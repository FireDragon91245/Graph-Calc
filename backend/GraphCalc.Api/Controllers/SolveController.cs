using GraphCalc.Api.Contracts;
using GraphCalc.Api.Infrastructure;
using GraphCalc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GraphCalc.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("solve")]
public sealed class SolveController : ControllerBase
{
    private readonly ISolverService _solverService;
    private readonly SolverQueueService _solverQueue;

    public SolveController(ISolverService solverService, SolverQueueService solverQueue)
    {
        _solverService = solverService;
        _solverQueue = solverQueue;
    }

    [HttpPost]
    [EnableRateLimiting("guest-solve")]
    public async Task<ActionResult<SolveResponse>> Solve([FromBody] SolveRequest request, CancellationToken cancellationToken)
    {
        if (request.Graph is null)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Graph payload is required for guest solve");
        }

        if (request.StoreData is null)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Store data payload is required for guest solve");
        }

        var result = await _solverQueue.RunAsync(
            ct => _solverService.SolveAsync(request.Graph, request.StoreData, request.Targets, ct),
            cancellationToken);

        return Ok(result);
    }
}