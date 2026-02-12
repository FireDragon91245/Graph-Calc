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
        
        # Track input limits and output demands
        input_limits: Dict[str, float] = {}
        output_demands: Dict[str, float] = {}
        
        # Extract input limits
        for node in input_nodes:
            if node.data:
                items_list = node.data.get("items", [])
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    mode = item_entry.get("mode", "infinite")
                    limit = item_entry.get("limit")
                    
                    if item_id and mode == "limit" and limit is not None:
                        if item_id not in input_limits:
                            input_limits[item_id] = 0
                        input_limits[item_id] += float(limit)
        
        # Extract output demands from requester nodes
        for node in requester_nodes:
            if node.data:
                requests = node.data.get("requests", [])
                for request in requests:
                    item_id = request.get("itemId")
                    target = request.get("targetPerSecond")
                    
                    if item_id and target is not None:
                        if item_id not in output_demands:
                            output_demands[item_id] = 0
                        output_demands[item_id] += float(target)
        
        # Build flow balance constraints for each item
        # Track production and consumption per item (using normalized item IDs)
        item_production: Dict[str, pywraplp.LinearExpr] = {}
        item_consumption: Dict[str, pywraplp.LinearExpr] = {}
        item_from_input: Dict[str, pywraplp.LinearExpr] = {}
        
        # Calculate production from recipes
        for recipe in recipes:
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
                
                if item_id not in item_production:
                    item_production[item_id] = 0
                item_production[item_id] += recipe_vars[recipe.node_id] * rate
        
        # Calculate consumption from recipes
        for recipe in recipes:
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
                
                if item_id not in item_consumption:
                    item_consumption[item_id] = 0
                item_consumption[item_id] += recipe_vars[recipe.node_id] * rate
        
        # Determine constraint mode
        # Check if there are inputrecipe nodes with multiplier limits (these ARE input constraints)
        has_inputrecipe_constraints = any(recipe.max_machines is not None for recipe in recipes)
        has_input_constraints = len(input_limits) > 0 or has_inputrecipe_constraints
        has_output_demands = len(output_demands) > 0
        
        # Apply constraints based on mode
        all_items = set(list(item_production.keys()) + list(item_consumption.keys()) + 
                       list(input_limits.keys()) + list(output_demands.keys()))
        
        for item_id in all_items:
            production = item_production.get(item_id, 0)
            consumption = item_consumption.get(item_id, 0)
            
            # Input limit constraints
            if item_id in input_limits:
                # Total consumption cannot exceed input limit
                solver.Add(consumption <= input_limits[item_id])
            
            # Output demand constraints
            if item_id in output_demands:
                # Production must meet demand
                solver.Add(production >= output_demands[item_id])
            
            # Flow balance constraints:
            # - Items both produced AND consumed (intermediate): strict equality
            #   (everything produced must be consumed, everything consumed must be produced)
            # - Items only produced (final outputs/byproducts): no constraint (goes to sinks)
            # - Items only consumed (from external Input nodes): no constraint (infinite supply)
            has_production = item_id in item_production
            has_consumption = item_id in item_consumption
            
            if has_production and has_consumption:
                # Intermediate item: strict mass balance
                solver.Add(production == consumption)
            elif has_production and not has_consumption:
                # Only produced, not consumed - goes to output sinks (no constraint needed)
                pass
            # Items only consumed come from Input nodes (infinite supply) - no constraint
        
        # Define objective based on constraint mode
        objective = solver.Objective()
        
        if has_output_demands and not has_input_constraints:
            # Output-constrained: Minimize total machine count (minimize input usage)
            for recipe_node_id, var in recipe_vars.items():
                objective.SetCoefficient(var, 1)
            objective.SetMinimization()
        
        elif has_input_constraints and not has_output_demands:
            # Input-constrained: Maximize inputrecipe utilization, minimize everything else
            # Force using 100% of limited inputs from Input nodes (if any)
            for item_id, limit in input_limits.items():
                if item_id in item_consumption:
                    solver.Add(item_consumption[item_id] == limit)
            
            # Maximize inputrecipe node utilization with high positive weight
            # Minimize all other recipes with small negative weight to prevent unbounded solutions
            # (recipes whose inputs come from infinite sources would otherwise go to infinity)
            has_inputrecipe_vars = False
            for recipe in recipes:
                if recipe.max_machines is not None:
                    objective.SetCoefficient(recipe_vars[recipe.node_id], 10000)  # Very high weight to maximize
                    has_inputrecipe_vars = True
                else:
                    # Small negative weight = minimize downstream recipes
                    # This ensures recipes only run as much as needed to process inputrecipe output
                    objective.SetCoefficient(recipe_vars[recipe.node_id], -0.001)
            
            # If there are no inputrecipe vars, fall back to minimizing total machines
            if not has_inputrecipe_vars:
                for recipe_node_id, var in recipe_vars.items():
                    objective.SetCoefficient(var, 1)
                objective.SetMinimization()
            else:
                objective.SetMaximization()
        
        elif has_input_constraints and has_output_demands:
            # Both constrained: Try to meet demands while respecting limits
            # Prioritize meeting demands
            for item_id, demand in output_demands.items():
                if item_id in item_production:
                    # Try to meet demand exactly
                    solver.Add(item_production[item_id] >= demand)
            
            # Minimize total machine count (efficiency)
            for recipe_node_id, var in recipe_vars.items():
                objective.SetCoefficient(var, 1)
            objective.SetMinimization()
        
        else:
            # No constraints: Just balance the system
            # Minimize total machines
            for recipe_node_id, var in recipe_vars.items():
                objective.SetCoefficient(var, 1)
            objective.SetMinimization()
        
        # Solve
        status = solver.Solve()
        
        if status != pywraplp.Solver.OPTIMAL and status != pywraplp.Solver.FEASIBLE:
            status_msg = "infeasible" if status == pywraplp.Solver.INFEASIBLE else "unbounded" if status == pywraplp.Solver.UNBOUNDED else "error"
            return SolveResponse(
                status="error",
                warnings=[f"No feasible solution found ({status_msg}). Check constraints - demands may exceed supply limits."]
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
        
        # Add warnings about unmet demands
        for item_id, demand in output_demands.items():
            if item_id in flows_per_second:
                actual = flows_per_second[item_id]
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
            
            node_data = NodeFlowData(machineCount=round(machine_count, 3))
            
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
                for item_id, rate in node_data.inputFlows.items():
                    existing.inputFlows[item_id] = round(existing.inputFlows.get(item_id, 0) + rate, 3)
                for item_id, rate in node_data.outputFlows.items():
                    existing.outputFlows[item_id] = round(existing.outputFlows.get(item_id, 0) + rate, 3)
                existing.totalInput = round(existing.totalInput + node_data.totalInput, 3)
                existing.totalOutput = round(existing.totalOutput + node_data.totalOutput, 3)
        
        # Process input nodes
        for node in input_nodes:
            if node.data:
                node_data = NodeFlowData()
                items_list = node.data.get("items", [])
                
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    if item_id and item_id in item_consumption:
                        # Calculate how much is being consumed from this input
                        consumed = 0
                        for recipe in recipes:
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
        
        # Process output nodes
        for node in output_nodes:
            if node.data:
                node_data = NodeFlowData()
                items_list = node.data.get("items", [])
                
                for item_entry in items_list:
                    item_id = item_entry.get("itemId")
                    if item_id and item_id in flows_per_second:
                        rate = flows_per_second[item_id]
                        if rate > 0.001:
                            node_data.inputFlows[item_id] = round(rate, 3)
                            node_data.totalInput += rate
                
                node_data.totalInput = round(node_data.totalInput, 3)
                if node_data.totalInput > 0:
                    node_flows[node.id] = node_data
        
        # Process requester nodes
        for node in requester_nodes:
            if node.data:
                node_data = NodeFlowData()
                requests = node.data.get("requests", [])
                
                for request in requests:
                    item_id = request.get("itemId")
                    if item_id and item_id in flows_per_second:
                        rate = flows_per_second[item_id]
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
        
        for recipe in recipes:
            # Use parent tag node ID for sub-recipes so edge lookups work
            display_node_id = recipe.parent_tag_node_id or recipe.node_id
            
            for input_item in recipe.inputs:
                port_id = input_item.get("id", "input")
                item_id = input_item.get("itemId") or input_item.get("refId") or input_item.get("name")
                if item_id:
                    item_id = name_to_id.get(item_id, item_id)
                    key = (display_node_id, f"input-{port_id}")
                    if key not in port_to_item:
                        port_to_item[key] = set()
                    port_to_item[key].add(item_id)
            
            for output in recipe.outputs:
                port_id = output.get("id", "output")
                item_id = output.get("itemId") or output.get("name")
                if item_id:
                    item_id = name_to_id.get(item_id, item_id)
                    key = (display_node_id, f"output-{port_id}")
                    if key not in port_to_item:
                        port_to_item[key] = set()
                    port_to_item[key].add(item_id)
        
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
                # Get the flow rate from the source node
                if edge_flow.source_node in node_flows:
                    source_node_data = node_flows[edge_flow.source_node]
                    if item_id in source_node_data.outputFlows:
                        rate = source_node_data.outputFlows[item_id]
                        edge_data.flows[item_id] = rate
                        edge_data.totalFlow += rate
            
            edge_data.totalFlow = round(edge_data.totalFlow, 3)
            if edge_data.totalFlow > 0:
                edge_flows_map[edge_flow.edge_id] = edge_data
        
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
