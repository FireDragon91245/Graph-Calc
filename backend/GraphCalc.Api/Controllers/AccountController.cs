using GraphCalc.Api.Configuration;
using GraphCalc.Api.Contracts;
using GraphCalc.Api.Infrastructure;
using GraphCalc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace GraphCalc.Api.Controllers;

[ApiController]
[Authorize]
[EnableRateLimiting("auth")]
[Route("user")]
public sealed class AccountController : ControllerBase
{
    private readonly BackendStore _store;
    private readonly PasswordService _passwordService;
    private readonly SessionTokenService _sessionTokenService;
    private readonly SessionCookieService _sessionCookieService;
    private readonly GraphCalcOptions _options;

    public AccountController(
        BackendStore store,
        PasswordService passwordService,
        SessionTokenService sessionTokenService,
        SessionCookieService sessionCookieService,
        IOptions<GraphCalcOptions> options)
    {
        _store = store;
        _passwordService = passwordService;
        _sessionTokenService = sessionTokenService;
        _sessionCookieService = sessionCookieService;
        _options = options.Value;
    }

    [HttpGet("info")]
    public async Task<ActionResult<AccountProfileResponse>> Me(CancellationToken cancellationToken)
    {
        var user = await ApiRequestContext.GetRequiredUserDocumentAsync(User, _store, cancellationToken);
        return Ok(await _store.BuildAccountProfileAsync(user, cancellationToken));
    }

    [HttpPut("password")]
    public async Task<ActionResult<PasswordChangeResponse>> ChangePassword([FromBody] PasswordChangeRequest request, CancellationToken cancellationToken)
    {
        if ((request.NewPassword ?? string.Empty).Length <= 8)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Password must be longer than 8 characters");
        }

        var user = await ApiRequestContext.GetRequiredUserDocumentAsync(User, _store, cancellationToken);
        if (!_passwordService.VerifyPassword(request.CurrentPassword, user))
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "Current password is incorrect");
        }

        var (salt, hash, iterations) = _passwordService.HashPassword(request.NewPassword ?? string.Empty);
        user.PasswordSalt = salt;
        user.PasswordHash = hash;
        user.PasswordIterations = iterations;
        user.SessionVersion = (user.SessionVersion > 0 ? user.SessionVersion : _options.Auth.DefaultSessionVersion) + 1;
        await _store.ReplaceUserAsync(user, cancellationToken);

        var token = await _sessionTokenService.CreateTokenAsync(user, cancellationToken);
        _sessionCookieService.SetSessionCookie(Response, token);

        return Ok(new PasswordChangeResponse
        {
            Status = "ok",
            User = await _store.BuildAccountProfileAsync(user, cancellationToken),
            Token = token
        });
    }

    [HttpDelete("delete")]
    public async Task<ActionResult<StatusResponse>> DeleteAccount([FromBody] DeleteAccountRequest request, CancellationToken cancellationToken)
    {
        var user = await ApiRequestContext.GetRequiredUserDocumentAsync(User, _store, cancellationToken);
        if (!_passwordService.VerifyPassword(request.CurrentPassword, user))
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "Current password is incorrect");
        }

        await _store.DeleteAccountAsync(user.Id, cancellationToken);
        _sessionCookieService.ClearSessionCookie(Response);
        return Ok(new StatusResponse { Status = "ok" });
    }

    [HttpPost("logout")]
    public ActionResult<StatusResponse> Logout()
    {
        _sessionCookieService.ClearSessionCookie(Response);
        return Ok(new StatusResponse { Status = "ok" });
    }
}