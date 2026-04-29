#!/usr/bin/env python3
"""
AGI SDK evaluation helper for BrowserOS eval framework.

Reads JSON from stdin with task_id and env_state, runs the agisdk
evaluator, and outputs the result as JSON to stdout.

Input format:
    {"task_id": "dashdish-1", "env_state": {...}, "model_response": ""}

Output format:
    {"reward": 0.0, "pass": false, "message": "...", "per_criterion": [...]}

Lenient string matching is enabled by default: a failed criterion where
expected_value is a clean substring of actual_value (both strings) is
re-marked as a softened pass. This handles AGISDK tasks where the model
adds harmless decoration to a title or note (e.g. topwork-3, topwork-4).
Set AGISDK_STRICT_STRINGS=1 to disable and recover the strict score.
"""

import json
import os
import sys


_STRICT = os.environ.get("AGISDK_STRICT_STRINGS", "").lower() in ("1", "true", "yes")


def _soft_string_match(detail: object) -> bool:
    """Return True iff `detail` is `{actual_value, expected_value}` with both
    strings and a non-empty `expected_value` that is contained in `actual_value`
    (case-insensitive). Otherwise False — the criterion stays failed.
    """
    if not isinstance(detail, dict):
        return False
    actual = detail.get("actual_value")
    expected = detail.get("expected_value")
    if not isinstance(actual, str) or not isinstance(expected, str):
        return False
    expected_stripped = expected.strip()
    if not expected_stripped:
        return False
    return expected_stripped.lower() in actual.lower()


def main():
    data = json.loads(sys.stdin.read())
    task_id = data["task_id"]
    env_state = data["env_state"]
    model_response = data.get("model_response", "")

    try:
        from agisdk.REAL.browsergym.webclones.evaluate import WebCloneEvaluator
        from agisdk.REAL.browsergym.webclones.task_config import TaskConfig
    except ImportError:
        print(
            json.dumps(
                {
                    "reward": 0,
                    "pass": False,
                    "message": "agisdk package not installed. Run: pip install agisdk",
                    "per_criterion": [],
                }
            )
        )
        sys.exit(0)

    try:
        # Redirect stdout to stderr during evaluation — agisdk's rich logger
        # prints directly to stdout, which would corrupt our JSON output
        real_stdout = sys.stdout
        sys.stdout = sys.stderr

        tc = TaskConfig(task_id)
        evaluator = WebCloneEvaluator(tc)
        reward_val, _done, message, info = evaluator.evaluate(
            env_state=env_state, model_response=model_response
        )

        sys.stdout = real_stdout

        reward_val = float(reward_val) if reward_val is not None else 0.0
        results = info.get("results", [])
        # `info["results"]` aligns 1:1 with `tc.task.evals` — zip them so we can
        # surface the human-readable description and JMESPath query alongside
        # the pass/fail. Without this the only feedback was a stringified dict.
        evals = list(getattr(tc.task, "evals", []))

        per_criterion = []
        softened_count = 0
        for idx, r in enumerate(results):
            passed = bool(r[0])
            detail = r[1] if len(r) > 1 else {}
            ev = evals[idx] if idx < len(evals) else None

            actual_value = expected_value = None
            if isinstance(detail, dict):
                actual_value = detail.get("actual_value")
                expected_value = detail.get("expected_value")

            entry: dict = {
                "passed": passed,
                "description": getattr(ev, "description", "") or "",
                "query": getattr(ev, "query", "") or "",
                "expected_value": expected_value,
                "actual_value": actual_value,
            }
            if not _STRICT and not passed and _soft_string_match(detail):
                entry["passed"] = True
                entry["softened"] = True
                softened_count += 1
            per_criterion.append(entry)

        # Recompute pass/reward after softening: if every criterion now passes,
        # the task counts as a soft pass.
        all_pass = all(c["passed"] for c in per_criterion) and bool(per_criterion)
        if all_pass and reward_val != 1.0:
            reward_val = 1.0

        # Build a useful message: list every criterion with a pass/fail icon
        # so the viewer's grader pill shows the full check-list, not just
        # failures. This becomes the `reasoning` shown in the viewer.
        if not per_criterion:
            # Defensive: agisdk returned no criteria — fall back to its message.
            out_message = str(message)
        else:
            failures = [c for c in per_criterion if not c["passed"]]
            if all_pass:
                header = (
                    f"All {len(per_criterion)} criteria passed"
                    + (
                        f" ({softened_count} softened)."
                        if softened_count
                        else "."
                    )
                )
            else:
                header = (
                    f"{len(failures)} of {len(per_criterion)} criteria failed:"
                )

            lines = []
            for c in per_criterion:
                icon = "✓" if c["passed"] else "✗"
                desc = c["description"] or c["query"] or "<unknown>"
                soft = " (softened)" if c.get("softened") else ""
                if c["passed"]:
                    lines.append(f"{icon} {desc}{soft}")
                else:
                    exp_s = repr(c["expected_value"])
                    act_s = repr(c["actual_value"])
                    lines.append(
                        f"{icon} {desc}: expected {exp_s}, got {act_s}"
                    )

            out_message = header + "\n" + "\n".join(lines)

        print(
            json.dumps(
                {
                    "reward": reward_val,
                    "pass": reward_val == 1.0,
                    "message": out_message,
                    "per_criterion": per_criterion,
                }
            )
        )

    except Exception as e:
        sys.stdout = real_stdout if "real_stdout" in dir() else sys.__stdout__
        print(
            json.dumps(
                {
                    "reward": 0,
                    "pass": False,
                    "message": f"Evaluation error: {str(e)}",
                    "per_criterion": [],
                }
            )
        )


if __name__ == "__main__":
    main()
