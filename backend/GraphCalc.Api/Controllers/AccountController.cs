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
    private readonly ThumbnailImageService _thumbnailImages;
    private readonly GraphCalcOptions _options;

    public AccountController(
        BackendStore store,
        PasswordService passwordService,
        SessionTokenService sessionTokenService,
        SessionCookieService sessionCookieService,
        ThumbnailImageService thumbnailImages,
        IOptions<GraphCalcOptions> options)
    {
        _store = store;
        _passwordService = passwordService;
        _sessionTokenService = sessionTokenService;
        _sessionCookieService = sessionCookieService;
        _thumbnailImages = thumbnailImages;
        _options = options.Value;
    }

    [HttpGet("info")]
    public async Task<ActionResult<AccountProfileResponse>> Me(CancellationToken cancellationToken)
    {
        var user = await ApiRequestContext.GetRequiredUserDocumentAsync(User, _store, cancellationToken);
        return Ok(await _store.BuildAccountProfileAsync(user, cancellationToken));
    }

    [HttpPatch("settings")]
    public async Task<ActionResult<AccountSettingsResponse>> UpdateSettings([FromBody] AccountSettingsUpdateRequest request, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        var normalizedLanguage = request.Language;
        if (normalizedLanguage is not null)
        {
            normalizedLanguage = normalizedLanguage.Trim().ToLowerInvariant().Split('-', 2)[0];
            if (normalizedLanguage is not ("en" or "de"))
            {
                throw new ApiException(StatusCodes.Status400BadRequest, "backend.errors.languageUnsupported");
            }
        }

        return Ok(await _store.UpdateUserSettingsAsync(
            user.Id,
            new AccountSettingsUpdateRequest { Language = normalizedLanguage },
            cancellationToken));
    }

    [HttpGet("profile-image")]
    public async Task<IActionResult> GetProfileImage(CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        var image = await _store.GetProfileImageAsync(user.Id, cancellationToken)
            ?? throw new ApiException(StatusCodes.Status404NotFound, "backend.errors.thumbnailNotFound");
        SetImageResponseHeaders(image.Sha256);
        return File(image.Data, image.ContentType);
    }

    [HttpPut("profile-image")]
    [RequestSizeLimit(5L * 1024L * 1024L + 64L * 1024L)]
    public async Task<ActionResult<ProfileImageUpdateResponse>> PutProfileImage([FromForm] IFormFile image, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        var validated = await _thumbnailImages.ValidateAsync(image, cancellationToken);
        var profileImageId = await _store.SetProfileImageAsync(user.Id, validated, cancellationToken);
        return Ok(new ProfileImageUpdateResponse { ProfileImageId = profileImageId });
    }

    [HttpDelete("profile-image")]
    public async Task<IActionResult> DeleteProfileImage(CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.DeleteProfileImageAsync(user.Id, cancellationToken);
        return NoContent();
    }

    [HttpPut("password")]
    public async Task<ActionResult<PasswordChangeResponse>> ChangePassword([FromBody] PasswordChangeRequest request, CancellationToken cancellationToken)
    {
        if ((request.NewPassword ?? string.Empty).Length <= 8)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "backend.errors.passwordTooShort");
        }

        var user = await ApiRequestContext.GetRequiredUserDocumentAsync(User, _store, cancellationToken);
        if (!_passwordService.VerifyPassword(request.CurrentPassword, user))
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "backend.errors.currentPasswordIncorrect");
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
            throw new ApiException(StatusCodes.Status401Unauthorized, "backend.errors.currentPasswordIncorrect");
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

    private void SetImageResponseHeaders(string sha256)
    {
        Response.Headers.ETag = $"\"{sha256}\"";
        Response.Headers.CacheControl = "private, no-cache";
        Response.Headers.XContentTypeOptions = "nosniff";
    }
}
