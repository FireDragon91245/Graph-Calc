using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace GraphCalc.Api.Documents;

public sealed class UserDocument
{
    [BsonId]
    public required string Id { get; init; }

    [BsonElement("username")]
    public required string Username { get; set; }

    [BsonElement("sessionVersion")]
    public int SessionVersion { get; set; }

    [BsonElement("passwordSalt")]
    public required string PasswordSalt { get; set; }

    [BsonElement("passwordHash")]
    public required string PasswordHash { get; set; }

    [BsonElement("passwordIterations")]
    public int PasswordIterations { get; set; }

    [BsonElement("profileImageId")]
    [BsonIgnoreIfNull]
    public string? ProfileImageId { get; set; }

    [BsonElement("settings")]
    public UserSettingsDocument Settings { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class UserSettingsDocument
{
    [BsonElement("language")]
    [BsonIgnoreIfNull]
    public string? Language { get; set; }
}

public sealed class WorkspaceDocument
{
    [BsonId]
    public required string Id { get; init; }

    [BsonElement("userId")]
    public required string UserId { get; init; }

    [BsonElement("activeProjectId")]
    [BsonIgnoreIfNull]
    public string? ActiveProjectId { get; set; }
}

public sealed class ProjectDocument
{
    [BsonId]
    public required string Id { get; init; }

    [BsonElement("userId")]
    public required string UserId { get; init; }

    [BsonElement("projectId")]
    public required string ProjectId { get; init; }

    [BsonElement("name")]
    public required string Name { get; set; }

    [BsonElement("sortOrder")]
    public int SortOrder { get; set; }

    [BsonElement("activeGraphId")]
    [BsonIgnoreIfNull]
    public string? ActiveGraphId { get; set; }

    [BsonElement("thumbnailId")]
    [BsonIgnoreIfNull]
    public string? ThumbnailId { get; set; }

    [BsonElement("moduleResourceImageIds")]
    public List<string> ModuleResourceImageIds { get; set; } = [];

    [BsonElement("store")]
    public BsonDocument Store { get; set; } = new();
}

public sealed class GraphDocument
{
    [BsonId]
    public required string Id { get; init; }

    [BsonElement("userId")]
    public required string UserId { get; init; }

    [BsonElement("projectId")]
    public required string ProjectId { get; init; }

    [BsonElement("graphId")]
    public required string GraphId { get; init; }

    [BsonElement("name")]
    public required string Name { get; set; }

    [BsonElement("sortOrder")]
    public int SortOrder { get; set; }

    [BsonElement("thumbnailId")]
    [BsonIgnoreIfNull]
    public string? ThumbnailId { get; set; }

    [BsonElement("data")]
    public BsonDocument Data { get; set; } = new();
}

public sealed class ImageDocument
{
    [BsonId]
    public required string Id { get; init; }

    [BsonElement("data")]
    public required byte[] Data { get; init; }

    [BsonElement("contentType")]
    public required string ContentType { get; init; }

    [BsonElement("sha256")]
    public required string Sha256 { get; init; }
}

public sealed class SecretSettingDocument
{
    [BsonId]
    public required string Id { get; init; }

    [BsonElement("secret")]
    public required string Secret { get; init; }
}

public sealed class LegacyImportSettingDocument
{
    [BsonId]
    public required string Id { get; init; }

    [BsonElement("completed")]
    public bool Completed { get; init; }

    [BsonElement("source")]
    public string Source { get; init; } = string.Empty;
}
