"""pytest plugin internals for qms-coverage.

Registers the ``qms_covers`` marker, validates slugs at collection time,
captures per-test status during the call phase, and pushes an evidence
manifest to the QMS at session end when ``QMS_CI_TOKEN`` is set.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any

import pytest


_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_RESULTS_ATTR = "_qms_coverage_results"
_SLUGS_KEY = "qms_ac_slugs"


def pytest_configure(config: pytest.Config) -> None:
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
        marker = item.get_closest_marker("qms_covers")
        if marker is None:
            continue
        slugs = list(marker.args)
        if not slugs:
            raise pytest.UsageError(
                f"qms-coverage: {item.nodeid} declares @covers() with no slugs. "
                f"Pass at least one AC slug, or remove the decorator."
            )
        for slug in slugs:
            if not isinstance(slug, str) or not _SLUG_RE.match(slug):
                raise pytest.UsageError(
                    f"qms-coverage: {item.nodeid} has invalid slug {slug!r}. "
                    f"Slugs must be kebab-case (lowercase letters, digits, single hyphens)."
                )
        item.user_properties.append((_SLUGS_KEY, slugs))


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[None]):
    outcome = yield
    report: pytest.TestReport = outcome.get_result()
    # Only the call phase tells us pass/fail in a meaningful way for evidence;
    # setup/teardown failures are captured as test failures here too.
    if report.when != "call":
        return
    slugs = _slugs_for(item)
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
    results: list[dict[str, Any]] = getattr(item.session.config, _RESULTS_ATTR)
    results.append(
        {
            "testId": item.nodeid,
            "testFile": test_file,
            "status": status,
            "durationMs": duration_ms,
            "acSlugs": list(slugs),
        }
    )


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    token = os.environ.get("QMS_CI_TOKEN")
    if not token:
        return

    results: list[dict[str, Any]] = getattr(session.config, _RESULTS_ATTR, [])
    if not results:
        return

    url = (os.environ.get("QMS_URL") or "").rstrip("/")
    if not url:
        raise RuntimeError(
            "qms-coverage: QMS_CI_TOKEN is set but QMS_URL is not."
        )

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

    body = json.dumps(manifest).encode("utf-8")
    request = urllib.request.Request(
        f"{url}/api/evidence",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_body = response.read().decode("utf-8", errors="replace")
            data = json.loads(response_body) if response_body else {}
            recorded = data.get("recorded", len(results))
            skipped = data.get("skipped") or []
            print(
                f"\n[qms-coverage] pushed {recorded} evidence row(s) "
                f"across {len(results)} test(s) on {branch}@{sha[:7]}.",
                flush=True,
            )
            if skipped:
                # The QMS skipped these slugs because they don't exist in
                # requirement_acceptance — author them via /admin or
                # /requirements before they'll start showing coverage.
                lines = "\n".join(f"  - {s}" for s in skipped)
                print(
                    f"[qms-coverage] WARN: {len(skipped)} unknown slug(s) "
                    f"skipped (author them in QMS to start tracking):\n{lines}",
                    file=sys.stderr,
                    flush=True,
                )
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"qms-coverage: POST {url}/api/evidence {e.code}: {body_text}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"qms-coverage: POST {url}/api/evidence failed: {e.reason}"
        ) from e


def _slugs_for(item: pytest.Item) -> list[str]:
    for key, value in item.user_properties:
        if key == _SLUGS_KEY:
            return value
    return []


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
