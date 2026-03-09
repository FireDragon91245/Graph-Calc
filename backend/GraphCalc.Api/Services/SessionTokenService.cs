using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraphCalc.Api.Configuration;
using GraphCalc.Api.Documents;
using Microsoft.Extensions.Options;

namespace GraphCalc.Api.Services;

public sealed class SessionTokenService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly GraphCalcOptions _options;
    private readonly BackendStore _store;

    public SessionTokenService(IOptions<GraphCalcOptions> options, BackendStore store)
    {
        _options = options.Value;
        _store = store;
    }

    public async Task<string> CreateTokenAsync(UserDocument user, CancellationToken cancellationToken)
    {
        var secret = await _store.GetJwtSecretAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payload = new SessionTokenPayload(
            user.Id,
            user.Id,
            user.Username,
            user.SessionVersion > 0 ? user.SessionVersion : _options.Auth.DefaultSessionVersion,
            now,
            now + _options.Auth.JwtTtlSeconds);
        var headerJson = JsonSerializer.Serialize(new { alg = _options.Auth.JwtAlgorithm, typ = "JWT" }, JsonOptions);
        var payloadJson = JsonSerializer.Serialize(payload, JsonOptions);

        var encodedHeader = Base64UrlEncode(Encoding.UTF8.GetBytes(headerJson));
        var encodedPayload = Base64UrlEncode(Encoding.UTF8.GetBytes(payloadJson));
        var signingInput = Encoding.ASCII.GetBytes($"{encodedHeader}.{encodedPayload}");
        var signature = ComputeSignature(signingInput, secret);
        return $"{encodedHeader}.{encodedPayload}.{Base64UrlEncode(signature)}";
    }

    public async Task<SessionTokenPayload?> ValidateAsync(string token, CancellationToken cancellationToken)
    {
        var parts = token.Split('.');
        if (parts.Length != 3)
        {
            return null;
        }

        var secret = await _store.GetJwtSecretAsync(cancellationToken);
        var signingInput = Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}");
        var expectedSignature = Base64UrlEncode(ComputeSignature(signingInput, secret));
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(parts[2]),
                Encoding.ASCII.GetBytes(expectedSignature)))
        {
            return null;
        }

        try
        {
            var header = JsonSerializer.Deserialize<SessionTokenHeader>(Base64UrlDecodeToString(parts[0]), JsonOptions);
            var payload = JsonSerializer.Deserialize<SessionTokenPayload>(Base64UrlDecodeToString(parts[1]), JsonOptions);
            if (header is null || payload is null)
            {
                return null;
            }

            if (!string.Equals(header.Alg, _options.Auth.JwtAlgorithm, StringComparison.Ordinal))
            {
                return null;
            }

            if (payload.Exp <= DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            {
                return null;
            }

            if (string.IsNullOrWhiteSpace(payload.UserId) || string.IsNullOrWhiteSpace(payload.Username))
            {
                return null;
            }

            return payload;
        }
        catch
        {
            return null;
        }
    }

    private static byte[] ComputeSignature(byte[] signingInput, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return hmac.ComputeHash(signingInput);
    }

    private static string Base64UrlEncode(byte[] data)
    {
        return Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static string Base64UrlDecodeToString(string data)
    {
        var incoming = data.Replace('-', '+').Replace('_', '/');
        incoming = incoming.PadRight(incoming.Length + ((4 - incoming.Length % 4) % 4), '=');
        return Encoding.UTF8.GetString(Convert.FromBase64String(incoming));
    }
}

public sealed record SessionTokenPayload(
    string Sub,
    string UserId,
    string Username,
    int SessionVersion,
    long Iat,
    long Exp);

public sealed record SessionTokenHeader(string Alg, string Typ);
