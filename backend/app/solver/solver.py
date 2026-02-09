from typing import Dict, Tuple, List
from app.api.models import Graph, SolveResponse


def _extract_recipe_data(node_data: dict) -> Tuple[str, float, List[dict], List[dict]]:
    title = str(node_data.get("title", "recipe"))
    time_seconds = float(node_data.get("timeSeconds", 1.0))
    inputs = list(node_data.get("inputs", []))
    outputs = list(node_data.get("outputs", []))
    return title, time_seconds, inputs, outputs


def solve_graph(graph: Graph) -> SolveResponse:
    flows: Dict[str, float] = {}
    machine_counts: Dict[str, float] = {}
    warnings: List[str] = []

    for node in graph.nodes:
        if node.type != "recipe" or not node.data:
            continue

        title, time_seconds, _inputs, outputs = _extract_recipe_data(node.data)
        if time_seconds <= 0:
            warnings.append(f"Recipe {title} has invalid timeSeconds")
            continue

        machine_counts[title] = machine_counts.get(title, 0) + 1
        rate = 1.0 / time_seconds

        for out in outputs:
            name = str(out.get("name", "output"))
            amount = float(out.get("amountPerCycle", 0))
            prob = float(out.get("probability", 1))
            expected = rate * amount * prob
            flows[name] = flows.get(name, 0) + expected

    return SolveResponse(
        status="ok",
        machineCounts=machine_counts,
        flowsPerSecond=flows,
        bottlenecks=[],
        warnings=warnings,
    )
