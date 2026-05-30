---
name: "Python spawn wait-only cancel event leaves watcher thread blocked after completion"
---

# Python spawn wait-only cancel event leaves watcher thread blocked after completion

## Summary

`poe_spawn.spawn(..., cancel_event=...)` documents support for event-like objects that expose only `wait()`, but its watcher cannot stop when such a `wait()` blocks without accepting a timeout. When the spawned process finishes normally first, the handle returns a result while its daemon cancellation watcher remains blocked indefinitely inside user-provided cancellation code.

## Reproduction

Run this disposable probe from the repository root:

```sh
cat > /tmp/py_poe_spawn_wait_only_cancel_probe.py <<'PY'
from __future__ import annotations

import io
import threading

from poe_spawn._spawn import SpawnHandle

class FakeProcess:
    def __init__(self) -> None:
        self.stdout = io.StringIO('{"event":"agent_message","text":"done"}\n')
        self.returncode = None

    def poll(self):
        return self.returncode

    def send_signal(self, sig) -> None:
        raise AssertionError(f"unexpected signal: {sig}")

    def wait(self) -> int:
        self.returncode = 0
        return 0

class WaitOnlyCancelEvent:
    def __init__(self) -> None:
        self.release = threading.Event()
        self.entered = threading.Event()

    def wait(self) -> bool:
        self.entered.set()
        self.release.wait()
        return False

cancel_event = WaitOnlyCancelEvent()
handle = SpawnHandle(FakeProcess(), cancel_event=cancel_event)
cancel_event.entered.wait(timeout=1)
list(handle.events)
print(f"result_exit_code={handle.result.exit_code}")
print(f"watcher_alive_after_completion={handle._cancel_watcher.is_alive()}")
cancel_event.release.set()
handle._cancel_watcher.join(timeout=1)
print(f"watcher_alive_after_release={handle._cancel_watcher.is_alive()}")
PY
PYTHONPATH=packages/py-poe-spawn/src python3 /tmp/py_poe_spawn_wait_only_cancel_probe.py
```

Output:

```text
result_exit_code=0
watcher_alive_after_completion=True
watcher_alive_after_release=False
```

## Observed Behavior

The Python package README documents `cancel_event` as accepting an object with `wait()` or `is_set()`. `_start_cancel_watcher()` consequently selects `_wait_for_cancel_event()` for wait-only objects at `packages/py-poe-spawn/src/poe_spawn/_spawn.py:332` through `packages/py-poe-spawn/src/poe_spawn/_spawn.py:345`. If `wait(0.05)` raises `TypeError`, that watcher invokes parameterless `cancel_event.wait()` at `packages/py-poe-spawn/src/poe_spawn/_spawn.py:353` through `packages/py-poe-spawn/src/poe_spawn/_spawn.py:362`, which may block indefinitely. Normal finalization only sets an unrelated `done` event and joins for `0.1` seconds at `packages/py-poe-spawn/src/poe_spawn/_spawn.py:87` through `packages/py-poe-spawn/src/poe_spawn/_spawn.py:99`, so it cannot release that permitted blocking wait-only watcher.

## Expected Behavior

Every documented `cancel_event` shape should allow the SDK to stop its watcher when the child completes, without requiring the cancellation object to be externally triggered after completion. Alternatively, the API should reject non-timeout-capable wait-only objects before starting the watcher.

## Impact

Applications that supply a documented wait-only cancellation token leak one blocked daemon thread for each spawn that finishes before cancellation. Repeated normal invocations can accumulate blocked threads and retained token/process-handle state for the lifetime of a Python worker, degrading service stability even when all agent subprocesses exit successfully.
