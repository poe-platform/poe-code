# Python Poe spawn async cancel signal failure is hidden behind success

## Summary

The exported `poe_spawn.spawn(..., cancel_event=...)` handles later cancellation in a daemon watcher thread. If that thread fails to deliver the interrupt signal to the running child, it crashes only in the background while the public `SpawnHandle` continues consuming output and reports a successful result. The caller cannot learn that its cancellation request was not enforced.

## Reproduction

Run this disposable Python probe from the repository root. It creates a valid cancellation event, obtains a public handle, then triggers cancellation against a started child whose `send_signal()` fails:

```sh
cat > /tmp/py_poe_spawn_async_cancel_signal_failure_probe.py <<'PY'
import io
import threading
import time
from unittest.mock import patch
from poe_spawn import spawn

class FakeProcess:
    def __init__(self):
        self.stdout = io.StringIO('{"event":"agent_message","text":"done"}\n')
        self.signal_calls = 0

    def poll(self):
        return None

    def send_signal(self, sig):
        self.signal_calls += 1
        raise PermissionError("signal denied")

    def wait(self):
        return 0

child = FakeProcess()
cancel_event = threading.Event()

with patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), patch(
    "poe_spawn._spawn.subprocess.Popen", return_value=child
):
    handle = spawn("codex", "probe", cancel_event=cancel_event)
    cancel_event.set()
    time.sleep(0.1)
    events = list(handle.events)
    print({
        "events": events,
        "result": handle.result,
        "signal_calls": child.signal_calls,
        "watcher_alive": handle._cancel_watcher.is_alive(),
    })
    assert child.signal_calls == 1
    assert handle.result.exit_code == 0
PY
PYTHONPATH=packages/py-poe-spawn/src python3 /tmp/py_poe_spawn_async_cancel_signal_failure_probe.py 2>&1
rm -f /tmp/py_poe_spawn_async_cancel_signal_failure_probe.py
```

The probe prints a background exception followed by a successful public result:

```text
Exception in thread Thread-1:
...
PermissionError: signal denied
{'events': [AgentMessageEvent(event='agent_message', text='done')], 'result': SpawnResultEvent(event='spawn_result', exit_code=0, thread_id=None, usage=None, protocol_version=None), 'signal_calls': 1, 'watcher_alive': False}
```

## Observed Behavior

For a cancellation object exposing `is_set()`, `_start_cancel_watcher()` creates a daemon thread targeting `_poll_cancel_event()`. Once cancellation is signaled, `_poll_cancel_event()` calls `_send_interrupt(process)` without catching failures or communicating them back to `SpawnHandle`. In the reproduction, `send_signal()` throws `PermissionError`, the watcher terminates with an uncaught thread exception, but consuming `handle.events` finalizes the child as `exit_code=0` and exposes no cancellation error.

## Expected Behavior

Failure to deliver a requested cancellation signal should reach the public handle/result or otherwise be represented as a controlled cancellation failure. A run for which cancellation was requested but not successfully applied should not silently resolve as ordinary success while the only error is printed from an internal daemon thread.

## Impact

Automation can request cancellation, fail to stop an agent process, and still treat its subsequent output as a successful completed run. This can permit cancelled work to continue mutating state, cause pipelines to report false success, and leave users unaware that process-control enforcement failed unless they happen to inspect background thread diagnostics.
