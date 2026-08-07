using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GraphCalc.Api.Contracts;

public sealed class AuthCredentialsRequest
{
    [JsonPropertyName("username")]
    public required string Username { get; init; }

    [JsonPropertyName("password")]
    public required string Password { get; init; }
}

public sealed class AuthResponse
{
    [JsonPropertyName("token")]
    public required string Token { get; init; }

    [JsonPropertyName("user")]
    public required BasicAuthUser User { get; init; }
}

public sealed class BasicAuthUser
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("username")]
    public required string Username { get; init; }
}

public sealed class AccountProfileResponse
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("username")]
    public required string Username { get; init; }

    [JsonPropertyName("projectCount")]
    public required int ProjectCount { get; init; }

    [JsonPropertyName("activeProjectId")]
    public string? ActiveProjectId { get; init; }
}

public sealed class PasswordChangeRequest
{
    [JsonPropertyName("currentPassword")]
    public required string CurrentPassword { get; init; }

    [JsonPropertyName("newPassword")]
    public required string NewPassword { get; init; }
}

public sealed class DeleteAccountRequest
{
    [JsonPropertyName("currentPassword")]
    public required string CurrentPassword { get; init; }
}

public sealed class NamedEntityRequest
{
    [JsonPropertyName("name")]
    public required string Name { get; init; }
}

public sealed class EntitySummaryResponse
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }
}

public sealed class ProjectsResponse
{
    [JsonPropertyName("projects")]
    public required IReadOnlyList<EntitySummaryResponse> Projects { get; init; }

    [JsonPropertyName("activeProjectId")]
    public string? ActiveProjectId { get; init; }
}

public sealed class GraphsResponse
{
    [JsonPropertyName("graphs")]
    public required IReadOnlyList<EntitySummaryResponse> Graphs { get; init; }

    [JsonPropertyName("activeGraphId")]
    public string? ActiveGraphId { get; init; }
}

public sealed class StatusResponse
{
    [JsonPropertyName("status")]
    public required string Status { get; init; }
}

public sealed class PasswordChangeResponse
{
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    [JsonPropertyName("user")]
    public required AccountProfileResponse User { get; init; }

    [JsonPropertyName("token")]
    public required string Token { get; init; }
}

public sealed class GraphData
{
    [JsonPropertyName("nodes")]
    public List<JsonElement> Nodes { get; init; } = [];

    [JsonPropertyName("edges")]
    public List<JsonElement> Edges { get; init; } = [];
}

public sealed class CategoryDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }
}

public sealed class ItemDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("categoryId")]
    public string? CategoryId { get; init; }
}

public sealed class TagDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("memberItemIds")]
    public List<string> MemberItemIds { get; init; } = [];
}

public sealed class RecipeTagDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("memberRecipeIds")]
    public List<string> MemberRecipeIds { get; init; } = [];
}

public sealed class RecipeInputDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("refType")]
    public required string RefType { get; init; }

    [JsonPropertyName("refId")]
    public required string RefId { get; init; }

    [JsonPropertyName("amount")]
    public required double Amount { get; init; }
}

public sealed class RecipeOutputDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("itemId")]
    public required string ItemId { get; init; }

    [JsonPropertyName("amount")]
    public required double Amount { get; init; }

    [JsonPropertyName("probability")]
    public required double Probability { get; init; }
}

public sealed class RecipeDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("timeSeconds")]
    public required double TimeSeconds { get; init; }

    [JsonPropertyName("inputs")]
    public List<RecipeInputDto> Inputs { get; init; } = [];

    [JsonPropertyName("outputs")]
    public List<RecipeOutputDto> Outputs { get; init; } = [];
}

[JsonConverter(typeof(JsonStringEnumConverter<RecipeTransformTypeDto>))]
public enum RecipeTransformTypeDto
{
    [JsonStringEnumMemberName("addPrefix")]
    AddPrefix,

    [JsonStringEnumMemberName("addSuffix")]
    AddSuffix,

    [JsonStringEnumMemberName("removePrefix")]
    RemovePrefix,

    [JsonStringEnumMemberName("removeSuffix")]
    RemoveSuffix,

    [JsonStringEnumMemberName("replace")]
    Replace,

    [JsonStringEnumMemberName("lowercase")]
    Lowercase,

    [JsonStringEnumMemberName("uppercase")]
    Uppercase
}

[JsonConverter(typeof(JsonStringEnumConverter<RecipeSourceFilterModeDto>))]
public enum RecipeSourceFilterModeDto
{
    [JsonStringEnumMemberName("any")]
    Any,

    [JsonStringEnumMemberName("all")]
    All
}

[JsonConverter(typeof(JsonStringEnumConverter<RecipeSlotResolverDto>))]
public enum RecipeSlotResolverDto
{
    [JsonStringEnumMemberName("source")]
    Source,

    [JsonStringEnumMemberName("fixedItem")]
    FixedItem,

    [JsonStringEnumMemberName("fixedTag")]
    FixedTag,

    [JsonStringEnumMemberName("related")]
    Related
}

[JsonConverter(typeof(JsonStringEnumConverter<RecipeOutputSlotResolverDto>))]
public enum RecipeOutputSlotResolverDto
{
    [JsonStringEnumMemberName("source")]
    Source,

    [JsonStringEnumMemberName("fixedItem")]
    FixedItem,

    [JsonStringEnumMemberName("related")]
    Related
}

[JsonConverter(typeof(JsonStringEnumConverter<RecipeNameItemDto>))]
public enum RecipeNameItemDto
{
    [JsonStringEnumMemberName("source")]
    Source,

    [JsonStringEnumMemberName("input1")]
    Input1,

    [JsonStringEnumMemberName("output1")]
    Output1,

    [JsonStringEnumMemberName("none")]
    None
}

public sealed class RecipeTransformStepDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("type")]
    public required RecipeTransformTypeDto Type { get; init; }

    [JsonPropertyName("value")]
    public string? Value { get; init; }

    [JsonPropertyName("replaceFrom")]
    public string? ReplaceFrom { get; init; }

    [JsonPropertyName("replaceTo")]
    public string? ReplaceTo { get; init; }
}

public sealed class RecipeSourceRuleDto
{
    [JsonPropertyName("filterMode")]
    public RecipeSourceFilterModeDto FilterMode { get; init; } = RecipeSourceFilterModeDto.Any;

    [JsonPropertyName("tagIds")]
    public List<string> TagIds { get; init; } = [];

    [JsonPropertyName("categoryIds")]
    public List<string> CategoryIds { get; init; } = [];

    [JsonPropertyName("itemIds")]
    public List<string> ItemIds { get; init; } = [];

    [JsonPropertyName("excludeTagIds")]
    public List<string> ExcludeTagIds { get; init; } = [];

    [JsonPropertyName("excludeCategoryIds")]
    public List<string> ExcludeCategoryIds { get; init; } = [];

    [JsonPropertyName("excludeItemIds")]
    public List<string> ExcludeItemIds { get; init; } = [];
}

public sealed class RecipeSlotRuleDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("resolver")]
    public required RecipeSlotResolverDto Resolver { get; init; }

    [JsonPropertyName("amount")]
    public required double Amount { get; init; }

    [JsonPropertyName("refId")]
    public string? RefId { get; init; }

    [JsonPropertyName("targetTagId")]
    public string? TargetTagId { get; init; }

    [JsonPropertyName("targetCategoryId")]
    public string? TargetCategoryId { get; init; }

    [JsonPropertyName("nameTransforms")]
    public List<RecipeTransformStepDto> NameTransforms { get; init; } = [];
}

public sealed class RecipeOutputSlotRuleDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("resolver")]
    public required RecipeOutputSlotResolverDto Resolver { get; init; }

    [JsonPropertyName("amount")]
    public required double Amount { get; init; }

    [JsonPropertyName("probability")]
    public required double Probability { get; init; }

    [JsonPropertyName("refId")]
    public string? RefId { get; init; }

    [JsonPropertyName("targetTagId")]
    public string? TargetTagId { get; init; }

    [JsonPropertyName("targetCategoryId")]
    public string? TargetCategoryId { get; init; }

    [JsonPropertyName("nameTransforms")]
    public List<RecipeTransformStepDto> NameTransforms { get; init; } = [];
}

public sealed class RecipeBlueprintDto
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("description")]
    public required string Description { get; init; }

    [JsonPropertyName("source")]
    public required RecipeSourceRuleDto Source { get; init; }

    [JsonPropertyName("recipeNamePrefix")]
    public required string RecipeNamePrefix { get; init; }

    [JsonPropertyName("recipeNameItem")]
    public required RecipeNameItemDto RecipeNameItem { get; init; }

    [JsonPropertyName("recipeNameSuffix")]
    public required string RecipeNameSuffix { get; init; }

    [JsonPropertyName("timeSeconds")]
    public required double TimeSeconds { get; init; }

    [JsonPropertyName("inputs")]
    public List<RecipeSlotRuleDto> Inputs { get; init; } = [];

    [JsonPropertyName("outputs")]
    public List<RecipeOutputSlotRuleDto> Outputs { get; init; } = [];

    [JsonPropertyName("recipeTagIds")]
    public List<string> RecipeTagIds { get; init; } = [];

    [JsonPropertyName("createdAt")]
    public required long CreatedAt { get; init; }

    [JsonPropertyName("updatedAt")]
    public required long UpdatedAt { get; init; }
}

public sealed class StoreData
{
    [JsonPropertyName("categories")]
    public List<CategoryDto> Categories { get; init; } = [];

    [JsonPropertyName("items")]
    public List<ItemDto> Items { get; init; } = [];

    [JsonPropertyName("tags")]
    public List<TagDto> Tags { get; init; } = [];

    [JsonPropertyName("recipeTags")]
    public List<RecipeTagDto> RecipeTags { get; init; } = [];

    [JsonPropertyName("recipes")]
    public List<RecipeDto> Recipes { get; init; } = [];

    [JsonPropertyName("recipeBlueprints")]
    public List<RecipeBlueprintDto> RecipeBlueprints { get; init; } = [];
}

public sealed class SolveTargets
{
    [JsonPropertyName("maximizeOutput")]
    public List<string> MaximizeOutput { get; init; } = [];

    [JsonPropertyName("minimizeInput")]
    public List<string> MinimizeInput { get; init; } = [];

    [JsonPropertyName("balance")]
    public bool Balance { get; init; }
}

public sealed class SolveRequest
{
    [JsonPropertyName("graph")]
    public GraphData? Graph { get; init; }

    [JsonPropertyName("targets")]
    public SolveTargets Targets { get; init; } = new();

    [JsonPropertyName("storeData")]
    public StoreData? StoreData { get; init; }
}

public sealed class NodeFlowData
{
    [JsonPropertyName("machineCount")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? MachineCount { get; init; }

    [JsonPropertyName("recipeRuns")]
    public Dictionary<string, double> RecipeRuns { get; init; } = [];

    [JsonPropertyName("inputFlows")]
    public Dictionary<string, double> InputFlows { get; init; } = [];

    [JsonPropertyName("outputFlows")]
    public Dictionary<string, double> OutputFlows { get; init; } = [];

    [JsonPropertyName("totalInput")]
    public double TotalInput { get; init; }

    [JsonPropertyName("totalOutput")]
    public double TotalOutput { get; init; }
}

public sealed class EdgeFlowData
{
    [JsonPropertyName("flows")]
    public Dictionary<string, double> Flows { get; init; } = [];

    [JsonPropertyName("totalFlow")]
    public double TotalFlow { get; init; }
}

public sealed class SolveResponse
{
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    [JsonPropertyName("machineCounts")]
    public Dictionary<string, double> MachineCounts { get; init; } = [];

    [JsonPropertyName("flowsPerSecond")]
    public Dictionary<string, double> FlowsPerSecond { get; init; } = [];

    [JsonPropertyName("bottlenecks")]
    public List<string> Bottlenecks { get; init; } = [];

    [JsonPropertyName("warnings")]
    public List<string> Warnings { get; init; } = [];

    [JsonPropertyName("nodeFlows")]
    public Dictionary<string, NodeFlowData> NodeFlows { get; init; } = [];

    [JsonPropertyName("edgeFlows")]
    public Dictionary<string, EdgeFlowData> EdgeFlows { get; init; } = [];

    [JsonPropertyName("problemEdgeIds")]
    public List<string> ProblemEdgeIds { get; init; } = [];
}
