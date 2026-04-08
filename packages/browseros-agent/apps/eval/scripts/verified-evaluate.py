#!/usr/bin/env python3
"""
Bridge script for WebArena-Verified evaluation.

Reads a JSON object from stdin with:
  - task_id: the original WebArena task ID (numeric string)
  - har_path: path to network.har
  - agent_response_path: path to agent_response.json

Calls the webarena-verified evaluator and outputs a JSON result to stdout.

Install: pip install webarena-verified

NOTE: The exact webarena-verified Python API may differ from what's assumed here.
The import paths and function signatures below are based on reasonable assumptions
about the package structure. Verify against the actual installed package and update
the imports/calls accordingly.
"""
import json
import sys


def main():
    data = json.loads(sys.stdin.read())
    task_id = data["task_id"]
    har_path = data["har_path"]
    agent_response_path = data["agent_response_path"]

    try:
        # Attempt to import from webarena-verified package.
        # The actual module structure may vary -- common patterns:
        #   from webarena_verified.evaluator import evaluate_task
        #   from webarena_verified import AgentResponseEvaluator, NetworkEventEvaluator
        from webarena_verified.evaluator import (
            AgentResponseEvaluator,
            NetworkEventEvaluator,
        )

        with open(agent_response_path) as f:
            agent_response = json.load(f)

        # Run agent response evaluation
        agent_eval = AgentResponseEvaluator()
        agent_result = agent_eval.evaluate(task_id=task_id, response=agent_response)

        # Run network event evaluation
        network_eval = NetworkEventEvaluator()
        network_result = network_eval.evaluate(task_id=task_id, har_path=har_path)

        # Both must pass for overall success
        passed = agent_result.get("passed", False) and network_result.get(
            "passed", False
        )

        print(
            json.dumps(
                {
                    "pass": passed,
                    "reward": 1.0 if passed else 0.0,
                    "message": f"agent_response: {agent_result.get('message', 'n/a')}, "
                    f"network: {network_result.get('message', 'n/a')}",
                    "details": {
                        "agent_response_result": agent_result,
                        "network_event_result": network_result,
                    },
                }
            )
        )

    except ImportError:
        # Fallback: webarena-verified not installed.
        # Return a structured error so the TypeScript grader can report it.
        print(
            json.dumps(
                {
                    "pass": False,
                    "reward": 0.0,
                    "message": "webarena-verified package not installed. "
                    "Run: pip install webarena-verified",
                    "details": {"error": "import_error"},
                }
            )
        )

    except Exception as e:
        print(
            json.dumps(
                {
                    "pass": False,
                    "reward": 0.0,
                    "message": f"Evaluation error: {str(e)}",
                    "details": {"error": str(e), "type": type(e).__name__},
                }
            )
        )


if __name__ == "__main__":
    main()
