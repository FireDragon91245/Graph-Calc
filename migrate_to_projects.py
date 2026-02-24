"""
Migration script: Move existing data/graph.json and data/store.json
into a project called 'star technology'.
Run once from the repo root: python migrate_to_projects.py
"""
import json
import shutil
import uuid
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
PROJECTS_DIR = DATA_DIR / "projects"
META_FILE = DATA_DIR / "projects_meta.json"

GRAPH_FILE = DATA_DIR / "graph.json"
STORE_FILE = DATA_DIR / "store.json"


def main():
    # Check if already migrated
    if META_FILE.exists():
        print("projects_meta.json already exists – migration may have already run.")
        resp = input("Continue anyway? (y/n) ").strip().lower()
        if resp != "y":
            return

    # Create projects dir
    PROJECTS_DIR.mkdir(exist_ok=True)

    # Generate project id
    pid = uuid.uuid4().hex[:12]
    project_name = "star technology"

    # Create project directory
    proj_dir = PROJECTS_DIR / pid
    proj_dir.mkdir(exist_ok=True)

    # Copy existing files into project
    if GRAPH_FILE.exists():
        shutil.copy2(GRAPH_FILE, proj_dir / "graph.json")
        print(f"Copied graph.json -> projects/{pid}/graph.json")
    else:
        print("No existing graph.json found, creating empty one")
        (proj_dir / "graph.json").write_text(json.dumps({"nodes": [], "edges": []}, indent=2))

    if STORE_FILE.exists():
        shutil.copy2(STORE_FILE, proj_dir / "store.json")
        print(f"Copied store.json -> projects/{pid}/store.json")
    else:
        print("No existing store.json found, creating empty one")
        default_store = {"categories": [], "items": [], "tags": [], "recipeTags": [], "recipes": []}
        (proj_dir / "store.json").write_text(json.dumps(default_store, indent=2))

    # Write meta file
    meta = {
        "projects": [{"id": pid, "name": project_name}],
        "activeProjectId": pid
    }
    META_FILE.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Created projects_meta.json with project '{project_name}' (id={pid})")

    print("\nMigration complete! You can now delete the old data/graph.json and data/store.json if desired.")


if __name__ == "__main__":
    main()
