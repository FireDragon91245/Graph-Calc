namespace GraphCalc.Api.Infrastructure;

public sealed class ApiException : Exception
{
    public ApiException(int statusCode, string code, IReadOnlyDictionary<string, object?>? args = null)
        : base(code)
    {
        StatusCode = statusCode;
        Code = code;
        Args = args ?? new Dictionary<string, object?>();
    }

    public int StatusCode { get; }
    public string Code { get; }
    public IReadOnlyDictionary<string, object?> Args { get; }
}
