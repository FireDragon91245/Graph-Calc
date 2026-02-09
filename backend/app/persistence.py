import json
import os
from pathlib import Path
from typing import Any, Dict

# Define data directory path
DATA_DIR = Path(__file__).parent.parent.parent / "data"
GRAPH_FILE = DATA_DIR / "graph.json"
STORE_FILE = DATA_DIR / "store.json"


def ensure_data_dir():
    """Ensure data directory exists"""
    DATA_DIR.mkdir(exist_ok=True)


def load_json_file(file_path: Path, default: Any = None) -> Any:
    """Load JSON file or return default if not exists"""
    ensure_data_dir()
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {file_path}: {e}")
            return default
    return default


def save_json_file(file_path: Path, data: Any):
    """Save data to JSON file"""
    ensure_data_dir()
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving {file_path}: {e}")
        raise


def load_graph() -> Dict[str, Any]:
    """Load graph data (nodes and edges)"""
    default = {"nodes": [], "edges": []}
    return load_json_file(GRAPH_FILE, default)


def save_graph(data: Dict[str, Any]):
    """Save graph data (nodes and edges)"""
    save_json_file(GRAPH_FILE, data)


def load_store() -> Dict[str, Any]:
    """Load store data (categories, items, tags, recipes, etc.)"""
    default = {
        "categories": [],
        "items": [],
        "tags": [],
        "recipeTags": [],
        "recipes": []
    }
    return load_json_file(STORE_FILE, default)


def save_store(data: Dict[str, Any]):
    """Save store data (categories, items, tags, recipes, etc.)"""
    save_json_file(STORE_FILE, data)
