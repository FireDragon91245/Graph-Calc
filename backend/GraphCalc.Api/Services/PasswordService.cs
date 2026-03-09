using System.Security.Cryptography;
using System.Text;
using GraphCalc.Api.Configuration;
using GraphCalc.Api.Documents;
using Microsoft.Extensions.Options;

namespace GraphCalc.Api.Services;

public sealed class PasswordService
{
    private readonly GraphCalcOptions _options;

    public PasswordService(IOptions<GraphCalcOptions> options)
    {
        _options = options.Value;
    }

    public (string Salt, string Hash, int Iterations) HashPassword(string password, string? salt = null)
    {
        var saltValue = salt ?? Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var hashBytes = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            Encoding.UTF8.GetBytes(saltValue),
            _options.Auth.PasswordHashIterations,
            HashAlgorithmName.SHA256,
            32);

        return (saltValue, Convert.ToHexString(hashBytes).ToLowerInvariant(), _options.Auth.PasswordHashIterations);
    }

    public bool VerifyPassword(string password, UserDocument user)
    {
        if (string.IsNullOrWhiteSpace(user.PasswordSalt))
        {
            return false;
        }

        var iterations = user.PasswordIterations > 0
            ? user.PasswordIterations
            : _options.Auth.PasswordHashIterations;
        var candidate = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            Encoding.UTF8.GetBytes(user.PasswordSalt),
            iterations,
            HashAlgorithmName.SHA256,
            32);
        var candidateHex = Convert.ToHexString(candidate).ToLowerInvariant();
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(candidateHex),
            Encoding.UTF8.GetBytes(user.PasswordHash));
    }
}
