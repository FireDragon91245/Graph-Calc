using System.Collections.Concurrent;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using GraphCalc.Api.Configuration;
using GraphCalc.Api.Contracts;
using GraphCalc.Api.Documents;
using GraphCalc.Api.Infrastructure;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Bson.IO;
using MongoDB.Driver;

namespace GraphCalc.Api.Services;

public sealed class BackendStore
{
    private const string DefaultProjectName = "Default Project";
    private const string DefaultGraphId = "main";
    private const string DefaultGraphName = "Main";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly GraphCalcOptions _options;
    private readonly ILogger<BackendStore> _logger;
    private readonly string _backendRoot;
    private readonly string _dataDir;
    private readonly string _userDataDir;
    private readonly string _legacyProjectsDir;
    private readonly string _legacyMetaFile;
    private readonly string _usersFile;
    private readonly SemaphoreSlim _initializeLock = new(1, 1);
    private readonly ConcurrentDictionary<string, CacheEntry<UserDocument>> _userCacheById = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, string> _userIdByUsername = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CacheEntry<WorkspaceDocument>> _workspaceCache = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CacheEntry<ProjectDocument>> _projectCache = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CacheEntry<GraphDocument>> _graphCache = new(StringComparer.Ordinal);

    private IMongoDatabase? _database;
    private bool _initialized;

    private sealed record MongoConnectionCandidate(MongoClientSettings Settings, string ConnectionMode);

    public BackendStore(IOptions<GraphCalcOptions> options, IWebHostEnvironment environment, ILogger<BackendStore> logger)
    {
        _options = options.Value;
        _logger = logger;
        _backendRoot = Path.GetFullPath(Path.Combine(environment.ContentRootPath, ".."));
        _dataDir = Path.Combine(_backendRoot, "data");
        _userDataDir = Path.Combine(_dataDir, "user_data");
        _legacyProjectsDir = Path.Combine(_dataDir, "projects");
        _legacyMetaFile = Path.Combine(_dataDir, "projects_meta.json");
        _usersFile = Path.Combine(_dataDir, "users.json");
    }

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        if (_initialized)
        {
            return;
        }

        await _initializeLock.WaitAsync(cancellationToken);
        try
        {
            if (_initialized)
            {
                return;
            }

            _database = await ConnectAsync(cancellationToken);
            _initialized = true;
            await EnsureIndexesAsync(cancellationToken);
            await MigrateLegacyDataIfNeededAsync(cancellationToken);
        }
        catch
        {
            _initialized = false;
            throw;
        }
        finally
        {
            _initializeLock.Release();
        }
    }

    public async Task RunCacheMaintenanceAsync(CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var idleCutoff = now.AddSeconds(-_options.Caching.EntryIdleTtlSeconds);
        var dirtyCutoff = now.AddSeconds(-_options.Caching.DirtyWriteBackSeconds);

        await FlushDirtyProjectsAsync(dirtyCutoff, idleCutoff, flushAll: false, cancellationToken);
        await FlushDirtyGraphsAsync(dirtyCutoff, idleCutoff, flushAll: false, cancellationToken);

        EvictIdleUsers(idleCutoff);
        EvictIdleEntries(_workspaceCache, idleCutoff);
        EvictIdleEntries(_projectCache, idleCutoff);
        EvictIdleEntries(_graphCache, idleCutoff);
    }

    public async Task FlushAllDirtyCacheAsync(CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        await FlushDirtyProjectsAsync(DateTime.MinValue, DateTime.MinValue, flushAll: true, cancellationToken);
        await FlushDirtyGraphsAsync(DateTime.MinValue, DateTime.MinValue, flushAll: true, cancellationToken);
    }

    public async Task<UserDocument?> GetUserByIdAsync(string userId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        if (_userCacheById.TryGetValue(userId, out var cachedUser))
        {
            return ReadCachedValue(cachedUser, CloneUserDocument);
        }

        var user = await Users().Find(x => x.Id == userId).FirstOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return null;
        }

        CacheUser(user);
        return CloneUserDocument(user);
    }

    public async Task<UserDocument?> GetUserByUsernameAsync(string username, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        if (_userIdByUsername.TryGetValue(username, out var userId))
        {
            var cachedUser = await GetUserByIdAsync(userId, cancellationToken);
            if (cachedUser is not null && string.Equals(cachedUser.Username, username, StringComparison.Ordinal))
            {
                return cachedUser;
            }

            _userIdByUsername.TryRemove(username, out _);
        }

        var user = await Users().Find(x => x.Username == username).FirstOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return null;
        }

        CacheUser(user);
        return CloneUserDocument(user);
    }

    public async Task<UserDocument> CreateUserAsync(string username, string passwordSalt, string passwordHash, int passwordIterations, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var user = new UserDocument
        {
            Id = GenerateId(),
            Username = username,
            SessionVersion = _options.Auth.DefaultSessionVersion,
            PasswordSalt = passwordSalt,
            PasswordHash = passwordHash,
            PasswordIterations = passwordIterations
        };

        await Users().InsertOneAsync(user, cancellationToken: cancellationToken);
        await EnsureUserWorkspaceAsync(user.Id, cancellationToken);
        CacheUser(user);
        return CloneUserDocument(user);
    }

    public async Task ReplaceUserAsync(UserDocument user, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        await Users().ReplaceOneAsync(x => x.Id == user.Id, user, new ReplaceOptions { IsUpsert = true }, cancellationToken);
        CacheUser(user);
    }

    public async Task DeleteAccountAsync(string userId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var existingUser = await GetUserByIdAsync(userId, cancellationToken);
        await Graphs().DeleteManyAsync(x => x.UserId == userId, cancellationToken);
        await Projects().DeleteManyAsync(x => x.UserId == userId, cancellationToken);
        await Workspaces().DeleteOneAsync(x => x.Id == userId, cancellationToken);
        await Users().DeleteOneAsync(x => x.Id == userId, cancellationToken);

        if (!string.IsNullOrWhiteSpace(existingUser?.Username))
        {
            _userIdByUsername.TryRemove(existingUser.Username, out _);
        }

        _userCacheById.TryRemove(userId, out _);
        _workspaceCache.TryRemove(userId, out _);
        RemoveProjectCacheEntries(userId);
        RemoveGraphCacheEntries(userId);
    }

    public async Task<int> CountProjectsAsync(string userId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        return (int)await Projects().CountDocumentsAsync(x => x.UserId == userId, cancellationToken: cancellationToken);
    }

    public async Task<AccountProfileResponse> BuildAccountProfileAsync(UserDocument user, CancellationToken cancellationToken)
    {
        string? activeProjectId;
        try
        {
            activeProjectId = await GetActiveProjectIdAsync(user.Id, cancellationToken);
        }
        catch
        {
            activeProjectId = null;
        }

        return new AccountProfileResponse
        {
            Id = user.Id,
            Username = user.Username,
            ProjectCount = await CountProjectsAsync(user.Id, cancellationToken),
            ActiveProjectId = activeProjectId
        };
    }

    public async Task<string> GetJwtSecretAsync(CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var secretDoc = await Settings().Find(Builders<BsonDocument>.Filter.Eq("_id", "jwt-secret")).FirstOrDefaultAsync(cancellationToken);
        if (secretDoc is not null && secretDoc.TryGetValue("secret", out var existingSecret) && existingSecret.IsString && !string.IsNullOrWhiteSpace(existingSecret.AsString))
        {
            return existingSecret.AsString;
        }

        var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        await Settings().UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", "jwt-secret"),
            Builders<BsonDocument>.Update.SetOnInsert("secret", secret),
            new UpdateOptions { IsUpsert = true },
            cancellationToken);

        var stored = await Settings().Find(Builders<BsonDocument>.Filter.Eq("_id", "jwt-secret")).FirstAsync(cancellationToken);
        return stored["secret"].AsString;
    }

    public async Task<ProjectsResponse> ListProjectsAsync(string userId, CancellationToken cancellationToken)
    {
        await EnsureUserWorkspaceAsync(userId, cancellationToken);
        var projects = await Projects()
            .Find(x => x.UserId == userId)
            .SortBy(x => x.SortOrder)
            .ThenBy(x => x.Name)
            .ToListAsync(cancellationToken);

        return new ProjectsResponse
        {
            Projects = projects.Select(ToSummary).ToArray(),
            ActiveProjectId = await GetActiveProjectIdAsync(userId, cancellationToken)
        };
    }

    public async Task<EntitySummaryResponse> CreateProjectAsync(string userId, string name, CancellationToken cancellationToken)
    {
        await EnsureUserWorkspaceAsync(userId, cancellationToken);
        var projectId = GenerateId();
        var sortOrder = await NextSortOrderAsync(Projects().Find(x => x.UserId == userId).Project(x => x.SortOrder), cancellationToken);
        var project = DefaultProjectDocument(userId, projectId, name, sortOrder);
        await Projects().InsertOneAsync(project, cancellationToken: cancellationToken);
        var defaultGraph = DefaultGraphDocument(userId, projectId, DefaultGraphId, DefaultGraphName, 0);
        await Graphs().InsertOneAsync(defaultGraph, cancellationToken: cancellationToken);
        await SetActiveProjectIfMissingAsync(userId, projectId, cancellationToken);
        CacheProject(project);
        CacheGraph(defaultGraph);
        return ToSummary(project);
    }

    public async Task<bool> RenameProjectAsync(string userId, string projectId, string newName, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var result = await Projects().UpdateOneAsync(
            x => x.UserId == userId && x.ProjectId == projectId,
            Builders<ProjectDocument>.Update.Set(x => x.Name, newName),
            cancellationToken: cancellationToken);
        if (result.MatchedCount > 0)
        {
            UpdateCachedProject(userId, projectId, project => project.Name = newName, markDirty: false);
        }
        return result.MatchedCount > 0;
    }

    public async Task<EntitySummaryResponse> CopyProjectAsync(string userId, string projectId, string newName, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var sourceProject = await GetProjectAsync(userId, projectId, cancellationToken)
            ?? throw new ApiException(StatusCodes.Status404NotFound, $"Project {projectId} not found");

        var newProjectId = GenerateId();
        var sortOrder = await NextSortOrderAsync(Projects().Find(x => x.UserId == userId).Project(x => x.SortOrder), cancellationToken);
        var copy = DefaultProjectDocument(userId, newProjectId, newName, sortOrder);
        copy.ActiveGraphId = sourceProject.ActiveGraphId ?? DefaultGraphId;
        copy.Store = NormalizeStoreDocument(sourceProject.Store);
        await Projects().InsertOneAsync(copy, cancellationToken: cancellationToken);
        CacheProject(copy);

        var graphs = await Graphs()
            .Find(x => x.UserId == userId && x.ProjectId == projectId)
            .SortBy(x => x.SortOrder)
            .ThenBy(x => x.Name)
            .ToListAsync(cancellationToken);

        if (graphs.Count == 0)
        {
            var defaultGraph = DefaultGraphDocument(userId, newProjectId, DefaultGraphId, DefaultGraphName, 0);
            await Graphs().InsertOneAsync(defaultGraph, cancellationToken: cancellationToken);
            CacheGraph(defaultGraph);
        }
        else
        {
            var copies = graphs.Select(graph => new GraphDocument
            {
                Id = $"{userId}:{newProjectId}:{graph.GraphId}",
                UserId = userId,
                ProjectId = newProjectId,
                GraphId = graph.GraphId,
                Name = graph.Name,
                SortOrder = graph.SortOrder,
                Data = NormalizeGraphDocument(graph.Data)
            }).ToList();
            await Graphs().InsertManyAsync(copies, cancellationToken: cancellationToken);
            foreach (var graphCopy in copies)
            {
                CacheGraph(graphCopy);
            }
        }

        return ToSummary(copy);
    }

    public async Task<bool> DeleteProjectAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var result = await Projects().DeleteOneAsync(x => x.UserId == userId && x.ProjectId == projectId, cancellationToken);
        if (result.DeletedCount == 0)
        {
            return false;
        }

        await Graphs().DeleteManyAsync(x => x.UserId == userId && x.ProjectId == projectId, cancellationToken);
        _projectCache.TryRemove(ProjectCacheKey(userId, projectId), out _);
        RemoveGraphCacheEntries(userId, projectId);
        var workspace = await GetWorkspaceAsync(userId, cancellationToken);
        if (workspace?.ActiveProjectId == projectId)
        {
            var fallback = await Projects().Find(x => x.UserId == userId).SortBy(x => x.SortOrder).FirstOrDefaultAsync(cancellationToken);
            await Workspaces().UpdateOneAsync(
                x => x.Id == userId,
                Builders<WorkspaceDocument>.Update.Set(x => x.ActiveProjectId, fallback?.ProjectId),
                cancellationToken: cancellationToken);
            UpdateCachedWorkspace(userId, cached => cached.ActiveProjectId = fallback?.ProjectId);
        }

        return true;
    }

    public async Task<bool> SetActiveProjectAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var exists = await Projects().Find(x => x.UserId == userId && x.ProjectId == projectId).AnyAsync(cancellationToken);
        if (!exists)
        {
            return false;
        }

        await EnsureUserWorkspaceAsync(userId, cancellationToken);
        await Workspaces().UpdateOneAsync(x => x.Id == userId, Builders<WorkspaceDocument>.Update.Set(x => x.ActiveProjectId, projectId), cancellationToken: cancellationToken);
        UpdateCachedWorkspace(userId, cached => cached.ActiveProjectId = projectId);
        return true;
    }

    public async Task<string> GetActiveProjectIdAsync(string userId, CancellationToken cancellationToken)
    {
        await EnsureUserWorkspaceAsync(userId, cancellationToken);
        var workspace = await GetWorkspaceAsync(userId, cancellationToken);
        if (!string.IsNullOrWhiteSpace(workspace?.ActiveProjectId))
        {
            var existing = await GetProjectAsync(userId, workspace.ActiveProjectId, cancellationToken);
            if (existing is not null)
            {
                return workspace.ActiveProjectId;
            }
        }

        var firstProject = await Projects().Find(x => x.UserId == userId).SortBy(x => x.SortOrder).FirstOrDefaultAsync(cancellationToken);
        if (firstProject is not null)
        {
            await Workspaces().UpdateOneAsync(x => x.Id == userId, Builders<WorkspaceDocument>.Update.Set(x => x.ActiveProjectId, firstProject.ProjectId), cancellationToken: cancellationToken);
            return firstProject.ProjectId;
        }

        return (await CreateProjectAsync(userId, DefaultProjectName, cancellationToken)).Id;
    }

    public async Task RequireProjectAccessAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        if (await GetProjectAsync(userId, projectId, cancellationToken) is null)
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Project not found");
        }
    }

    public async Task<GraphsResponse> ListGraphsAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        await EnsureProjectGraphsAsync(userId, projectId, cancellationToken);
        var project = await GetProjectAsync(userId, projectId, cancellationToken);
        if (project is null)
        {
            return new GraphsResponse { Graphs = [], ActiveGraphId = null };
        }

        var graphs = await Graphs()
            .Find(x => x.UserId == userId && x.ProjectId == projectId)
            .SortBy(x => x.SortOrder)
            .ThenBy(x => x.Name)
            .ToListAsync(cancellationToken);
        var activeGraphId = project.ActiveGraphId;
        if (graphs.Count > 0 && graphs.All(x => x.GraphId != activeGraphId))
        {
            activeGraphId = graphs[0].GraphId;
            await Projects().UpdateOneAsync(
                x => x.UserId == userId && x.ProjectId == projectId,
                Builders<ProjectDocument>.Update.Set(x => x.ActiveGraphId, activeGraphId),
                cancellationToken: cancellationToken);
            UpdateCachedProject(userId, projectId, project => project.ActiveGraphId = activeGraphId, markDirty: false);
        }

        return new GraphsResponse
        {
            Graphs = graphs.Select(ToSummary).ToArray(),
            ActiveGraphId = activeGraphId
        };
    }

    public async Task<EntitySummaryResponse> CreateGraphAsync(string userId, string projectId, string name, CancellationToken cancellationToken)
    {
        await RequireProjectAccessAsync(userId, projectId, cancellationToken);
        var graphId = GenerateId();
        var sortOrder = await NextSortOrderAsync(Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId).Project(x => x.SortOrder), cancellationToken);
        var graph = DefaultGraphDocument(userId, projectId, graphId, name, sortOrder);
        await Graphs().InsertOneAsync(graph, cancellationToken: cancellationToken);
        await SetActiveGraphIfMissingAsync(userId, projectId, graphId, cancellationToken);
        CacheGraph(graph);
        return ToSummary(graph);
    }

    public async Task<bool> RenameGraphAsync(string userId, string projectId, string graphId, string newName, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var result = await Graphs().UpdateOneAsync(
            x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId,
            Builders<GraphDocument>.Update.Set(x => x.Name, newName),
            cancellationToken: cancellationToken);
        if (result.MatchedCount > 0)
        {
            UpdateCachedGraph(userId, projectId, graphId, graph => graph.Name = newName, markDirty: false);
        }
        return result.MatchedCount > 0;
    }

    public async Task<EntitySummaryResponse> CopyGraphAsync(string userId, string projectId, string graphId, string newName, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var sourceGraph = await Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new ApiException(StatusCodes.Status404NotFound, $"Graph {graphId} not found in project {projectId}");
        var newGraphId = GenerateId();
        var sortOrder = await NextSortOrderAsync(Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId).Project(x => x.SortOrder), cancellationToken);
        var graph = DefaultGraphDocument(userId, projectId, newGraphId, newName, sortOrder);
        graph.Data = NormalizeGraphDocument(sourceGraph.Data);
        await Graphs().InsertOneAsync(graph, cancellationToken: cancellationToken);
        CacheGraph(graph);
        return ToSummary(graph);
    }

    public async Task<bool> DeleteGraphAsync(string userId, string projectId, string graphId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var result = await Graphs().DeleteOneAsync(x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId, cancellationToken);
        if (result.DeletedCount == 0)
        {
            return false;
        }

        _graphCache.TryRemove(GraphCacheKey(userId, projectId, graphId), out _);

        var project = await GetProjectAsync(userId, projectId, cancellationToken);
        if (project?.ActiveGraphId == graphId)
        {
            var fallback = await Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId).SortBy(x => x.SortOrder).FirstOrDefaultAsync(cancellationToken);
            await Projects().UpdateOneAsync(
                x => x.UserId == userId && x.ProjectId == projectId,
                Builders<ProjectDocument>.Update.Set(x => x.ActiveGraphId, fallback?.GraphId),
                cancellationToken: cancellationToken);
            UpdateCachedProject(userId, projectId, cached => cached.ActiveGraphId = fallback?.GraphId, markDirty: false);
        }

        return true;
    }

    public async Task<bool> SetActiveGraphAsync(string userId, string projectId, string graphId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var exists = await Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId).AnyAsync(cancellationToken);
        if (!exists)
        {
            return false;
        }

        var result = await Projects().UpdateOneAsync(
            x => x.UserId == userId && x.ProjectId == projectId,
            Builders<ProjectDocument>.Update.Set(x => x.ActiveGraphId, graphId),
            cancellationToken: cancellationToken);
        if (result.MatchedCount > 0)
        {
            UpdateCachedProject(userId, projectId, project => project.ActiveGraphId = graphId, markDirty: false);
        }
        return result.MatchedCount > 0;
    }

    public async Task<GraphData> LoadGraphAsync(string userId, string projectId, string graphId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        if (_graphCache.TryGetValue(GraphCacheKey(userId, projectId, graphId), out var cachedGraph))
        {
            return ReadCachedValue(cachedGraph, graph => FromBsonDocument(graph.Data, DefaultGraphData));
        }

        var graph = await Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId).FirstOrDefaultAsync(cancellationToken);
        if (graph is not null)
        {
            CacheGraph(graph);
        }

        return graph is null ? DefaultGraphData() : FromBsonDocument(graph.Data, DefaultGraphData);
    }

    public async Task SaveGraphAsync(string userId, string projectId, string graphId, GraphData data, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var normalized = NormalizeGraphData(data);
        if (_graphCache.TryGetValue(GraphCacheKey(userId, projectId, graphId), out var cachedGraph))
        {
            UpdateCachedEntry(cachedGraph, graph => graph.Data = normalized, markDirty: true);
            return;
        }

        var existing = await Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId).FirstOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            existing.Data = normalized;
            CacheGraph(existing, dirty: true);
            return;
        }

        var sortOrder = await NextSortOrderAsync(Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId).Project(x => x.SortOrder), cancellationToken);
        var graph = DefaultGraphDocument(userId, projectId, graphId, graphId, sortOrder);
        graph.Data = normalized;
        await Graphs().InsertOneAsync(graph, cancellationToken: cancellationToken);
        CacheGraph(graph);
    }

    public async Task<StoreData> LoadStoreAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        var project = await GetProjectAsync(userId, projectId, cancellationToken);
        return project is null ? DefaultStoreData() : FromBsonDocument(project.Store, DefaultStoreData);
    }

    public async Task SaveStoreAsync(string userId, string projectId, StoreData store, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var normalized = NormalizeStoreData(store);
        if (_projectCache.TryGetValue(ProjectCacheKey(userId, projectId), out var cachedProject))
        {
            UpdateCachedEntry(cachedProject, project => project.Store = normalized, markDirty: true);
            return;
        }

        var project = await Projects().Find(x => x.UserId == userId && x.ProjectId == projectId).FirstOrDefaultAsync(cancellationToken);
        if (project is null)
        {
            return;
        }

        project.Store = normalized;
        CacheProject(project, dirty: true);
    }

    private async Task<IMongoDatabase> ConnectAsync(CancellationToken cancellationToken)
    {
        var candidateSettings = BuildCandidateMongoSettings();
        Exception? lastError = null;

        foreach (var candidate in candidateSettings)
        {
            try
            {
                var client = new MongoClient(candidate.Settings);
                var database = client.GetDatabase(_options.Mongo.Database);
                await database.RunCommandAsync((Command<BsonDocument>)"{ ping: 1 }", cancellationToken: cancellationToken);
                _logger.LogInformation("Connected to MongoDB using {ConnectionMode}", candidate.ConnectionMode);
                return database;
            }
            catch (Exception ex)
            {
                lastError = ex;
                _logger.LogWarning(ex, "MongoDB connection attempt failed using {ConnectionMode}", candidate.ConnectionMode);
            }
        }

        throw lastError ?? new InvalidOperationException("Unable to connect to MongoDB");
    }

    private MongoConnectionCandidate[] BuildCandidateMongoSettings()
    {
        var candidates = new List<MongoConnectionCandidate>
        {
            BuildMongoConnectionCandidate(includeCredentials: true)
        };

        if (_options.Mongo.AllowNoAuthFallback && UsesMongoCredential())
        {
            candidates.Add(BuildMongoConnectionCandidate(includeCredentials: false));
        }

        return candidates.ToArray();
    }

    private MongoConnectionCandidate BuildMongoConnectionCandidate(bool includeCredentials)
    {
        var clientCertificate = LoadMongoClientCertificate();
        var settings = new MongoClientSettings
        {
            Server = new MongoServerAddress(_options.Mongo.Host, _options.Mongo.Port)
        };

        var credential = BuildMongoCredential(includeCredentials, clientCertificate);
        if (credential is not null)
        {
            settings.Credential = credential;
        }

        ConfigureMongoTls(settings, clientCertificate);

        var connectionMode = DescribeConnectionMode(includeCredentials, clientCertificate is not null);
        return new MongoConnectionCandidate(settings, connectionMode);
    }

    private MongoCredential? BuildMongoCredential(bool includeCredentials, X509Certificate2? clientCertificate)
    {
        if (!includeCredentials)
        {
            return null;
        }

        return NormalizeAuthenticationMode() switch
        {
            "none" => null,
            "password" => BuildPasswordCredential(),
            "x509" => BuildX509Credential(clientCertificate),
            var mode => throw new InvalidOperationException($"Unsupported mongo.authenticationMode '{mode}'. Expected one of: none, password, x509.")
        };
    }

    private MongoCredential BuildPasswordCredential()
    {
        if (string.IsNullOrWhiteSpace(_options.Mongo.Username))
        {
            throw new InvalidOperationException("MongoDB password authentication requires mongo.username.");
        }

        return MongoCredential.CreateCredential(
            _options.Mongo.AuthDatabase,
            _options.Mongo.Username,
            _options.Mongo.Password);
    }

    private MongoCredential BuildX509Credential(X509Certificate2? clientCertificate)
    {
        if (!_options.Mongo.Tls.Enabled)
        {
            throw new InvalidOperationException("MongoDB X.509 authentication requires mongo.tls.enabled=true.");
        }

        if (clientCertificate is null)
        {
            throw new InvalidOperationException("MongoDB X.509 authentication requires mongo.tls.clientCertificate to be configured.");
        }

        if (string.IsNullOrWhiteSpace(_options.Mongo.Username))
        {
            throw new InvalidOperationException("MongoDB X.509 authentication requires mongo.username to contain the certificate subject/username.");
        }

        return MongoCredential.CreateMongoX509Credential(_options.Mongo.Username);
    }

    private void ConfigureMongoTls(MongoClientSettings settings, X509Certificate2? clientCertificate)
    {
        if (!_options.Mongo.Tls.Enabled)
        {
            return;
        }

        settings.UseTls = true;
        settings.SslSettings = new SslSettings
        {
            CheckCertificateRevocation = _options.Mongo.Tls.CheckCertificateRevocation,
            ClientCertificates = BuildMongoClientCertificates(clientCertificate),
            ServerCertificateValidationCallback = BuildServerCertificateValidationCallback()
        };
    }

    private IEnumerable<X509Certificate>? BuildMongoClientCertificates(X509Certificate2? clientCertificate)
    {
        return clientCertificate is null ? null : [clientCertificate];
    }

    private RemoteCertificateValidationCallback? BuildServerCertificateValidationCallback()
    {
        if (_options.Mongo.Tls.VerifyServerCertificate)
        {
            return null;
        }

        return static (_, _, _, _) => true;
    }

    private bool UsesMongoCredential() => NormalizeAuthenticationMode() is "password" or "x509";

    private string NormalizeAuthenticationMode() => _options.Mongo.AuthenticationMode.Trim().ToLowerInvariant();

    private string DescribeConnectionMode(bool includeCredentials, bool hasClientCertificate)
    {
        var authMode = includeCredentials ? NormalizeAuthenticationMode() : "none";
        var transport = _options.Mongo.Tls.Enabled
            ? _options.Mongo.Tls.VerifyServerCertificate ? "tls-verified" : "tls-unverified"
            : "plain";
        var clientCertificate = hasClientCertificate ? "client-cert" : "no-client-cert";
        return $"{transport}/{authMode}/{clientCertificate}";
    }

    private X509Certificate2? LoadMongoClientCertificate()
    {
        var certificateOptions = _options.Mongo.Tls.ClientCertificate;
        if (certificateOptions is null)
        {
            return null;
        }

        var hasPfx = !string.IsNullOrWhiteSpace(certificateOptions.PfxFile);
        var hasPem = !string.IsNullOrWhiteSpace(certificateOptions.CertFile) || !string.IsNullOrWhiteSpace(certificateOptions.KeyFile);

        if (!hasPfx && !hasPem)
        {
            return null;
        }

        if (hasPfx && hasPem)
        {
            throw new InvalidOperationException("Configure either mongo.tls.clientCertificate.pfxFile or mongo.tls.clientCertificate.certFile/keyFile, not both.");
        }

        if (hasPfx)
        {
            var pfxPath = ResolveBackendPath(certificateOptions.PfxFile);
            return LoadPkcs12Certificate(pfxPath, certificateOptions.PfxPassword);
        }

        if (string.IsNullOrWhiteSpace(certificateOptions.CertFile) || string.IsNullOrWhiteSpace(certificateOptions.KeyFile))
        {
            throw new InvalidOperationException("mongo.tls.clientCertificate.certFile and keyFile must both be set when using PEM client certificates.");
        }

        var certPath = ResolveBackendPath(certificateOptions.CertFile);
        var keyPath = ResolveBackendPath(certificateOptions.KeyFile);
        return LoadPemCertificate(certPath, keyPath);
    }

    private string ResolveBackendPath(string relativeOrAbsolutePath)
    {
        return Path.IsPathRooted(relativeOrAbsolutePath)
            ? relativeOrAbsolutePath
            : Path.GetFullPath(Path.Combine(_backendRoot, relativeOrAbsolutePath));
    }

    private static X509Certificate2 LoadPkcs12Certificate(string pfxPath, string password)
    {
        var effectivePassword = string.IsNullOrEmpty(password) ? null : password;
        return X509CertificateLoader.LoadPkcs12FromFile(pfxPath, effectivePassword);
    }

    private static X509Certificate2 LoadPemCertificate(string certPath, string keyPath)
    {
        using var pemCertificate = X509Certificate2.CreateFromPemFile(certPath, keyPath);
        return OperatingSystem.IsWindows()
            ? X509CertificateLoader.LoadPkcs12(pemCertificate.Export(X509ContentType.Pfx), password: null)
            : pemCertificate;
    }

    private async Task EnsureIndexesAsync(CancellationToken cancellationToken)
    {
        await Users().Indexes.CreateOneAsync(new CreateIndexModel<UserDocument>(Builders<UserDocument>.IndexKeys.Ascending(x => x.Username), new CreateIndexOptions { Unique = true }), cancellationToken: cancellationToken);
        await Projects().Indexes.CreateManyAsync(
        [
            new CreateIndexModel<ProjectDocument>(Builders<ProjectDocument>.IndexKeys.Ascending(x => x.UserId).Ascending(x => x.ProjectId), new CreateIndexOptions { Unique = true }),
            new CreateIndexModel<ProjectDocument>(Builders<ProjectDocument>.IndexKeys.Ascending(x => x.UserId).Ascending(x => x.SortOrder))
        ], cancellationToken);
        await Graphs().Indexes.CreateManyAsync(
        [
            new CreateIndexModel<GraphDocument>(Builders<GraphDocument>.IndexKeys.Ascending(x => x.UserId).Ascending(x => x.ProjectId).Ascending(x => x.GraphId), new CreateIndexOptions { Unique = true }),
            new CreateIndexModel<GraphDocument>(Builders<GraphDocument>.IndexKeys.Ascending(x => x.UserId).Ascending(x => x.ProjectId).Ascending(x => x.SortOrder))
        ], cancellationToken);
    }

    private async Task MigrateLegacyDataIfNeededAsync(CancellationToken cancellationToken)
    {
        var marker = await Settings().Find(Builders<BsonDocument>.Filter.Eq("_id", "legacy-import")).FirstOrDefaultAsync(cancellationToken);
        if (marker is not null && marker.TryGetValue("completed", out var completed) && completed.ToBoolean())
        {
            return;
        }

        var hasExistingData =
            await Users().EstimatedDocumentCountAsync(cancellationToken: cancellationToken) > 0 ||
            await Projects().EstimatedDocumentCountAsync(cancellationToken: cancellationToken) > 0 ||
            await Graphs().EstimatedDocumentCountAsync(cancellationToken: cancellationToken) > 0 ||
            await Workspaces().EstimatedDocumentCountAsync(cancellationToken: cancellationToken) > 0;
        if (hasExistingData)
        {
            await SetLegacyMarkerAsync("mongo-existing", cancellationToken);
            return;
        }

        var legacyUsers = LoadLegacyUsers();
        var importedAny = false;
        var currentUsers = new List<UserDocument>();
        foreach (var user in legacyUsers)
        {
            currentUsers.RemoveAll(x => x.Id == user.Id);
            currentUsers.Add(user);
            await EnsureUserWorkspaceAsync(user.Id, cancellationToken);

            var userMeta = Path.Combine(_userDataDir, user.Id, "projects_meta.json");
            var userProjects = Path.Combine(_userDataDir, user.Id, "projects");
            if (File.Exists(userMeta) || Directory.Exists(userProjects))
            {
                await ImportWorkspaceAsync(user.Id, userMeta, userProjects, replaceExisting: false, cancellationToken);
                importedAny = true;
            }
        }

        if (currentUsers.Count > 0)
        {
            foreach (var user in currentUsers)
            {
                await Users().ReplaceOneAsync(x => x.Id == user.Id, user, new ReplaceOptions { IsUpsert = true }, cancellationToken);
            }
        }

        if (!importedAny && currentUsers.Count > 0 && (File.Exists(_legacyMetaFile) || Directory.Exists(_legacyProjectsDir)))
        {
            await ImportWorkspaceAsync(currentUsers[0].Id, _legacyMetaFile, _legacyProjectsDir, replaceExisting: false, cancellationToken);
            importedAny = true;
        }

        await SetLegacyMarkerAsync(importedAny ? "json-files" : "none", cancellationToken);
    }

    private async Task SetLegacyMarkerAsync(string source, CancellationToken cancellationToken)
    {
        await Settings().ReplaceOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", "legacy-import"),
            new BsonDocument { ["_id"] = "legacy-import", ["completed"] = true, ["source"] = source },
            new ReplaceOptions { IsUpsert = true },
            cancellationToken);
    }

    private List<UserDocument> LoadLegacyUsers()
    {
        if (!File.Exists(_usersFile))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(_usersFile));
            if (!document.RootElement.TryGetProperty("users", out var usersElement) || usersElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var users = new List<UserDocument>();
            foreach (var element in usersElement.EnumerateArray())
            {
                users.Add(new UserDocument
                {
                    Id = element.TryGetProperty("id", out var idProp) && idProp.ValueKind == JsonValueKind.String ? idProp.GetString()! : GenerateId(),
                    Username = element.TryGetProperty("username", out var usernameProp) && usernameProp.ValueKind == JsonValueKind.String ? usernameProp.GetString()! : string.Empty,
                    SessionVersion = element.TryGetProperty("sessionVersion", out var sessionVersionProp) && sessionVersionProp.TryGetInt32(out var sessionVersion) ? sessionVersion : _options.Auth.DefaultSessionVersion,
                    PasswordSalt = element.TryGetProperty("passwordSalt", out var saltProp) && saltProp.ValueKind == JsonValueKind.String ? saltProp.GetString()! : string.Empty,
                    PasswordHash = element.TryGetProperty("passwordHash", out var hashProp) && hashProp.ValueKind == JsonValueKind.String ? hashProp.GetString()! : string.Empty,
                    PasswordIterations = element.TryGetProperty("passwordIterations", out var iterationsProp) && iterationsProp.TryGetInt32(out var iterations) ? iterations : _options.Auth.PasswordHashIterations
                });
            }

            return users.Where(x => !string.IsNullOrWhiteSpace(x.Username)).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read legacy users file");
            return [];
        }
    }

    private async Task ImportWorkspaceAsync(string userId, string metaPath, string projectsDir, bool replaceExisting, CancellationToken cancellationToken)
    {
        await EnsureUserWorkspaceAsync(userId, cancellationToken);
        if (replaceExisting)
        {
            await Graphs().DeleteManyAsync(x => x.UserId == userId, cancellationToken);
            await Projects().DeleteManyAsync(x => x.UserId == userId, cancellationToken);
        }

        using var meta = LoadJsonDocument(metaPath);
        var projectEntries = meta?.RootElement.TryGetProperty("projects", out var projectsElement) == true && projectsElement.ValueKind == JsonValueKind.Array
            ? projectsElement.EnumerateArray().ToArray()
            : [];

        for (var index = 0; index < projectEntries.Length; index++)
        {
            var projectElement = projectEntries[index];
            var projectId = projectElement.TryGetProperty("id", out var projectIdProp) && projectIdProp.ValueKind == JsonValueKind.String
                ? projectIdProp.GetString()!
                : GenerateId();
            var projectName = projectElement.TryGetProperty("name", out var projectNameProp) && projectNameProp.ValueKind == JsonValueKind.String
                ? projectNameProp.GetString()!
                : $"Project {index + 1}";
            var project = DefaultProjectDocument(userId, projectId, projectName, index);
            var storePath = Path.Combine(projectsDir, projectId, "store.json");
            project.Store = NormalizeStoreDocument(LoadBsonDocument(storePath) ?? NormalizeStoreData(DefaultStoreData()));
            await Projects().ReplaceOneAsync(x => x.Id == project.Id, project, new ReplaceOptions { IsUpsert = true }, cancellationToken);

            var graphsMetaPath = Path.Combine(projectsDir, projectId, "graphs_meta.json");
            using var graphMeta = LoadJsonDocument(graphsMetaPath);
            var graphEntries = graphMeta?.RootElement.TryGetProperty("graphs", out var graphsElement) == true && graphsElement.ValueKind == JsonValueKind.Array
                ? graphsElement.EnumerateArray().ToArray()
                : [CreateDefaultGraphMetaElement()];
            var activeGraphId = graphMeta?.RootElement.TryGetProperty("activeGraphId", out var activeGraphElement) == true && activeGraphElement.ValueKind == JsonValueKind.String
                ? activeGraphElement.GetString()
                : DefaultGraphId;

            await Graphs().DeleteManyAsync(x => x.UserId == userId && x.ProjectId == projectId, cancellationToken);
            for (var graphIndex = 0; graphIndex < graphEntries.Length; graphIndex++)
            {
                var graphElement = graphEntries[graphIndex];
                var graphId = graphElement.TryGetProperty("id", out var graphIdProp) && graphIdProp.ValueKind == JsonValueKind.String
                    ? graphIdProp.GetString()!
                    : GenerateId();
                var graphName = graphElement.TryGetProperty("name", out var graphNameProp) && graphNameProp.ValueKind == JsonValueKind.String
                    ? graphNameProp.GetString()!
                    : graphId;
                var graphFile = Path.Combine(projectsDir, projectId, "graphs", $"{graphId}.json");
                if (!File.Exists(graphFile) && string.Equals(graphId, DefaultGraphId, StringComparison.Ordinal))
                {
                    graphFile = Path.Combine(projectsDir, projectId, "graph.json");
                }

                var graph = DefaultGraphDocument(userId, projectId, graphId, graphName, graphIndex);
                graph.Data = NormalizeGraphDocument(LoadBsonDocument(graphFile) ?? NormalizeGraphData(DefaultGraphData()));
                await Graphs().ReplaceOneAsync(x => x.Id == graph.Id, graph, new ReplaceOptions { IsUpsert = true }, cancellationToken);
            }

            await Projects().UpdateOneAsync(
                x => x.UserId == userId && x.ProjectId == projectId,
                Builders<ProjectDocument>.Update.Set(x => x.ActiveGraphId, activeGraphId ?? DefaultGraphId),
                cancellationToken: cancellationToken);
        }

        var activeProjectId = meta?.RootElement.TryGetProperty("activeProjectId", out var activeProjectElement) == true && activeProjectElement.ValueKind == JsonValueKind.String
            ? activeProjectElement.GetString()
            : null;
        await Workspaces().ReplaceOneAsync(
            x => x.Id == userId,
            new WorkspaceDocument { Id = userId, UserId = userId, ActiveProjectId = activeProjectId },
            new ReplaceOptions { IsUpsert = true },
            cancellationToken);

        if (projectEntries.Length == 0)
        {
            await GetActiveProjectIdAsync(userId, cancellationToken);
        }
    }

    private static JsonElement CreateDefaultGraphMetaElement()
    {
        using var document = JsonDocument.Parse("{\"id\":\"main\",\"name\":\"Main\"}");
        return document.RootElement.Clone();
    }

    private async Task EnsureUserWorkspaceAsync(string userId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        if (_workspaceCache.ContainsKey(userId))
        {
            return;
        }

        await Workspaces().UpdateOneAsync(
            x => x.Id == userId,
            Builders<WorkspaceDocument>.Update.SetOnInsert(x => x.UserId, userId).SetOnInsert(x => x.ActiveProjectId, null),
            new UpdateOptions { IsUpsert = true },
            cancellationToken);

        var workspace = await Workspaces().Find(x => x.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? new WorkspaceDocument { Id = userId, UserId = userId, ActiveProjectId = null };
        CacheWorkspace(workspace);
    }

    private async Task EnsureProjectGraphsAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        var project = await GetProjectAsync(userId, projectId, cancellationToken);
        if (project is null)
        {
            return;
        }

        var count = await Graphs().CountDocumentsAsync(x => x.UserId == userId && x.ProjectId == projectId, cancellationToken: cancellationToken);
        if (count == 0)
        {
            var defaultGraph = DefaultGraphDocument(userId, projectId, DefaultGraphId, DefaultGraphName, 0);
            await Graphs().InsertOneAsync(defaultGraph, cancellationToken: cancellationToken);
            await Projects().UpdateOneAsync(
                x => x.UserId == userId && x.ProjectId == projectId,
                Builders<ProjectDocument>.Update.Set(x => x.ActiveGraphId, DefaultGraphId),
                cancellationToken: cancellationToken);
            CacheGraph(defaultGraph);
            UpdateCachedProject(userId, projectId, cached => cached.ActiveGraphId = DefaultGraphId, markDirty: false);
        }
    }

    private async Task SetActiveProjectIfMissingAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        var workspace = await GetWorkspaceAsync(userId, cancellationToken);
        if (string.IsNullOrWhiteSpace(workspace?.ActiveProjectId))
        {
            await Workspaces().UpdateOneAsync(x => x.Id == userId, Builders<WorkspaceDocument>.Update.Set(x => x.ActiveProjectId, projectId), cancellationToken: cancellationToken);
            UpdateCachedWorkspace(userId, cached => cached.ActiveProjectId = projectId);
        }
    }

    private async Task SetActiveGraphIfMissingAsync(string userId, string projectId, string graphId, CancellationToken cancellationToken)
    {
        var project = await GetProjectAsync(userId, projectId, cancellationToken);
        if (project is not null && string.IsNullOrWhiteSpace(project.ActiveGraphId))
        {
            await Projects().UpdateOneAsync(
                x => x.UserId == userId && x.ProjectId == projectId,
                Builders<ProjectDocument>.Update.Set(x => x.ActiveGraphId, graphId),
                cancellationToken: cancellationToken);
            UpdateCachedProject(userId, projectId, cached => cached.ActiveGraphId = graphId, markDirty: false);
        }
    }

    private async Task<WorkspaceDocument?> GetWorkspaceAsync(string userId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        if (_workspaceCache.TryGetValue(userId, out var cachedWorkspace))
        {
            return ReadCachedValue(cachedWorkspace, CloneWorkspaceDocument);
        }

        var workspace = await Workspaces().Find(x => x.Id == userId).FirstOrDefaultAsync(cancellationToken);
        if (workspace is null)
        {
            return null;
        }

        CacheWorkspace(workspace);
        return CloneWorkspaceDocument(workspace);
    }

    private async Task<ProjectDocument?> GetProjectAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var cacheKey = ProjectCacheKey(userId, projectId);
        if (_projectCache.TryGetValue(cacheKey, out var cachedProject))
        {
            return ReadCachedValue(cachedProject, CloneProjectDocument);
        }

        var project = await Projects().Find(x => x.UserId == userId && x.ProjectId == projectId).FirstOrDefaultAsync(cancellationToken);
        if (project is null)
        {
            return null;
        }

        CacheProject(project);
        return CloneProjectDocument(project);
    }

    private static async Task<int> NextSortOrderAsync<TDocument>(IFindFluent<TDocument, int> sortProjection, CancellationToken cancellationToken)
    {
        var sortOrders = await sortProjection.SortByDescending(x => x).Limit(1).ToListAsync(cancellationToken);
        return sortOrders.Count == 0 ? 0 : sortOrders[0] + 1;
    }

    private static EntitySummaryResponse ToSummary(ProjectDocument project)
    {
        return new EntitySummaryResponse { Id = project.ProjectId, Name = project.Name };
    }

    private static EntitySummaryResponse ToSummary(GraphDocument graph)
    {
        return new EntitySummaryResponse { Id = graph.GraphId, Name = graph.Name };
    }

    private static string GenerateId()
    {
        return Guid.NewGuid().ToString("N")[..12];
    }

    private ProjectDocument DefaultProjectDocument(string userId, string projectId, string name, int sortOrder)
    {
        return new ProjectDocument
        {
            Id = $"{userId}:{projectId}",
            UserId = userId,
            ProjectId = projectId,
            Name = name,
            SortOrder = sortOrder,
            ActiveGraphId = DefaultGraphId,
            Store = NormalizeStoreData(DefaultStoreData())
        };
    }

    private GraphDocument DefaultGraphDocument(string userId, string projectId, string graphId, string name, int sortOrder)
    {
        return new GraphDocument
        {
            Id = $"{userId}:{projectId}:{graphId}",
            UserId = userId,
            ProjectId = projectId,
            GraphId = graphId,
            Name = name,
            SortOrder = sortOrder,
            Data = NormalizeGraphData(DefaultGraphData())
        };
    }

    private static GraphData DefaultGraphData()
    {
        return new GraphData();
    }

    private static StoreData DefaultStoreData()
    {
        return new StoreData();
    }

    private static BsonDocument NormalizeGraphData(GraphData data)
    {
        return ToBsonDocument(new GraphData
        {
            Nodes = data.Nodes ?? [],
            Edges = data.Edges ?? []
        });
    }

    private static BsonDocument NormalizeStoreData(StoreData store)
    {
        return ToBsonDocument(new StoreData
        {
            Categories = store.Categories ?? [],
            Items = store.Items ?? [],
            Tags = store.Tags ?? [],
            RecipeTags = store.RecipeTags ?? [],
            Recipes = store.Recipes ?? []
        });
    }

    private static BsonDocument NormalizeGraphDocument(BsonDocument? document)
    {
        return NormalizeGraphData(FromBsonDocument(document, DefaultGraphData));
    }

    private static BsonDocument NormalizeStoreDocument(BsonDocument? document)
    {
        return NormalizeStoreData(FromBsonDocument(document, DefaultStoreData));
    }

    private static T FromBsonDocument<T>(BsonDocument? document, Func<T> fallback)
    {
        if (document is null || document.ElementCount == 0)
        {
            return fallback();
        }

        var json = document.ToJson(new JsonWriterSettings { OutputMode = JsonOutputMode.RelaxedExtendedJson });
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? fallback();
    }

    private static BsonDocument ToBsonDocument<T>(T value)
    {
        return BsonDocument.Parse(JsonSerializer.Serialize(value, JsonOptions));
    }

    private async Task FlushDirtyProjectsAsync(DateTime dirtyCutoffUtc, DateTime idleCutoffUtc, bool flushAll, CancellationToken cancellationToken)
    {
        foreach (var pair in _projectCache.ToArray())
        {
            var entry = pair.Value;
            long dirtyVersion;
            ProjectDocument snapshot;

            lock (entry.SyncRoot)
            {
                if (!entry.IsDirty || (!flushAll && entry.DirtySinceUtc > dirtyCutoffUtc && entry.LastAccessUtc > idleCutoffUtc))
                {
                    continue;
                }

                dirtyVersion = entry.DirtyVersion;
                snapshot = CloneProjectDocument(entry.Value);
            }

            await Projects().ReplaceOneAsync(x => x.Id == snapshot.Id, snapshot, new ReplaceOptions { IsUpsert = true }, cancellationToken);

            lock (entry.SyncRoot)
            {
                if (entry.IsDirty && entry.DirtyVersion == dirtyVersion)
                {
                    entry.IsDirty = false;
                    entry.DirtySinceUtc = default;
                }
            }
        }
    }

    private async Task FlushDirtyGraphsAsync(DateTime dirtyCutoffUtc, DateTime idleCutoffUtc, bool flushAll, CancellationToken cancellationToken)
    {
        foreach (var pair in _graphCache.ToArray())
        {
            var entry = pair.Value;
            long dirtyVersion;
            GraphDocument snapshot;

            lock (entry.SyncRoot)
            {
                if (!entry.IsDirty || (!flushAll && entry.DirtySinceUtc > dirtyCutoffUtc && entry.LastAccessUtc > idleCutoffUtc))
                {
                    continue;
                }

                dirtyVersion = entry.DirtyVersion;
                snapshot = CloneGraphDocument(entry.Value);
            }

            await Graphs().ReplaceOneAsync(x => x.Id == snapshot.Id, snapshot, new ReplaceOptions { IsUpsert = true }, cancellationToken);

            lock (entry.SyncRoot)
            {
                if (entry.IsDirty && entry.DirtyVersion == dirtyVersion)
                {
                    entry.IsDirty = false;
                    entry.DirtySinceUtc = default;
                }
            }
        }
    }

    private void EvictIdleUsers(DateTime idleCutoffUtc)
    {
        foreach (var pair in _userCacheById.ToArray())
        {
            var shouldEvict = false;
            string? username = null;

            lock (pair.Value.SyncRoot)
            {
                shouldEvict = !pair.Value.IsDirty && pair.Value.LastAccessUtc <= idleCutoffUtc;
                if (shouldEvict)
                {
                    username = pair.Value.Value.Username;
                }
            }

            if (!shouldEvict || !_userCacheById.TryRemove(pair.Key, out _))
            {
                continue;
            }

            if (!string.IsNullOrWhiteSpace(username) && _userIdByUsername.TryGetValue(username, out var mappedUserId) && string.Equals(mappedUserId, pair.Key, StringComparison.Ordinal))
            {
                _userIdByUsername.TryRemove(username, out _);
            }
        }
    }

    private static void EvictIdleEntries<T>(ConcurrentDictionary<string, CacheEntry<T>> cache, DateTime idleCutoffUtc)
    {
        foreach (var pair in cache.ToArray())
        {
            var shouldEvict = false;
            lock (pair.Value.SyncRoot)
            {
                shouldEvict = !pair.Value.IsDirty && pair.Value.LastAccessUtc <= idleCutoffUtc;
            }

            if (shouldEvict)
            {
                cache.TryRemove(pair.Key, out _);
            }
        }
    }

    private void CacheUser(UserDocument user)
    {
        CacheValue(_userCacheById, user.Id, CloneUserDocument(user), dirty: false);
        _userIdByUsername[user.Username] = user.Id;
    }

    private void CacheWorkspace(WorkspaceDocument workspace)
    {
        CacheValue(_workspaceCache, workspace.Id, CloneWorkspaceDocument(workspace), dirty: false);
    }

    private void CacheProject(ProjectDocument project, bool dirty = false)
    {
        CacheValue(_projectCache, ProjectCacheKey(project.UserId, project.ProjectId), CloneProjectDocument(project), dirty);
    }

    private void CacheGraph(GraphDocument graph, bool dirty = false)
    {
        CacheValue(_graphCache, GraphCacheKey(graph.UserId, graph.ProjectId, graph.GraphId), CloneGraphDocument(graph), dirty);
    }

    private static TResult ReadCachedValue<TValue, TResult>(CacheEntry<TValue> entry, Func<TValue, TResult> projector)
    {
        lock (entry.SyncRoot)
        {
            entry.LastAccessUtc = DateTime.UtcNow;
            return projector(entry.Value);
        }
    }

    private static void CacheValue<TValue>(ConcurrentDictionary<string, CacheEntry<TValue>> cache, string key, TValue value, bool dirty)
    {
        cache.AddOrUpdate(
            key,
            _ => CreateEntry(value, dirty),
            (_, existing) =>
            {
                lock (existing.SyncRoot)
                {
                    existing.Value = value;
                    existing.LastAccessUtc = DateTime.UtcNow;
                    if (dirty)
                    {
                        MarkDirty(existing);
                    }
                    else
                    {
                        existing.IsDirty = false;
                        existing.DirtySinceUtc = default;
                    }
                }

                return existing;
            });
    }

    private static CacheEntry<TValue> CreateEntry<TValue>(TValue value, bool dirty)
    {
        var entry = new CacheEntry<TValue> { Value = value, LastAccessUtc = DateTime.UtcNow };
        if (dirty)
        {
            MarkDirty(entry);
        }

        return entry;
    }

    private static void UpdateCachedEntry<TValue>(CacheEntry<TValue> entry, Action<TValue> update, bool markDirty)
    {
        lock (entry.SyncRoot)
        {
            update(entry.Value);
            entry.LastAccessUtc = DateTime.UtcNow;
            if (markDirty)
            {
                MarkDirty(entry);
            }
        }
    }

    private void UpdateCachedWorkspace(string userId, Action<WorkspaceDocument> update)
    {
        if (_workspaceCache.TryGetValue(userId, out var cachedWorkspace))
        {
            UpdateCachedEntry(cachedWorkspace, update, markDirty: false);
        }
    }

    private void UpdateCachedProject(string userId, string projectId, Action<ProjectDocument> update, bool markDirty)
    {
        if (_projectCache.TryGetValue(ProjectCacheKey(userId, projectId), out var cachedProject))
        {
            UpdateCachedEntry(cachedProject, update, markDirty);
        }
    }

    private void UpdateCachedGraph(string userId, string projectId, string graphId, Action<GraphDocument> update, bool markDirty)
    {
        if (_graphCache.TryGetValue(GraphCacheKey(userId, projectId, graphId), out var cachedGraph))
        {
            UpdateCachedEntry(cachedGraph, update, markDirty);
        }
    }

    private void RemoveProjectCacheEntries(string userId, string? projectId = null)
    {
        foreach (var key in _projectCache.Keys)
        {
            if (key.StartsWith(ProjectCacheKeyPrefix(userId, projectId), StringComparison.Ordinal))
            {
                _projectCache.TryRemove(key, out _);
            }
        }
    }

    private void RemoveGraphCacheEntries(string userId, string? projectId = null)
    {
        foreach (var key in _graphCache.Keys)
        {
            if (key.StartsWith(GraphCacheKeyPrefix(userId, projectId), StringComparison.Ordinal))
            {
                _graphCache.TryRemove(key, out _);
            }
        }
    }

    private static void MarkDirty<TValue>(CacheEntry<TValue> entry)
    {
        entry.IsDirty = true;
        entry.DirtySinceUtc = DateTime.UtcNow;
        entry.DirtyVersion++;
    }

    private static string ProjectCacheKey(string userId, string projectId)
    {
        return $"{userId}:{projectId}";
    }

    private static string GraphCacheKey(string userId, string projectId, string graphId)
    {
        return $"{userId}:{projectId}:{graphId}";
    }

    private static string ProjectCacheKeyPrefix(string userId, string? projectId)
    {
        return string.IsNullOrWhiteSpace(projectId) ? $"{userId}:" : $"{userId}:{projectId}";
    }

    private static string GraphCacheKeyPrefix(string userId, string? projectId)
    {
        return string.IsNullOrWhiteSpace(projectId) ? $"{userId}:" : $"{userId}:{projectId}:";
    }

    private static UserDocument CloneUserDocument(UserDocument user)
    {
        return new UserDocument
        {
            Id = user.Id,
            Username = user.Username,
            SessionVersion = user.SessionVersion,
            PasswordSalt = user.PasswordSalt,
            PasswordHash = user.PasswordHash,
            PasswordIterations = user.PasswordIterations
        };
    }

    private static WorkspaceDocument CloneWorkspaceDocument(WorkspaceDocument workspace)
    {
        return new WorkspaceDocument
        {
            Id = workspace.Id,
            UserId = workspace.UserId,
            ActiveProjectId = workspace.ActiveProjectId
        };
    }

    private static ProjectDocument CloneProjectDocument(ProjectDocument project)
    {
        return new ProjectDocument
        {
            Id = project.Id,
            UserId = project.UserId,
            ProjectId = project.ProjectId,
            Name = project.Name,
            SortOrder = project.SortOrder,
            ActiveGraphId = project.ActiveGraphId,
            Store = (BsonDocument)project.Store.DeepClone()
        };
    }

    private static GraphDocument CloneGraphDocument(GraphDocument graph)
    {
        return new GraphDocument
        {
            Id = graph.Id,
            UserId = graph.UserId,
            ProjectId = graph.ProjectId,
            GraphId = graph.GraphId,
            Name = graph.Name,
            SortOrder = graph.SortOrder,
            Data = (BsonDocument)graph.Data.DeepClone()
        };
    }

    private sealed class CacheEntry<TValue>
    {
        public TValue Value { get; set; } = default!;

        public object SyncRoot { get; } = new();

        public DateTime LastAccessUtc { get; set; }

        public bool IsDirty { get; set; }

        public DateTime DirtySinceUtc { get; set; }

        public long DirtyVersion { get; set; }
    }

    private static JsonDocument? LoadJsonDocument(string path)
    {
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            return JsonDocument.Parse(File.ReadAllText(path));
        }
        catch
        {
            return null;
        }
    }

    private static BsonDocument? LoadBsonDocument(string path)
    {
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            return BsonDocument.Parse(File.ReadAllText(path));
        }
        catch
        {
            return null;
        }
    }

    private IMongoCollection<UserDocument> Users() => (_database ?? throw new InvalidOperationException("Store not initialized")).GetCollection<UserDocument>("users");

    private IMongoCollection<WorkspaceDocument> Workspaces() => (_database ?? throw new InvalidOperationException("Store not initialized")).GetCollection<WorkspaceDocument>("user_workspaces");

    private IMongoCollection<ProjectDocument> Projects() => (_database ?? throw new InvalidOperationException("Store not initialized")).GetCollection<ProjectDocument>("projects");

    private IMongoCollection<GraphDocument> Graphs() => (_database ?? throw new InvalidOperationException("Store not initialized")).GetCollection<GraphDocument>("graphs");

    private IMongoCollection<BsonDocument> Settings() => (_database ?? throw new InvalidOperationException("Store not initialized")).GetCollection<BsonDocument>("settings");
}
