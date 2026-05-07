"""qms-coverage — pytest plugin that pushes per-AC test evidence to the Aletta QMS.

Usage in tests:

    from qms_coverage import covers

    @covers("req-org-002-shared-s-1")
    def test_accept_invite():
        ...

`covers` is sugar for ``pytest.mark.qms_covers``; the plugin (auto-loaded via
its `pytest11` entry point) registers the marker, captures pass/fail status
during the run, and posts a manifest to ``${QMS_URL}/api/evidence`` at session
end when ``QMS_CI_TOKEN`` is set. Locally, with the env unset, the plugin
no-ops so ``pytest`` runs as normal.
"""

import pytest

# Variadic API: ``@covers("slug-a", "slug-b")``. Mirrors the TS package's
# ``test(name, { covers: [...] }, fn)`` shape; multiple slugs are allowed
# when one test verifies more than one AC.
covers = pytest.mark.qms_covers

__all__ = ["covers"]
