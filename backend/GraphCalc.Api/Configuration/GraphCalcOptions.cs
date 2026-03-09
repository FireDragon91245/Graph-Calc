using System.ComponentModel.DataAnnotations;

namespace GraphCalc.Api.Configuration;

public sealed class GraphCalcOptions
{
    [Required]
    public required ServerOptions Server { get; init; }

    [Required]
    public required AuthOptions Auth { get; init; }

    [Required]
    public required MongoOptions Mongo { get; init; }

    [Required]
    public required SolverOptions Solver { get; init; }

    [Required]
    public required RateLimitingOptions RateLimiting { get; init; }
}

public sealed class ServerOptions
{
    [Required]
    public required string Host { get; init; }

    [Range(1, 65535)]
    public required int Port { get; init; }

    [Required]
    public required string[] FrontendOrigins { get; init; }

    public bool LogRequests { get; init; } = true;

    [Required]
    public required SslOptions Ssl { get; init; }
}

public sealed class SslOptions
{
    [Required]
    public required string CertFile { get; init; }

    [Required]
    public required string KeyFile { get; init; }
}

public sealed class AuthOptions
{
    [Required]
    public required string JwtAlgorithm { get; init; }

    [Range(60, int.MaxValue)]
    public required int JwtTtlSeconds { get; init; }

    [Range(1000, int.MaxValue)]
    public required int PasswordHashIterations { get; init; }

    [Range(1, int.MaxValue)]
    public int DefaultSessionVersion { get; init; } = 1;

    [Required]
    public required CookieOptions Cookie { get; init; }
}

public sealed class CookieOptions
{
    [Required]
    public required string Name { get; init; }

    public bool HttpOnly { get; init; } = true;

    public bool Secure { get; init; } = true;

    [Required]
    public string SameSite { get; init; } = "lax";

    [Required]
    public string Path { get; init; } = "/";
}

public sealed class MongoOptions
{
    [Required]
    public required string Host { get; init; }

    [Range(1, 65535)]
    public required int Port { get; init; }

    public string Username { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;

    [Required]
    public required string AuthDatabase { get; init; }

    [Required]
    public required string Database { get; init; }

    public bool AllowNoAuthFallback { get; init; } = true;
}

public sealed class SolverOptions
{
    [Range(1, 512)]
    public int MaxConcurrency { get; init; } = 2;

    [Range(1, 3600)]
    public int RequestTimeoutSeconds { get; init; } = 5;

    [Range(0, 10000)]
    public int QueueLimit { get; init; } = 32;
}

public sealed class RateLimitingOptions
{
    [Range(1, 100000)]
    public int GlobalRequestsPerMinute { get; init; } = 240;

    [Range(1, 100000)]
    public int AuthRequestsPerMinute { get; init; } = 10;

    [Range(1, 100000)]
    public int SolverRequestsPerMinute { get; init; } = 20;
}
