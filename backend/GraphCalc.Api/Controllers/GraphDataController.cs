using GraphCalc.Api.Contracts;
using GraphCalc.Api.Infrastructure;
using GraphCalc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GraphCalc.Api.Controllers;

[ApiController]
[Authorize]
[Route("projects/{projectId}")]
public sealed class GraphDataController : ControllerBase
{
    private readonly BackendStore _store;
    private readonly ISolverService _solverService;
    private readonly SolverQueueService _solverQueue;

    public GraphDataController(BackendStore store, ISolverService solverService, SolverQueueService solverQueue)
    {
        _store = store;
        _solverService = solverService;
        _solverQueue = solverQueue;
    }

    [HttpPost("graphs/{graphId}/solve")]
    [EnableRateLimiting("solve")]
    public async Task<ActionResult<SolveResponse>> Solve(string projectId, string graphId, [FromBody] SolveRequest request, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        var graph = await _store.LoadGraphAsync(user.Id, projectId, graphId, cancellationToken);
        var storeData = await _store.LoadStoreAsync(user.Id, projectId, cancellationToken);

        var result = await _solverQueue.RunAsync(
            ct => _solverService.SolveAsync(graph, storeData, request.Targets, ct),
            cancellationToken);
        return Ok(result);
    }

    [HttpGet("graphs/{graphId}/load")]
    [EnableRateLimiting("crud")]
    public async Task<ActionResult<GraphData>> GetGraph(string projectId, string graphId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        return Ok(await _store.LoadGraphAsync(user.Id, projectId, graphId, cancellationToken));
    }

    [HttpPost("graphs/{graphId}/save")]
    [EnableRateLimiting("crud")]
    public async Task<ActionResult<StatusResponse>> SaveGraph(string projectId, string graphId, [FromBody] GraphData graph, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        await _store.SaveGraphAsync(user.Id, projectId, graphId, graph, cancellationToken);
        return Ok(new StatusResponse { Status = "ok" });
    }

    [HttpGet("store/load")]
    [EnableRateLimiting("crud")]
    public async Task<ActionResult<StoreData>> GetStore(string projectId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        return Ok(await _store.LoadStoreAsync(user.Id, projectId, cancellationToken));
    }

    [HttpPost("store/save")]
    [EnableRateLimiting("crud")]
    public async Task<ActionResult<StatusResponse>> SaveStore(string projectId, [FromBody] StoreData storeData, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        await _store.SaveStoreAsync(user.Id, projectId, storeData, cancellationToken);
        return Ok(new StatusResponse { Status = "ok" });
    }
}