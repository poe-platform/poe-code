# Python Poe spawn preset cancel signal failure leaves child unmanaged

## Summary

The exported `poe_spawn.spawn(..., cancel_event=...)` starts its child process before handling an already-set, valid cancellation event. If sending the initial interrupt fails, construction raises that signal error without returning a `SpawnHandle` and without waiting for or terminating the child process, leaving the launched process unmanaged.

## Reproduction

Run this disposable Python probe from the repository root. It supplies a valid already-set `threading.Event` and a fake started child whose interrupt dispatch fails:

```sh
cat > /tmp/py_poe_spawn_preset_cancel_signal_failure_probe.py <<'PY'
import threading
from unittest.mock import patch
from poe_spawn import spawn

class FakeProcess:
    def __init__(self):
        self.stdout = None
        self.signal_calls = []
        self.wait_calls = 0

    def poll(self):
        return None

    def send_signal(self, sig):
        self.signal_calls.append(sig)
        raise PermissionError("signal denied")

    def wait(self):
        self.wait_calls += 1
        return 0

child = FakeProcess()
cancel_event = threading.Event()
cancel_event.set()

with patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), patch(
    "poe_spawn._spawn.subprocess.Popen", return_value=child
):
    try:
        spawn("codex", "probe", cancel_event=cancel_event)
    except Exception as error:
        print({
            "error": type(error).__name__ + ": " + str(error),
            "signal_calls": len(child.signal_calls),
            "wait_calls": child.wait_calls,
        })
        assert isinstance(error, PermissionError)
        assert child.signal_calls
        assert child.wait_calls == 0
    else:
        raise AssertionError("expected signal failure")
PY
PYTHONPATH=packages/py-poe-spawn/src python3 /tmp/py_poe_spawn_preset_cancel_signal_failure_probe.py
rm -f /tmp/py_poe_spawn_preset_cancel_signal_failure_probe.py
```

The probe succeeds and prints:

```text
{'error': 'PermissionError: signal denied', 'signal_calls': 1, 'wait_calls': 0}
```

## Observed Behavior

`_SpawnInvoker.__call__()` invokes `subprocess.Popen(...)` before constructing `SpawnHandle`. In `SpawnHandle.__init__()`, `_start_cancel_watcher()` detects that the valid supplied cancellation event is already set and calls `_send_interrupt(process)` immediately. When `process.send_signal(...)` raises, the exception escapes the constructor. The spawned process has already been created, but no handle is returned and no cleanup or reaping operation is attempted, as shown by `wait_calls == 0`.

## Expected Behavior

An already-cancelled valid event should either prevent child creation or result in a managed cancellation attempt. If interrupt delivery fails after launch, the wrapper should retain control long enough to clean up or return a handle/result that exposes the live child and cancellation failure; it should not orphan the process during object construction.

## Impact

Applications that start work with a cancellation token already set can leak active `poe-code` processes when signal dispatch fails due to platform, permission, or process-control errors. The caller receives only the interrupt exception and has no `SpawnHandle` with which to inspect, retry cancellation, consume output, or reap the child, allowing cancelled work to continue unexpectedly.
