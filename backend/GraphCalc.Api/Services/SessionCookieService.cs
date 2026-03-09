using GraphCalc.Api.Configuration;
using Microsoft.Extensions.Options;

namespace GraphCalc.Api.Services;

public sealed class SessionCookieService
{
    private readonly GraphCalcOptions _options;

    public SessionCookieService(IOptions<GraphCalcOptions> options)
    {
        _options = options.Value;
    }

    public void SetSessionCookie(HttpResponse response, string token)
    {
        response.Cookies.Append(
            _options.Auth.Cookie.Name,
            token,
            new Microsoft.AspNetCore.Http.CookieOptions
            {
                HttpOnly = _options.Auth.Cookie.HttpOnly,
                Secure = _options.Auth.Cookie.Secure,
                SameSite = ParseSameSite(_options.Auth.Cookie.SameSite),
                Path = _options.Auth.Cookie.Path,
                MaxAge = TimeSpan.FromSeconds(_options.Auth.JwtTtlSeconds),
                IsEssential = true
            });
    }

    public void ClearSessionCookie(HttpResponse response)
    {
        response.Cookies.Delete(
            _options.Auth.Cookie.Name,
            new Microsoft.AspNetCore.Http.CookieOptions
            {
                HttpOnly = _options.Auth.Cookie.HttpOnly,
                Secure = _options.Auth.Cookie.Secure,
                SameSite = ParseSameSite(_options.Auth.Cookie.SameSite),
                Path = _options.Auth.Cookie.Path,
                IsEssential = true
            });
    }

    private static SameSiteMode ParseSameSite(string value)
    {
        return value.ToLowerInvariant() switch
        {
            "strict" => SameSiteMode.Strict,
            "none" => SameSiteMode.None,
            _ => SameSiteMode.Lax
        };
    }
}