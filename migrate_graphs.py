"""Migrate existing single-graph projects to multi-graph structure."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app.persistence import _maybe_migrate_project, _load_meta

meta = _load_meta()
for p in meta.get("projects", []):
    pid = p["id"]
    pname = p["name"]
    print(f"Migrating project: {pname} ({pid})")
    _maybe_migrate_project(pid)

print("Migration complete.")
