namespace GraphCalc.Api.Infrastructure;

public sealed class ApiException : Exception
{
    public ApiException(int statusCode, string detail)
        : base(detail)
    {
        StatusCode = statusCode;
        Detail = detail;
    }

    public int StatusCode { get; }

    public string Detail { get; }
}
