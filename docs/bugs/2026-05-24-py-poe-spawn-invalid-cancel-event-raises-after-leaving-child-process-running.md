# Python spawn invalid cancel event raises after leaving the child process running

## Summary

`poe_spawn.spawn(..., cancel_event=...)` launches the `poe-code` child process before validating whether `cancel_event` implements the required cancellation API. Passing an invalid event-like object raises `TypeError` to the caller while the already-created child process continues running with no returned `SpawnHandle` available to cancel or consume.

## Reproduction

Run this disposable probe from the repository root:

```sh
cat > /tmp/py_poe_spawn_invalid_cancel_probe.py <<'PY'
from __future__ import annotations

import subprocess
import sys
from unittest import mock

from poe_spawn import spawn

started: list[subprocess.Popen[str]] = []
real_popen = subprocess.Popen

def recording_popen(*args, **kwargs):
    child = real_popen(*args, **kwargs)
    started.append(child)
    return child

with mock.patch(
    "poe_spawn._spawn._resolve_cli_command",
    return_value=[sys.executable, "-c", "import time; time.sleep(60)", "--"],
), mock.patch("poe_spawn._spawn.subprocess.Popen", side_effect=recording_popen):
    try:
        spawn("codex", "ignored", cancel_event=object())
    except TypeError as error:
        print(f"caught={type(error).__name__}: {error}")

child = started[0]
print(f"children_started={len(started)}")
print(f"running_after_error={child.poll() is None}")
child.terminate()
child.wait(timeout=5)
PY
PYTHONPATH=packages/py-poe-spawn/src python3 /tmp/py_poe_spawn_invalid_cancel_probe.py
```

Output:

```text
caught=TypeError: cancel_event must expose wait() or is_set().
children_started=1
running_after_error=True
```

## Observed Behavior

`_SpawnInvoker.__call__()` constructs the subprocess at `packages/py-poe-spawn/src/poe_spawn/_spawn.py:119` before `SpawnHandle.__init__()` calls `_start_cancel_watcher()` at `packages/py-poe-spawn/src/poe_spawn/_spawn.py:31`. `_start_cancel_watcher()` validates `cancel_event` only afterward and raises for unsupported values at `packages/py-poe-spawn/src/poe_spawn/_spawn.py:335`. The exception escapes construction, so callers never receive the handle that owns the newly running process.

## Expected Behavior

Invalid `cancel_event` input should be rejected before any subprocess is started, or construction failure should terminate and reap the already-started child before surfacing the error to the caller.

## Impact

A configuration or type mistake in Python SDK callers can silently leave live agent subprocesses running after the API call fails. Long-lived applications, job runners, and tests can leak compute, retain external tool sessions, continue performing unintended agent work, or accumulate orphaned processes that callers cannot manage through the SDK.
