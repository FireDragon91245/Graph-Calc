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
    
    return SolveResponse(
        status="ok" if any_ok else "error",
        machineCounts=merged_machine_counts,
        flowsPerSecond=merged_flows_per_second,
        bottlenecks=merged_bottlenecks,
        warnings=merged_warnings,
        nodeFlows=merged_node_flows,
        edgeFlows=merged_edge_flows,
    )


def solve_graph(graph: Graph, store_data: Optional[Dict] = None) -> SolveResponse:
    """
    Solve the factory graph using LP optimization with node precedence.
    
    Modes:
    - Input-constrained: Maximize output while using 100% of limited inputs
    - Output-constrained: Fulfill output demands while minimizing input
    - Both constrained: Find optimal equilibrium
    
    Recipe tags are expanded into individual independent sub-recipes using store_data.
    Each sub-recipe gets its own machine count variable and can be 0 (unused).
    Recipes are NOT constraints - they're optional processing steps.
    """
    warnings: List[str] = []
    
    # Build item name->id mapping for normalizing display names to item IDs
    name_to_id = _build_name_to_id_map(store_data)
    
    try:
        # Extract all nodes by type
        recipe_nodes = []
        input_nodes = []
        output_nodes = []
        requester_nodes = []
        
        for node in graph.nodes:
            if node.type in ["recipe", "recipetag", "inputrecipe", "inputrecipetag"]:
                recipe_nodes.append(node)
            elif node.type == "input":
                input_nodes.append(node)
            elif node.type == "output" or node.type == "mixedoutput":
                output_nodes.append(node)
            elif node.type == "requester":
                requester_nodes.append(node)
        
        # Extract all recipe instances (recipe tags get expanded into sub-recipes)
        recipes: List[RecipeInstance] = []
        for node in recipe_nodes:
            recipes.extend(_extract_recipes_from_node(node, store_data=store_data, name_to_id=name_to_id))
        
        if not recipes and not input_nodes:
            return SolveResponse(
                status="ok",
                machineCounts={},
                flowsPerSecond={},
                bottlenecks=[],
                warnings=["No recipes or inputs found in graph"]
            )
        
        # Build edge flow map with node type information
        edge_flows: List[EdgeFlow] = []
        node_type_map = {node.id: node.type for node in graph.nodes}
        
        for edge in graph.edges:
            source_handle = edge.sourceHandle or "output"
            target_handle = edge.targetHandle or "input"
            
            source_type = node_type_map.get(edge.source)
            target_type = node_type_map.get(edge.target)
            
            edge_flow = EdgeFlow(
                edge_id=edge.id,
                source_node=edge.source,
                target_node=edge.target,
                source_port=source_handle,
                target_port=target_handle
            )
            
            # Classify edge for precedence
            if source_type in ["recipe", "recipetag", "inputrecipe", "inputrecipetag"] and \
               target_type in ["recipe", "recipetag"]:
                edge_flow.is_recipe_to_recipe = True
            elif source_type in ["recipe", "recipetag", "inputrecipe", "inputrecipetag"] and \
                 target_type in ["output", "mixedoutput", "requester"]:
                edge_flow.is_recipe_to_output = True
            elif source_type == "input" and \
                 target_type in ["recipe", "recipetag"]:
                edge_flow.is_input_to_recipe = True
            
            edge_flows.append(edge_flow)
        
        # === Find connected components ===
        # Detect disconnected subgraphs early so we can solve them independently.
        adjacency: Dict[str, Set[str]] = defaultdict(set)
        all_graph_node_ids = {node.id for node in graph.nodes}
        
        for edge in graph.edges:
            adjacency[edge.source].add(edge.target)
            adjacency[edge.target].add(edge.source)
        
        # BFS to find connected components
        visited_nodes: Set[str] = set()
        components: List[Set[str]] = []
        for node_id in all_graph_node_ids:
            if node_id not in visited_nodes:
                component: Set[str] = set()
                queue = [node_id]
                while queue:
                    current = queue.pop(0)
                    if current in visited_nodes:
                        continue
                    visited_nodes.add(current)
                    component.add(current)
                    for neighbor in adjacency.get(current, set()):
                        if neighbor not in visited_nodes:
                            queue.append(neighbor)
                components.append(component)
        
        # If multiple disconnected subgraphs exist, solve each independently
        # so that infeasibility in one subgraph doesn't block others.
        if len(components) > 1:
            return _solve_components_independently(graph, store_data, components, warnings)
        
        # --- Single connected component: solve directly ---
        
        # Map each node to its component index (all component 0 for single component)
        node_to_component: Dict[str, int] = {}
        for comp_idx, comp in enumerate(components):
            for nid in comp:
                node_to_component[nid] = comp_idx
        
        # Helper: get component index for a recipe (uses parent tag node for sub-recipes)
        def _recipe_component(recipe: RecipeInstance) -> int:
            original = recipe.parent_tag_node_id or recipe.node_id
            return node_to_component.get(original, 0)
        
        # Create LP solver
        solver = pywraplp.Solver.CreateSolver("GLOP")
        if not solver:
            return SolveResponse(
                status="error",
                warnings=["Failed to create LP solver"]
            )
        
        # Decision variables: machine count for each recipe (non-negative)
        recipe_vars: Dict[str, pywraplp.Variable] = {}
        for recipe in recipes:
            var_name = f"machines_{recipe.node_id}"
            # Apply upper bound if this is an inputrecipe with a multiplier constraint
            upper_bound = recipe.max_machines if recipe.max_machines is not None else solver.infinity()
            recipe_vars[recipe.node_id] = solver.NumVar(0, upper_bound, var_name)
        
        # Build a map of node_id -> recipe for quick lookup
        recipe_map = {recipe.node_id: recipe for recipe in recipes}
        
        # === Validate edge item types to detect mismatches ===
        # Check that items provided by source nodes match what target recipe
        # ports expect.  When an Input node provides item X but connects to a
        # recipe port expecting item Y, the recipe cannot obtain its required
        # input.  Recipes with any mismatched input port are constrained to 0
        # machines so they cannot run.
        node_by_id = {node.id: node for node in graph.nodes}
        
        # Build: visual node ID -> list of recipe instances
        # Regular recipe: node_id -> [recipe]
        # Tag sub-recipes: parent_tag_node_id -> [sub1, sub2, ...]
        visual_to_recipes: Dict[str, List[RecipeInstance]] = defaultdict(list)
        for recipe in recipes:
            visual_id = recipe.parent_tag_node_id or recipe.node_id
            visual_to_recipes[visual_id].append(recipe)
        
        # Incoming edges per target node: target_id -> [(source_id, srcHandle, tgtHandle)]
        edges_by_target: Dict[str, List[Tuple[str, str, str]]] = defaultdict(list)
        for edge in graph.edges:
            edges_by_target[edge.target].append(
                (edge.source, edge.sourceHandle or "output", edge.targetHandle or "input")
            )
        
        mismatched_visual_nodes: Set[str] = set()  # visual node IDs with mismatched inputs
        
        for visual_node_id, recipe_list in visual_to_recipes.items():
            for recipe in recipe_list:
                for inp in recipe.inputs:
                    if inp.get("isMixed"):
                        continue
                    port_id = inp.get("id")
                    needed_item = inp.get("itemId") or inp.get("refId")
                    if not port_id or not needed_item:
                        continue
                    
                    target_handle = f"input-{port_id}"
                    
                    for (src_id, src_handle, tgt_handle) in edges_by_target.get(visual_node_id, []):
                        if tgt_handle != target_handle:
                            continue
                        
                        # Determine what item the source provides on this handle
                        provided_item = None
                        src_type = node_type_map.get(src_id)
                        
                        if src_type == "input":
                            src_node = node_by_id.get(src_id)
                            if src_node and src_node.data:
                                entry_id = src_handle.replace("output-", "")
                                for ie in src_node.data.get("items", []):
                                    if str(ie.get("id")) == entry_id:
                                        provided_item = ie.get("itemId")
                                        break
                        elif src_type in ("recipe", "recipetag", "inputrecipe", "inputrecipetag"):
                            # Check all sub-recipes of the source visual node
                            for src_recipe in visual_to_recipes.get(src_id, []):
                                out_port_id = src_handle.replace("output-", "")
                                for out in src_recipe.outputs:
                                    if out.get("id") == out_port_id:
                                        provided_item = out.get("itemId")
                                        break
                                if provided_item:
                                    break
                        
                        if provided_item and needed_item and provided_item != needed_item:
                            src_node_obj = node_by_id.get(src_id)
                            if src_type == "input":
                                src_desc = f"Input node ({provided_item})"
                            elif src_node_obj and src_node_obj.data:
                                src_desc = src_node_obj.data.get("title", src_id)
                            else:
                                src_desc = src_id
                            warnings.append(
                                f"Edge item mismatch: '{src_desc}' provides "
                                f"'{provided_item}' but '{recipe.name}' expects "
                                f"'{needed_item}' at input port '{port_id}'. "
                                f"Recipe '{recipe.name}' is disabled."
                            )
                            mismatched_visual_nodes.add(visual_node_id)
        
        # Constrain ALL recipe instances under mismatched visual nodes to 0
        for recipe in recipes:
            visual_id = recipe.parent_tag_node_id or recipe.node_id
            if visual_id in mismatched_visual_nodes:
                solver.Add(recipe_vars[recipe.node_id] == 0)
        
        # Track mixed input connections: for each recipe with mixed inputs,
        # track which items can flow into it based on edges
        mixed_input_flows: Dict[str, Dict[str, pywraplp.LinearExpr]] = {}  # {target_node_id: {input_port_id: total_flow_expr}}
        mixed_output_flows: Dict[str, Dict[str, pywraplp.LinearExpr]] = {}  # {source_node_id: {output_port_id: total_flow_expr}}
        
        for edge in graph.edges:
            source_node_id = edge.source
            target_node_id = edge.target
            source_handle = edge.sourceHandle or "output"
            target_handle = edge.targetHandle or "input"
            
            # Check if source node has this output as a mixed output
            source_recipe = recipe_map.get(source_node_id)
            if source_recipe:
                source_output_id = source_handle.replace("output-", "")
                for output in source_recipe.outputs:
                    if output.get("id") == source_output_id and output.get("isMixed"):
                        # This edge flows FROM a mixed output!
                        # Find the target to see what consumes it
                        target_recipe = recipe_map.get(target_node_id)
                        if target_recipe:
                            target_input_id = target_handle.replace("input-", "")
                            for input_item in target_recipe.inputs:
                                if input_item.get("id") == target_input_id:
                                    # Calculate the consumption rate at target
                                    amount = float(input_item.get("amountPerCycle", input_item.get("amount", 0)))
                                    rate = amount / target_recipe.time_seconds
                                    
                                    # Add this consumption to the mixed output's total
                                    key = f"{source_node_id}_{source_output_id}"
                                    if key not in mixed_output_flows:
                                        mixed_output_flows[key] = 0
                                    mixed_output_flows[key] += recipe_vars[target_node_id] * rate
                                    break
            
            # Check if target node has this input as a mixed input
            target_recipe = recipe_map.get(target_node_id)
            if target_recipe:
                # Find the target input port
                target_input_id = target_handle.replace("input-", "")
                for input_item in target_recipe.inputs:
                    if input_item.get("id") == target_input_id and input_item.get("isMixed"):
                        # This edge connects to a mixed input!
                        # Find the source output to determine what item flows
                        source_recipe = recipe_map.get(source_node_id)
                        if source_recipe:
                            source_output_id = source_handle.replace("output-", "")
                            for output in source_recipe.outputs:
                                if output.get("id") == source_output_id:
                                    # Calculate the flow rate from source
                                    amount = float(output.get("amountPerCycle", output.get("amount", 0)))
                                    probability = float(output.get("probability", 1.0))
                                    rate = amount * probability / source_recipe.time_seconds
                                    
                                    # Add this flow to the mixed input's total
                                    key = f"{target_node_id}_{target_input_id}"
                                    if key not in mixed_input_flows:
                                        mixed_input_flows[key] = 0
                                    mixed_input_flows[key] += recipe_vars[source_node_id] * rate
                                    break
        
        # Create constraints for mixed inputs: total input flow must equal consumption
        # (can't waste incoming items)
        for key, total_input_flow in mixed_input_flows.items():
            parts = key.split("_", 1)
            if len(parts) == 2:
                target_node_id, input_id = parts
                target_recipe = recipe_map.get(target_node_id)
                if target_recipe:
                    # Find the consumption rate for this mixed input
                    for input_item in target_recipe.inputs:
                        if input_item.get("id") == input_id:
                            amount = float(input_item.get("amountPerCycle", input_item.get("amount", 0)))
                            consumption_rate = amount / target_recipe.time_seconds
                            # Constraint: total input flow == consumption
                            solver.Add(total_input_flow == recipe_vars[target_node_id] * consumption_rate)
                            break
        
        # Create constraints for mixed outputs: production must equal outflow
        # (can't let stuff vanish - everything must be consumed somewhere)
        for key, total_outflow in mixed_output_flows.items():
            parts = key.split("_", 1)
            if len(parts) == 2:
                source_node_id, output_id = parts
                source_recipe = recipe_map.get(source_node_id)
                if source_recipe:
                    # Find the production rate for this mixed output
                    for output in source_recipe.outputs:
                        if output.get("id") == output_id:
                            amount = float(output.get("amountPerCycle", output.get("amount", 0)))
                            probability = float(output.get("probability", 1.0))
                            production_rate = amount * probability / source_recipe.time_seconds
                            # Constraint: production == total outflow (nothing can vanish)
                            solver.Add(recipe_vars[source_node_id] * production_rate == total_outflow)
                            break
        
        # Track input limits and output demands PER COMPONENT
        # Also keep global aggregates for the objective mode decision
        comp_input_limits: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        comp_output_demands: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        input_limits: Dict[str, float] = {}
        output_demands: Dict[str, float] = {}
        
        # Extract input limits
        for node in input_nodes:
            if node.data:
                comp_idx = node_to_component.get(node.id, 0)
                items_list = node.data.get("items", [])
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    mode = item_entry.get("mode", "infinite")
                    limit = item_entry.get("limit")
                    
                    if item_id and mode == "limit" and limit is not None:
                        comp_input_limits[comp_idx][item_id] += float(limit)
                        if item_id not in input_limits:
                            input_limits[item_id] = 0
                        input_limits[item_id] += float(limit)
        
        # Extract output demands from requester nodes
        for node in requester_nodes:
            if node.data:
                comp_idx = node_to_component.get(node.id, 0)
                requests = node.data.get("requests", [])
                for request in requests:
                    item_id = request.get("itemId")
                    target = request.get("targetPerSecond")
                    
                    if item_id and target is not None:
                        comp_output_demands[comp_idx][item_id] += float(target)
                        if item_id not in output_demands:
                            output_demands[item_id] = 0
                        output_demands[item_id] += float(target)
        
        # Collect items that flow into output nodes (these are "maximize" sinks,
        # NOT hard demands).  Output nodes receiving 0 is perfectly fine.
        comp_output_sink_items: Dict[int, Set[str]] = defaultdict(set)
        for node in output_nodes:
            if node.data:
                comp_idx = node_to_component.get(node.id, 0)
                items_list = node.data.get("items", [])
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    if item_id:
                        comp_output_sink_items[comp_idx].add(item_id)
        
        # Build flow balance constraints for each item PER COMPONENT
        # Track production and consumption per (component, item) so disconnected
        # subgraphs using the same item don't get linked together.
        comp_item_production: Dict[int, Dict[str, pywraplp.LinearExpr]] = defaultdict(dict)
        comp_item_consumption: Dict[int, Dict[str, pywraplp.LinearExpr]] = defaultdict(dict)
        
        # Also build global aggregates (used by results / bottleneck logic later)
        item_production: Dict[str, pywraplp.LinearExpr] = {}
        item_consumption: Dict[str, pywraplp.LinearExpr] = {}
        
        # Calculate production from recipes
        for recipe in recipes:
            comp_idx = _recipe_component(recipe)
            for output in recipe.outputs:
                item_id = output.get("itemId") or output.get("name")
                if not item_id:
                    continue
                # Normalize display names to item IDs
                item_id = name_to_id.get(item_id, item_id)
                
                # For mixed outputs, we can't track by specific item name
                # Skip them from item balance (edges determine actual flow)
                if output.get("isMixed"):
                    continue
                    
                amount = float(output.get("amountPerCycle", output.get("amount", 0)))
                probability = float(output.get("probability", 1.0))
                rate = amount * probability / recipe.time_seconds
                
                if item_id not in comp_item_production[comp_idx]:
                    comp_item_production[comp_idx][item_id] = 0
                comp_item_production[comp_idx][item_id] += recipe_vars[recipe.node_id] * rate
                
                if item_id not in item_production:
                    item_production[item_id] = 0
                item_production[item_id] += recipe_vars[recipe.node_id] * rate
        
        # Calculate consumption from recipes
        for recipe in recipes:
            comp_idx = _recipe_component(recipe)
            for input_item in recipe.inputs:
                # Skip mixed inputs - their items are determined by edges, not by name
                if input_item.get("isMixed"):
                    continue
                    
                item_id = input_item.get("itemId") or input_item.get("refId") or input_item.get("name")
                if not item_id:
                    continue
                # Normalize display names to item IDs
                item_id = name_to_id.get(item_id, item_id)
                
                amount = float(input_item.get("amountPerCycle", input_item.get("amount", 0)))
                rate = amount / recipe.time_seconds
                
                if item_id not in comp_item_consumption[comp_idx]:
                    comp_item_consumption[comp_idx][item_id] = 0
                comp_item_consumption[comp_idx][item_id] += recipe_vars[recipe.node_id] * rate
                
                if item_id not in item_consumption:
                    item_consumption[item_id] = 0
                item_consumption[item_id] += recipe_vars[recipe.node_id] * rate
        
        # Determine constraint mode
        # Check if there are inputrecipe nodes with multiplier limits (these ARE input constraints)
        has_inputrecipe_constraints = any(recipe.max_machines is not None for recipe in recipes)
        has_input_constraints = len(input_limits) > 0 or has_inputrecipe_constraints
        has_output_demands = len(output_demands) > 0
        
        # Apply constraints PER COMPONENT so disconnected subgraphs are independent
        for comp_idx in range(len(components)):
            c_production = comp_item_production.get(comp_idx, {})
            c_consumption = comp_item_consumption.get(comp_idx, {})
            c_limits = comp_input_limits.get(comp_idx, {})
            c_demands = comp_output_demands.get(comp_idx, {})
            
            comp_all_items = set(list(c_production.keys()) + list(c_consumption.keys()) +
                                 list(c_limits.keys()) + list(c_demands.keys()))
            
            for item_id in comp_all_items:
                production = c_production.get(item_id, 0)
                consumption = c_consumption.get(item_id, 0)
                
                # Input limit constraints
                if item_id in c_limits:
                    # Total consumption cannot exceed input limit
                    solver.Add(consumption <= c_limits[item_id])
                
                # Does this item flow into an output node (maximize sink)?
                has_output_sink = item_id in comp_output_sink_items.get(comp_idx, set())
                
                # Flow balance constraints:
                # Items can be intermediate (produced & consumed by recipes),
                # demanded externally (by requesters), or both.
                # Output sinks (output nodes) are soft goals - they consume
                # whatever surplus is available but never cause infeasibility.
                # Requesters (demands) always have priority over output sinks.
                has_production = item_id in c_production
                has_consumption = item_id in c_consumption
                has_demand = item_id in c_demands
                
                if has_production and has_consumption and has_demand:
                    # Intermediate item WITH external demand (e.g. requester):
                    # Net surplus must satisfy the demand.
                    solver.Add(production >= consumption + c_demands[item_id])
                elif has_production and has_consumption and has_output_sink:
                    # Intermediate item with output sink: allow surplus.
                    # The surplus flows to the output node (maximized by objective).
                    solver.Add(production >= consumption)
                elif has_production and has_consumption:
                    # Pure intermediate item: strict mass balance (no waste)
                    solver.Add(production == consumption)
                elif has_production and not has_consumption and has_demand:
                    # Final output with demand: production must meet demand
                    solver.Add(production >= c_demands[item_id])
                elif has_production and not has_consumption:
                    # Only produced, not consumed - goes to output sinks (no constraint needed)
                    pass
                elif not has_production and has_demand:
                    # Demanded but not produced by any recipe in this component - warn later
                    pass
                # Items only consumed come from Input nodes (infinite supply) - no constraint
        
        # Build global all_items set for results calculation
        all_items = set(list(item_production.keys()) + list(item_consumption.keys()) + 
                       list(input_limits.keys()) + list(output_demands.keys()))
        
        # Compute item depth (distance from raw inputs through recipe chain)
        # Used to prioritize later-stage (more complex) output nodes over earlier ones.
        # Deeper items get much higher weight so they consume ingredients first.
        comp_item_depth: Dict[int, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for comp_idx in range(len(components)):
            # Items from input nodes start at depth 0
            for node in input_nodes:
                if node_to_component.get(node.id, 0) == comp_idx and node.data:
                    for item_entry in node.data.get("items", []):
                        iid = item_entry.get("itemId")
                        if iid:
                            comp_item_depth[comp_idx][iid] = 0
            
            # Iteratively propagate depths through recipes
            changed = True
            while changed:
                changed = False
                for recipe in recipes:
                    if _recipe_component(recipe) != comp_idx:
                        continue
                    max_input_depth = -1
                    for inp in recipe.inputs:
                        iid = inp.get("itemId") or inp.get("refId") or inp.get("name")
                        if iid:
                            iid = name_to_id.get(iid, iid)
                            if iid in comp_item_depth[comp_idx]:
                                max_input_depth = max(max_input_depth, comp_item_depth[comp_idx][iid])
                    if max_input_depth < 0:
                        max_input_depth = 0
                    new_depth = max_input_depth + 1
                    for out in recipe.outputs:
                        iid = out.get("itemId") or out.get("name")
                        if iid:
                            iid = name_to_id.get(iid, iid)
                            if iid not in comp_item_depth[comp_idx] or comp_item_depth[comp_idx][iid] < new_depth:
                                comp_item_depth[comp_idx][iid] = new_depth
                                changed = True
        
        # Create surplus variables for output-sink items.
        # These represent the net flow going to output nodes (production - consumption - demand).
        # Surplus is always >= 0 (output nodes can receive 0 without causing infeasibility).
        output_surplus_vars: List[Tuple] = []  # [(var, depth_weight), ...]
        has_output_sinks = False
        for comp_idx in range(len(components)):
            c_sinks = comp_output_sink_items.get(comp_idx, set())
            c_production = comp_item_production.get(comp_idx, {})
            c_consumption = comp_item_consumption.get(comp_idx, {})
            c_demands = comp_output_demands.get(comp_idx, {})
            
            for item_id in c_sinks:
                if item_id in c_production:
                    has_output_sinks = True
                    surplus = solver.NumVar(0, solver.infinity(), f"surplus_{comp_idx}_{item_id}")
                    prod = c_production.get(item_id, 0)
                    demand = c_demands.get(item_id, 0)
                    has_cons = item_id in c_consumption
                    has_dem = demand > 0
                    
                    # surplus <= net production available for the output node
                    if has_cons and has_dem:
                        solver.Add(surplus <= prod - c_consumption[item_id] - demand)
                    elif has_cons:
                        solver.Add(surplus <= prod - c_consumption[item_id])
                    elif has_dem:
                        solver.Add(surplus <= prod - demand)
                    else:
                        solver.Add(surplus <= prod)
                    
                    # Depth-weighted priority: deeper (more complex) items get
                    # exponentially higher weight so they always take precedence.
                    depth = comp_item_depth.get(comp_idx, {}).get(item_id, 0)
                    weight = 1000.0 ** max(depth, 1)
                    output_surplus_vars.append((surplus, weight))
        
        # Define objective based on constraint mode
        objective = solver.Objective()
        
        if has_output_demands and not has_input_constraints:
            # Output-constrained (no input limits): Minimize total machine count.
            # Output sinks get whatever surplus arises from meeting demands.
            for recipe_node_id, var in recipe_vars.items():
                objective.SetCoefficient(var, 1)
            objective.SetMinimization()
        
        elif has_input_constraints and not has_output_demands:
            # Input-constrained: Maximize throughput within input upper bounds.
            has_inputrecipe_vars = False
            for recipe in recipes:
                if recipe.max_machines is not None:
                    objective.SetCoefficient(recipe_vars[recipe.node_id], 10000)
                    has_inputrecipe_vars = True
                else:
                    objective.SetCoefficient(recipe_vars[recipe.node_id], 1)
            
            # Add depth-weighted surplus terms to prioritize deeper output sinks
            for surplus_var, weight in output_surplus_vars:
                objective.SetCoefficient(surplus_var, weight)
            
            objective.SetMaximization()
        
        elif has_input_constraints and has_output_demands:
            # Both constrained: Meet demands (hard constraints already in place),
            # then maximize output-sink surplus within input limits.
            # Demands always have priority over output nodes.
            if has_output_sinks:
                # Maximize depth-weighted surplus going to output nodes.
                # Small recipe penalty prevents unnecessary machine usage when
                # surplus is zero (tie-breaking towards fewer machines).
                for recipe_node_id, var in recipe_vars.items():
                    objective.SetCoefficient(var, -0.001)
                for surplus_var, weight in output_surplus_vars:
                    objective.SetCoefficient(surplus_var, weight)
                objective.SetMaximization()
            else:
                # No output sinks: just minimize machines to meet demands
                for recipe_node_id, var in recipe_vars.items():
                    objective.SetCoefficient(var, 1)
                objective.SetMinimization()
        
        else:
            # No constraints: Just balance the system
            for recipe_node_id, var in recipe_vars.items():
                objective.SetCoefficient(var, 1)
            objective.SetMinimization()
        
        # Solve
        status = solver.Solve()
        
        if status != pywraplp.Solver.OPTIMAL and status != pywraplp.Solver.FEASIBLE:
            status_msg = "infeasible" if status == pywraplp.Solver.INFEASIBLE else "unbounded" if status == pywraplp.Solver.UNBOUNDED else "error"
            warnings.append(f"No feasible solution found ({status_msg}). Check constraints - demands may exceed supply limits.")
            return SolveResponse(
                status="error",
                warnings=warnings
            )
        
        # Extract results
        machine_counts: Dict[str, float] = {}
        flows_per_second: Dict[str, float] = {}
        
        for recipe in recipes:
            machine_count = recipe_vars[recipe.node_id].solution_value()
            if machine_count > 0.001:  # Only include if meaningful
                machine_counts[recipe.name] = round(machine_count, 3)
        
        # Calculate actual flows (using normalized item IDs)
        for item_id in all_items:
            production = 0
            for recipe in recipes:
                machine_count = recipe_vars[recipe.node_id].solution_value()
                for output in recipe.outputs:
                    out_item_id = output.get("itemId") or output.get("name")
                    if out_item_id:
                        out_item_id = name_to_id.get(out_item_id, out_item_id)
                    if out_item_id == item_id:
                        amount = float(output.get("amountPerCycle", output.get("amount", 0)))
                        probability = float(output.get("probability", 1.0))
                        rate = amount * probability / recipe.time_seconds
                        production += machine_count * rate
            
            if production > 0.001:
                flows_per_second[item_id] = round(production, 3)
        
        # Identify bottlenecks (items at their limit)
        bottlenecks: List[str] = []
        for item_id, limit in input_limits.items():
            if item_id in item_consumption:
                consumption_vars = []
                for recipe in recipes:
                    for input_item in recipe.inputs:
                        in_item_id = input_item.get("itemId") or input_item.get("refId") or input_item.get("name")
                        if in_item_id:
                            in_item_id = name_to_id.get(in_item_id, in_item_id)
                        if in_item_id == item_id:
                            machine_count = recipe_vars[recipe.node_id].solution_value()
                            amount = float(input_item.get("amountPerCycle", input_item.get("amount", 0)))
                            rate = amount / recipe.time_seconds
                            consumption_vars.append(machine_count * rate)
                
                total_consumption = sum(consumption_vars)
                if total_consumption >= limit * 0.95:  # Within 5% of limit
                    bottlenecks.append(item_id)
        
        # Build per-component flows_per_second for node-level calculations
        comp_flows_per_second: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        comp_consumption_solved: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for recipe in recipes:
            comp_idx = _recipe_component(recipe)
            machine_count = recipe_vars[recipe.node_id].solution_value()
            if machine_count < 0.001:
                continue
            for output in recipe.outputs:
                out_item_id = output.get("itemId") or output.get("name")
                if not out_item_id:
                    continue
                out_item_id = name_to_id.get(out_item_id, out_item_id)
                amount = float(output.get("amountPerCycle", output.get("amount", 0)))
                probability = float(output.get("probability", 1.0))
                rate = machine_count * amount * probability / recipe.time_seconds
                if rate > 0.001:
                    comp_flows_per_second[comp_idx][out_item_id] += rate
            for inp in recipe.inputs:
                if inp.get("isMixed"):
                    continue
                in_item_id = inp.get("itemId") or inp.get("refId") or inp.get("name")
                if not in_item_id:
                    continue
                in_item_id = name_to_id.get(in_item_id, in_item_id)
                amount = float(inp.get("amountPerCycle", inp.get("amount", 0)))
                rate = machine_count * amount / recipe.time_seconds
                if rate > 0.001:
                    comp_consumption_solved[comp_idx][in_item_id] += rate
        for ci in comp_flows_per_second:
            for iid in comp_flows_per_second[ci]:
                comp_flows_per_second[ci][iid] = round(comp_flows_per_second[ci][iid], 3)
        for ci in comp_consumption_solved:
            for iid in comp_consumption_solved[ci]:
                comp_consumption_solved[ci][iid] = round(comp_consumption_solved[ci][iid], 3)
        
        # Net production per component = production - internal recipe consumption
        # Used for requester/output nodes that consume the net surplus
        comp_net_production: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for ci in comp_flows_per_second:
            for iid in comp_flows_per_second[ci]:
                net = comp_flows_per_second[ci][iid] - comp_consumption_solved[ci].get(iid, 0)
                comp_net_production[ci][iid] = round(max(net, 0), 3)

        # Add warnings about unmet demands (per-component)
        for comp_idx in range(len(components)):
            c_demands = comp_output_demands.get(comp_idx, {})
            comp_fps = comp_flows_per_second.get(comp_idx, {})
            for item_id, demand in c_demands.items():
                actual = comp_fps.get(item_id, 0)
                if actual < demand * 0.95:  # More than 5% short
                    warnings.append(f"Demand for {item_id} ({demand}/s) not fully met (producing {actual}/s)")

        # Calculate detailed node flows
        from app.api.models import NodeFlowData, EdgeFlowData
        node_flows: Dict[str, NodeFlowData] = {}
        
        # Process recipe nodes
        for recipe in recipes:
            machine_count = recipe_vars[recipe.node_id].solution_value()
            if machine_count < 0.001:
                continue
            
            rounded_machine_count = round(machine_count, 3)
            node_data = NodeFlowData(
                machineCount=rounded_machine_count,
                recipeRuns={recipe.recipe_id: rounded_machine_count}
            )
            
            # Calculate input flows for this node (normalize item IDs)
            for input_item in recipe.inputs:
                item_id = input_item.get("itemId") or input_item.get("refId") or input_item.get("name")
                if item_id:
                    item_id = name_to_id.get(item_id, item_id)
                    amount = float(input_item.get("amountPerCycle", input_item.get("amount", 0)))
                    rate = machine_count * amount / recipe.time_seconds
                    if rate > 0.001:
                        node_data.inputFlows[item_id] = round(node_data.inputFlows.get(item_id, 0) + rate, 3)
                        node_data.totalInput += rate
            
            # Calculate output flows for this node (normalize item IDs)
            for output in recipe.outputs:
                item_id = output.get("itemId") or output.get("name")
                if item_id:
                    item_id = name_to_id.get(item_id, item_id)
                    amount = float(output.get("amountPerCycle", output.get("amount", 0)))
                    probability = float(output.get("probability", 1.0))
                    rate = machine_count * amount * probability / recipe.time_seconds
                    if rate > 0.001:
                        node_data.outputFlows[item_id] = round(node_data.outputFlows.get(item_id, 0) + rate, 3)
                        node_data.totalOutput += rate
            
            node_data.totalInput = round(node_data.totalInput, 3)
            node_data.totalOutput = round(node_data.totalOutput, 3)
            
            # For recipe tag nodes, we need to find the original node ID
            original_node_id = recipe.parent_tag_node_id or recipe.node_id
            
            if original_node_id not in node_flows:
                node_flows[original_node_id] = node_data
            else:
                # Sum up for recipe tags
                existing = node_flows[original_node_id]
                existing.machineCount = round((existing.machineCount or 0) + node_data.machineCount, 3)
                for recipe_id, run_count in node_data.recipeRuns.items():
                    existing.recipeRuns[recipe_id] = round(existing.recipeRuns.get(recipe_id, 0) + run_count, 3)
                for item_id, rate in node_data.inputFlows.items():
                    existing.inputFlows[item_id] = round(existing.inputFlows.get(item_id, 0) + rate, 3)
                for item_id, rate in node_data.outputFlows.items():
                    existing.outputFlows[item_id] = round(existing.outputFlows.get(item_id, 0) + rate, 3)
                existing.totalInput = round(existing.totalInput + node_data.totalInput, 3)
                existing.totalOutput = round(existing.totalOutput + node_data.totalOutput, 3)
        
        # Process input nodes (scoped to same connected component)
        for node in input_nodes:
            if node.data:
                node_data = NodeFlowData()
                items_list = node.data.get("items", [])
                node_comp = node_to_component.get(node.id, 0)
                
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    if item_id and item_id in item_consumption:
                        # Calculate how much is being consumed from this input
                        # Only count recipes in the same connected component
                        consumed = 0
                        for recipe in recipes:
                            if _recipe_component(recipe) != node_comp:
                                continue
                            machine_count = recipe_vars[recipe.node_id].solution_value()
                            for input_item in recipe.inputs:
                                in_item_id = input_item.get("itemId") or input_item.get("refId") or input_item.get("name")
                                if in_item_id:
                                    in_item_id = name_to_id.get(in_item_id, in_item_id)
                                if in_item_id == item_id:
                                    amount = float(input_item.get("amountPerCycle", input_item.get("amount", 0)))
                                    rate = machine_count * amount / recipe.time_seconds
                                    consumed += rate
                        
                        if consumed > 0.001:
                            node_data.outputFlows[item_id] = round(consumed, 3)
                            node_data.totalOutput += consumed
                
                node_data.totalOutput = round(node_data.totalOutput, 3)
                if node_data.totalOutput > 0:
                    node_flows[node.id] = node_data
        
        # Process output nodes (scoped to same connected component)
        # Output nodes show the NET surplus available (production - internal recipe consumption - demands).
        # When multiple output nodes consume the same item, they must SPLIT the
        # available surplus — not each independently read the full pool.
        # Deeper items (more processing) get priority: the deepest output node
        # gets its fill first, then the next-deepest, etc.
        
        # Step 1: Group output nodes by (component, item_id) and sort by depth (deepest first)
        from collections import defaultdict as _dd
        output_node_groups: Dict[Tuple[int, str], List[GraphNode]] = _dd(list)
        for node in output_nodes:
            if node.data:
                node_comp = node_to_component.get(node.id, 0)
                items_list = node.data.get("items", [])
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    if item_id:
                        output_node_groups[(node_comp, item_id)].append(node)
        
        # Step 2: For each (component, item), distribute the surplus pool
        # Track remaining surplus per (component, item) after each allocation
        remaining_surplus: Dict[Tuple[int, str], float] = {}
        for (comp_idx_key, item_id_key), nodes_list in output_node_groups.items():
            comp_net = comp_net_production.get(comp_idx_key, {})
            available = comp_net.get(item_id_key, 0)
            remaining_surplus[(comp_idx_key, item_id_key)] = available
        
        # Sort output nodes by item depth (deepest first) for priority allocation
        all_output_allocations: List[Tuple[GraphNode, str, int, float]] = []  # (node, item_id, depth, comp_idx)
        for (comp_idx_key, item_id_key), nodes_list in output_node_groups.items():
            depth = comp_item_depth.get(comp_idx_key, {}).get(item_id_key, 0)
            for n in nodes_list:
                all_output_allocations.append((n, item_id_key, depth, comp_idx_key))
        # Sort by depth descending (deepest items allocated first)
        all_output_allocations.sort(key=lambda x: -x[2])
        
        # Step 3: Allocate surplus to output nodes in priority order
        output_node_flows_map: Dict[str, Dict[str, float]] = _dd(lambda: _dd(float))  # node_id -> item_id -> rate
        for (node, item_id_alloc, depth, comp_idx_key) in all_output_allocations:
            key = (comp_idx_key, item_id_alloc)
            avail = remaining_surplus.get(key, 0)
            if avail > 0.001:
                output_node_flows_map[node.id][item_id_alloc] += avail
                remaining_surplus[key] = 0  # This output node takes all available surplus for this item
        
        # Step 4: Build NodeFlowData for output nodes
        for node in output_nodes:
            if node.id in output_node_flows_map:
                node_data = NodeFlowData()
                for item_id_alloc, rate in output_node_flows_map[node.id].items():
                    if rate > 0.001:
                        node_data.inputFlows[item_id_alloc] = round(rate, 3)
                        node_data.totalInput += rate
                node_data.totalInput = round(node_data.totalInput, 3)
                if node_data.totalInput > 0:
                    node_flows[node.id] = node_data
        
        # Process requester nodes (scoped to same connected component)
        # Use net production (production - internal consumption) so that items
        # which are both intermediate AND demanded show the correct surplus flow
        for node in requester_nodes:
            if node.data:
                node_data = NodeFlowData()
                requests = node.data.get("requests", [])
                node_comp = node_to_component.get(node.id, 0)
                comp_net = comp_net_production.get(node_comp, {})
                
                for request in requests:
                    item_id = request.get("itemId")
                    target = request.get("targetPerSecond")
                    if item_id:
                        # Use the net production available for this item.
                        # For items only produced (not consumed internally), this
                        # equals total production. For intermediate items with
                        # external demand, this is the surplus after recipes.
                        net = comp_net.get(item_id, 0)
                        # Cap at demand if specified (requesters shouldn't show
                        # more than demanded; surplus stays in the system)
                        if target is not None and float(target) > 0:
                            rate = min(net, float(target))
                        else:
                            rate = net
                        if rate > 0.001:
                            node_data.inputFlows[item_id] = round(rate, 3)
                            node_data.totalInput += rate
                
                node_data.totalInput = round(node_data.totalInput, 3)
                if node_data.totalInput > 0:
                    node_flows[node.id] = node_data
        
        # Calculate edge flows
        edge_flows_map: Dict[str, EdgeFlowData] = {}
        
        # Build a map of port to item
        # For recipe tag sub-recipes, map ports to the PARENT tag node ID
        # so edges (which reference the tag node) can find the items
        port_to_item: Dict[Tuple[str, str], Set[str]] = {}  # (node_id, port_id) -> set of item_ids
        
        # Build lookup from tag node ID -> tag node port definitions
        # This is needed to correctly map sub-recipe ports to the tag node's
        # collapsed/pattern ports (e.g. when recipes have different output counts
        # and get collapsed into a single Mixed Output)
        tag_node_port_defs: Dict[str, Dict] = {}
        for node in graph.nodes:
            if node.type in ["recipetag", "inputrecipetag"] and node.data:
                tag_node_port_defs[node.id] = {
                    "inputs": node.data.get("inputs", []),
                    "outputs": node.data.get("outputs", []),
                }
        
        for recipe in recipes:
            # Use parent tag node ID for sub-recipes so edge lookups work
            display_node_id = recipe.parent_tag_node_id or recipe.node_id
            
            # Check if this is a sub-recipe of a recipe tag node
            tag_ports = tag_node_port_defs.get(recipe.parent_tag_node_id) if recipe.parent_tag_node_id else None
            
            if tag_ports:
                # --- Recipe tag sub-recipe: map ports to tag node's port definitions ---
                # The tag node's ports may be collapsed (e.g. 4 recipe outputs -> 1 Mixed Output)
                # so we can't use the store recipe's port IDs directly.
                tag_inputs = tag_ports["inputs"]
                tag_outputs = tag_ports["outputs"]
                
                # Map sub-recipe INPUTS to tag node input ports
                if len(tag_inputs) == len(recipe.inputs):
                    # Same count: positional mapping (sub-recipe input[i] -> tag input[i])
                    for idx, input_item in enumerate(recipe.inputs):
                        item_id = input_item.get("itemId") or input_item.get("refId") or input_item.get("name")
                        if item_id:
                            item_id = name_to_id.get(item_id, item_id)
                            tag_port_id = tag_inputs[idx].get("id", f"i{idx+1}")
                            key = (display_node_id, f"input-{tag_port_id}")
                            port_to_item.setdefault(key, set()).add(item_id)
                else:
                    # Different count (collapsed): fixed ports by ID match, rest to mixed
                    fixed_input_map = {}
                    mixed_input_ports = []
                    for tp in tag_inputs:
                        if not tp.get("isMixed") and tp.get("fixedRefId"):
                            fixed_input_map[tp["fixedRefId"]] = tp
                        elif tp.get("isMixed"):
                            mixed_input_ports.append(tp)
                    
                    for input_item in recipe.inputs:
                        item_id = input_item.get("itemId") or input_item.get("refId") or input_item.get("name")
                        if not item_id:
                            continue
                        item_id = name_to_id.get(item_id, item_id)
                        if item_id in fixed_input_map:
                            tag_port_id = fixed_input_map[item_id]["id"]
                        elif mixed_input_ports:
                            tag_port_id = mixed_input_ports[0]["id"]
                        else:
                            continue
                        key = (display_node_id, f"input-{tag_port_id}")
                        port_to_item.setdefault(key, set()).add(item_id)
                
                # Map sub-recipe OUTPUTS to tag node output ports
                if len(tag_outputs) == len(recipe.outputs):
                    # Same count: positional mapping (sub-recipe output[i] -> tag output[i])
                    for idx, output in enumerate(recipe.outputs):
                        item_id = output.get("itemId") or output.get("name")
                        if item_id:
                            item_id = name_to_id.get(item_id, item_id)
                            tag_port_id = tag_outputs[idx].get("id", f"o{idx+1}")
                            key = (display_node_id, f"output-{tag_port_id}")
                            port_to_item.setdefault(key, set()).add(item_id)
                else:
                    # Different count (collapsed): fixed ports by itemId match, rest to mixed
                    # This is the key fix: when a tag has 1 Mixed Output but recipes have
                    # 3-4 outputs, ALL non-fixed outputs must map to that Mixed Output port
                    fixed_output_map = {}
                    mixed_output_ports = []
                    for tp in tag_outputs:
                        if not tp.get("isMixed") and tp.get("fixedRefId"):
                            fixed_output_map[tp["fixedRefId"]] = tp
                        elif tp.get("isMixed"):
                            mixed_output_ports.append(tp)
                    
                    for output in recipe.outputs:
                        item_id = output.get("itemId") or output.get("name")
                        if not item_id:
                            continue
                        item_id = name_to_id.get(item_id, item_id)
                        if item_id in fixed_output_map:
                            tag_port_id = fixed_output_map[item_id]["id"]
                        elif mixed_output_ports:
                            tag_port_id = mixed_output_ports[0]["id"]
                        else:
                            continue
                        key = (display_node_id, f"output-{tag_port_id}")
                        port_to_item.setdefault(key, set()).add(item_id)
            else:
                # --- Non-tag recipe: use port IDs directly (original behavior) ---
                for input_item in recipe.inputs:
                    port_id = input_item.get("id", "input")
                    item_id = input_item.get("itemId") or input_item.get("refId") or input_item.get("name")
                    if item_id:
                        item_id = name_to_id.get(item_id, item_id)
                        key = (display_node_id, f"input-{port_id}")
                        port_to_item.setdefault(key, set()).add(item_id)
                
                for output in recipe.outputs:
                    port_id = output.get("id", "output")
                    item_id = output.get("itemId") or output.get("name")
                    if item_id:
                        item_id = name_to_id.get(item_id, item_id)
                        key = (display_node_id, f"output-{port_id}")
                        port_to_item.setdefault(key, set()).add(item_id)
        
        # Add input/output node ports
        for node in input_nodes:
            if node.data:
                items_list = node.data.get("items", [])
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    port_id = item_entry.get("id", "output")
                    if item_id:
                        key = (node.id, f"output-{port_id}")
                        if key not in port_to_item:
                            port_to_item[key] = set()
                        port_to_item[key].add(item_id)
        
        for node in output_nodes:
            if node.data:
                items_list = node.data.get("items", [])
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    port_id = item_entry.get("id", "input")
                    if item_id:
                        key = (node.id, f"input-{port_id}")
                        if key not in port_to_item:
                            port_to_item[key] = set()
                        port_to_item[key].add(item_id)
        
        for node in requester_nodes:
            if node.data:
                requests = node.data.get("requests", [])
                for request in requests:
                    item_id = request.get("itemId")
                    port_id = request.get("id", "input")
                    if item_id:
                        key = (node.id, f"input-{port_id}")
                        if key not in port_to_item:
                            port_to_item[key] = set()
                        port_to_item[key].add(item_id)
        
        # Now calculate flows for each edge
        for edge_flow in edge_flows:
            edge_data = EdgeFlowData()
            
            source_key = (edge_flow.source_node, edge_flow.source_port)
            target_key = (edge_flow.target_node, edge_flow.target_port)
            
            # Find items that flow through this edge
            source_items = port_to_item.get(source_key, set())
            target_items = port_to_item.get(target_key, set())
            
            # Items that match on both ends
            common_items = source_items & target_items
            
            if not common_items and source_items:
                # Use source items if no common items
                common_items = source_items
            
            # Calculate flow for each item
            for item_id in common_items:
                source_rate = 0.0
                target_rate = 0.0
                
                # Get the total output rate at the source node for this item
                if edge_flow.source_node in node_flows:
                    source_node_data = node_flows[edge_flow.source_node]
                    source_rate = source_node_data.outputFlows.get(item_id, 0.0)
                
                # Get the consumption rate at the target node for this item
                if edge_flow.target_node in node_flows:
                    target_node_data = node_flows[edge_flow.target_node]
                    target_rate = target_node_data.inputFlows.get(item_id, 0.0)
                
                # Determine edge flow based on available source/target info.
                # Target consumption is preferred (correctly handles fanout where
                # one source feeds multiple targets - each edge gets its target's
                # actual consumption, not the source total).
                # Fall back to source output ONLY when the target node hasn't been
                # processed into node_flows yet (e.g. mixedoutput nodes whose flows
                # are derived from edges later).
                target_node_type = node_type_map.get(edge_flow.target_node)
                target_in_node_flows = edge_flow.target_node in node_flows
                
                if source_rate > 0.001 and target_rate > 0.001:
                    rate = min(source_rate, target_rate)
                elif target_rate > 0.001:
                    rate = target_rate
                elif source_rate > 0.001 and not target_in_node_flows and \
                     target_node_type not in ("recipe", "recipetag", "inputrecipe", "inputrecipetag",
                                              "output", "requester"):
                    # Target not yet computed (e.g. mixedoutput nodes) - use source
                    rate = source_rate
                else:
                    # Target IS in node_flows but has 0 consumption, OR target is
                    # an output/requester node with 0 allocation → edge carries nothing
                    rate = 0.0
                
                if rate > 0.001:
                    edge_data.flows[item_id] = round(rate, 3)
                    edge_data.totalFlow += rate
            
            edge_data.totalFlow = round(edge_data.totalFlow, 3)
            if edge_data.totalFlow > 0:
                edge_flows_map[edge_flow.edge_id] = edge_data

        # Populate mixed output node flows from incoming edge flows
        for node in graph.nodes:
            if node.type != "mixedoutput":
                continue

            mixed_node_data = NodeFlowData()
            incoming_edges = [edge for edge in graph.edges if edge.target == node.id]

            for edge in incoming_edges:
                edge_data = edge_flows_map.get(edge.id)
                if not edge_data:
                    continue
                for item_id, rate in edge_data.flows.items():
                    mixed_node_data.inputFlows[item_id] = round(mixed_node_data.inputFlows.get(item_id, 0) + rate, 3)
                    mixed_node_data.totalInput += rate

            mixed_node_data.totalInput = round(mixed_node_data.totalInput, 3)
            if mixed_node_data.totalInput > 0:
                node_flows[node.id] = mixed_node_data
        
        return SolveResponse(
            status="ok",
            machineCounts=machine_counts,
            flowsPerSecond=flows_per_second,
            bottlenecks=bottlenecks,
            warnings=warnings,
            nodeFlows=node_flows,
            edgeFlows=edge_flows_map
        )
    
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        return SolveResponse(
            status="error",
            warnings=[f"Solver error: {str(e)}", f"Details: {error_detail}"]
        )
