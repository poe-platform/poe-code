# Python spawn returns malformed JSONL fields as typed events

## Summary

The `poe_spawn` README promises typed ACP events and states that malformed JSONL lines are skipped. However, its JSONL parser validates only that required dataclass field names exist, not that values have the documented types. A malformed child stream can therefore return `UsageEvent` and `SpawnResultEvent` instances whose integer and string fields contain incompatible runtime values.

## Reproduction

Run this disposable Python probe from the repository root. It injects a fake `poe-code` process that emits syntactically valid JSONL with structurally invalid ACP field types, then consumes it through the public `spawn()` API:

```sh
PYTHONPATH=packages/py-poe-spawn/src python3 - <<'PY'
import io
from unittest.mock import patch
from poe_spawn import spawn
from poe_spawn.types import UsageEvent

class FakeProcess:
    def __init__(self):
        self.stdout = io.StringIO(
            '{"event":"usage","inputTokens":"lots","outputTokens":null}\n'
            '{"event":"spawn_result","exitCode":0,"threadId":17,"usage":{"inputTokens":"lots","outputTokens":null}}\n'
        )

    def wait(self):
        return 0

    def send_signal(self, _signal):
        pass

with patch('poe_spawn._spawn._resolve_cli_command', return_value=['poe-code']), patch(
    'poe_spawn._spawn.subprocess.Popen', return_value=FakeProcess()
):
    handle = spawn('codex', 'probe')
    events = list(handle.events)
    result = handle.result

observed = {
    'event_input_type': type(events[0].input_tokens).__name__,
    'event_output': events[0].output_tokens,
    'result_thread_type': type(result.thread_id).__name__,
    'result_usage_input_type': type(result.usage.input_tokens).__name__,
}
print(observed)
assert isinstance(events[0], UsageEvent)
assert observed == {
    'event_input_type': 'str',
    'event_output': None,
    'result_thread_type': 'int',
    'result_usage_input_type': 'str',
}
print('PASS: public SpawnHandle exposes malformed typed events')
PY
```

## Observed Behavior

The public handle exposes invalidly typed fields inside dataclasses documented as typed protocol events:

```text
{'event_input_type': 'str', 'event_output': None, 'result_thread_type': 'int', 'result_usage_input_type': 'str'}
PASS: public SpawnHandle exposes malformed typed events
```

The public field declarations require `UsageEvent.input_tokens` and `UsageEvent.output_tokens` to be integers and `SpawnResultEvent.thread_id` to be `str | None` in `packages/py-poe-spawn/src/poe_spawn/types.py:54` and `packages/py-poe-spawn/src/poe_spawn/types.py:70`. `parse_jsonl_line()` normalizes JSON keys and constructs these classes in `packages/py-poe-spawn/src/poe_spawn/_parse.py:30`, but `_instantiate_dataclass()` only catches missing/extra-constructor shape errors in `packages/py-poe-spawn/src/poe_spawn/_parse.py:77`; Python dataclass constructors do not enforce annotation types at runtime. As a result, the invalid values are accepted instead of being skipped as malformed input.

## Expected Behavior

Protocol parsing should validate each event field against its documented runtime type before yielding a typed event or storing a spawn result. JSONL records with incompatible field types should be skipped or surfaced as a clear protocol error rather than masquerading as valid `AcpEvent` and `SpawnResultEvent` objects.

## Impact

Malformed or version-incompatible CLI output can break Python caller assumptions after passing through the SDK's typed API: token accounting may receive strings or `None`, thread lookup may receive non-string identifiers, and downstream arithmetic, serialization, or routing code can fail or silently corrupt state. The documented defensive parser boundary does not protect applications from invalid protocol records.
