# Python spawn overwrites CLI spawn result exit code with wrapper status

## Summary

`poe_spawn.spawn()` parses the CLI's final `spawn_result` protocol record but discards its `exitCode` during finalization. If `poe-code` reports an agent failure in its JSONL result while the wrapper process itself exits successfully, the Python SDK returns exit code `0` and masks the reported failed agent run.

## Reproduction

Run this disposable Python probe from the repository root. The fake process emits a protocol-level failed result but returns a successful transport/process status from `wait()`:

```sh
PYTHONPATH=packages/py-poe-spawn/src python3 - <<'PY'
import io
from unittest.mock import patch
from poe_spawn import spawn

class FakeProcess:
    def __init__(self):
        self.stdout = io.StringIO('{"event":"spawn_result","exitCode":9,"threadId":"t"}\n')

    def wait(self):
        return 0

    def send_signal(self, _signal):
        pass

with patch('poe_spawn._spawn._resolve_cli_command', return_value=['poe-code']), patch(
    'poe_spawn._spawn.subprocess.Popen', return_value=FakeProcess()
):
    handle = spawn('codex', 'probe')
    list(handle.events)

observed = {
    'emitted_exit_code': 9,
    'returned_exit_code': handle.result.exit_code,
    'thread_id': handle.result.thread_id,
}
print(observed)
assert observed == {'emitted_exit_code': 9, 'returned_exit_code': 0, 'thread_id': 't'}
print('PASS: protocol failure is replaced by successful wrapper status')
PY
```

## Observed Behavior

The final result retains the emitted thread identifier but replaces the emitted failure status with the process status:

```text
{'emitted_exit_code': 9, 'returned_exit_code': 0, 'thread_id': 't'}
PASS: protocol failure is replaced by successful wrapper status
```

`SpawnHandle._iter_events()` stores any parsed `spawn_result` record in `self._result_event` at `packages/py-poe-spawn/src/poe_spawn/_spawn.py:64`. During finalization, `_finalize()` obtains the subprocess status and constructs a new `SpawnResultEvent` with `exit_code=exit_code` unconditionally at `packages/py-poe-spawn/src/poe_spawn/_spawn.py:83`, while it preserves only `thread_id`, `usage`, and `protocol_version` from the parsed result. The CLI-provided `parsed.exit_code` is never returned.

## Expected Behavior

When the CLI emits a valid terminal `spawn_result`, the Python SDK should expose that protocol result, including its agent-run `exitCode`. It may use the child process status only when no final result record was emitted, or surface an explicit mismatch if transport status and protocol status conflict.

## Impact

Python automation can interpret a failed agent run as successful whenever the JSON protocol communicates failure independently of the wrapper process exit status. CI orchestration, retry logic, failure notifications, and callers deciding whether to trust generated edits can all proceed incorrectly because the SDK masks the protocol-level failure.
