using System.Text.Json;
using Google.OrTools.LinearSolver;
using GraphCalc.Api.Contracts;

namespace GraphCalc.Api.Services;

public interface ISolverService
{
    Task<SolveResponse> SolveAsync(GraphData graph, StoreData store, SolveTargets targets, CancellationToken cancellationToken);
}

public sealed class SolverService : ISolverService
{
    private readonly ILogger<SolverService> _logger;

    public SolverService(ILogger<SolverService> logger)
    {
        _logger = logger;
    }

    public Task<SolveResponse> SolveAsync(GraphData graph, StoreData store, SolveTargets targets, CancellationToken cancellationToken)
    {
        return Task.Run(() => GraphLpSolver.Solve(graph, store, _logger, cancellationToken), cancellationToken);
    }
}

internal static class GraphLpSolver
{
    private const double FlowThreshold = 0.001;

    public static SolveResponse Solve(GraphData graph, StoreData? storeData, ILogger logger, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var warnings = new List<string>();
        var problemEdgeIds = new List<string>();
        var nameToId = BuildNameToIdMap(storeData);

        try
        {
            var parsedGraph = ParseGraph(graph);
            var recipeNodes = new List<ParsedNode>();
            var inputNodes = new List<ParsedNode>();
            var outputNodes = new List<ParsedNode>();
            var requesterNodes = new List<ParsedNode>();
            var nodeTypeMap = new Dictionary<string, string>(StringComparer.Ordinal);
            var nodeById = new Dictionary<string, ParsedNode>(StringComparer.Ordinal);

            foreach (var node in parsedGraph.Nodes)
            {
                nodeTypeMap[node.Id] = node.Type;
                nodeById[node.Id] = node;
                switch (node.Type)
                {
                    case "recipe":
                    case "recipetag":
                    case "inputrecipe":
                    case "inputrecipetag":
                        recipeNodes.Add(node);
                        break;
                    case "input":
                        inputNodes.Add(node);
                        break;
                    case "output":
                    case "mixedoutput":
                        outputNodes.Add(node);
                        break;
                    case "requester":
                        requesterNodes.Add(node);
                        break;
                }
            }

            var recipes = new List<RecipeInstance>();
            foreach (var node in recipeNodes)
            {
                recipes.AddRange(ExtractRecipesFromNode(node, storeData, nameToId));
            }

            if (recipes.Count == 0 && inputNodes.Count == 0)
            {
                return new SolveResponse
                {
                    Status = "ok",
                    MachineCounts = new Dictionary<string, double>(StringComparer.Ordinal),
                    FlowsPerSecond = new Dictionary<string, double>(StringComparer.Ordinal),
                    Bottlenecks = [],
                    Warnings = ["No recipes or inputs found in graph"],
                    NodeFlows = new Dictionary<string, NodeFlowData>(StringComparer.Ordinal),
                    EdgeFlows = new Dictionary<string, EdgeFlowData>(StringComparer.Ordinal),
                    ProblemEdgeIds = []
                };
            }

            var adjacency = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var node in parsedGraph.Nodes)
            {
                adjacency[node.Id] = [];
            }

            foreach (var edge in parsedGraph.Edges)
            {
                if (!adjacency.TryGetValue(edge.Source, out var sourceSet))
                {
                    sourceSet = [];
                    adjacency[edge.Source] = sourceSet;
                }

                if (!adjacency.TryGetValue(edge.Target, out var targetSet))
                {
                    targetSet = [];
                    adjacency[edge.Target] = targetSet;
                }

                sourceSet.Add(edge.Target);
                targetSet.Add(edge.Source);
            }

            var allNodeIds = parsedGraph.Nodes.Select(node => node.Id).ToHashSet(StringComparer.Ordinal);
            var components = ComputeConnectedComponents(allNodeIds, adjacency, cancellationToken);
            var (sccs, nodeToScc) = ComputeStronglyConnectedComponents(allNodeIds, parsedGraph.Edges, cancellationToken);
            var cycleEdgeIds = ComputeCycleEdgeIds(parsedGraph, sccs, nodeToScc);

            if (components.Count > 1)
            {
                return SolveComponentsIndependently(parsedGraph, storeData, components, warnings, logger, cancellationToken);
            }

            cancellationToken.ThrowIfCancellationRequested();
            var solver = Solver.CreateSolver("GLOP");
            if (solver is null)
            {
                return new SolveResponse
                {
                    Status = "error",
                    Warnings = ["Failed to create LP solver"],
                    ProblemEdgeIds = problemEdgeIds
                };
            }

            var recipeVars = new Dictionary<string, Variable>(StringComparer.Ordinal);
            foreach (var recipe in recipes)
            {
                recipeVars[recipe.NodeId] = solver.MakeNumVar(0.0, recipe.MaxMachines ?? double.PositiveInfinity, $"m_{recipe.NodeId}");
            }

            var portProd = new Dictionary<(string NodeId, string Handle), List<PortItemContribution>>();
            var portCons = new Dictionary<(string NodeId, string Handle), List<PortItemContribution>>();
            var mixedCons = new Dictionary<(string NodeId, string Handle), List<RecipeRateContribution>>();
            var portOutputItems = new Dictionary<(string NodeId, string Handle), HashSet<string>>();
            var portInputItems = new Dictionary<(string NodeId, string Handle), HashSet<string>>();

            var tagPortDefinitions = new Dictionary<string, TagPortDefinitions>(StringComparer.Ordinal);
            foreach (var node in parsedGraph.Nodes)
            {
                if (node.Type is "recipetag" or "inputrecipetag")
                {
                    tagPortDefinitions[node.Id] = new TagPortDefinitions(GetArrayProperty(node.Data, "inputs"), GetArrayProperty(node.Data, "outputs"));
                }
            }

            foreach (var recipe in recipes)
            {
                cancellationToken.ThrowIfCancellationRequested();
                tagPortDefinitions.TryGetValue(recipe.ParentTagNodeId ?? string.Empty, out var tagPorts);
                var visualId = recipe.ParentTagNodeId ?? recipe.NodeId;
                RegisterRecipeOutputs(recipe, visualId, tagPorts, nameToId, portProd, portOutputItems);
                RegisterRecipeInputs(recipe, visualId, tagPorts, nameToId, portCons, mixedCons, portInputItems);
            }

            foreach (var node in inputNodes)
            {
                foreach (var itemEntry in GetArrayProperty(node.Data, "items"))
                {
                    var itemId = GetStringProperty(itemEntry, "itemId");
                    if (!string.IsNullOrWhiteSpace(itemId))
                    {
                        AddSetValue(portOutputItems, (node.Id, $"output-{GetStringProperty(itemEntry, "id", "output")}"), itemId);
                    }
                }
            }

            foreach (var node in outputNodes.Where(node => node.Type != "mixedoutput"))
            {
                foreach (var itemEntry in GetArrayProperty(node.Data, "items"))
                {
                    var itemId = GetStringProperty(itemEntry, "itemId");
                    if (!string.IsNullOrWhiteSpace(itemId))
                    {
                        AddSetValue(portInputItems, (node.Id, $"input-{GetStringProperty(itemEntry, "id", "input")}"), itemId);
                    }
                }
            }

            foreach (var node in requesterNodes)
            {
                foreach (var requestEntry in GetArrayProperty(node.Data, "requests"))
                {
                    var itemId = GetStringProperty(requestEntry, "itemId");
                    if (!string.IsNullOrWhiteSpace(itemId))
                    {
                        AddSetValue(portInputItems, (node.Id, $"input-{GetStringProperty(requestEntry, "id", "input")}"), itemId);
                    }
                }
            }

            var edgesBySource = new Dictionary<(string NodeId, string Handle), List<ParsedEdge>>();
            var edgesByTarget = new Dictionary<(string NodeId, string Handle), List<ParsedEdge>>();
            var edgeFlowVars = new Dictionary<string, Dictionary<string, Variable>>(StringComparer.Ordinal);
            var edgeVarCounter = 0;

            foreach (var edge in parsedGraph.Edges)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var sourceHandle = edge.SourceHandle ?? "output";
                var targetHandle = edge.TargetHandle ?? "input";
                var sourceKey = (edge.Source, sourceHandle);
                var targetKey = (edge.Target, targetHandle);
                AddListValue(edgesBySource, sourceKey, edge);
                AddListValue(edgesByTarget, targetKey, edge);

                portOutputItems.TryGetValue(sourceKey, out var sourceItems);
                sourceItems ??= [];

                var targetSpecific = new HashSet<string>(StringComparer.Ordinal);
                if (portCons.TryGetValue(targetKey, out var targetContributions))
                {
                    foreach (var contribution in targetContributions)
                    {
                        targetSpecific.Add(contribution.ItemId);
                    }
                }

                if (sourceItems.Count > 0 && targetSpecific.Count > 0 && !sourceItems.Overlaps(targetSpecific))
                {
                    warnings.Add($"Edge item mismatch: '{GetNodeDisplayName(nodeById.GetValueOrDefault(edge.Source))}' provides {FormatItemSet(sourceItems)} but '{GetNodeDisplayName(nodeById.GetValueOrDefault(edge.Target))}' expects {FormatItemSet(targetSpecific)}. Connected recipes disabled.");
                    if (!problemEdgeIds.Contains(edge.Id, StringComparer.Ordinal))
                    {
                        problemEdgeIds.Add(edge.Id);
                    }
                }

                portInputItems.TryGetValue(targetKey, out var targetItems);
                var edgeItems = targetItems is { Count: > 0 }
                    ? sourceItems.Intersect(targetItems, StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal)
                    : sourceItems.ToHashSet(StringComparer.Ordinal);
                var perItemVariables = new Dictionary<string, Variable>(StringComparer.Ordinal);
                foreach (var itemId in edgeItems)
                {
                    perItemVariables[itemId] = solver.MakeNumVar(0.0, double.PositiveInfinity, $"f{edgeVarCounter}_{itemId}");
                    edgeVarCounter += 1;
                }

                edgeFlowVars[edge.Id] = perItemVariables;
            }

            foreach (var (portKey, contributions) in portProd)
            {
                var outgoing = edgesBySource.GetValueOrDefault(portKey);
                if (outgoing is null || outgoing.Count == 0)
                {
                    continue;
                }

                var itemRates = contributions.GroupBy(entry => entry.ItemId, StringComparer.Ordinal);
                foreach (var itemRateGroup in itemRates)
                {
                    var terms = new List<VarCoeff>();
                    foreach (var contribution in itemRateGroup)
                    {
                        terms.Add(new VarCoeff(recipeVars[contribution.Recipe.NodeId], contribution.RatePerMachine));
                    }

                    foreach (var edge in outgoing)
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemRateGroup.Key, out var flowVar))
                        {
                            terms.Add(new VarCoeff(flowVar, -1.0));
                        }
                    }

                    if (terms.Any(term => term.Coefficient < 0.0))
                    {
                        AddConstraint(solver, terms, 0.0, 0.0);
                    }
                }
            }

            foreach (var (portKey, contributions) in portCons)
            {
                var incoming = edgesByTarget.GetValueOrDefault(portKey) ?? [];
                var itemRates = contributions.GroupBy(entry => entry.ItemId, StringComparer.Ordinal);
                foreach (var itemRateGroup in itemRates)
                {
                    var terms = new List<VarCoeff>();
                    foreach (var edge in incoming)
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemRateGroup.Key, out var flowVar))
                        {
                            terms.Add(new VarCoeff(flowVar, 1.0));
                        }
                    }

                    foreach (var contribution in itemRateGroup)
                    {
                        terms.Add(new VarCoeff(recipeVars[contribution.Recipe.NodeId], -contribution.RatePerMachine));
                    }

                    AddConstraint(solver, terms, 0.0, 0.0);
                }
            }

            foreach (var (portKey, rates) in mixedCons)
            {
                var incoming = edgesByTarget.GetValueOrDefault(portKey) ?? [];
                var terms = new List<VarCoeff>();
                foreach (var edge in incoming)
                {
                    if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars))
                    {
                        terms.AddRange(flowVars.Values.Select(variable => new VarCoeff(variable, 1.0)));
                    }
                }

                terms.AddRange(rates.Select(rate => new VarCoeff(recipeVars[rate.Recipe.NodeId], -rate.RatePerMachine)));
                AddConstraint(solver, terms, 0.0, 0.0);
            }

            var inputLimits = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var node in inputNodes)
            {
                foreach (var itemEntry in GetArrayProperty(node.Data, "items"))
                {
                    var itemId = GetStringProperty(itemEntry, "itemId");
                    var mode = GetStringProperty(itemEntry, "mode", "infinite");
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var portKey = (node.Id, $"output-{GetStringProperty(itemEntry, "id", "output")}");
                    var outgoing = edgesBySource.GetValueOrDefault(portKey) ?? [];
                    if (mode == "limit" && TryGetDoubleProperty(itemEntry, "limit", out var limitValue))
                    {
                        var terms = new List<VarCoeff>();
                        foreach (var edge in outgoing)
                        {
                            if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemId, out var flowVar))
                            {
                                terms.Add(new VarCoeff(flowVar, 1.0));
                            }
                        }

                        if (terms.Count > 0)
                        {
                            AddConstraint(solver, terms, double.NegativeInfinity, limitValue);
                        }

                        inputLimits[itemId] = inputLimits.GetValueOrDefault(itemId) + limitValue;
                    }
                }
            }

            var hasInputRecipeConstraints = recipes.Any(recipe => recipe.MaxMachines is not null);
            var hasInputConstraints = inputLimits.Count > 0 || hasInputRecipeConstraints;

            var outputDemands = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var node in requesterNodes)
            {
                foreach (var requestEntry in GetArrayProperty(node.Data, "requests"))
                {
                    var itemId = GetStringProperty(requestEntry, "itemId");
                    if (string.IsNullOrWhiteSpace(itemId) || !TryGetDoubleProperty(requestEntry, "targetPerSecond", out var targetValue))
                    {
                        continue;
                    }

                    var portKey = (node.Id, $"input-{GetStringProperty(requestEntry, "id", "input")}");
                    var incoming = edgesByTarget.GetValueOrDefault(portKey) ?? [];
                    var terms = new List<VarCoeff>();
                    foreach (var edge in incoming)
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemId, out var flowVar))
                        {
                            terms.Add(new VarCoeff(flowVar, 1.0));
                        }
                    }

                    if (terms.Count > 0)
                    {
                        AddConstraint(solver, terms, targetValue, double.PositiveInfinity);
                    }
                    else
                    {
                        warnings.Add($"Requester demands {itemId} ({targetValue}/s) but no supplying edge exists");
                    }

                    outputDemands[itemId] = outputDemands.GetValueOrDefault(itemId) + targetValue;
                }
            }

            var hasOutputDemands = outputDemands.Count > 0;
            var nodeDepth = ComputeNodeDepths(parsedGraph, nodeTypeMap, inputNodes, recipes, sccs, nodeToScc);
            var outputSurplusVars = new List<WeightedVariable>();
            var hasOutputSinks = false;

            foreach (var node in outputNodes)
            {
                if (node.Type == "mixedoutput")
                {
                    var mixedPortKey = (node.Id, "mixed-input");
                    var incoming = edgesByTarget.GetValueOrDefault(mixedPortKey) ?? [];
                    if (incoming.Count == 0)
                    {
                        continue;
                    }

                    var itemVars = new Dictionary<string, List<Variable>>(StringComparer.Ordinal);
                    var itemDepths = new Dictionary<string, int>(StringComparer.Ordinal);
                    foreach (var edge in incoming)
                    {
                        var sourceDepth = nodeDepth.GetValueOrDefault(edge.Source, 0);
                        if (!edgeFlowVars.TryGetValue(edge.Id, out var flowVars))
                        {
                            continue;
                        }

                        foreach (var (itemId, flowVar) in flowVars)
                        {
                            AddListValue(itemVars, itemId, flowVar);
                            itemDepths[itemId] = Math.Max(itemDepths.GetValueOrDefault(itemId, 0), sourceDepth);
                        }
                    }

                    foreach (var (itemId, vars) in itemVars)
                    {
                        hasOutputSinks = true;
                        var surplus = solver.MakeNumVar(0.0, double.PositiveInfinity, $"surplus_{node.Id}_{itemId}");
                        var terms = vars.Select(variable => new VarCoeff(variable, -1.0)).ToList();
                        terms.Add(new VarCoeff(surplus, 1.0));
                        AddConstraint(solver, terms, 0.0, 0.0);
                        outputSurplusVars.Add(new WeightedVariable(surplus, Math.Pow(10.0, Math.Max(itemDepths.GetValueOrDefault(itemId, 0), 1))));
                    }

                    continue;
                }

                foreach (var itemEntry in GetArrayProperty(node.Data, "items"))
                {
                    var itemId = GetStringProperty(itemEntry, "itemId");
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var portKey = (node.Id, $"input-{GetStringProperty(itemEntry, "id", "input")}");
                    var incoming = edgesByTarget.GetValueOrDefault(portKey) ?? [];
                    var vars = new List<Variable>();
                    foreach (var edge in incoming)
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemId, out var flowVar))
                        {
                            vars.Add(flowVar);
                        }
                    }

                    if (vars.Count == 0)
                    {
                        continue;
                    }

                    hasOutputSinks = true;
                    var surplus = solver.MakeNumVar(0.0, double.PositiveInfinity, $"surplus_{node.Id}_{itemId}");
                    var terms = vars.Select(variable => new VarCoeff(variable, -1.0)).ToList();
                    terms.Add(new VarCoeff(surplus, 1.0));
                    AddConstraint(solver, terms, 0.0, 0.0);

                    var maxSourceDepth = incoming.Count == 0 ? 0 : incoming.Max(edge => nodeDepth.GetValueOrDefault(edge.Source, 0));
                    outputSurplusVars.Add(new WeightedVariable(surplus, Math.Pow(10.0, Math.Max(maxSourceDepth, 1))));
                }
            }

            var recipeTypes = new HashSet<string>(StringComparer.Ordinal) { "recipe", "recipetag", "inputrecipe", "inputrecipetag" };
            var secondaryPreferenceTerms = new List<WeightedVariable>();
            if (cycleEdgeIds.Count > 0)
            {
                var maxDepth = nodeDepth.Count == 0 ? 0 : nodeDepth.Values.Max();
                foreach (var (portKey, incomingEdges) in edgesByTarget)
                {
                    if (incomingEdges.Count < 2 || !recipeTypes.Contains(nodeTypeMap.GetValueOrDefault(portKey.NodeId, string.Empty)))
                    {
                        continue;
                    }

                    var weightsByEdge = new Dictionary<string, double>(StringComparer.Ordinal);
                    var distinctWeights = new HashSet<double>();
                    foreach (var edge in incomingEdges)
                    {
                        var weight = GetSupplyPreferenceWeight(edge, nodeTypeMap, nodeDepth, maxDepth);
                        weightsByEdge[edge.Id] = weight;
                        distinctWeights.Add(weight);
                    }

                    if (distinctWeights.Count < 2)
                    {
                        continue;
                    }

                    foreach (var edge in incomingEdges)
                    {
                        if (!edgeFlowVars.TryGetValue(edge.Id, out var flowVars))
                        {
                            continue;
                        }

                        foreach (var variable in flowVars.Values)
                        {
                            secondaryPreferenceTerms.Add(new WeightedVariable(variable, weightsByEdge[edge.Id]));
                        }
                    }
                }
            }

            var objective = solver.Objective();
            var objectiveTerms = new Dictionary<Variable, double>();
            var objectiveIsMaximization = false;

            void AddObjectiveTerm(Variable variable, double coefficient)
            {
                var next = objectiveTerms.GetValueOrDefault(variable) + coefficient;
                objectiveTerms[variable] = next;
                objective.SetCoefficient(variable, next);
            }

            if (hasOutputDemands && !hasInputConstraints)
            {
                foreach (var variable in recipeVars.Values)
                {
                    AddObjectiveTerm(variable, 1.0);
                }

                objective.SetMinimization();
            }
            else if (hasInputConstraints && !hasOutputDemands)
            {
                foreach (var recipe in recipes)
                {
                    AddObjectiveTerm(recipeVars[recipe.NodeId], recipe.MaxMachines is not null ? 10000.0 : -0.001);
                }

                foreach (var weightedVar in outputSurplusVars)
                {
                    AddObjectiveTerm(weightedVar.Variable, weightedVar.Weight);
                }

                objective.SetMaximization();
                objectiveIsMaximization = true;
            }
            else if (hasInputConstraints && hasOutputDemands)
            {
                if (hasOutputSinks)
                {
                    foreach (var variable in recipeVars.Values)
                    {
                        AddObjectiveTerm(variable, -0.001);
                    }

                    foreach (var weightedVar in outputSurplusVars)
                    {
                        AddObjectiveTerm(weightedVar.Variable, weightedVar.Weight);
                    }

                    objective.SetMaximization();
                    objectiveIsMaximization = true;
                }
                else
                {
                    foreach (var variable in recipeVars.Values)
                    {
                        AddObjectiveTerm(variable, 1.0);
                    }

                    objective.SetMinimization();
                }
            }
            else
            {
                foreach (var variable in recipeVars.Values)
                {
                    AddObjectiveTerm(variable, 1.0);
                }

                objective.SetMinimization();
            }

            cancellationToken.ThrowIfCancellationRequested();
            var status = solver.Solve();
            if (status is not Solver.ResultStatus.OPTIMAL and not Solver.ResultStatus.FEASIBLE)
            {
                HandleFailedSolve(status, cycleEdgeIds, warnings, problemEdgeIds);
                return new SolveResponse
                {
                    Status = "error",
                    Warnings = warnings,
                    ProblemEdgeIds = problemEdgeIds
                };
            }

            if (cycleEdgeIds.Count > 0 && secondaryPreferenceTerms.Count > 0)
            {
                var primaryValue = objective.Value();
                var tolerance = Math.Max(1e-7, 1e-7 * Math.Max(1.0, Math.Abs(primaryValue)));
                AddConstraint(
                    solver,
                    objectiveTerms.Select(entry => new VarCoeff(entry.Key, entry.Value)).ToList(),
                    objectiveIsMaximization ? primaryValue - tolerance : double.NegativeInfinity,
                    objectiveIsMaximization ? double.PositiveInfinity : primaryValue + tolerance);

                foreach (var variable in objectiveTerms.Keys)
                {
                    objective.SetCoefficient(variable, 0.0);
                }

                var secondaryCoefficients = new Dictionary<Variable, double>();
                foreach (var weightedVar in secondaryPreferenceTerms)
                {
                    secondaryCoefficients[weightedVar.Variable] = secondaryCoefficients.GetValueOrDefault(weightedVar.Variable) + weightedVar.Weight;
                }

                foreach (var (variable, coefficient) in secondaryCoefficients)
                {
                    objective.SetCoefficient(variable, coefficient);
                }

                objective.SetMinimization();
                status = solver.Solve();
                if (status is not Solver.ResultStatus.OPTIMAL and not Solver.ResultStatus.FEASIBLE)
                {
                    warnings.Add("Circular preference pass failed; falling back to the primary cycle solution may require a retry.");
                }
            }

            if (cycleEdgeIds.Count > 0)
            {
                var cycleEdgesByScc = new Dictionary<int, List<string>>();
                foreach (var edge in parsedGraph.Edges)
                {
                    if (cycleEdgeIds.Contains(edge.Id))
                    {
                        AddListValue(cycleEdgesByScc, nodeToScc[edge.Source], edge.Id);
                    }
                }

                for (var sccIndex = 0; sccIndex < sccs.Count; sccIndex += 1)
                {
                    var componentNodes = sccs[sccIndex];
                    var cycleItems = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var edge in parsedGraph.Edges)
                    {
                        if (!cycleEdgeIds.Contains(edge.Id) || nodeToScc.GetValueOrDefault(edge.Source, -1) != sccIndex)
                        {
                            continue;
                        }

                        if (!edgeFlowVars.TryGetValue(edge.Id, out var flowVars))
                        {
                            continue;
                        }

                        foreach (var (itemId, variable) in flowVars)
                        {
                            if (variable.SolutionValue() > 1e-7)
                            {
                                cycleItems.Add(itemId);
                            }
                        }
                    }

                    foreach (var itemId in cycleItems)
                    {
                        var internalProduction = 0.0;
                        var internalConsumption = 0.0;
                        var externalEntry = 0.0;
                        var externalExit = 0.0;

                        foreach (var recipe in recipes)
                        {
                            var visualId = recipe.ParentTagNodeId ?? recipe.NodeId;
                            if (!componentNodes.Contains(visualId))
                            {
                                continue;
                            }

                            var machineCount = recipeVars[recipe.NodeId].SolutionValue();
                            if (machineCount <= 1e-7)
                            {
                                continue;
                            }

                            foreach (var output in recipe.Outputs)
                            {
                                if (ResolveItemId(output, nameToId, false) == itemId)
                                {
                                    internalProduction += machineCount * GetAmountPerCycle(output) * GetProbability(output) / recipe.TimeSeconds;
                                }
                            }

                            foreach (var input in recipe.Inputs)
                            {
                                if (ResolveItemId(input, nameToId, true) == itemId)
                                {
                                    internalConsumption += machineCount * GetAmountPerCycle(input) / recipe.TimeSeconds;
                                }
                            }
                        }

                        foreach (var edge in parsedGraph.Edges)
                        {
                            if (!edgeFlowVars.TryGetValue(edge.Id, out var flowVars) || !flowVars.TryGetValue(itemId, out var flowVar))
                            {
                                continue;
                            }

                            var sourceScc = nodeToScc.GetValueOrDefault(edge.Source, -1);
                            var targetScc = nodeToScc.GetValueOrDefault(edge.Target, -1);
                            if (sourceScc == sccIndex && targetScc != sccIndex)
                            {
                                externalExit += flowVar.SolutionValue();
                            }
                            else if (sourceScc != sccIndex && targetScc == sccIndex)
                            {
                                externalEntry += flowVar.SolutionValue();
                            }
                        }

                        if (internalProduction + externalEntry > internalConsumption + externalExit + 1e-6)
                        {
                            foreach (var edgeId in cycleEdgesByScc.GetValueOrDefault(sccIndex) ?? [])
                            {
                                if (!problemEdgeIds.Contains(edgeId, StringComparer.Ordinal))
                                {
                                    problemEdgeIds.Add(edgeId);
                                }
                            }

                            warnings.Add($"Circular reference is runaway for {itemId}: {Round3(internalProduction + externalEntry)}/s available inside the cycle but only {Round3(internalConsumption + externalExit)}/s can be consumed or removed.");
                            return new SolveResponse
                            {
                                Status = "error",
                                Warnings = warnings,
                                ProblemEdgeIds = problemEdgeIds
                            };
                        }
                    }
                }
            }

            var machineCounts = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var recipe in recipes)
            {
                var machineCount = recipeVars[recipe.NodeId].SolutionValue();
                if (machineCount > FlowThreshold)
                {
                    machineCounts[recipe.Name] = Round3(machineCounts.GetValueOrDefault(recipe.Name) + machineCount);
                }
            }

            var edgeFlowsResult = new Dictionary<string, EdgeFlowData>(StringComparer.Ordinal);
            foreach (var edge in parsedGraph.Edges)
            {
                if (!edgeFlowVars.TryGetValue(edge.Id, out var flowVars))
                {
                    continue;
                }

                var flows = new Dictionary<string, double>(StringComparer.Ordinal);
                var total = 0.0;
                foreach (var (itemId, variable) in flowVars)
                {
                    var value = variable.SolutionValue();
                    if (value > FlowThreshold)
                    {
                        flows[itemId] = Round3(value);
                        total += value;
                    }
                }

                if (total > FlowThreshold)
                {
                    edgeFlowsResult[edge.Id] = new EdgeFlowData
                    {
                        Flows = flows,
                        TotalFlow = Round3(total)
                    };
                }
            }

            var flowsPerSecond = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var recipe in recipes)
            {
                var machineCount = recipeVars[recipe.NodeId].SolutionValue();
                if (machineCount < FlowThreshold)
                {
                    continue;
                }

                foreach (var output in recipe.Outputs)
                {
                    var itemId = ResolveItemId(output, nameToId, false);
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var rate = machineCount * GetAmountPerCycle(output) * GetProbability(output) / recipe.TimeSeconds;
                    if (rate > FlowThreshold)
                    {
                        flowsPerSecond[itemId] = Round3(flowsPerSecond.GetValueOrDefault(itemId) + rate);
                    }
                }
            }

            var nodeFlowAccumulators = new Dictionary<string, MutableNodeFlow>(StringComparer.Ordinal);
            foreach (var recipe in recipes)
            {
                var machineCount = recipeVars[recipe.NodeId].SolutionValue();
                if (machineCount < FlowThreshold)
                {
                    continue;
                }

                var nodeFlow = new MutableNodeFlow { MachineCount = Round3(machineCount) };
                nodeFlow.RecipeRuns[recipe.RecipeId] = Round3(machineCount);

                foreach (var input in recipe.Inputs)
                {
                    var itemId = ResolveItemId(input, nameToId, true);
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var rate = machineCount * GetAmountPerCycle(input) / recipe.TimeSeconds;
                    if (rate > FlowThreshold)
                    {
                        nodeFlow.InputFlows[itemId] = Round3(nodeFlow.InputFlows.GetValueOrDefault(itemId) + rate);
                        nodeFlow.TotalInput += rate;
                    }
                }

                foreach (var output in recipe.Outputs)
                {
                    var itemId = ResolveItemId(output, nameToId, false);
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var rate = machineCount * GetAmountPerCycle(output) * GetProbability(output) / recipe.TimeSeconds;
                    if (rate > FlowThreshold)
                    {
                        nodeFlow.OutputFlows[itemId] = Round3(nodeFlow.OutputFlows.GetValueOrDefault(itemId) + rate);
                        nodeFlow.TotalOutput += rate;
                    }
                }

                nodeFlow.TotalInput = Round3(nodeFlow.TotalInput);
                nodeFlow.TotalOutput = Round3(nodeFlow.TotalOutput);
                MergeNodeFlow(nodeFlowAccumulators, recipe.ParentTagNodeId ?? recipe.NodeId, nodeFlow);
            }

            foreach (var node in inputNodes)
            {
                var nodeFlow = new MutableNodeFlow();
                foreach (var itemEntry in GetArrayProperty(node.Data, "items"))
                {
                    var itemId = GetStringProperty(itemEntry, "itemId");
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var portKey = (node.Id, $"output-{GetStringProperty(itemEntry, "id", "output")}");
                    var total = 0.0;
                    foreach (var edge in edgesBySource.GetValueOrDefault(portKey) ?? [])
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemId, out var flowVar))
                        {
                            var value = flowVar.SolutionValue();
                            if (value > FlowThreshold)
                            {
                                total += value;
                            }
                        }
                    }

                    if (total > FlowThreshold)
                    {
                        nodeFlow.OutputFlows[itemId] = Round3(total);
                        nodeFlow.TotalOutput += total;
                    }
                }

                nodeFlow.TotalOutput = Round3(nodeFlow.TotalOutput);
                if (nodeFlow.TotalOutput > 0.0)
                {
                    nodeFlowAccumulators[node.Id] = nodeFlow;
                }
            }

            foreach (var node in outputNodes.Where(node => node.Type != "mixedoutput"))
            {
                var nodeFlow = new MutableNodeFlow();
                foreach (var itemEntry in GetArrayProperty(node.Data, "items"))
                {
                    var itemId = GetStringProperty(itemEntry, "itemId");
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var portKey = (node.Id, $"input-{GetStringProperty(itemEntry, "id", "input")}");
                    var total = 0.0;
                    foreach (var edge in edgesByTarget.GetValueOrDefault(portKey) ?? [])
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemId, out var flowVar))
                        {
                            var value = flowVar.SolutionValue();
                            if (value > FlowThreshold)
                            {
                                total += value;
                            }
                        }
                    }

                    if (total > FlowThreshold)
                    {
                        nodeFlow.InputFlows[itemId] = Round3(total);
                        nodeFlow.TotalInput += total;
                    }
                }

                nodeFlow.TotalInput = Round3(nodeFlow.TotalInput);
                if (nodeFlow.TotalInput > 0.0)
                {
                    nodeFlowAccumulators[node.Id] = nodeFlow;
                }
            }

            foreach (var node in outputNodes.Where(node => node.Type == "mixedoutput"))
            {
                var nodeFlow = new MutableNodeFlow();
                foreach (var edge in parsedGraph.Edges.Where(edge => edge.Target == node.Id))
                {
                    if (!edgeFlowVars.TryGetValue(edge.Id, out var flowVars))
                    {
                        continue;
                    }

                    foreach (var (itemId, flowVar) in flowVars)
                    {
                        var value = flowVar.SolutionValue();
                        if (value > FlowThreshold)
                        {
                            nodeFlow.InputFlows[itemId] = Round3(nodeFlow.InputFlows.GetValueOrDefault(itemId) + value);
                            nodeFlow.TotalInput += value;
                        }
                    }
                }

                nodeFlow.TotalInput = Round3(nodeFlow.TotalInput);
                if (nodeFlow.TotalInput > 0.0)
                {
                    nodeFlowAccumulators[node.Id] = nodeFlow;
                }
            }

            foreach (var node in requesterNodes)
            {
                var nodeFlow = new MutableNodeFlow();
                foreach (var requestEntry in GetArrayProperty(node.Data, "requests"))
                {
                    var itemId = GetStringProperty(requestEntry, "itemId");
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var portKey = (node.Id, $"input-{GetStringProperty(requestEntry, "id", "input")}");
                    var total = 0.0;
                    foreach (var edge in edgesByTarget.GetValueOrDefault(portKey) ?? [])
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemId, out var flowVar))
                        {
                            var value = flowVar.SolutionValue();
                            if (value > FlowThreshold)
                            {
                                total += value;
                            }
                        }
                    }

                    if (TryGetDoubleProperty(requestEntry, "targetPerSecond", out var targetValue) && targetValue > 0.0)
                    {
                        total = Math.Min(total, targetValue);
                    }

                    if (total > FlowThreshold)
                    {
                        nodeFlow.InputFlows[itemId] = Round3(total);
                        nodeFlow.TotalInput += total;
                    }
                }

                nodeFlow.TotalInput = Round3(nodeFlow.TotalInput);
                if (nodeFlow.TotalInput > 0.0)
                {
                    nodeFlowAccumulators[node.Id] = nodeFlow;
                }
            }

            var bottlenecks = new List<string>();
            foreach (var node in inputNodes)
            {
                foreach (var itemEntry in GetArrayProperty(node.Data, "items"))
                {
                    var itemId = GetStringProperty(itemEntry, "itemId");
                    var mode = GetStringProperty(itemEntry, "mode", "infinite");
                    if (string.IsNullOrWhiteSpace(itemId) || mode != "limit" || !TryGetDoubleProperty(itemEntry, "limit", out var limitValue))
                    {
                        continue;
                    }

                    var portKey = (node.Id, $"output-{GetStringProperty(itemEntry, "id", "output")}");
                    var totalFlow = 0.0;
                    foreach (var edge in edgesBySource.GetValueOrDefault(portKey) ?? [])
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemId, out var flowVar))
                        {
                            totalFlow += flowVar.SolutionValue();
                        }
                    }

                    if (totalFlow >= limitValue * 0.95)
                    {
                        bottlenecks.Add(itemId);
                    }
                }
            }

            foreach (var node in requesterNodes)
            {
                foreach (var requestEntry in GetArrayProperty(node.Data, "requests"))
                {
                    var itemId = GetStringProperty(requestEntry, "itemId");
                    if (string.IsNullOrWhiteSpace(itemId) || !TryGetDoubleProperty(requestEntry, "targetPerSecond", out var targetValue))
                    {
                        continue;
                    }

                    var portKey = (node.Id, $"input-{GetStringProperty(requestEntry, "id", "input")}");
                    var total = 0.0;
                    foreach (var edge in edgesByTarget.GetValueOrDefault(portKey) ?? [])
                    {
                        if (edgeFlowVars.TryGetValue(edge.Id, out var flowVars) && flowVars.TryGetValue(itemId, out var flowVar))
                        {
                            total += flowVar.SolutionValue();
                        }
                    }

                    if (total < targetValue * 0.95)
                    {
                        warnings.Add($"Demand for {itemId} ({targetValue}/s) not fully met (delivering {Round3(total)}/s)");
                    }
                }
            }

            foreach (var edge in parsedGraph.Edges)
            {
                if (problemEdgeIds.Contains(edge.Id, StringComparer.Ordinal))
                {
                    continue;
                }

                var sourceType = nodeTypeMap.GetValueOrDefault(edge.Source);
                var targetType = nodeTypeMap.GetValueOrDefault(edge.Target);
                if (((sourceType is not null && recipeTypes.Contains(sourceType)) || sourceType == "input") &&
                    ((targetType is not null && recipeTypes.Contains(targetType)) || targetType is "output" or "requester" or "mixedoutput"))
                {
                    if (!edgeFlowsResult.TryGetValue(edge.Id, out var edgeFlow) || edgeFlow.TotalFlow < FlowThreshold)
                    {
                        problemEdgeIds.Add(edge.Id);
                    }
                }
            }

            return new SolveResponse
            {
                Status = "ok",
                MachineCounts = machineCounts,
                FlowsPerSecond = flowsPerSecond,
                Bottlenecks = bottlenecks,
                Warnings = warnings,
                NodeFlows = nodeFlowAccumulators.ToDictionary(pair => pair.Key, pair => pair.Value.ToDto(), StringComparer.Ordinal),
                EdgeFlows = edgeFlowsResult,
                ProblemEdgeIds = problemEdgeIds
            };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Solver execution failed");
            return new SolveResponse
            {
                Status = "error",
                Warnings = [$"Solver error: {exception.Message}", $"Details: {exception}"]
            };
        }
    }

    private static SolveResponse SolveComponentsIndependently(ParsedGraph graph, StoreData? storeData, List<HashSet<string>> components, List<string> baseWarnings, ILogger logger, CancellationToken cancellationToken)
    {
        var mergedMachineCounts = new Dictionary<string, double>(StringComparer.Ordinal);
        var mergedFlowsPerSecond = new Dictionary<string, double>(StringComparer.Ordinal);
        var mergedBottlenecks = new List<string>();
        var mergedWarnings = new List<string>(baseWarnings);
        var mergedNodeFlows = new Dictionary<string, NodeFlowData>(StringComparer.Ordinal);
        var mergedEdgeFlows = new Dictionary<string, EdgeFlowData>(StringComparer.Ordinal);
        var mergedProblemEdgeIds = new List<string>();
        var anyOk = false;

        for (var index = 0; index < components.Count; index += 1)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var component = components[index];
            var subGraph = new GraphData
            {
                Nodes = graph.Nodes.Where(node => component.Contains(node.Id)).Select(node => node.RawNode).ToList(),
                Edges = graph.Edges.Where(edge => component.Contains(edge.Source) && component.Contains(edge.Target)).Select(edge => edge.RawEdge).ToList()
            };

            if (subGraph.Nodes.Count == 0)
            {
                continue;
            }

            var result = Solve(subGraph, storeData, logger, cancellationToken);
            if (result.Status == "error")
            {
                var descriptions = graph.Nodes
                    .Where(node => component.Contains(node.Id))
                    .Select(node =>
                    {
                        var title = GetStringProperty(node.Data, "title") ?? GetStringProperty(node.Data, "recipeId") ?? string.Empty;
                        return string.IsNullOrWhiteSpace(title) ? node.Type : $"{node.Type}({title})";
                    })
                    .Take(6);
                mergedWarnings.AddRange(result.Warnings);
                mergedWarnings.Add($"Subgraph {index + 1} infeasible [{string.Join(", ", descriptions)}]");
                mergedProblemEdgeIds.AddRange(result.ProblemEdgeIds);
                foreach (var edge in graph.Edges.Where(edge => component.Contains(edge.Source) && component.Contains(edge.Target)))
                {
                    if (!mergedProblemEdgeIds.Contains(edge.Id, StringComparer.Ordinal))
                    {
                        mergedProblemEdgeIds.Add(edge.Id);
                    }
                }
                continue;
            }

            anyOk = true;
            MergeNumericDictionary(mergedMachineCounts, result.MachineCounts);
            MergeNumericDictionary(mergedFlowsPerSecond, result.FlowsPerSecond);
            mergedBottlenecks.AddRange(result.Bottlenecks);
            mergedWarnings.AddRange(result.Warnings);
            foreach (var (nodeId, nodeFlow) in result.NodeFlows)
            {
                mergedNodeFlows[nodeId] = nodeFlow;
            }

            foreach (var (edgeId, edgeFlow) in result.EdgeFlows)
            {
                mergedEdgeFlows[edgeId] = edgeFlow;
            }

            foreach (var edgeId in result.ProblemEdgeIds)
            {
                if (!mergedProblemEdgeIds.Contains(edgeId, StringComparer.Ordinal))
                {
                    mergedProblemEdgeIds.Add(edgeId);
                }
            }
        }

        return new SolveResponse
        {
            Status = anyOk ? "ok" : "error",
            MachineCounts = mergedMachineCounts,
            FlowsPerSecond = mergedFlowsPerSecond,
            Bottlenecks = mergedBottlenecks,
            Warnings = mergedWarnings,
            NodeFlows = mergedNodeFlows,
            EdgeFlows = mergedEdgeFlows,
            ProblemEdgeIds = mergedProblemEdgeIds
        };
    }

    private static ParsedGraph ParseGraph(GraphData graph)
    {
        var nodes = new List<ParsedNode>(graph.Nodes.Count);
        foreach (var rawNode in graph.Nodes)
        {
            var id = GetRequiredStringProperty(rawNode, "id");
            var type = GetRequiredStringProperty(rawNode, "type");
            var data = rawNode.TryGetProperty("data", out var dataElement) && dataElement.ValueKind == JsonValueKind.Object
                ? dataElement.Clone()
                : (JsonElement?)null;
            nodes.Add(new ParsedNode(id, type, data, rawNode.Clone()));
        }

        var edges = new List<ParsedEdge>(graph.Edges.Count);
        foreach (var rawEdge in graph.Edges)
        {
            edges.Add(new ParsedEdge(
                GetRequiredStringProperty(rawEdge, "id"),
                GetRequiredStringProperty(rawEdge, "source"),
                GetRequiredStringProperty(rawEdge, "target"),
                GetStringProperty(rawEdge, "sourceHandle"),
                GetStringProperty(rawEdge, "targetHandle"),
                rawEdge.Clone()));
        }

        return new ParsedGraph(nodes, edges);
    }

    private static List<RecipeInstance> ExtractRecipesFromNode(ParsedNode node, StoreData? storeData, IReadOnlyDictionary<string, string> nameToId)
    {
        if (node.Data is null)
        {
            return [];
        }

        return node.Type switch
        {
            "recipe" =>
            [
                new RecipeInstance(
                    node.Id,
                    GetStringProperty(node.Data, "recipeId", node.Id),
                    GetStringProperty(node.Data, "title", "Recipe"),
                    GetDoubleProperty(node.Data, "timeSeconds", 1.0),
                    GetArrayProperty(node.Data, "inputs").Select(input => NormalizePort(input, nameToId, true)).ToList(),
                    GetArrayProperty(node.Data, "outputs").Select(output => NormalizePort(output, nameToId, false)).ToList(),
                    null,
                    null)
            ],
            "recipetag" => ExtractRecipeTag(node, storeData, nameToId, false),
            "inputrecipetag" => ExtractRecipeTag(node, storeData, nameToId, true),
            "inputrecipe" =>
            [
                new RecipeInstance(
                    node.Id,
                    node.Id,
                    GetStringProperty(node.Data, "title", "Input Recipe"),
                    GetDoubleProperty(node.Data, "timeSeconds", 1.0),
                    [],
                    GetArrayProperty(node.Data, "outputs").Select(output => NormalizePort(output, nameToId, false)).ToList(),
                    1.0,
                    null)
            ],
            _ => []
        };
    }

    private static List<RecipeInstance> ExtractRecipeTag(ParsedNode node, StoreData? storeData, IReadOnlyDictionary<string, string> nameToId, bool isInputTag)
    {
        if (storeData is not null)
        {
            var expanded = ExpandRecipeTag(node, storeData, nameToId, isInputTag);
            if (expanded.Count > 0)
            {
                return expanded;
            }
        }

        var outputs = GetArrayProperty(node.Data, "outputs")
            .Where(output => !GetBoolProperty(output, "isMixed", false))
            .Select(output => NormalizePort(output, nameToId, false))
            .ToList();
        if (isInputTag)
        {
            if (outputs.Count == 0)
            {
                return [];
            }

            return
            [
                new RecipeInstance(
                    node.Id,
                    node.Id,
                    GetStringProperty(node.Data, "title", "Input Recipe Tag"),
                    GetDoubleProperty(node.Data, "timeSeconds", 1.0),
                    [],
                    outputs,
                    GetDoubleProperty(node.Data, "multiplier", 1.0),
                    null)
            ];
        }

        var inputs = GetArrayProperty(node.Data, "inputs")
            .Where(input => !GetBoolProperty(input, "isMixed", false))
            .Select(input => NormalizePort(input, nameToId, true))
            .ToList();
        if (inputs.Count == 0 && outputs.Count == 0)
        {
            return [];
        }

        return
        [
            new RecipeInstance(
                node.Id,
                GetStringProperty(node.Data, "recipeTagId", node.Id),
                GetStringProperty(node.Data, "title", "RecipeTag"),
                1.0,
                inputs,
                outputs,
                null,
                null)
        ];
    }

    private static List<RecipeInstance> ExpandRecipeTag(ParsedNode node, StoreData storeData, IReadOnlyDictionary<string, string> nameToId, bool isInputTag)
    {
        var recipeTagId = GetStringProperty(node.Data, "recipeTagId");
        if (string.IsNullOrWhiteSpace(recipeTagId))
        {
            return [];
        }

        var recipeTag = storeData.RecipeTags.FirstOrDefault(entry => entry.Id == recipeTagId);
        if (recipeTag is null)
        {
            return [];
        }

        var multiplier = isInputTag ? GetDoubleProperty(node.Data, "multiplier", 1.0) : (double?)null;
        var recipes = new List<RecipeInstance>();
        foreach (var memberRecipeId in recipeTag.MemberRecipeIds)
        {
            var storeRecipe = storeData.Recipes.FirstOrDefault(recipe => recipe.Id == memberRecipeId);
            if (storeRecipe is null)
            {
                continue;
            }

            var inputs = new List<Dictionary<string, object?>>();
            if (!isInputTag)
            {
                foreach (var input in storeRecipe.Inputs)
                {
                    inputs.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["id"] = input.Id,
                        ["itemId"] = input.RefId,
                        ["refId"] = input.RefId,
                        ["refType"] = input.RefType,
                        ["amount"] = input.Amount,
                        ["amountPerCycle"] = input.Amount
                    });
                }
            }

            var outputs = new List<Dictionary<string, object?>>();
            foreach (var output in storeRecipe.Outputs)
            {
                var amount = output.Amount * (multiplier ?? 1.0);
                outputs.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = output.Id,
                    ["itemId"] = output.ItemId,
                    ["amount"] = amount,
                    ["amountPerCycle"] = amount,
                    ["probability"] = output.Probability
                });
            }

            recipes.Add(new RecipeInstance(
                $"{node.Id}__sub__{memberRecipeId}",
                memberRecipeId,
                storeRecipe.Name,
                storeRecipe.TimeSeconds,
                inputs,
                outputs,
                multiplier,
                node.Id));
        }

        return recipes;
    }

    private static Dictionary<string, string> BuildNameToIdMap(StoreData? storeData)
    {
        var nameToId = new Dictionary<string, string>(StringComparer.Ordinal);
        if (storeData is null)
        {
            return nameToId;
        }

        foreach (var item in storeData.Items)
        {
            nameToId[item.Name] = item.Id;
        }

        return nameToId;
    }

    private static void RegisterRecipeOutputs(RecipeInstance recipe, string visualId, TagPortDefinitions? tagPorts, IReadOnlyDictionary<string, string> nameToId, Dictionary<(string NodeId, string Handle), List<PortItemContribution>> portProd, Dictionary<(string NodeId, string Handle), HashSet<string>> portOutputItems)
    {
        if (tagPorts is not null)
        {
            if (tagPorts.Outputs.Count == recipe.Outputs.Count)
            {
                for (var index = 0; index < recipe.Outputs.Count; index += 1)
                {
                    var output = recipe.Outputs[index];
                    var itemId = ResolveItemId(output, nameToId, false);
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var handle = $"output-{GetStringProperty(tagPorts.Outputs[index], "id", $"o{index + 1}")}";
                    var rate = GetAmountPerCycle(output) * GetProbability(output) / recipe.TimeSeconds;
                    AddListValue(portProd, (visualId, handle), new PortItemContribution(recipe, itemId, rate));
                    AddSetValue(portOutputItems, (visualId, handle), itemId);
                }

                return;
            }

            var fixedMap = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            var mixedPorts = new List<JsonElement>();
            foreach (var outputPort in tagPorts.Outputs)
            {
                if (!GetBoolProperty(outputPort, "isMixed", false) && TryGetStringProperty(outputPort, "fixedRefId", out var fixedRefId))
                {
                    fixedMap[fixedRefId] = outputPort;
                }
                else if (GetBoolProperty(outputPort, "isMixed", false))
                {
                    mixedPorts.Add(outputPort);
                }
            }

            foreach (var output in recipe.Outputs)
            {
                var itemId = ResolveItemId(output, nameToId, false);
                if (string.IsNullOrWhiteSpace(itemId))
                {
                    continue;
                }

                JsonElement tagOutput;
                if (fixedMap.TryGetValue(itemId, out var fixedPort))
                {
                    tagOutput = fixedPort;
                }
                else if (mixedPorts.Count > 0)
                {
                    tagOutput = mixedPorts[0];
                }
                else
                {
                    continue;
                }

                var handle = $"output-{GetStringProperty(tagOutput, "id", "output")}";
                var rate = GetAmountPerCycle(output) * GetProbability(output) / recipe.TimeSeconds;
                AddListValue(portProd, (visualId, handle), new PortItemContribution(recipe, itemId, rate));
                AddSetValue(portOutputItems, (visualId, handle), itemId);
            }

            return;
        }

        foreach (var output in recipe.Outputs)
        {
            var itemId = ResolveItemId(output, nameToId, false);
            if (string.IsNullOrWhiteSpace(itemId))
            {
                continue;
            }

            var handle = $"output-{GetStringValue(output, "id", "output")}";
            var rate = GetAmountPerCycle(output) * GetProbability(output) / recipe.TimeSeconds;
            AddListValue(portProd, (visualId, handle), new PortItemContribution(recipe, itemId, rate));
            AddSetValue(portOutputItems, (visualId, handle), itemId);
        }
    }

    private static void RegisterRecipeInputs(RecipeInstance recipe, string visualId, TagPortDefinitions? tagPorts, IReadOnlyDictionary<string, string> nameToId, Dictionary<(string NodeId, string Handle), List<PortItemContribution>> portCons, Dictionary<(string NodeId, string Handle), List<RecipeRateContribution>> mixedCons, Dictionary<(string NodeId, string Handle), HashSet<string>> portInputItems)
    {
        if (tagPorts is not null)
        {
            if (tagPorts.Inputs.Count == recipe.Inputs.Count)
            {
                for (var index = 0; index < recipe.Inputs.Count; index += 1)
                {
                    var input = recipe.Inputs[index];
                    var itemId = ResolveItemId(input, nameToId, true);
                    if (string.IsNullOrWhiteSpace(itemId))
                    {
                        continue;
                    }

                    var handle = $"input-{GetStringProperty(tagPorts.Inputs[index], "id", $"i{index + 1}")}";
                    var rate = GetAmountPerCycle(input) / recipe.TimeSeconds;
                    AddListValue(portCons, (visualId, handle), new PortItemContribution(recipe, itemId, rate));
                    AddSetValue(portInputItems, (visualId, handle), itemId);
                }

                return;
            }

            var fixedMap = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            var mixedPorts = new List<JsonElement>();
            foreach (var inputPort in tagPorts.Inputs)
            {
                if (!GetBoolProperty(inputPort, "isMixed", false) && TryGetStringProperty(inputPort, "fixedRefId", out var fixedRefId))
                {
                    fixedMap[fixedRefId] = inputPort;
                }
                else if (GetBoolProperty(inputPort, "isMixed", false))
                {
                    mixedPorts.Add(inputPort);
                }
            }

            foreach (var input in recipe.Inputs)
            {
                var itemId = ResolveItemId(input, nameToId, true);
                if (string.IsNullOrWhiteSpace(itemId))
                {
                    continue;
                }

                JsonElement tagInput;
                if (fixedMap.TryGetValue(itemId, out var fixedPort))
                {
                    tagInput = fixedPort;
                }
                else if (mixedPorts.Count > 0)
                {
                    tagInput = mixedPorts[0];
                }
                else
                {
                    continue;
                }

                var handle = $"input-{GetStringProperty(tagInput, "id", "input")}";
                var rate = GetAmountPerCycle(input) / recipe.TimeSeconds;
                AddListValue(portCons, (visualId, handle), new PortItemContribution(recipe, itemId, rate));
                AddSetValue(portInputItems, (visualId, handle), itemId);
            }

            return;
        }

        foreach (var input in recipe.Inputs)
        {
            var handle = $"input-{GetStringValue(input, "id", "input")}";
            var rate = GetAmountPerCycle(input) / recipe.TimeSeconds;
            if (GetBoolValue(input, "isMixed", false))
            {
                AddListValue(mixedCons, (visualId, handle), new RecipeRateContribution(recipe, rate));
            }
            else
            {
                var itemId = ResolveItemId(input, nameToId, true);
                if (string.IsNullOrWhiteSpace(itemId))
                {
                    continue;
                }

                AddListValue(portCons, (visualId, handle), new PortItemContribution(recipe, itemId, rate));
                AddSetValue(portInputItems, (visualId, handle), itemId);
            }
        }
    }

    private static List<HashSet<string>> ComputeConnectedComponents(HashSet<string> allNodeIds, Dictionary<string, HashSet<string>> adjacency, CancellationToken cancellationToken)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var components = new List<HashSet<string>>();
        foreach (var nodeId in allNodeIds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (visited.Contains(nodeId))
            {
                continue;
            }

            var component = new HashSet<string>(StringComparer.Ordinal);
            var queue = new Queue<string>();
            queue.Enqueue(nodeId);
            while (queue.Count > 0)
            {
                var current = queue.Dequeue();
                if (!visited.Add(current))
                {
                    continue;
                }

                component.Add(current);
                foreach (var neighbor in adjacency.GetValueOrDefault(current) ?? [])
                {
                    if (!visited.Contains(neighbor))
                    {
                        queue.Enqueue(neighbor);
                    }
                }
            }

            components.Add(component);
        }

        return components;
    }

    private static (List<HashSet<string>> Sccs, Dictionary<string, int> NodeToScc) ComputeStronglyConnectedComponents(HashSet<string> nodeIds, IReadOnlyList<ParsedEdge> edges, CancellationToken cancellationToken)
    {
        var adjacency = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var edge in edges)
        {
            AddListValue(adjacency, edge.Source, edge.Target);
        }

        var index = 0;
        var stack = new Stack<string>();
        var onStack = new HashSet<string>(StringComparer.Ordinal);
        var indices = new Dictionary<string, int>(StringComparer.Ordinal);
        var lowLinks = new Dictionary<string, int>(StringComparer.Ordinal);
        var sccs = new List<HashSet<string>>();

        void StrongConnect(string nodeId)
        {
            cancellationToken.ThrowIfCancellationRequested();
            indices[nodeId] = index;
            lowLinks[nodeId] = index;
            index += 1;
            stack.Push(nodeId);
            onStack.Add(nodeId);

            foreach (var neighbor in adjacency.GetValueOrDefault(nodeId) ?? [])
            {
                if (!indices.ContainsKey(neighbor))
                {
                    StrongConnect(neighbor);
                    lowLinks[nodeId] = Math.Min(lowLinks[nodeId], lowLinks[neighbor]);
                }
                else if (onStack.Contains(neighbor))
                {
                    lowLinks[nodeId] = Math.Min(lowLinks[nodeId], indices[neighbor]);
                }
            }

            if (lowLinks[nodeId] != indices[nodeId])
            {
                return;
            }

            var component = new HashSet<string>(StringComparer.Ordinal);
            while (stack.Count > 0)
            {
                var member = stack.Pop();
                onStack.Remove(member);
                component.Add(member);
                if (member == nodeId)
                {
                    break;
                }
            }

            sccs.Add(component);
        }

        foreach (var nodeId in nodeIds)
        {
            if (!indices.ContainsKey(nodeId))
            {
                StrongConnect(nodeId);
            }
        }

        var nodeToScc = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var sccIndex = 0; sccIndex < sccs.Count; sccIndex += 1)
        {
            foreach (var nodeId in sccs[sccIndex])
            {
                nodeToScc[nodeId] = sccIndex;
            }
        }

        return (sccs, nodeToScc);
    }

    private static HashSet<string> ComputeCycleEdgeIds(ParsedGraph graph, IReadOnlyList<HashSet<string>> sccs, IReadOnlyDictionary<string, int> nodeToScc)
    {
        var cyclicalSccs = sccs.Select((component, index) => (component, index)).Where(entry => entry.component.Count > 1).Select(entry => entry.index).ToHashSet();
        var cycleEdgeIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var edge in graph.Edges)
        {
            if (!nodeToScc.TryGetValue(edge.Source, out var sourceScc) || !nodeToScc.TryGetValue(edge.Target, out var targetScc) || sourceScc != targetScc)
            {
                continue;
            }

            if (cyclicalSccs.Contains(sourceScc) || edge.Source == edge.Target)
            {
                cycleEdgeIds.Add(edge.Id);
            }
        }

        return cycleEdgeIds;
    }

    private static Dictionary<string, int> ComputeNodeDepths(ParsedGraph graph, IReadOnlyDictionary<string, string> nodeTypeMap, IReadOnlyList<ParsedNode> inputNodes, IReadOnlyList<RecipeInstance> recipes, IReadOnlyList<HashSet<string>> sccs, IReadOnlyDictionary<string, int> nodeToScc)
    {
        var recipeTypes = new HashSet<string>(StringComparer.Ordinal) { "recipe", "recipetag", "inputrecipe", "inputrecipetag" };
        var componentEdges = new Dictionary<int, HashSet<int>>();
        var recipeTargetEdges = new HashSet<(int Source, int Target)>();
        var indegree = Enumerable.Range(0, sccs.Count).ToDictionary(index => index, _ => 0);

        foreach (var edge in graph.Edges)
        {
            if (!nodeToScc.TryGetValue(edge.Source, out var sourceComponent) || !nodeToScc.TryGetValue(edge.Target, out var targetComponent) || sourceComponent == targetComponent)
            {
                continue;
            }

            if (!componentEdges.TryGetValue(sourceComponent, out var targets))
            {
                targets = [];
                componentEdges[sourceComponent] = targets;
            }

            if (targets.Add(targetComponent))
            {
                indegree[targetComponent] += 1;
            }

            if (recipeTypes.Contains(nodeTypeMap.GetValueOrDefault(edge.Target, string.Empty)))
            {
                recipeTargetEdges.Add((sourceComponent, targetComponent));
            }
        }

        var componentDepths = new Dictionary<int, int>();
        foreach (var node in inputNodes)
        {
            componentDepths[nodeToScc[node.Id]] = 0;
        }

        foreach (var recipe in recipes.Where(recipe => recipe.MaxMachines is not null))
        {
            componentDepths[nodeToScc[recipe.ParentTagNodeId ?? recipe.NodeId]] = 0;
        }

        var queue = new Queue<int>(indegree.Where(entry => entry.Value == 0).Select(entry => entry.Key));
        while (queue.Count > 0)
        {
            var componentId = queue.Dequeue();
            var hasCurrentDepth = componentDepths.TryGetValue(componentId, out var currentDepth);
            foreach (var nextComponent in componentEdges.GetValueOrDefault(componentId) ?? [])
            {
                if (hasCurrentDepth && recipeTargetEdges.Contains((componentId, nextComponent)))
                {
                    var nextDepth = currentDepth + 1;
                    if (nextDepth > componentDepths.GetValueOrDefault(nextComponent, -1))
                    {
                        componentDepths[nextComponent] = nextDepth;
                    }
                }

                indegree[nextComponent] -= 1;
                if (indegree[nextComponent] == 0)
                {
                    queue.Enqueue(nextComponent);
                }
            }
        }

        var nodeDepth = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var node in inputNodes)
        {
            nodeDepth[node.Id] = 0;
        }

        foreach (var (componentId, depth) in componentDepths)
        {
            foreach (var nodeId in sccs[componentId])
            {
                if (recipeTypes.Contains(nodeTypeMap.GetValueOrDefault(nodeId, string.Empty)))
                {
                    nodeDepth[nodeId] = depth;
                }
            }
        }

        return nodeDepth;
    }

    private static double GetSupplyPreferenceWeight(ParsedEdge edge, IReadOnlyDictionary<string, string> nodeTypeMap, IReadOnlyDictionary<string, int> nodeDepth, int maxDepth)
    {
        var cappedDepth = Math.Min(maxDepth, 6);
        var sourceType = nodeTypeMap.GetValueOrDefault(edge.Source, string.Empty);
        if (sourceType == "input")
        {
            return Math.Pow(10.0, Math.Min(cappedDepth + 3, 8));
        }

        if (sourceType is "inputrecipe" or "inputrecipetag")
        {
            return Math.Pow(10.0, Math.Min(cappedDepth + 2, 8));
        }

        return Math.Pow(10.0, Math.Min(Math.Max(cappedDepth - nodeDepth.GetValueOrDefault(edge.Source, 0), 0) + 1, 8));
    }

    private static void HandleFailedSolve(Solver.ResultStatus status, HashSet<string> cycleEdgeIds, List<string> warnings, List<string> problemEdgeIds)
    {
        var statusMessage = status switch
        {
            Solver.ResultStatus.INFEASIBLE => "infeasible",
            Solver.ResultStatus.UNBOUNDED => "unbounded",
            _ => "error"
        };
        if (cycleEdgeIds.Count > 0)
        {
            foreach (var edgeId in cycleEdgeIds.OrderBy(edgeId => edgeId, StringComparer.Ordinal))
            {
                if (!problemEdgeIds.Contains(edgeId, StringComparer.Ordinal))
                {
                    problemEdgeIds.Add(edgeId);
                }
            }

            if (status == Solver.ResultStatus.UNBOUNDED)
            {
                warnings.Add("Circular reference is runaway: the cycle can produce more reusable output than it can consume.");
            }
            else if (status == Solver.ResultStatus.INFEASIBLE)
            {
                warnings.Add("Circular reference cannot be balanced with the available fresh inputs.");
            }
        }

        warnings.Add($"No feasible solution found ({statusMessage}). Check constraints - demands may exceed supply limits.");
    }

    private static void MergeNodeFlow(Dictionary<string, MutableNodeFlow> destination, string nodeId, MutableNodeFlow source)
    {
        if (!destination.TryGetValue(nodeId, out var existing))
        {
            destination[nodeId] = source;
            return;
        }

        existing.MachineCount = Round3((existing.MachineCount ?? 0.0) + (source.MachineCount ?? 0.0));
        MergeNumericDictionary(existing.RecipeRuns, source.RecipeRuns);
        MergeNumericDictionary(existing.InputFlows, source.InputFlows);
        MergeNumericDictionary(existing.OutputFlows, source.OutputFlows);
        existing.TotalInput = Round3(existing.TotalInput + source.TotalInput);
        existing.TotalOutput = Round3(existing.TotalOutput + source.TotalOutput);
    }

    private static void MergeNumericDictionary(Dictionary<string, double> destination, IReadOnlyDictionary<string, double> source)
    {
        foreach (var (key, value) in source)
        {
            destination[key] = Round3(destination.GetValueOrDefault(key) + value);
        }
    }

    private static Dictionary<string, object?> NormalizePort(JsonElement port, IReadOnlyDictionary<string, string> nameToId, bool isInput)
    {
        var normalized = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var property in port.EnumerateObject())
        {
            normalized[property.Name] = property.Value.ValueKind switch
            {
                JsonValueKind.String => property.Value.GetString(),
                JsonValueKind.Number => property.Value.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => property.Value.Clone()
            };
        }

        normalized["itemId"] = ResolveItemId(normalized, nameToId, isInput);
        return normalized;
    }

    private static string ResolveItemId(IReadOnlyDictionary<string, object?> portData, IReadOnlyDictionary<string, string> nameToId, bool isInput)
    {
        if (TryGetStringValue(portData, "itemId", out var itemId))
        {
            return itemId;
        }

        if (isInput && TryGetStringValue(portData, "refId", out var refId))
        {
            return refId;
        }

        if (TryGetStringValue(portData, "fixedRefId", out var fixedRefId))
        {
            return fixedRefId;
        }

        var name = GetStringValue(portData, "name", string.Empty);
        return nameToId.GetValueOrDefault(name, name);
    }

    private static double GetAmountPerCycle(IReadOnlyDictionary<string, object?> portData)
    {
        return TryGetDoubleValue(portData, "amountPerCycle", out var amountPerCycle) ? amountPerCycle : GetDoubleValue(portData, "amount", 0.0);
    }

    private static double GetProbability(IReadOnlyDictionary<string, object?> portData)
    {
        return GetDoubleValue(portData, "probability", 1.0);
    }

    private static string FormatItemSet(IEnumerable<string> items)
    {
        return "{" + string.Join(", ", items.OrderBy(item => item, StringComparer.Ordinal)) + "}";
    }

    private static string GetNodeDisplayName(ParsedNode? node)
    {
        return GetStringProperty(node?.Data, "title") ?? node?.Id ?? "unknown";
    }

    private static void AddConstraint(Solver solver, IReadOnlyList<VarCoeff> terms, double lowerBound, double upperBound)
    {
        var constraint = solver.MakeConstraint(lowerBound, upperBound);
        foreach (var term in terms)
        {
            constraint.SetCoefficient(term.Variable, term.Coefficient);
        }
    }

    private static double Round3(double value)
    {
        return Math.Round(value, 3, MidpointRounding.AwayFromZero);
    }

    private static IReadOnlyList<JsonElement> GetArrayProperty(JsonElement? element, string propertyName)
    {
        if (element is not { ValueKind: JsonValueKind.Object } objectElement || !objectElement.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return property.EnumerateArray().Select(entry => entry.Clone()).ToList();
    }

    private static string GetRequiredStringProperty(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(property.GetString()))
        {
            throw new InvalidOperationException($"Expected string property '{propertyName}' on solver graph payload");
        }

        return property.GetString()!;
    }

    private static string? GetStringProperty(JsonElement? element, string propertyName)
    {
        if (element is { ValueKind: JsonValueKind.Object } objectElement && objectElement.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(property.GetString()))
        {
            return property.GetString()!;
        }

        return null;
    }

    private static string GetStringProperty(JsonElement? element, string propertyName, string fallback)
    {
        if (element is { ValueKind: JsonValueKind.Object } objectElement && objectElement.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(property.GetString()))
        {
            return property.GetString()!;
        }

        return fallback;
    }

    private static bool TryGetStringProperty(JsonElement element, string propertyName, out string value)
    {
        if (element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(property.GetString()))
        {
            value = property.GetString()!;
            return true;
        }

        value = string.Empty;
        return false;
    }

    private static double GetDoubleProperty(JsonElement? element, string propertyName, double fallback)
    {
        return TryGetDoubleProperty(element, propertyName, out var value) ? value : fallback;
    }

    private static bool TryGetDoubleProperty(JsonElement? element, string propertyName, out double value)
    {
        if (element is { ValueKind: JsonValueKind.Object } objectElement && objectElement.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.Number)
        {
            value = property.GetDouble();
            return true;
        }

        value = default;
        return false;
    }

    private static bool GetBoolProperty(JsonElement element, string propertyName, bool fallback)
    {
        return element.TryGetProperty(propertyName, out var property) && property.ValueKind is JsonValueKind.True or JsonValueKind.False ? property.GetBoolean() : fallback;
    }

    private static string GetStringValue(IReadOnlyDictionary<string, object?> dictionary, string key, string fallback)
    {
        return TryGetStringValue(dictionary, key, out var value) ? value : fallback;
    }

    private static bool TryGetStringValue(IReadOnlyDictionary<string, object?> dictionary, string key, out string value)
    {
        if (dictionary.TryGetValue(key, out var raw) && raw is string stringValue && !string.IsNullOrWhiteSpace(stringValue))
        {
            value = stringValue;
            return true;
        }

        value = string.Empty;
        return false;
    }

    private static double GetDoubleValue(IReadOnlyDictionary<string, object?> dictionary, string key, double fallback)
    {
        return TryGetDoubleValue(dictionary, key, out var value) ? value : fallback;
    }

    private static bool TryGetDoubleValue(IReadOnlyDictionary<string, object?> dictionary, string key, out double value)
    {
        if (dictionary.TryGetValue(key, out var raw))
        {
            switch (raw)
            {
                case double doubleValue:
                    value = doubleValue;
                    return true;
                case float floatValue:
                    value = floatValue;
                    return true;
                case int intValue:
                    value = intValue;
                    return true;
                case long longValue:
                    value = longValue;
                    return true;
                case JsonElement jsonElement when jsonElement.ValueKind == JsonValueKind.Number:
                    value = jsonElement.GetDouble();
                    return true;
            }
        }

        value = default;
        return false;
    }

    private static bool GetBoolValue(IReadOnlyDictionary<string, object?> dictionary, string key, bool fallback)
    {
        if (dictionary.TryGetValue(key, out var raw))
        {
            switch (raw)
            {
                case bool boolValue:
                    return boolValue;
                case JsonElement jsonElement when jsonElement.ValueKind is JsonValueKind.True or JsonValueKind.False:
                    return jsonElement.GetBoolean();
            }
        }

        return fallback;
    }

    private static void AddListValue<TKey, TValue>(Dictionary<TKey, List<TValue>> dictionary, TKey key, TValue value) where TKey : notnull
    {
        if (!dictionary.TryGetValue(key, out var list))
        {
            list = [];
            dictionary[key] = list;
        }

        list.Add(value);
    }

    private static void AddSetValue<TKey>(Dictionary<TKey, HashSet<string>> dictionary, TKey key, string value) where TKey : notnull
    {
        if (!dictionary.TryGetValue(key, out var set))
        {
            set = new HashSet<string>(StringComparer.Ordinal);
            dictionary[key] = set;
        }

        set.Add(value);
    }

    private sealed record ParsedGraph(List<ParsedNode> Nodes, List<ParsedEdge> Edges);

    private sealed record ParsedNode(string Id, string Type, JsonElement? Data, JsonElement RawNode);

    private sealed record ParsedEdge(string Id, string Source, string Target, string? SourceHandle, string? TargetHandle, JsonElement RawEdge);

    private sealed record TagPortDefinitions(IReadOnlyList<JsonElement> Inputs, IReadOnlyList<JsonElement> Outputs);

    private sealed record RecipeInstance(string NodeId, string RecipeId, string Name, double TimeSeconds, List<Dictionary<string, object?>> Inputs, List<Dictionary<string, object?>> Outputs, double? MaxMachines, string? ParentTagNodeId);

    private sealed record PortItemContribution(RecipeInstance Recipe, string ItemId, double RatePerMachine);

    private sealed record RecipeRateContribution(RecipeInstance Recipe, double RatePerMachine);

    private sealed record WeightedVariable(Variable Variable, double Weight);

    private sealed record VarCoeff(Variable Variable, double Coefficient);

    private sealed class MutableNodeFlow
    {
        public double? MachineCount { get; set; }

        public Dictionary<string, double> RecipeRuns { get; } = new(StringComparer.Ordinal);

        public Dictionary<string, double> InputFlows { get; } = new(StringComparer.Ordinal);

        public Dictionary<string, double> OutputFlows { get; } = new(StringComparer.Ordinal);

        public double TotalInput { get; set; }

        public double TotalOutput { get; set; }

        public NodeFlowData ToDto()
        {
            return new NodeFlowData
            {
                MachineCount = MachineCount,
                RecipeRuns = RecipeRuns,
                InputFlows = InputFlows,
                OutputFlows = OutputFlows,
                TotalInput = TotalInput,
                TotalOutput = TotalOutput
            };
        }
    }
}
