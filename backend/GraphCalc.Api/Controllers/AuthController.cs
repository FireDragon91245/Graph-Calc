using GraphCalc.Api.Contracts;
using GraphCalc.Api.Infrastructure;
using GraphCalc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GraphCalc.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("")]
public sealed class AuthController : ControllerBase
{
    private readonly BackendStore _store;
    private readonly PasswordService _passwordService;
    private readonly SessionTokenService _sessionTokenService;
    private readonly SessionCookieService _sessionCookieService;

    public AuthController(
        BackendStore store,
        PasswordService passwordService,
        SessionTokenService sessionTokenService,
        SessionCookieService sessionCookieService)
    {
        _store = store;
        _passwordService = passwordService;
        _sessionTokenService = sessionTokenService;
        _sessionCookieService = sessionCookieService;
    }

    [HttpPost("register")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Register([FromBody] AuthCredentialsRequest request, CancellationToken cancellationToken)
    {
        var username = (request.Username ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(username))
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Username is required");
        }

        if ((request.Password ?? string.Empty).Length <= 8)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Password must be longer than 8 characters");
        }

        if (await _store.GetUserByUsernameAsync(username, cancellationToken) is not null)
        {
            throw new ApiException(StatusCodes.Status409Conflict, "Username already exists");
        }

        var (salt, hash, iterations) = _passwordService.HashPassword(request.Password ?? string.Empty);
        var user = await _store.CreateUserAsync(username, salt, hash, iterations, cancellationToken);
        var token = await _sessionTokenService.CreateTokenAsync(user, cancellationToken);
        _sessionCookieService.SetSessionCookie(Response, token);

        return Ok(new AuthResponse
        {
            Token = token,
            User = new BasicAuthUser { Id = user.Id, Username = user.Username }
        });
    }

    [HttpPost("authenticate")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Authenticate([FromBody] AuthCredentialsRequest request, CancellationToken cancellationToken)
    {
        var username = (request.Username ?? string.Empty).Trim();
        var user = await _store.GetUserByUsernameAsync(username, cancellationToken);
        if (user is null || !_passwordService.VerifyPassword(request.Password, user))
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "Invalid username or password");
        }

        var token = await _sessionTokenService.CreateTokenAsync(user, cancellationToken);
        _sessionCookieService.SetSessionCookie(Response, token);

        return Ok(new AuthResponse
        {
            Token = token,
            User = new BasicAuthUser { Id = user.Id, Username = user.Username }
        });
    }
}