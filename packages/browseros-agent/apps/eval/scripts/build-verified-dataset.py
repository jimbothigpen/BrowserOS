#!/usr/bin/env python3
"""
Build WebArena-Verified eval datasets for the BrowserOS eval framework.

Imports task definitions from the webarena-verified pip package and converts
them to the eval framework's JSONL format.

Usage:
    python3 apps/eval/scripts/build-verified-dataset.py [--subset hard|full] [--sites shopping,gitlab,...]

Output: JSONL to stdout (pipe to file)

    python3 apps/eval/scripts/build-verified-dataset.py --subset hard > apps/eval/data/webarena-verified-hard.jsonl

Install: pip install webarena-verified

NOTE: The exact webarena-verified package structure and task format are assumed.
The import paths and field names below should be verified against the actual
installed package. Key assumptions:
  - Tasks are available via webarena_verified.tasks.load_tasks() or similar
  - Each task has: task_id, instruction/intent, start_url, site, task_type
  - Hard subset is identified by a difficulty field or a separate loader
"""
import argparse
import json
import sys
from collections import defaultdict

# Site URL mapping for WebArena self-hosted Docker instances.
# These are the default ports from `webarena-verified env start`.
SITE_URLS = {
    "shopping": "http://localhost:7770",
    "shopping_admin": "http://localhost:7780",
    "reddit": "http://localhost:9999",
    "gitlab": "http://localhost:8023",
    "wikipedia": "http://localhost:8888",
    "map": "http://localhost:3000",
}


def load_tasks_from_package():
    """
    Load task definitions from the webarena-verified package.
    Falls back to a bundled JSON file if the package API differs.
    """
    try:
        # Try the expected package API
        from webarena_verified import load_tasks

        return load_tasks()
    except (ImportError, AttributeError):
        pass

    try:
        # Alternative: tasks might be in a data submodule
        from webarena_verified.tasks import get_all_tasks

        return get_all_tasks()
    except (ImportError, AttributeError):
        pass

    try:
        # Alternative: load from bundled JSON within the package
        import importlib.resources as pkg_resources

        import webarena_verified

        data_path = pkg_resources.files(webarena_verified) / "data" / "tasks.json"
        with open(str(data_path)) as f:
            return json.load(f)
    except Exception:
        pass

    print(
        "ERROR: Could not load tasks from webarena-verified package.\n"
        "Install with: pip install webarena-verified\n"
        "If the API differs, update the load_tasks_from_package() function.",
        file=sys.stderr,
    )
    sys.exit(1)


def is_hard_task(task):
    """
    Determine if a task belongs to the Hard subset (258 discriminative tasks).
    The exact field depends on the package -- common patterns:
      - task.get("subset") == "hard"
      - task.get("difficulty") == "hard"
      - task.get("is_hard") == True
      - task_id in HARD_TASK_IDS
    """
    if task.get("subset") == "hard":
        return True
    if task.get("difficulty") == "hard":
        return True
    if task.get("is_hard", False):
        return True
    return False


def get_site(task):
    """Extract the site name from a task definition."""
    for field in ("site", "website", "domain"):
        if field in task:
            return task[field]
    # Infer from start_url
    url = task.get("start_url", "")
    for site, site_url in SITE_URLS.items():
        if site_url in url:
            return site
    return "unknown"


def get_task_instruction(task):
    """Extract the task instruction/query text."""
    for field in ("intent", "instruction", "query", "task", "description"):
        if field in task and task[field]:
            return task[field]
    return ""


def get_start_url(task):
    """Extract or derive the start URL."""
    if "start_url" in task and task["start_url"]:
        return task["start_url"]
    site = get_site(task)
    return SITE_URLS.get(site, "http://localhost:7770")


def convert_task(task, subset_label):
    """Convert a webarena-verified task to the eval framework's JSONL format."""
    task_id = str(task.get("task_id", task.get("id", "")))
    site = get_site(task)
    query_id = f"verified-{site}-{task_id}"
    instruction = get_task_instruction(task)
    start_url = get_start_url(task)
    task_type = task.get("task_type", task.get("type", "action"))

    # Collect evaluation-relevant fields from the original task
    additional = {
        "site": site,
        "subset": subset_label,
        "task_type": task_type,
    }

    # Preserve expected response data for the evaluator
    for field in (
        "expected_response",
        "eval",
        "evaluation",
        "expected",
        "reference_answer",
        "answer",
    ):
        if field in task:
            additional["expected_response"] = task[field]
            break

    # Preserve network assertions if present
    for field in ("network_assertions", "network_eval", "har_assertions"):
        if field in task:
            additional["network_assertions"] = task[field]
            break

    return {
        "query_id": query_id,
        "dataset": "webarena-verified",
        "query": instruction,
        "graders": ["verified_har"],
        "start_url": start_url,
        "metadata": {
            "original_task_id": task_id,
            "website": site,
            "category": "webarena-verified",
            "additional": additional,
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="Build WebArena-Verified eval dataset"
    )
    parser.add_argument(
        "--subset",
        choices=["full", "hard"],
        default="hard",
        help="Task subset: 'hard' (258 tasks, default) or 'full' (812 tasks)",
    )
    parser.add_argument(
        "--sites",
        type=str,
        default=None,
        help="Comma-separated site filter (e.g., shopping,gitlab,reddit)",
    )
    args = parser.parse_args()

    tasks = load_tasks_from_package()

    # Handle both list and dict formats
    if isinstance(tasks, dict):
        task_list = list(tasks.values())
    else:
        task_list = list(tasks)

    # Filter to hard subset if requested
    if args.subset == "hard":
        filtered = [t for t in task_list if is_hard_task(t)]
        if not filtered:
            # If no tasks are flagged as hard, the package might not have
            # subset labels. Warn and use all tasks.
            print(
                f"WARNING: No tasks matched 'hard' subset filter. "
                f"Using all {len(task_list)} tasks. "
                f"Verify the subset detection logic against the actual package.",
                file=sys.stderr,
            )
            filtered = task_list
        task_list = filtered

    # Filter by sites
    if args.sites:
        allowed_sites = set(args.sites.split(","))
        task_list = [t for t in task_list if get_site(t) in allowed_sites]

    # Convert and output
    stats = defaultdict(int)
    for task in task_list:
        converted = convert_task(task, args.subset)
        print(json.dumps(converted, ensure_ascii=False))
        stats[converted["metadata"]["website"]] += 1

    print(
        f"Generated {len(task_list)} tasks ({args.subset} subset). "
        f"Sites: {dict(sorted(stats.items()))}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
