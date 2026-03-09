namespace GraphCalc.Api.Infrastructure;

public sealed record AuthenticatedUser(string Id, string Username, int SessionVersion);
