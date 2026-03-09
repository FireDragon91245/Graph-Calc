using System.Security.Claims;
using GraphCalc.Api.Documents;
using GraphCalc.Api.Services;

namespace GraphCalc.Api.Infrastructure;

internal static class ApiRequestContext
{
    public static string NormalizeName(string? name, string errorMessage)
    {
        var normalized = (name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ApiException(StatusCodes.Status400BadRequest, errorMessage);
        }

        return normalized;
    }

    public static AuthenticatedUser GetAuthenticatedUser(ClaimsPrincipal principal)
    {
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var username = principal.FindFirstValue(ClaimTypes.Name);
        var sessionVersionRaw = principal.FindFirst("sessionVersion")?.Value;
        _ = int.TryParse(sessionVersionRaw, out var sessionVersion);

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(username))
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "Authentication required");
        }

        return new AuthenticatedUser(id, username, sessionVersion > 0 ? sessionVersion : 1);
    }

    public static async Task<UserDocument> GetRequiredUserDocumentAsync(ClaimsPrincipal principal, BackendStore store, CancellationToken cancellationToken)
    {
        var user = GetAuthenticatedUser(principal);
        return await store.GetUserByIdAsync(user.Id, cancellationToken)
               ?? throw new ApiException(StatusCodes.Status404NotFound, "User not found");
    }
}