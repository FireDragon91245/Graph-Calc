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
    private readonly ThumbnailImageService _thumbnailImages;

    public ProjectsController(BackendStore store, ThumbnailImageService thumbnailImages)
    {
        _store = store;
        _thumbnailImages = thumbnailImages;
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

    [HttpGet("{projectId}/thumbnail")]
    public async Task<IActionResult> GetProjectThumbnail(string projectId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        var image = await _store.GetProjectThumbnailAsync(user.Id, projectId, cancellationToken)
            ?? throw new ApiException(StatusCodes.Status404NotFound, "Thumbnail not found");
        SetThumbnailResponseHeaders(image.Sha256);
        return File(image.Data, image.ContentType);
    }

    [HttpPut("{projectId}/thumbnail")]
    [RequestSizeLimit(5L * 1024L * 1024L + 64L * 1024L)]
    public async Task<ActionResult<ThumbnailUpdateResponse>> PutProjectThumbnail(string projectId, [FromForm] IFormFile image, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        var validated = await _thumbnailImages.ValidateAsync(image, cancellationToken);
        var thumbnailId = await _store.SetProjectThumbnailAsync(user.Id, projectId, validated, cancellationToken);
        return Ok(new ThumbnailUpdateResponse { ThumbnailId = thumbnailId });
    }

    [HttpDelete("{projectId}/thumbnail")]
    public async Task<IActionResult> DeleteProjectThumbnail(string projectId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        if (!await _store.DeleteProjectThumbnailAsync(user.Id, projectId, cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Project not found");
        }
        return NoContent();
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

    [HttpGet("{projectId}/graphs/{graphId}/thumbnail")]
    public async Task<IActionResult> GetGraphThumbnail(string projectId, string graphId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        var image = await _store.GetGraphThumbnailAsync(user.Id, projectId, graphId, cancellationToken)
            ?? throw new ApiException(StatusCodes.Status404NotFound, "Thumbnail not found");
        SetThumbnailResponseHeaders(image.Sha256);
        return File(image.Data, image.ContentType);
    }

    [HttpPut("{projectId}/graphs/{graphId}/thumbnail")]
    [RequestSizeLimit(5L * 1024L * 1024L + 64L * 1024L)]
    public async Task<ActionResult<ThumbnailUpdateResponse>> PutGraphThumbnail(string projectId, string graphId, [FromForm] IFormFile image, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        var validated = await _thumbnailImages.ValidateAsync(image, cancellationToken);
        var thumbnailId = await _store.SetGraphThumbnailAsync(user.Id, projectId, graphId, validated, cancellationToken);
        return Ok(new ThumbnailUpdateResponse { ThumbnailId = thumbnailId });
    }

    [HttpDelete("{projectId}/graphs/{graphId}/thumbnail")]
    public async Task<IActionResult> DeleteGraphThumbnail(string projectId, string graphId, CancellationToken cancellationToken)
    {
        var user = ApiRequestContext.GetAuthenticatedUser(User);
        if (!await _store.DeleteGraphThumbnailAsync(user.Id, projectId, graphId, cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Graph not found");
        }
        return NoContent();
    }

    private void SetThumbnailResponseHeaders(string sha256)
    {
        Response.Headers.ETag = $"\"{sha256}\"";
        Response.Headers.CacheControl = "private, no-cache";
        Response.Headers.XContentTypeOptions = "nosniff";
    }
}
