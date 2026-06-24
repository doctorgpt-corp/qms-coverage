"""pytest plugin internals for qms-coverage.

Registers the ``qms_covers`` marker, captures per-test evidence as it
passes through pytest, and writes a manifest to ``QMS_EVIDENCE_OUT`` at
session end. A separate publish step (the ``qms-coverage-publish`` Node
CLI) renders a job summary and POSTs the manifest to the QMS — keeping
test failures and QMS-availability failures decoupled.

xdist behaviour: when running under ``pytest-xdist``, evidence is
attached to the ``TestReport.user_properties`` on the worker (which
``xdist`` serialises back to the controller) and accumulated on the
controller in ``pytest_runtest_logreport``. Only the controller writes
the manifest at session end; workers and any non-aggregator processes
return early to avoid racing on the output path.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest


_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_RESULTS_ATTR = "_qms_coverage_results"
_EVIDENCE_KEY = "qms_evidence_row"


def _covers_slugs(item: pytest.Item) -> list[str]:
    """All AC slugs declared on a test, unioned across every ``qms_covers``
    marker. ``@covers`` decorators stack — two stacked decorators produce two
    markers — so we iterate them all rather than reading only the closest one
    (``get_closest_marker`` returns a single marker, which silently dropped
    every slug but the innermost). Order is preserved and duplicates removed."""
    slugs: list[str] = []
    seen: set[str] = set()
    for marker in item.iter_markers("qms_covers"):
        for slug in marker.args:
            if slug not in seen:
                seen.add(slug)
                slugs.append(slug)
    return slugs

# Stash for pytest_runtest_logreport, which only receives ``report`` as
# an argument and so cannot reach ``config`` directly.
_active_config: pytest.Config | None = None


def pytest_configure(config: pytest.Config) -> None:
    global _active_config
    _active_config = config
    config.addinivalue_line(
        "markers",
        "qms_covers(*slugs): record per-AC test evidence to the Aletta QMS. "
        "Each slug must be kebab-case (lowercase letters, digits, single hyphens).",
    )
    setattr(config, _RESULTS_ATTR, [])


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    for item in items:
        markers = list(item.iter_markers("qms_covers"))
        if not markers:
            continue
        # Validate every marker (each stacked decorator is its own marker), so a
        # `@covers()` with no slugs anywhere in the stack still fails fast.
        for marker in markers:
            if not marker.args:
                raise pytest.UsageError(
                    f"qms-coverage: {item.nodeid} declares @covers() with no slugs. "
                    f"Pass at least one AC slug, or remove the decorator."
                )
            for slug in marker.args:
                if not isinstance(slug, str) or not _SLUG_RE.match(slug):
                    raise pytest.UsageError(
                        f"qms-coverage: {item.nodeid} has invalid slug {slug!r}. "
                        f"Slugs must be kebab-case (lowercase letters, digits, single hyphens)."
                    )


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[None]):
    outcome = yield
    report: pytest.TestReport = outcome.get_result()
    # Only the call phase tells us pass/fail in a meaningful way for evidence;
    # setup/teardown failures are captured as test failures here too.
    if report.when != "call":
        return
    slugs = _covers_slugs(item)
    if not slugs:
        return
    if report.outcome == "passed":
        status = "passed"
    elif report.outcome == "failed":
        status = "failed"
    elif report.outcome == "skipped":
        status = "skipped"
    else:  # pragma: no cover — pytest only emits the three above
        return
    duration_ms = int((report.duration or 0.0) * 1000)
    test_file = item.location[0] if item.location else item.nodeid.split("::", 1)[0]
    row = {
        "testId": item.nodeid,
        "testFile": test_file,
        "status": status,
        "durationMs": duration_ms,
        "acSlugs": slugs,
    }
    # Attach the row to the report. ``user_properties`` rides through
    # xdist's report transport, so the controller can pick it up via
    # pytest_runtest_logreport even when this hook ran on a worker.
    report.user_properties.append((_EVIDENCE_KEY, row))


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    # Workers fire logreport locally too; skip there. Only the controller
    # (or a single-process run) writes the manifest at session end, so any
    # worker-side accumulation would be wasted and would also race the
    # controller for the output path.
    if os.environ.get("PYTEST_XDIST_WORKER"):
        return
    if report.when != "call":
        return
    if _active_config is None:
        return
    results: list[dict[str, Any]] | None = getattr(_active_config, _RESULTS_ATTR, None)
    if results is None:
        return
    for key, value in report.user_properties:
        if key == _EVIDENCE_KEY:
            results.append(value)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    # The controller (or a single-process run) is the only writer. Workers
    # have only a slice of the results in their own session.config, and a
    # worker-side write would race the controller for QMS_EVIDENCE_OUT.
    if os.environ.get("PYTEST_XDIST_WORKER"):
        return

    out_path = os.environ.get("QMS_EVIDENCE_OUT")
    if not out_path:
        return

    results: list[dict[str, Any]] = getattr(session.config, _RESULTS_ATTR, [])

    branch = os.environ.get("GITHUB_REF_NAME") or _safe_git("rev-parse --abbrev-ref HEAD")
    if not branch:
        raise RuntimeError(
            "qms-coverage: cannot determine git branch "
            "(GITHUB_REF_NAME unset and `git rev-parse --abbrev-ref HEAD` failed)."
        )

    sha = os.environ.get("GITHUB_SHA") or _safe_git("rev-parse HEAD")
    if not sha:
        raise RuntimeError(
            "qms-coverage: cannot determine git SHA "
            "(GITHUB_SHA unset and `git rev-parse HEAD` failed)."
        )

    run_id = os.environ.get("GITHUB_RUN_ID")
    server_url = os.environ.get("GITHUB_SERVER_URL")
    repo = os.environ.get("GITHUB_REPOSITORY")
    run_url = (
        f"{server_url}/{repo}/actions/runs/{run_id}"
        if server_url and repo and run_id
        else None
    )

    manifest: dict[str, Any] = {
        "branch": branch,
        "sha": sha,
        "results": results,
    }
    if run_id:
        manifest["runId"] = run_id
    if run_url:
        manifest["runUrl"] = run_url

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        f"\n[qms-coverage] wrote {len(results)} evidence row(s) to {out_path} "
        f"on {branch}@{sha[:7]}.",
        flush=True,
    )


def _safe_git(args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args.split()],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return result.stdout.strip() or None
    except Exception:
        return None
