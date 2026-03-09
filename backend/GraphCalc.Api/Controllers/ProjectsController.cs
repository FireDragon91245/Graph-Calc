using GraphCalc.Api.Contracts;
using GraphCalc.Api.Infrastructure;
using GraphCalc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GraphCalc.Api.Controllers;

[ApiController]
[Authorize]
[EnableRateLimiting("crud")]
[Route("projects")]
public sealed class ProjectsController : ControllerBase
{
    private readonly BackendStore _store;

    public ProjectsController(BackendStore store)
    {
        _store = store;
    }

    [HttpGet]
    public async Task<ActionResult<ProjectsResponse>> ListProjects(CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        return Ok(await _store.ListProjectsAsync(user.Id, cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<EntitySummaryResponse>> CreateProject([FromBody] NamedEntityRequest request, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        return Ok(await _store.CreateProjectAsync(user.Id, ApiRequestContext.NormalizeName(request.Name, "Project name is required"), cancellationToken));
    }

    [HttpPut("{projectId}/activate")]
    public async Task<ActionResult<StatusResponse>> ActivateProject(string projectId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        if (!await _store.SetActiveProjectAsync(user.Id, projectId, cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Project not found");
        }

        return Ok(new StatusResponse { Status = "ok" });
    }

    [HttpPut("{projectId}/rename")]
    public async Task<ActionResult<StatusResponse>> RenameProject(string projectId, [FromBody] NamedEntityRequest request, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        if (!await _store.RenameProjectAsync(user.Id, projectId, ApiRequestContext.NormalizeName(request.Name, "Project name is required"), cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Project not found");
        }

        return Ok(new StatusResponse { Status = "ok" });
    }

    [HttpPost("{projectId}/copy")]
    public async Task<ActionResult<EntitySummaryResponse>> CopyProject(string projectId, [FromBody] NamedEntityRequest request, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        return Ok(await _store.CopyProjectAsync(user.Id, projectId, ApiRequestContext.NormalizeName(request.Name, "Project name is required"), cancellationToken));
    }

    [HttpDelete("{projectId}/delete")]
    public async Task<ActionResult<StatusResponse>> DeleteProject(string projectId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        if (!await _store.DeleteProjectAsync(user.Id, projectId, cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Project not found");
        }

        return Ok(new StatusResponse { Status = "ok" });
    }

    [HttpGet("{projectId}/graphs")]
    public async Task<ActionResult<GraphsResponse>> ListGraphs(string projectId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        return Ok(await _store.ListGraphsAsync(user.Id, projectId, cancellationToken));
    }

    [HttpPost("{projectId}/graphs")]
    public async Task<ActionResult<EntitySummaryResponse>> CreateGraph(string projectId, [FromBody] NamedEntityRequest request, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        return Ok(await _store.CreateGraphAsync(user.Id, projectId, ApiRequestContext.NormalizeName(request.Name, "Graph name is required"), cancellationToken));
    }

    [HttpPut("{projectId}/graphs/{graphId}/activate")]
    public async Task<ActionResult<StatusResponse>> ActivateGraph(string projectId, string graphId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        if (!await _store.SetActiveGraphAsync(user.Id, projectId, graphId, cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Graph not found");
        }

        return Ok(new StatusResponse { Status = "ok" });
    }

    [HttpPut("{projectId}/graphs/{graphId}/rename")]
    public async Task<ActionResult<StatusResponse>> RenameGraph(string projectId, string graphId, [FromBody] NamedEntityRequest request, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        if (!await _store.RenameGraphAsync(user.Id, projectId, graphId, ApiRequestContext.NormalizeName(request.Name, "Graph name is required"), cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Graph not found");
        }

        return Ok(new StatusResponse { Status = "ok" });
    }

    [HttpPost("{projectId}/graphs/{graphId}/copy")]
    public async Task<ActionResult<EntitySummaryResponse>> CopyGraph(string projectId, string graphId, [FromBody] NamedEntityRequest request, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        return Ok(await _store.CopyGraphAsync(user.Id, projectId, graphId, ApiRequestContext.NormalizeName(request.Name, "Graph name is required"), cancellationToken));
    }

    [HttpDelete("{projectId}/graphs/{graphId}/delete")]
    public async Task<ActionResult<StatusResponse>> DeleteGraph(string projectId, string graphId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        await _store.RequireProjectAccessAsync(user.Id, projectId, cancellationToken);
        if (!await _store.DeleteGraphAsync(user.Id, projectId, graphId, cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Graph not found");
        }

        return Ok(new StatusResponse { Status = "ok" });
    }
}