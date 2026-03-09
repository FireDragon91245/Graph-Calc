using System.Security.Claims;
using System.Text.Encodings.Web;
using GraphCalc.Api.Configuration;
using GraphCalc.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace GraphCalc.Api.Auth;

public sealed class GraphCalcAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "GraphCalcSession";

    private readonly SessionTokenService _sessionTokenService;
    private readonly BackendStore _store;
    private readonly GraphCalcOptions _options;

    public GraphCalcAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> schemeOptions,
        ILoggerFactory logger,
        UrlEncoder encoder,
        SessionTokenService sessionTokenService,
        BackendStore store,
        IOptions<GraphCalcOptions> options)
        : base(schemeOptions, logger, encoder)
    {
        _sessionTokenService = sessionTokenService;
        _store = store;
        _options = options.Value;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Cookies.TryGetValue(_options.Auth.Cookie.Name, out var token) || string.IsNullOrWhiteSpace(token))
        {
            return AuthenticateResult.NoResult();
        }

        var payload = await _sessionTokenService.ValidateAsync(token, Context.RequestAborted);
        if (payload is null)
        {
            return AuthenticateResult.Fail("Invalid session");
        }

        var user = await _store.GetUserByIdAsync(payload.UserId, Context.RequestAborted);
        if (user is null || !string.Equals(user.Username, payload.Username, StringComparison.Ordinal))
        {
            return AuthenticateResult.Fail("Session user not found");
        }

        var currentSessionVersion = user.SessionVersion > 0 ? user.SessionVersion : _options.Auth.DefaultSessionVersion;
        if (currentSessionVersion != payload.SessionVersion)
        {
            return AuthenticateResult.Fail("Session is no longer valid");
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim("sessionVersion", currentSessionVersion.ToString())
        };
        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.ContentType = "application/json";
        return Response.WriteAsJsonAsync(new { detail = "Authentication required" }, Context.RequestAborted);
    }
}
