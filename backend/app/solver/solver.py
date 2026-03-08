from typing import Dict, List, Set, Tuple, Optional
from collections import defaultdict
from ortools.linear_solver import pywraplp
from app.api.models import Graph, SolveResponse, GraphNode, GraphEdge


class RecipeInstance:
    """Represents a single recipe instance in the graph"""
    def __init__(self, node_id: str, recipe_id: str, name: str, time_seconds: float, 
                 inputs: List[Dict], outputs: List[Dict], max_machines: Optional[float] = None,
                 parent_tag_node_id: Optional[str] = None):
        self.node_id = node_id
        self.recipe_id = recipe_id
        self.name = name
        self.time_seconds = time_seconds
        self.inputs = inputs  # List of {itemId, amount/amountPerCycle}
        self.outputs = outputs  # List of {itemId, amount/amountPerCycle, probability}
        self.max_machines = max_machines  # Upper bound for machine count (for inputrecipe nodes)
        self.parent_tag_node_id = parent_tag_node_id  # If from a recipe tag expansion


class EdgeFlow:
    """Represents flow on an edge"""
    def __init__(self, edge_id: str, source_node: str, target_node: str, 
                 source_port: str, target_port: str, item_id: Optional[str] = None):
        self.edge_id = edge_id
        self.source_node = source_node
        self.target_node = target_node
        self.source_port = source_port
        self.target_port = target_port
        self.item_id = item_id
        self.is_recipe_to_recipe = False
        self.is_recipe_to_output = False
        self.is_input_to_recipe = False


def _compute_strongly_connected_components(
    node_ids: Set[str], edges: List[GraphEdge]
) -> Tuple[List[Set[str]], Dict[str, int]]:
    adjacency: Dict[str, List[str]] = defaultdict(list)
    for edge in edges:
        adjacency[edge.source].append(edge.target)

    index = 0
    stack: List[str] = []
    on_stack: Set[str] = set()
    indices: Dict[str, int] = {}
    lowlinks: Dict[str, int] = {}
    sccs: List[Set[str]] = []

    def strongconnect(node_id: str) -> None:
        nonlocal index
        indices[node_id] = index
        lowlinks[node_id] = index
        index += 1
        stack.append(node_id)
        on_stack.add(node_id)

        for neighbor in adjacency.get(node_id, []):
            if neighbor not in indices:
                strongconnect(neighbor)
                lowlinks[node_id] = min(lowlinks[node_id], lowlinks[neighbor])
            elif neighbor in on_stack:
                lowlinks[node_id] = min(lowlinks[node_id], indices[neighbor])

        if lowlinks[node_id] != indices[node_id]:
            return

        component: Set[str] = set()
        while stack:
            member = stack.pop()
            on_stack.remove(member)
            component.add(member)
            if member == node_id:
                break
        sccs.append(component)

    for node_id in node_ids:
        if node_id not in indices:
            strongconnect(node_id)

    node_to_scc: Dict[str, int] = {}
    for scc_index, component in enumerate(sccs):
        for node_id in component:
            node_to_scc[node_id] = scc_index

    return sccs, node_to_scc


def _compute_cycle_edge_ids(
    graph: Graph, sccs: List[Set[str]], node_to_scc: Dict[str, int]
) -> Set[str]:
    cyclical_sccs = {
        scc_index for scc_index, component in enumerate(sccs)
        if len(component) > 1
    }
    cycle_edge_ids: Set[str] = set()

    for edge in graph.edges:
        src_scc = node_to_scc.get(edge.source)
        tgt_scc = node_to_scc.get(edge.target)
        if src_scc is None or src_scc != tgt_scc:
            continue
        if src_scc in cyclical_sccs or edge.source == edge.target:
            cycle_edge_ids.add(edge.id)

    return cycle_edge_ids


def _compute_node_depths(
    graph: Graph,
    node_type_map: Dict[str, str],
    input_nodes: List[GraphNode],
    recipes: List[RecipeInstance],
    sccs: List[Set[str]],
    node_to_scc: Dict[str, int],
) -> Dict[str, int]:
    recipe_types = frozenset((
        "recipe", "recipetag", "inputrecipe", "inputrecipetag"
    ))
    comp_edges: Dict[int, Set[int]] = defaultdict(set)
    recipe_target_edges: Set[Tuple[int, int]] = set()
    indegree: Dict[int, int] = {idx: 0 for idx in range(len(sccs))}

    for edge in graph.edges:
        src_comp = node_to_scc.get(edge.source)
        tgt_comp = node_to_scc.get(edge.target)
        if src_comp is None or tgt_comp is None or src_comp == tgt_comp:
            continue
        if tgt_comp not in comp_edges[src_comp]:
            comp_edges[src_comp].add(tgt_comp)
            indegree[tgt_comp] += 1
        if node_type_map.get(edge.target) in recipe_types:
            recipe_target_edges.add((src_comp, tgt_comp))

    component_depths: Dict[int, int] = {}
    for node in input_nodes:
        component_depths[node_to_scc[node.id]] = 0
    for recipe in recipes:
        if recipe.max_machines is None:
            continue
        visual_id = recipe.parent_tag_node_id or recipe.node_id
        component_depths[node_to_scc[visual_id]] = 0

    queue: List[int] = [idx for idx in range(len(sccs)) if indegree[idx] == 0]
    queue_index = 0
    while queue_index < len(queue):
        component_id = queue[queue_index]
        queue_index += 1
        current_depth = component_depths.get(component_id)

        for next_component in comp_edges.get(component_id, set()):
            if current_depth is not None and (component_id, next_component) in recipe_target_edges:
                next_depth = current_depth + 1
                if next_depth > component_depths.get(next_component, -1):
                    component_depths[next_component] = next_depth
            indegree[next_component] -= 1
            if indegree[next_component] == 0:
                queue.append(next_component)

    node_depth: Dict[str, int] = {}
    for node in input_nodes:
        node_depth[node.id] = 0
    for component_id, component_depth in component_depths.items():
        for node_id in sccs[component_id]:
            if node_type_map.get(node_id) in recipe_types:
                node_depth[node_id] = component_depth

    return node_depth


def _get_supply_preference_weight(
    edge: GraphEdge,
    node_type_map: Dict[str, str],
    node_depth: Dict[str, int],
    max_depth: int,
) -> float:
    capped_depth = min(max_depth, 6)
    source_type = node_type_map.get(edge.source)
    if source_type == "input":
        return float(10 ** min(capped_depth + 3, 8))
    if source_type in ("inputrecipe", "inputrecipetag"):
        return float(10 ** min(capped_depth + 2, 8))

    source_depth = node_depth.get(edge.source, 0)
    return float(10 ** min(max(capped_depth - source_depth, 0) + 1, 8))


def _build_name_to_id_map(store_data: Optional[Dict]) -> Dict[str, str]:
    """Build a mapping from item display name -> item id for normalization"""
    name_to_id = {}
    if store_data:
        for item in store_data.get("items", []):
            name_to_id[item.get("name", "")] = item.get("id", "")
    return name_to_id


def _resolve_item_id(port_data: dict, name_to_id: Dict[str, str], is_input: bool = False) -> str:
    """Resolve an item identifier to a consistent item ID.
    
    Priority: itemId > refId > fixedRefId > name mapped to ID > name as-is
    """
    # First try explicit item ID fields
    item_id = port_data.get("itemId")
    if item_id:
        return item_id
    
    if is_input:
        ref_id = port_data.get("refId")
        if ref_id:
            return ref_id
    
    fixed_ref = port_data.get("fixedRefId")
    if fixed_ref:
        return fixed_ref
    
    # Fall back to name -> ID mapping
    name = port_data.get("name", "")
    return name_to_id.get(name, name)


def _expand_recipe_tag(node: GraphNode, store_data: Dict, name_to_id: Dict[str, str],
                       is_input_tag: bool = False) -> List[RecipeInstance]:
    """Expand a recipe tag node into individual recipe instances using store data.
    
    Each member recipe becomes an independent RecipeInstance with its own
    machine count variable. Recipe tags are syntax sugar for multiple recipe nodes.
    """
    recipes = []
    recipe_tag_id = node.data.get("recipeTagId")
    if not recipe_tag_id:
        return recipes
    
    # Find the recipe tag definition in store data
    recipe_tag_def = None
    for rt in store_data.get("recipeTags", []):
        if rt.get("id") == recipe_tag_id:
            recipe_tag_def = rt
            break
    
    if not recipe_tag_def:
        return recipes
    
    member_recipe_ids = recipe_tag_def.get("memberRecipeIds", [])
    all_store_recipes = store_data.get("recipes", [])
    multiplier = float(node.data.get("multiplier", 1.0)) if is_input_tag else None
    
    for member_id in member_recipe_ids:
        # Find the member recipe in store data
        member_recipe = None
        for r in all_store_recipes:
            if r.get("id") == member_id:
                member_recipe = r
                break
        
        if not member_recipe:
            continue
        
        time_seconds = float(member_recipe.get("timeSeconds", 1.0))
        
        # Build inputs from store recipe (with proper item IDs)
        inputs = []
        if not is_input_tag:  # Input tags have no inputs (auto-supplied)
            for inp in member_recipe.get("inputs", []):
                item_id = inp.get("refId", "")
                inputs.append({
                    "id": inp.get("id"),
                    "itemId": item_id,
                    "refId": item_id,
                    "refType": inp.get("refType", "item"),
                    "amount": float(inp.get("amount", 0)),
                    "amountPerCycle": float(inp.get("amount", 0)),
                })
        
        # Build outputs from store recipe (with proper item IDs)
        outputs = []
        for out in member_recipe.get("outputs", []):
            amt = float(out.get("amount", 0))
            if is_input_tag and multiplier is not None:
                # For input recipe tags, scale by multiplier (matches InputRecipeNode frontend behavior)
                amt = amt * multiplier
            outputs.append({
                "id": out.get("id"),
                "itemId": out.get("itemId", ""),
                "amount": amt,
                "amountPerCycle": amt,
                "probability": float(out.get("probability", 1.0)),
            })
        
        recipes.append(RecipeInstance(
            node_id=f"{node.id}__sub__{member_id}",
            recipe_id=member_id,
            name=member_recipe.get("name", member_id),
            time_seconds=time_seconds,
            inputs=inputs,
            outputs=outputs,
            max_machines=multiplier,
            parent_tag_node_id=node.id
        ))
    
    return recipes


def _extract_recipes_from_node(node: GraphNode, store_data: Optional[Dict] = None,
                                name_to_id: Optional[Dict[str, str]] = None) -> List[RecipeInstance]:
    """Extract recipe instances from a node (handles recipe tags as multiple recipes)"""
    if not node.data:
        return []
    
    if name_to_id is None:
        name_to_id = {}
    
    recipes = []
    
    if node.type == "recipe":
        # Single recipe node - resolve display names to item IDs
        recipe_id = node.data.get("recipeId", node.id)
        title = node.data.get("title", "Recipe")
        time_seconds = float(node.data.get("timeSeconds", 1.0))
        inputs = node.data.get("inputs", [])
        outputs = node.data.get("outputs", [])
        
        # Resolve item IDs for all ports
        resolved_inputs = []
        for inp in inputs:
            resolved = dict(inp)
            resolved["itemId"] = _resolve_item_id(inp, name_to_id, is_input=True)
            resolved_inputs.append(resolved)
        
        resolved_outputs = []
        for out in outputs:
            resolved = dict(out)
            resolved["itemId"] = _resolve_item_id(out, name_to_id, is_input=False)
            resolved_outputs.append(resolved)
        
        recipes.append(RecipeInstance(
            node_id=node.id,
            recipe_id=recipe_id,
            name=title,
            time_seconds=time_seconds,
            inputs=resolved_inputs,
            outputs=resolved_outputs
        ))
    
    elif node.type == "recipetag":
        # Recipe tag = collection of independent recipes (syntax sugar for multiple recipe nodes)
        # Expand into individual sub-recipes using store data
        if store_data:
            expanded = _expand_recipe_tag(node, store_data, name_to_id, is_input_tag=False)
            if expanded:
                recipes.extend(expanded)
                return recipes
        
        # Fallback if no store data: treat fixed ports as a single recipe
        # (won't handle mixed ports correctly, but better than nothing)
        inputs = node.data.get("inputs", [])
        outputs = node.data.get("outputs", [])
        recipe_tag_id = node.data.get("recipeTagId", node.id)
        
        # Only use fixed (non-mixed) ports for the fallback single recipe
        fixed_inputs = []
        for inp in inputs:
            if not inp.get("isMixed"):
                resolved = dict(inp)
                resolved["itemId"] = _resolve_item_id(inp, name_to_id, is_input=True)
                fixed_inputs.append(resolved)
        
        fixed_outputs = []
        for out in outputs:
            if not out.get("isMixed"):
                resolved = dict(out)
                resolved["itemId"] = _resolve_item_id(out, name_to_id, is_input=False)
                fixed_outputs.append(resolved)
        
        if fixed_inputs or fixed_outputs:
            recipes.append(RecipeInstance(
                node_id=node.id,
                recipe_id=recipe_tag_id,
                name=node.data.get("title", "RecipeTag"),
                time_seconds=1.0,  # Unknown without store data
                inputs=fixed_inputs,
                outputs=fixed_outputs
            ))
    
    elif node.type == "inputrecipetag":
        # Input recipe tag - expand into individual recipes with max_machines
        if store_data:
            expanded = _expand_recipe_tag(node, store_data, name_to_id, is_input_tag=True)
            if expanded:
                recipes.extend(expanded)
                return recipes
        
        # Fallback: treat as single input recipe
        outputs = node.data.get("outputs", [])
        multiplier = float(node.data.get("multiplier", 1.0))
        time_seconds = float(node.data.get("timeSeconds", 1.0))
        
        resolved_outputs = []
        for out in outputs:
            if not out.get("isMixed"):
                resolved = dict(out)
                resolved["itemId"] = _resolve_item_id(out, name_to_id, is_input=False)
                resolved_outputs.append(resolved)
        
        if resolved_outputs:
            recipes.append(RecipeInstance(
                node_id=node.id,
                recipe_id=node.id,
                name=node.data.get("title", "Input Recipe Tag"),
                time_seconds=time_seconds,
                inputs=[],
                outputs=resolved_outputs,
                max_machines=multiplier
            ))
    
    elif node.type == "inputrecipe":
        # Input recipe nodes - limited sources that produce items
        # The multiplier is already baked into amountPerCycle by the frontend
        outputs = node.data.get("outputs", [])
        multiplier = float(node.data.get("multiplier", 1.0))
        time_seconds = float(node.data.get("timeSeconds", 1.0))
        
        # Resolve item IDs and fix the multiplier double-counting:
        # Frontend sets amountPerCycle = base_amount * multiplier
        # Solver sets max_machines = multiplier
        # So we set max_machines = 1 to avoid double-counting
        resolved_outputs = []
        for out in outputs:
            resolved = dict(out)
            resolved["itemId"] = _resolve_item_id(out, name_to_id, is_input=False)
            resolved_outputs.append(resolved)
        
        recipes.append(RecipeInstance(
            node_id=node.id,
            recipe_id=node.id,
            name=node.data.get("title", "Input Recipe"),
            time_seconds=time_seconds,
            inputs=[],
            outputs=resolved_outputs,
            max_machines=1.0  # multiplier already baked into amountPerCycle
        ))
    
    return recipes


def _solve_components_independently(
    graph: Graph, store_data: Optional[Dict],
    components: List[Set[str]], base_warnings: List[str]
) -> SolveResponse:
    """Solve each connected component of the graph independently.
    
    When a graph has multiple disconnected subgraphs, each is solved as its own
    LP problem. This prevents infeasibility in one subgraph from blocking
    solutions in others, and ensures each subgraph uses the correct objective
    mode for its own constraint type.
    """
    from app.api.models import NodeFlowData, EdgeFlowData
    
    merged_machine_counts: Dict[str, float] = {}
    merged_flows_per_second: Dict[str, float] = {}
    merged_bottlenecks: List[str] = []
    merged_warnings: List[str] = list(base_warnings)
    merged_node_flows: Dict[str, NodeFlowData] = {}
    merged_edge_flows: Dict[str, EdgeFlowData] = {}
    merged_problem_edge_ids: List[str] = []
    any_ok = False
    
    for comp_idx, component in enumerate(components):
        # Build sub-graph for this component
        comp_nodes = [node for node in graph.nodes if node.id in component]
        comp_edges = [edge for edge in graph.edges
                      if edge.source in component and edge.target in component]
        
        if not comp_nodes:
            continue
        
        sub_graph = Graph(nodes=comp_nodes, edges=comp_edges)
        result = solve_graph(sub_graph, store_data=store_data)
        
        if result.status == "error":
            # Describe the failed component for a useful warning
            node_descriptions = []
            for n in comp_nodes:
                title = ""
                if n.data:
                    title = n.data.get("title", "") or n.data.get("recipeId", "") or ""
                desc = f"{n.type}"
                if title:
                    desc += f"({title})"
                node_descriptions.append(desc)
            desc_str = ", ".join(node_descriptions[:6])
            # Include all warnings from the failed sub-solve (mismatch details, etc.)
            merged_warnings.extend(result.warnings)
            merged_warnings.append(
                f"Subgraph {comp_idx + 1} infeasible [{desc_str}]"
            )
            # Flag all edges in the infeasible component as problem edges
            merged_problem_edge_ids.extend(result.problemEdgeIds)
            for e in comp_edges:
                if e.id not in result.problemEdgeIds:
                    merged_problem_edge_ids.append(e.id)
        else:
            any_ok = True
            # Merge machine counts (sum for same recipe names across components)
            for k, v in result.machineCounts.items():
                merged_machine_counts[k] = merged_machine_counts.get(k, 0) + v
            # Merge flows per second (sum for same items)
            for k, v in result.flowsPerSecond.items():
                merged_flows_per_second[k] = merged_flows_per_second.get(k, 0) + v
            merged_bottlenecks.extend(result.bottlenecks)
            # Node and edge IDs are unique across components
            merged_node_flows.update(result.nodeFlows)
            merged_edge_flows.update(result.edgeFlows)
            merged_warnings.extend(result.warnings)
            merged_problem_edge_ids.extend(result.problemEdgeIds)
    
    return SolveResponse(
        status="ok" if any_ok else "error",
        machineCounts=merged_machine_counts,
        flowsPerSecond=merged_flows_per_second,
        bottlenecks=merged_bottlenecks,
        warnings=merged_warnings,
        nodeFlows=merged_node_flows,
        edgeFlows=merged_edge_flows,
        problemEdgeIds=merged_problem_edge_ids,
    )


def solve_graph(graph: Graph, store_data: Optional[Dict] = None) -> SolveResponse:
    """
    Solve the factory graph using LP optimization with an EDGE-BASED flow model.

    Key principle: every unit of material must travel through an actual graph
    edge.  Items cannot "teleport" between unconnected nodes.  This is enforced
    by giving each edge its own LP flow variable and writing conservation
    constraints at every port:

      recipe output port:  production == Σ outgoing-edge flows
      recipe input  port:  consumption == Σ incoming-edge flows

    Modes (unchanged from the old solver):
    - Input-constrained:  Maximize output while respecting input limits
    - Output-constrained: Fulfill output demands while minimizing machines
    - Both constrained:   Meet demands, then maximize output surplus

    Recipe tags are expanded into individual sub-recipes via store_data.
    Each sub-recipe gets its own machine-count variable.
    """
    warnings: List[str] = []
    problem_edge_ids: List[str] = []
    name_to_id = _build_name_to_id_map(store_data)

    try:
        # ───────────────────────────────────────────────────────────────
        # Step 1 – Classify nodes
        # ───────────────────────────────────────────────────────────────
        recipe_nodes: List[GraphNode] = []
        input_nodes:  List[GraphNode] = []
        output_nodes: List[GraphNode] = []
        requester_nodes: List[GraphNode] = []
        node_type_map: Dict[str, str] = {}
        node_by_id: Dict[str, GraphNode] = {}

        for node in graph.nodes:
            node_type_map[node.id] = node.type
            node_by_id[node.id] = node
            if node.type in ("recipe", "recipetag", "inputrecipe", "inputrecipetag"):
                recipe_nodes.append(node)
            elif node.type == "input":
                input_nodes.append(node)
            elif node.type in ("output", "mixedoutput"):
                output_nodes.append(node)
            elif node.type == "requester":
                requester_nodes.append(node)

        # ───────────────────────────────────────────────────────────────
        # Step 2 – Extract recipe instances (recipe tags → sub-recipes)
        # ───────────────────────────────────────────────────────────────
        recipes: List[RecipeInstance] = []
        for node in recipe_nodes:
            recipes.extend(
                _extract_recipes_from_node(node, store_data=store_data,
                                           name_to_id=name_to_id)
            )

        if not recipes and not input_nodes:
            return SolveResponse(
                status="ok", machineCounts={}, flowsPerSecond={},
                bottlenecks=[],
                warnings=["No recipes or inputs found in graph"],
            )

        # ───────────────────────────────────────────────────────────────
        # Step 3 – Connected components  (solve independently if >1)
        # ───────────────────────────────────────────────────────────────
        adjacency: Dict[str, Set[str]] = defaultdict(set)
        all_node_ids = {n.id for n in graph.nodes}
        for edge in graph.edges:
            adjacency[edge.source].add(edge.target)
            adjacency[edge.target].add(edge.source)

        visited: Set[str] = set()
        components: List[Set[str]] = []
        for nid in all_node_ids:
            if nid not in visited:
                comp: Set[str] = set()
                queue = [nid]
                while queue:
                    cur = queue.pop(0)
                    if cur in visited:
                        continue
                    visited.add(cur)
                    comp.add(cur)
                    for nb in adjacency.get(cur, set()):
                        if nb not in visited:
                            queue.append(nb)
                components.append(comp)

        sccs, node_to_scc = _compute_strongly_connected_components(
            all_node_ids, graph.edges
        )
        cycle_edge_ids = _compute_cycle_edge_ids(graph, sccs, node_to_scc)

        if len(components) > 1:
            return _solve_components_independently(
                graph, store_data, components, warnings
            )

        # ───────────────────────────────────────────────────────────────
        # Step 4 – LP solver & machine variables
        # ───────────────────────────────────────────────────────────────
        solver = pywraplp.Solver.CreateSolver("GLOP")
        if not solver:
            return SolveResponse(
                status="error", warnings=["Failed to create LP solver"]
            )

        recipe_vars: Dict[str, pywraplp.Variable] = {}
        for recipe in recipes:
            ub = (recipe.max_machines
                  if recipe.max_machines is not None
                  else solver.infinity())
            recipe_vars[recipe.node_id] = solver.NumVar(
                0, ub, f"m_{recipe.node_id}"
            )

        # ───────────────────────────────────────────────────────────────
        # Step 5 – Build port → recipe-contribution mappings
        #
        #  port_prod[(visual_node, handle)] = [(recipe, item_id, rate/machine)]
        #  port_cons[(visual_node, handle)] = [(recipe, item_id, rate/machine)]
        #  mixed_cons[(visual_node, handle)] = [(recipe, rate/machine)]
        #  port_output_items[(node, handle)]  = {items the port can provide}
        # ───────────────────────────────────────────────────────────────
        port_prod: Dict[Tuple[str, str],
                        List[Tuple[RecipeInstance, str, float]]] = defaultdict(list)
        port_cons: Dict[Tuple[str, str],
                        List[Tuple[RecipeInstance, str, float]]] = defaultdict(list)
        mixed_cons: Dict[Tuple[str, str],
                         List[Tuple[RecipeInstance, float]]] = defaultdict(list)
        port_output_items: Dict[Tuple[str, str], Set[str]] = defaultdict(set)
        port_input_items: Dict[Tuple[str, str], Set[str]] = defaultdict(set)

        # Tag-node port definitions (for sub-recipe → visual-port mapping)
        tag_port_defs: Dict[str, Dict] = {}
        for node in graph.nodes:
            if node.type in ("recipetag", "inputrecipetag") and node.data:
                tag_port_defs[node.id] = {
                    "inputs":  node.data.get("inputs", []),
                    "outputs": node.data.get("outputs", []),
                }

        for recipe in recipes:
            visual_id = recipe.parent_tag_node_id or recipe.node_id
            tag_ports = (tag_port_defs.get(recipe.parent_tag_node_id)
                         if recipe.parent_tag_node_id else None)

            # ── register OUTPUT ports ──
            if tag_ports:
                tag_outputs = tag_ports["outputs"]
                if len(tag_outputs) == len(recipe.outputs):
                    # positional mapping
                    for idx, out in enumerate(recipe.outputs):
                        item_id = out.get("itemId") or out.get("name", "")
                        item_id = name_to_id.get(item_id, item_id)
                        if not item_id:
                            continue
                        tp_id = tag_outputs[idx].get("id", f"o{idx+1}")
                        handle = f"output-{tp_id}"
                        amount = float(out.get("amountPerCycle",
                                               out.get("amount", 0)))
                        prob = float(out.get("probability", 1.0))
                        rate = amount * prob / recipe.time_seconds
                        port_prod[(visual_id, handle)].append(
                            (recipe, item_id, rate))
                        port_output_items[(visual_id, handle)].add(item_id)
                else:
                    # collapsed (fixed + mixed)
                    fixed_map: Dict[str, dict] = {}
                    mixed_ports: List[dict] = []
                    for tp in tag_outputs:
                        if not tp.get("isMixed") and tp.get("fixedRefId"):
                            fixed_map[tp["fixedRefId"]] = tp
                        elif tp.get("isMixed"):
                            mixed_ports.append(tp)
                    for out in recipe.outputs:
                        item_id = out.get("itemId") or out.get("name", "")
                        item_id = name_to_id.get(item_id, item_id)
                        if not item_id:
                            continue
                        if item_id in fixed_map:
                            tp_id = fixed_map[item_id]["id"]
                        elif mixed_ports:
                            tp_id = mixed_ports[0]["id"]
                        else:
                            continue
                        handle = f"output-{tp_id}"
                        amount = float(out.get("amountPerCycle",
                                               out.get("amount", 0)))
                        prob = float(out.get("probability", 1.0))
                        rate = amount * prob / recipe.time_seconds
                        port_prod[(visual_id, handle)].append(
                            (recipe, item_id, rate))
                        port_output_items[(visual_id, handle)].add(item_id)
            else:
                # regular recipe – direct mapping
                for out in recipe.outputs:
                    port_id = out.get("id", "output")
                    item_id = out.get("itemId") or out.get("name", "")
                    item_id = name_to_id.get(item_id, item_id)
                    if not item_id:
                        continue
                    handle = f"output-{port_id}"
                    amount = float(out.get("amountPerCycle",
                                           out.get("amount", 0)))
                    prob = float(out.get("probability", 1.0))
                    rate = amount * prob / recipe.time_seconds
                    port_prod[(visual_id, handle)].append(
                        (recipe, item_id, rate))
                    port_output_items[(visual_id, handle)].add(item_id)

            # ── register INPUT ports ──
            if tag_ports:
                # Tag sub-recipes: ALWAYS use per-item constraints (port_cons)
                # even when the tag port is marked isMixed. Each sub-recipe
                # knows its actual item; "mixed" is just a UI grouping.
                tag_inputs = tag_ports["inputs"]
                if len(tag_inputs) == len(recipe.inputs):
                    for idx, inp in enumerate(recipe.inputs):
                        item_id = (inp.get("itemId")
                                   or inp.get("refId")
                                   or inp.get("name", ""))
                        item_id = name_to_id.get(item_id, item_id)
                        if not item_id:
                            continue
                        tp_id = tag_inputs[idx].get("id", f"i{idx+1}")
                        handle = f"input-{tp_id}"
                        amount = float(inp.get("amountPerCycle",
                                               inp.get("amount", 0)))
                        rate = amount / recipe.time_seconds
                        port_cons[(visual_id, handle)].append(
                            (recipe, item_id, rate))
                        port_input_items[(visual_id, handle)].add(item_id)
                else:
                    fixed_map = {}
                    mixed_ports = []
                    for tp in tag_inputs:
                        if not tp.get("isMixed") and tp.get("fixedRefId"):
                            fixed_map[tp["fixedRefId"]] = tp
                        elif tp.get("isMixed"):
                            mixed_ports.append(tp)
                    for inp in recipe.inputs:
                        item_id = (inp.get("itemId")
                                   or inp.get("refId")
                                   or inp.get("name", ""))
                        item_id = name_to_id.get(item_id, item_id)
                        if not item_id:
                            continue
                        if item_id in fixed_map:
                            tp_id = fixed_map[item_id]["id"]
                        elif mixed_ports:
                            tp_id = mixed_ports[0]["id"]
                        else:
                            continue
                        handle = f"input-{tp_id}"
                        amount = float(inp.get("amountPerCycle",
                                               inp.get("amount", 0)))
                        rate = amount / recipe.time_seconds
                        port_cons[(visual_id, handle)].append(
                            (recipe, item_id, rate))
                        port_input_items[(visual_id, handle)].add(item_id)
            else:
                for inp in recipe.inputs:
                    port_id = inp.get("id", "input")
                    handle = f"input-{port_id}"
                    amount = float(inp.get("amountPerCycle",
                                           inp.get("amount", 0)))
                    rate = amount / recipe.time_seconds
                    if inp.get("isMixed"):
                        mixed_cons[(visual_id, handle)].append(
                            (recipe, rate))
                    else:
                        item_id = (inp.get("itemId")
                                   or inp.get("refId")
                                   or inp.get("name", ""))
                        item_id = name_to_id.get(item_id, item_id)
                        if item_id:
                            port_cons[(visual_id, handle)].append(
                                (recipe, item_id, rate))
                            port_input_items[(visual_id, handle)].add(
                                item_id)

        # Register input-node output ports
        for node in input_nodes:
            if not node.data:
                continue
            for ie in node.data.get("items", []):
                item_id = ie.get("itemId")
                if item_id:
                    port_output_items[
                        (node.id, f"output-{ie.get('id', 'output')}")
                    ].add(item_id)

        # Register target-side port_input_items for output & requester nodes
        for node in output_nodes:
            if not node.data or node.type == "mixedoutput":
                continue
            for ie in node.data.get("items", []):
                item_id = ie.get("itemId")
                if item_id:
                    port_input_items[
                        (node.id, f"input-{ie.get('id', 'input')}")
                    ].add(item_id)
        for node in requester_nodes:
            if not node.data:
                continue
            for req in node.data.get("requests", []):
                item_id = req.get("itemId")
                if item_id:
                    port_input_items[
                        (node.id, f"input-{req.get('id', 'input')}")
                    ].add(item_id)

        # ───────────────────────────────────────────────────────────────
        # Step 6 – Index edges by port & create per-edge flow variables
        # ───────────────────────────────────────────────────────────────
        edges_by_src: Dict[Tuple[str, str], List[GraphEdge]] = defaultdict(list)
        edges_by_tgt: Dict[Tuple[str, str], List[GraphEdge]] = defaultdict(list)
        edge_flow_vars: Dict[str, Dict[str, pywraplp.Variable]] = {}
        evar_ctr = 0  # for short unique LP names

        for edge in graph.edges:
            src_h = edge.sourceHandle or "output"
            tgt_h = edge.targetHandle or "input"
            src_key = (edge.source, src_h)
            tgt_key = (edge.target, tgt_h)
            edges_by_src[src_key].append(edge)
            edges_by_tgt[tgt_key].append(edge)

            # Items this edge can carry = items the source port provides
            src_items = port_output_items.get(src_key, set())

            # Mismatch warning (informational – LP handles it structurally)
            tgt_specific: Set[str] = set()
            for (_, iid, _) in port_cons.get(tgt_key, []):
                tgt_specific.add(iid)
            if src_items and tgt_specific and not (src_items & tgt_specific):
                src_node = node_by_id.get(edge.source)
                tgt_node = node_by_id.get(edge.target)
                src_desc = (src_node.data.get("title", edge.source)
                            if src_node and src_node.data else edge.source)
                tgt_desc = (tgt_node.data.get("title", edge.target)
                            if tgt_node and tgt_node.data else edge.target)
                warnings.append(
                    f"Edge item mismatch: '{src_desc}' provides "
                    f"{src_items} but '{tgt_desc}' expects "
                    f"{tgt_specific}. Connected recipes disabled."
                )
                problem_edge_ids.append(edge.id)

            # Determine which items this edge should carry:
            # Intersect source items with target-accepted items when known.
            # For mixedoutput or truly mixed targets, use all source items.
            tgt_items = port_input_items.get(tgt_key, set())
            if tgt_items:
                edge_items = src_items & tgt_items
            else:
                # Target has no typed ports (mixedoutput, or mixed_cons)
                edge_items = src_items

            # Create one flow variable per (edge, item)
            edge_flow_vars[edge.id] = {}
            for item_id in edge_items:
                var = solver.NumVar(
                    0, solver.infinity(), f"f{evar_ctr}_{item_id}")
                edge_flow_vars[edge.id][item_id] = var
                evar_ctr += 1

        # ───────────────────────────────────────────────────────────────
        # Step 7 – Recipe output conservation constraints
        #
        #   For each recipe output port WITH outgoing edges:
        #     per item:  Σ machines_r * rate_r  ==  Σ edge_flow
        #   Ports without outgoing edges → waste (no constraint)
        # ───────────────────────────────────────────────────────────────
        for port_key, contributions in port_prod.items():
            outgoing = edges_by_src.get(port_key, [])
            if not outgoing:
                continue  # waste – OK

            # group by item
            item_rates: Dict[str, List[Tuple[RecipeInstance, float]]] = \
                defaultdict(list)
            for (recipe, item_id, rate) in contributions:
                item_rates[item_id].append((recipe, rate))

            for item_id, rates in item_rates.items():
                production = solver.Sum(
                    [recipe_vars[r.node_id] * rt for r, rt in rates])
                out_terms = [
                    edge_flow_vars[e.id][item_id]
                    for e in outgoing
                    if item_id in edge_flow_vars.get(e.id, {})
                ]
                if out_terms:
                    # Once an output port is wired, all production on that
                    # item/port must be accounted for on its edges.
                    solver.Add(production == solver.Sum(out_terms))
                # else: no outgoing edge carries this item – waste at port

        # ───────────────────────────────────────────────────────────────
        # Step 8a – Recipe input conservation (non-mixed ports)
        #
        #   Σ incoming-edge flows  ==  Σ machines_r * rate_r
        #   No incoming flow ⇒ consumption forced to 0 ⇒ machines = 0
        # ───────────────────────────────────────────────────────────────
        for port_key, contributions in port_cons.items():
            incoming = edges_by_tgt.get(port_key, [])

            item_rates: Dict[str, List[Tuple[RecipeInstance, float]]] = \
                defaultdict(list)
            for (recipe, item_id, rate) in contributions:
                item_rates[item_id].append((recipe, rate))

            for item_id, rates in item_rates.items():
                consumption = solver.Sum(
                    [recipe_vars[r.node_id] * rt for r, rt in rates])
                in_terms = [
                    edge_flow_vars[e.id][item_id]
                    for e in incoming
                    if item_id in edge_flow_vars.get(e.id, {})
                ]
                if in_terms:
                    solver.Add(solver.Sum(in_terms) == consumption)
                else:
                    # No edge supplies this item → recipe cannot run
                    solver.Add(consumption == 0)

        # ───────────────────────────────────────────────────────────────
        # Step 8b – Mixed-input conservation (any-item ports)
        #
        #   Σ ALL incoming-edge flows (any item) == consumption
        # ───────────────────────────────────────────────────────────────
        for port_key, rates in mixed_cons.items():
            incoming = edges_by_tgt.get(port_key, [])
            consumption = solver.Sum(
                [recipe_vars[r.node_id] * rt for r, rt in rates])
            in_terms = []
            for e in incoming:
                for _, var in edge_flow_vars.get(e.id, {}).items():
                    in_terms.append(var)
            if in_terms:
                solver.Add(solver.Sum(in_terms) == consumption)
            else:
                solver.Add(consumption == 0)

        # ───────────────────────────────────────────────────────────────
        # Step 9 – Input-node limit constraints
        # ───────────────────────────────────────────────────────────────
        input_limits: Dict[str, float] = {}

        for node in input_nodes:
            if not node.data:
                continue
            for ie in node.data.get("items", []):
                item_id = ie.get("itemId")
                mode = ie.get("mode", "infinite")
                limit = ie.get("limit")
                if not item_id:
                    continue
                port_key = (node.id, f"output-{ie.get('id', 'output')}")
                outgoing = edges_by_src.get(port_key, [])

                if mode == "limit" and limit is not None:
                    limit_val = float(limit)
                    out_terms = [
                        edge_flow_vars[e.id][item_id]
                        for e in outgoing
                        if item_id in edge_flow_vars.get(e.id, {})
                    ]
                    if out_terms:
                        solver.Add(solver.Sum(out_terms) <= limit_val)
                    input_limits[item_id] = (
                        input_limits.get(item_id, 0) + limit_val)

        has_inputrecipe_constraints = any(
            r.max_machines is not None for r in recipes)
        has_input_constraints = (
            len(input_limits) > 0 or has_inputrecipe_constraints)

        # ───────────────────────────────────────────────────────────────
        # Step 10 – Requester (demand) constraints
        # ───────────────────────────────────────────────────────────────
        output_demands: Dict[str, float] = {}

        for node in requester_nodes:
            if not node.data:
                continue
            for req in node.data.get("requests", []):
                item_id = req.get("itemId")
                target = req.get("targetPerSecond")
                if not item_id or target is None:
                    continue
                target_val = float(target)
                port_key = (node.id, f"input-{req.get('id', 'input')}")
                incoming = edges_by_tgt.get(port_key, [])
                in_terms = [
                    edge_flow_vars[e.id][item_id]
                    for e in incoming
                    if item_id in edge_flow_vars.get(e.id, {})
                ]
                if in_terms:
                    solver.Add(solver.Sum(in_terms) >= target_val)
                else:
                    warnings.append(
                        f"Requester demands {item_id} ({target_val}/s) "
                        f"but no supplying edge exists")
                output_demands[item_id] = (
                    output_demands.get(item_id, 0) + target_val)

        has_output_demands = len(output_demands) > 0

        # ───────────────────────────────────────────────────────────────
        # Step 11 – Output-node surplus variables & depth weighting
        # ───────────────────────────────────────────────────────────────
        # Node depth (for prioritising complex outputs)
        _recipe_types = frozenset((
            "recipe", "recipetag", "inputrecipe", "inputrecipetag"))
        node_depth = _compute_node_depths(
            graph, node_type_map, input_nodes, recipes, sccs, node_to_scc
        )

        output_surplus_vars: List[Tuple] = []
        has_output_sinks = False

        for node in output_nodes:
            if node.type == "mixedoutput":
                # Mixed output accepts any item — create a surplus var for
                # every item arriving via incoming edges so the objective
                # has incentive to push flow there.
                mx_port_key = (node.id, "mixed-input")
                mx_incoming = edges_by_tgt.get(mx_port_key, [])
                if not mx_incoming:
                    continue

                mx_item_vars: Dict[str, List] = defaultdict(list)
                mx_item_depth: Dict[str, int] = {}
                for e in mx_incoming:
                    sd = node_depth.get(e.source, 0)
                    for iid, var in edge_flow_vars.get(e.id, {}).items():
                        mx_item_vars[iid].append(var)
                        if iid not in mx_item_depth or sd > mx_item_depth[iid]:
                            mx_item_depth[iid] = sd

                for iid, vlist in mx_item_vars.items():
                    has_output_sinks = True
                    surplus = solver.NumVar(
                        0, solver.infinity(),
                        f"surplus_{node.id}_{iid}")
                    solver.Add(surplus == solver.Sum(vlist))
                    weight = 10.0 ** max(mx_item_depth.get(iid, 0), 1)
                    output_surplus_vars.append((surplus, weight))
                continue

            if not node.data:
                continue
            for ie in node.data.get("items", []):
                item_id = ie.get("itemId")
                if not item_id:
                    continue
                port_key = (node.id, f"input-{ie.get('id', 'input')}")
                incoming = edges_by_tgt.get(port_key, [])
                in_terms = [
                    edge_flow_vars[e.id][item_id]
                    for e in incoming
                    if item_id in edge_flow_vars.get(e.id, {})
                ]
                if not in_terms:
                    continue

                has_output_sinks = True
                surplus = solver.NumVar(
                    0, solver.infinity(),
                    f"surplus_{node.id}_{item_id}")
                solver.Add(surplus == solver.Sum(in_terms))

                max_src_depth = 0
                for e in incoming:
                    max_src_depth = max(
                        max_src_depth, node_depth.get(e.source, 0))
                weight = 10.0 ** max(max_src_depth, 1)
                output_surplus_vars.append((surplus, weight))

        secondary_preference_terms: List[Tuple[pywraplp.Variable, float]] = []
        if cycle_edge_ids:
            max_depth = max(node_depth.values(), default=0)
            for port_key, incoming_edges in edges_by_tgt.items():
                if len(incoming_edges) < 2:
                    continue
                target_node_id, _ = port_key
                if node_type_map.get(target_node_id) not in _recipe_types:
                    continue

                weights_by_edge: Dict[str, float] = {}
                distinct_weights: Set[float] = set()
                for edge in incoming_edges:
                    weight = _get_supply_preference_weight(
                        edge, node_type_map, node_depth, max_depth
                    )
                    weights_by_edge[edge.id] = weight
                    distinct_weights.add(weight)

                if len(distinct_weights) < 2:
                    continue

                for edge in incoming_edges:
                    for var in edge_flow_vars.get(edge.id, {}).values():
                        secondary_preference_terms.append(
                            (var, weights_by_edge[edge.id])
                        )

        # ───────────────────────────────────────────────────────────────
        # Step 12 – Objective function
        # ───────────────────────────────────────────────────────────────
        objective = solver.Objective()
        objective_terms: List[Tuple[pywraplp.Variable, float]] = []

        def add_objective_term(var: pywraplp.Variable, coeff: float) -> None:
            objective.SetCoefficient(var, coeff)
            objective_terms.append((var, coeff))

        objective_is_maximization = False

        if has_output_demands and not has_input_constraints:
            for var in recipe_vars.values():
                add_objective_term(var, 1)
            objective.SetMinimization()

        elif has_input_constraints and not has_output_demands:
            for recipe in recipes:
                if recipe.max_machines is not None:
                    add_objective_term(recipe_vars[recipe.node_id], 10000)
                else:
                    add_objective_term(recipe_vars[recipe.node_id], -0.001)
            for sv, w in output_surplus_vars:
                add_objective_term(sv, w)
            objective.SetMaximization()
            objective_is_maximization = True

        elif has_input_constraints and has_output_demands:
            if has_output_sinks:
                for var in recipe_vars.values():
                    add_objective_term(var, -0.001)
                for sv, w in output_surplus_vars:
                    add_objective_term(sv, w)
                objective.SetMaximization()
                objective_is_maximization = True
            else:
                for var in recipe_vars.values():
                    add_objective_term(var, 1)
                objective.SetMinimization()
        else:
            for var in recipe_vars.values():
                add_objective_term(var, 1)
            objective.SetMinimization()

        # ───────────────────────────────────────────────────────────────
        # Step 13 – Solve
        # ───────────────────────────────────────────────────────────────
        status = solver.Solve()

        if status not in (pywraplp.Solver.OPTIMAL,
                          pywraplp.Solver.FEASIBLE):
            status_msg = {
                pywraplp.Solver.INFEASIBLE: "infeasible",
                pywraplp.Solver.UNBOUNDED:  "unbounded",
            }.get(status, "error")
            if cycle_edge_ids:
                for edge_id in sorted(cycle_edge_ids):
                    if edge_id not in problem_edge_ids:
                        problem_edge_ids.append(edge_id)
                if status == pywraplp.Solver.UNBOUNDED:
                    warnings.append(
                        "Circular reference is runaway: the cycle can "
                        "produce more reusable output than it can consume."
                    )
                elif status == pywraplp.Solver.INFEASIBLE:
                    warnings.append(
                        "Circular reference cannot be balanced with the "
                        "available fresh inputs."
                    )
            warnings.append(
                f"No feasible solution found ({status_msg}). "
                f"Check constraints - demands may exceed supply limits.")
            return SolveResponse(status="error", warnings=warnings,
                                 problemEdgeIds=problem_edge_ids)

        if cycle_edge_ids and secondary_preference_terms:
            primary_value = objective.Value()
            tolerance = max(1e-7, 1e-7 * max(1.0, abs(primary_value)))
            primary_expr = solver.Sum([
                var * coeff for var, coeff in objective_terms
            ])
            if objective_is_maximization:
                solver.Add(primary_expr >= primary_value - tolerance)
            else:
                solver.Add(primary_expr <= primary_value + tolerance)

            secondary_coeffs: Dict[pywraplp.Variable, float] = defaultdict(float)
            for var, coeff in secondary_preference_terms:
                secondary_coeffs[var] += coeff

            for var, _ in objective_terms:
                objective.SetCoefficient(var, 0)
            for var, coeff in secondary_coeffs.items():
                objective.SetCoefficient(var, coeff)
            objective.SetMinimization()

            status = solver.Solve()
            if status not in (pywraplp.Solver.OPTIMAL,
                              pywraplp.Solver.FEASIBLE):
                warnings.append(
                    "Circular preference pass failed; falling back to the "
                    "primary cycle solution may require a retry."
                )

        if cycle_edge_ids:
            cycle_edges_by_scc: Dict[int, List[str]] = defaultdict(list)
            for edge in graph.edges:
                if edge.id not in cycle_edge_ids:
                    continue
                cycle_edges_by_scc[node_to_scc[edge.source]].append(edge.id)

            for scc_index, component_nodes in enumerate(sccs):
                cycle_items: Set[str] = set()
                for edge in graph.edges:
                    if edge.id not in cycle_edge_ids:
                        continue
                    if node_to_scc.get(edge.source) != scc_index:
                        continue
                    for item_id, var in edge_flow_vars.get(edge.id, {}).items():
                        if var.solution_value() > 1e-7:
                            cycle_items.add(item_id)

                if not cycle_items:
                    continue

                for item_id in cycle_items:
                    internal_production = 0.0
                    internal_consumption = 0.0
                    external_entry = 0.0
                    external_exit = 0.0

                    for recipe in recipes:
                        visual_id = recipe.parent_tag_node_id or recipe.node_id
                        if visual_id not in component_nodes:
                            continue
                        machine_count = recipe_vars[recipe.node_id].solution_value()
                        if machine_count <= 1e-7:
                            continue

                        for out in recipe.outputs:
                            output_item_id = out.get("itemId") or out.get("name", "")
                            output_item_id = name_to_id.get(output_item_id, output_item_id)
                            if output_item_id != item_id:
                                continue
                            amount = float(out.get("amountPerCycle", out.get("amount", 0)))
                            prob = float(out.get("probability", 1.0))
                            internal_production += (
                                machine_count * amount * prob / recipe.time_seconds
                            )

                        for inp in recipe.inputs:
                            input_item_id = (
                                inp.get("itemId") or inp.get("refId") or inp.get("name", "")
                            )
                            input_item_id = name_to_id.get(input_item_id, input_item_id)
                            if input_item_id != item_id:
                                continue
                            amount = float(inp.get("amountPerCycle", inp.get("amount", 0)))
                            internal_consumption += (
                                machine_count * amount / recipe.time_seconds
                            )

                    for edge in graph.edges:
                        src_scc = node_to_scc.get(edge.source)
                        tgt_scc = node_to_scc.get(edge.target)
                        if src_scc == scc_index and tgt_scc != scc_index:
                            var = edge_flow_vars.get(edge.id, {}).get(item_id)
                            if var:
                                external_exit += var.solution_value()
                        elif src_scc != scc_index and tgt_scc == scc_index:
                            var = edge_flow_vars.get(edge.id, {}).get(item_id)
                            if var:
                                external_entry += var.solution_value()

                    if internal_production + external_entry > internal_consumption + external_exit + 1e-6:
                        for edge_id in cycle_edges_by_scc.get(scc_index, []):
                            if edge_id not in problem_edge_ids:
                                problem_edge_ids.append(edge_id)
                        warnings.append(
                            f"Circular reference is runaway for {item_id}: "
                            f"{round(internal_production + external_entry, 3)}/s "
                            f"available inside the cycle but only "
                            f"{round(internal_consumption + external_exit, 3)}/s "
                            f"can be consumed or removed."
                        )
                        return SolveResponse(
                            status="error",
                            warnings=warnings,
                            problemEdgeIds=problem_edge_ids,
                        )

        # ───────────────────────────────────────────────────────────────
        # Step 14 – Extract results
        # ───────────────────────────────────────────────────────────────
        from app.api.models import NodeFlowData, EdgeFlowData

        # -- machine counts (legacy: recipe_name → total) --
        machine_counts: Dict[str, float] = {}
        for recipe in recipes:
            mc = recipe_vars[recipe.node_id].solution_value()
            if mc > 0.001:
                machine_counts[recipe.name] = round(
                    machine_counts.get(recipe.name, 0) + mc, 3)

        # -- edge flows --
        edge_flows_result: Dict[str, EdgeFlowData] = {}
        for edge in graph.edges:
            flows: Dict[str, float] = {}
            total = 0.0
            for item_id, var in edge_flow_vars.get(edge.id, {}).items():
                val = var.solution_value()
                if val > 0.001:
                    flows[item_id] = round(val, 3)
                    total += val
            if total > 0.001:
                edge_flows_result[edge.id] = EdgeFlowData(
                    flows=flows, totalFlow=round(total, 3))

        # -- flows per second (legacy: total production per item) --
        flows_per_second: Dict[str, float] = {}
        for recipe in recipes:
            mc = recipe_vars[recipe.node_id].solution_value()
            if mc < 0.001:
                continue
            for out in recipe.outputs:
                iid = out.get("itemId") or out.get("name", "")
                iid = name_to_id.get(iid, iid)
                if not iid:
                    continue
                amount = float(out.get("amountPerCycle",
                                       out.get("amount", 0)))
                prob = float(out.get("probability", 1.0))
                rate = mc * amount * prob / recipe.time_seconds
                if rate > 0.001:
                    flows_per_second[iid] = round(
                        flows_per_second.get(iid, 0) + rate, 3)

        # -- node flows --
        node_flows: Dict[str, NodeFlowData] = {}

        # recipe nodes
        for recipe in recipes:
            mc = recipe_vars[recipe.node_id].solution_value()
            if mc < 0.001:
                continue
            rmc = round(mc, 3)
            nd = NodeFlowData(
                machineCount=rmc,
                recipeRuns={recipe.recipe_id: rmc})
            for inp in recipe.inputs:
                iid = (inp.get("itemId") or inp.get("refId")
                       or inp.get("name", ""))
                iid = name_to_id.get(iid, iid)
                if iid:
                    amount = float(inp.get("amountPerCycle",
                                           inp.get("amount", 0)))
                    rate = mc * amount / recipe.time_seconds
                    if rate > 0.001:
                        nd.inputFlows[iid] = round(
                            nd.inputFlows.get(iid, 0) + rate, 3)
                        nd.totalInput += rate
            for out in recipe.outputs:
                iid = out.get("itemId") or out.get("name", "")
                iid = name_to_id.get(iid, iid)
                if iid:
                    amount = float(out.get("amountPerCycle",
                                           out.get("amount", 0)))
                    prob = float(out.get("probability", 1.0))
                    rate = mc * amount * prob / recipe.time_seconds
                    if rate > 0.001:
                        nd.outputFlows[iid] = round(
                            nd.outputFlows.get(iid, 0) + rate, 3)
                        nd.totalOutput += rate
            nd.totalInput = round(nd.totalInput, 3)
            nd.totalOutput = round(nd.totalOutput, 3)

            visual_id = recipe.parent_tag_node_id or recipe.node_id
            if visual_id not in node_flows:
                node_flows[visual_id] = nd
            else:
                ex = node_flows[visual_id]
                ex.machineCount = round(
                    (ex.machineCount or 0) + nd.machineCount, 3)
                for rid, rc in nd.recipeRuns.items():
                    ex.recipeRuns[rid] = round(
                        ex.recipeRuns.get(rid, 0) + rc, 3)
                for iid, r in nd.inputFlows.items():
                    ex.inputFlows[iid] = round(
                        ex.inputFlows.get(iid, 0) + r, 3)
                for iid, r in nd.outputFlows.items():
                    ex.outputFlows[iid] = round(
                        ex.outputFlows.get(iid, 0) + r, 3)
                ex.totalInput = round(
                    ex.totalInput + nd.totalInput, 3)
                ex.totalOutput = round(
                    ex.totalOutput + nd.totalOutput, 3)

        # input nodes – sum outgoing edge flows
        for node in input_nodes:
            if not node.data:
                continue
            nd = NodeFlowData()
            for ie in node.data.get("items", []):
                item_id = ie.get("itemId")
                if not item_id:
                    continue
                pk = (node.id, f"output-{ie.get('id', 'output')}")
                total = 0.0
                for e in edges_by_src.get(pk, []):
                    var = edge_flow_vars.get(e.id, {}).get(item_id)
                    if var:
                        val = var.solution_value()
                        if val > 0.001:
                            total += val
                if total > 0.001:
                    nd.outputFlows[item_id] = round(total, 3)
                    nd.totalOutput += total
            nd.totalOutput = round(nd.totalOutput, 3)
            if nd.totalOutput > 0:
                node_flows[node.id] = nd

        # output nodes – sum incoming edge flows
        for node in output_nodes:
            if not node.data:
                continue
            nd = NodeFlowData()
            for ie in node.data.get("items", []):
                item_id = ie.get("itemId")
                if not item_id:
                    continue
                pk = (node.id, f"input-{ie.get('id', 'input')}")
                total = 0.0
                for e in edges_by_tgt.get(pk, []):
                    var = edge_flow_vars.get(e.id, {}).get(item_id)
                    if var:
                        val = var.solution_value()
                        if val > 0.001:
                            total += val
                if total > 0.001:
                    nd.inputFlows[item_id] = round(total, 3)
                    nd.totalInput += total
            nd.totalInput = round(nd.totalInput, 3)
            if nd.totalInput > 0:
                node_flows[node.id] = nd

        # mixed-output nodes – sum incoming edge flows
        for node in graph.nodes:
            if node.type != "mixedoutput":
                continue
            nd = NodeFlowData()
            for e in graph.edges:
                if e.target != node.id:
                    continue
                for item_id, var in edge_flow_vars.get(e.id, {}).items():
                    val = var.solution_value()
                    if val > 0.001:
                        nd.inputFlows[item_id] = round(
                            nd.inputFlows.get(item_id, 0) + val, 3)
                        nd.totalInput += val
            nd.totalInput = round(nd.totalInput, 3)
            if nd.totalInput > 0:
                node_flows[node.id] = nd

        # requester nodes – sum incoming edge flows (capped at demand)
        for node in requester_nodes:
            if not node.data:
                continue
            nd = NodeFlowData()
            for req in node.data.get("requests", []):
                item_id = req.get("itemId")
                target = req.get("targetPerSecond")
                if not item_id:
                    continue
                pk = (node.id, f"input-{req.get('id', 'input')}")
                total = 0.0
                for e in edges_by_tgt.get(pk, []):
                    var = edge_flow_vars.get(e.id, {}).get(item_id)
                    if var:
                        val = var.solution_value()
                        if val > 0.001:
                            total += val
                # cap display at demand
                if target is not None and float(target) > 0:
                    total = min(total, float(target))
                if total > 0.001:
                    nd.inputFlows[item_id] = round(total, 3)
                    nd.totalInput += total
            nd.totalInput = round(nd.totalInput, 3)
            if nd.totalInput > 0:
                node_flows[node.id] = nd

        # -- bottlenecks --
        bottlenecks: List[str] = []
        for node in input_nodes:
            if not node.data:
                continue
            for ie in node.data.get("items", []):
                item_id = ie.get("itemId")
                mode = ie.get("mode", "infinite")
                limit = ie.get("limit")
                if not item_id or mode != "limit" or limit is None:
                    continue
                pk = (node.id, f"output-{ie.get('id', 'output')}")
                total_flow = 0.0
                for e in edges_by_src.get(pk, []):
                    var = edge_flow_vars.get(e.id, {}).get(item_id)
                    if var:
                        total_flow += var.solution_value()
                if total_flow >= float(limit) * 0.95:
                    bottlenecks.append(item_id)

        # -- unmet-demand warnings --
        for node in requester_nodes:
            if not node.data:
                continue
            for req in node.data.get("requests", []):
                item_id = req.get("itemId")
                target = req.get("targetPerSecond")
                if not item_id or target is None:
                    continue
                target_val = float(target)
                pk = (node.id, f"input-{req.get('id', 'input')}")
                total = 0.0
                for e in edges_by_tgt.get(pk, []):
                    var = edge_flow_vars.get(e.id, {}).get(item_id)
                    if var:
                        total += var.solution_value()
                if total < target_val * 0.95:
                    warnings.append(
                        f"Demand for {item_id} ({target_val}/s) "
                        f"not fully met (delivering {round(total, 3)}/s)")

        # Detect edges that connect recipe/tag nodes but carry zero flow
        _recipe_types_set = {"recipe", "recipetag", "inputrecipe",
                             "inputrecipetag"}
        for edge in graph.edges:
            if edge.id in problem_edge_ids:
                continue  # already flagged
            src_t = node_type_map.get(edge.source)
            tgt_t = node_type_map.get(edge.target)
            # Only flag edges between meaningful node types
            if (src_t in _recipe_types_set or src_t == "input") and \
               (tgt_t in _recipe_types_set or tgt_t in ("output", "requester",
                                                         "mixedoutput")):
                ef = edge_flows_result.get(edge.id)
                if not ef or ef.totalFlow < 0.001:
                    problem_edge_ids.append(edge.id)

        return SolveResponse(
            status="ok",
            machineCounts=machine_counts,
            flowsPerSecond=flows_per_second,
            bottlenecks=bottlenecks,
            warnings=warnings,
            nodeFlows=node_flows,
            edgeFlows=edge_flows_result,
            problemEdgeIds=problem_edge_ids,
        )

    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        return SolveResponse(
            status="error",
            warnings=[f"Solver error: {str(e)}",
                      f"Details: {error_detail}"]
        )
