using System.Security.Cryptography;
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

    private IMongoDatabase? _database;
    private bool _initialized;

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

    public async Task<UserDocument?> GetUserByIdAsync(string userId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        return await Users().Find(x => x.Id == userId).FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<UserDocument?> GetUserByUsernameAsync(string username, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        return await Users().Find(x => x.Username == username).FirstOrDefaultAsync(cancellationToken);
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
        return user;
    }

    public async Task ReplaceUserAsync(UserDocument user, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        await Users().ReplaceOneAsync(x => x.Id == user.Id, user, new ReplaceOptions { IsUpsert = true }, cancellationToken);
    }

    public async Task DeleteAccountAsync(string userId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        await Graphs().DeleteManyAsync(x => x.UserId == userId, cancellationToken);
        await Projects().DeleteManyAsync(x => x.UserId == userId, cancellationToken);
        await Workspaces().DeleteOneAsync(x => x.Id == userId, cancellationToken);
        await Users().DeleteOneAsync(x => x.Id == userId, cancellationToken);
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
        await Graphs().InsertOneAsync(DefaultGraphDocument(userId, projectId, DefaultGraphId, DefaultGraphName, 0), cancellationToken: cancellationToken);
        await SetActiveProjectIfMissingAsync(userId, projectId, cancellationToken);
        return ToSummary(project);
    }

    public async Task<bool> RenameProjectAsync(string userId, string projectId, string newName, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var result = await Projects().UpdateOneAsync(
            x => x.UserId == userId && x.ProjectId == projectId,
            Builders<ProjectDocument>.Update.Set(x => x.Name, newName),
            cancellationToken: cancellationToken);
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

        var graphs = await Graphs()
            .Find(x => x.UserId == userId && x.ProjectId == projectId)
            .SortBy(x => x.SortOrder)
            .ThenBy(x => x.Name)
            .ToListAsync(cancellationToken);

        if (graphs.Count == 0)
        {
            await Graphs().InsertOneAsync(DefaultGraphDocument(userId, newProjectId, DefaultGraphId, DefaultGraphName, 0), cancellationToken: cancellationToken);
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
        var workspace = await GetWorkspaceAsync(userId, cancellationToken);
        if (workspace?.ActiveProjectId == projectId)
        {
            var fallback = await Projects().Find(x => x.UserId == userId).SortBy(x => x.SortOrder).FirstOrDefaultAsync(cancellationToken);
            await Workspaces().UpdateOneAsync(
                x => x.Id == userId,
                Builders<WorkspaceDocument>.Update.Set(x => x.ActiveProjectId, fallback?.ProjectId),
                cancellationToken: cancellationToken);
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
        await InitializeAsync(cancellationToken);
        var exists = await Projects().Find(x => x.UserId == userId && x.ProjectId == projectId).AnyAsync(cancellationToken);
        if (!exists)
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
        return ToSummary(graph);
    }

    public async Task<bool> RenameGraphAsync(string userId, string projectId, string graphId, string newName, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var result = await Graphs().UpdateOneAsync(
            x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId,
            Builders<GraphDocument>.Update.Set(x => x.Name, newName),
            cancellationToken: cancellationToken);
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

        var project = await GetProjectAsync(userId, projectId, cancellationToken);
        if (project?.ActiveGraphId == graphId)
        {
            var fallback = await Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId).SortBy(x => x.SortOrder).FirstOrDefaultAsync(cancellationToken);
            await Projects().UpdateOneAsync(
                x => x.UserId == userId && x.ProjectId == projectId,
                Builders<ProjectDocument>.Update.Set(x => x.ActiveGraphId, fallback?.GraphId),
                cancellationToken: cancellationToken);
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
        return result.MatchedCount > 0;
    }

    public async Task<GraphData> LoadGraphAsync(string userId, string projectId, string graphId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var graph = await Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId).FirstOrDefaultAsync(cancellationToken);
        return graph is null ? DefaultGraphData() : FromBsonDocument(graph.Data, DefaultGraphData);
    }

    public async Task SaveGraphAsync(string userId, string projectId, string graphId, GraphData data, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var normalized = NormalizeGraphData(data);
        var existing = await Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId && x.GraphId == graphId).FirstOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            await Graphs().UpdateOneAsync(x => x.Id == existing.Id, Builders<GraphDocument>.Update.Set(x => x.Data, normalized), cancellationToken: cancellationToken);
            return;
        }

        var sortOrder = await NextSortOrderAsync(Graphs().Find(x => x.UserId == userId && x.ProjectId == projectId).Project(x => x.SortOrder), cancellationToken);
        var graph = DefaultGraphDocument(userId, projectId, graphId, graphId, sortOrder);
        graph.Data = normalized;
        await Graphs().InsertOneAsync(graph, cancellationToken: cancellationToken);
    }

    public async Task<StoreData> LoadStoreAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        var project = await GetProjectAsync(userId, projectId, cancellationToken);
        return project is null ? DefaultStoreData() : FromBsonDocument(project.Store, DefaultStoreData);
    }

    public async Task SaveStoreAsync(string userId, string projectId, StoreData store, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        await Projects().UpdateOneAsync(
            x => x.UserId == userId && x.ProjectId == projectId,
            Builders<ProjectDocument>.Update.Set(x => x.Store, NormalizeStoreData(store)),
            cancellationToken: cancellationToken);
    }

    private async Task<IMongoDatabase> ConnectAsync(CancellationToken cancellationToken)
    {
        var candidateUris = BuildCandidateMongoUris();
        Exception? lastError = null;

        foreach (var uri in candidateUris)
        {
            try
            {
                var client = new MongoClient(uri);
                var database = client.GetDatabase(_options.Mongo.Database);
                await database.RunCommandAsync((Command<BsonDocument>)"{ ping: 1 }", cancellationToken: cancellationToken);
                _logger.LogInformation("Connected to MongoDB using {ConnectionMode}", uri.Contains("@", StringComparison.Ordinal) ? "configured-auth" : "no-auth-fallback");
                return database;
            }
            catch (Exception ex)
            {
                lastError = ex;
                _logger.LogWarning(ex, "MongoDB connection attempt failed");
            }
        }

        throw lastError ?? new InvalidOperationException("Unable to connect to MongoDB");
    }

    private string[] BuildCandidateMongoUris()
    {
        var uris = new List<string> { BuildMongoUri(includeCredentials: true) };
        var noAuth = BuildMongoUri(includeCredentials: false);
        if (_options.Mongo.AllowNoAuthFallback && !uris.Contains(noAuth, StringComparer.Ordinal))
        {
            uris.Add(noAuth);
        }
        return uris.ToArray();
    }

    private string BuildMongoUri(bool includeCredentials)
    {
        var credentials = string.Empty;
        if (includeCredentials && !string.IsNullOrWhiteSpace(_options.Mongo.Username))
        {
            credentials = Uri.EscapeDataString(_options.Mongo.Username);
            if (!string.IsNullOrWhiteSpace(_options.Mongo.Password))
            {
                credentials = $"{credentials}:{Uri.EscapeDataString(_options.Mongo.Password)}";
            }
            credentials += "@";
        }

        var authSuffix = includeCredentials ? $"?authSource={Uri.EscapeDataString(_options.Mongo.AuthDatabase)}" : string.Empty;
        return $"mongodb://{credentials}{_options.Mongo.Host}:{_options.Mongo.Port}/{_options.Mongo.Database}{authSuffix}";
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
        await Workspaces().UpdateOneAsync(
            x => x.Id == userId,
            Builders<WorkspaceDocument>.Update.SetOnInsert(x => x.UserId, userId).SetOnInsert(x => x.ActiveProjectId, null),
            new UpdateOptions { IsUpsert = true },
            cancellationToken);
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
            await Graphs().InsertOneAsync(DefaultGraphDocument(userId, projectId, DefaultGraphId, DefaultGraphName, 0), cancellationToken: cancellationToken);
            await Projects().UpdateOneAsync(
                x => x.UserId == userId && x.ProjectId == projectId,
                Builders<ProjectDocument>.Update.Set(x => x.ActiveGraphId, DefaultGraphId),
                cancellationToken: cancellationToken);
        }
    }

    private async Task SetActiveProjectIfMissingAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        var workspace = await GetWorkspaceAsync(userId, cancellationToken);
        if (string.IsNullOrWhiteSpace(workspace?.ActiveProjectId))
        {
            await Workspaces().UpdateOneAsync(x => x.Id == userId, Builders<WorkspaceDocument>.Update.Set(x => x.ActiveProjectId, projectId), cancellationToken: cancellationToken);
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
        }
    }

    private async Task<WorkspaceDocument?> GetWorkspaceAsync(string userId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        return await Workspaces().Find(x => x.Id == userId).FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<ProjectDocument?> GetProjectAsync(string userId, string projectId, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        return await Projects().Find(x => x.UserId == userId && x.ProjectId == projectId).FirstOrDefaultAsync(cancellationToken);
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
