# Python Poe spawn string args expand into character arguments

## Summary

The public `py-poe-spawn` API accepts a bare string for its `args` option and appends each character as a separate child-process argument. Passing `args="--verbose"` therefore launches `poe-code` with `-`, `-`, `v`, `e`, `r`, `b`, `o`, `s`, `e` instead of forwarding the intended single extra agent CLI flag or rejecting the malformed SDK input.

## Reproduction

Run this disposable Python probe from the repository root. It patches process startup only to observe the command produced by the exported `spawn.pretty(...)` API:

```sh
cat > /tmp/py_poe_spawn_string_args_probe.py <<'PY'
from unittest.mock import patch
from poe_spawn import spawn

class FakeProcess:
    def __init__(self):
        self.stdout = None

    def wait(self):
        return 0

calls = []

def fake_popen(command, **kwargs):
    calls.append(command)
    return FakeProcess()

with patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), patch(
    "poe_spawn._spawn.subprocess.Popen", side_effect=fake_popen
):
    result = spawn.pretty("codex", "probe", args="--verbose")

print({"exit_code": result.exit_code, "command": calls[0], "tail": calls[0][-9:]})
assert calls[0][-9:] == list("--verbose")
PY
PYTHONPATH=packages/py-poe-spawn/src python3 /tmp/py_poe_spawn_string_args_probe.py
rm -f /tmp/py_poe_spawn_string_args_probe.py
```

The probe succeeds and prints:

```text
{'exit_code': 0, 'command': ['poe-code', '--yes', 'spawn', 'codex', 'probe', '-', '-', 'v', 'e', 'r', 'b', 'o', 's', 'e'], 'tail': ['-', '-', 'v', 'e', 'r', 'b', 'o', 's', 'e']}
```

## Observed Behavior

The README describes `args` as `Sequence[str] | None` containing extra agent CLI arguments. Both public invocation methods forward the value into `_build_spawn_command()`, which uses `command.extend(args)` whenever `args` is truthy. Because Python strings are iterable sequences, an accidental bare string is accepted and each character is emitted as an individual process argument. The wrapper neither detects string misuse nor preserves it as one intended CLI argument.

## Expected Behavior

The Python wrapper should require `args` to be a non-string sequence of argument strings, or clearly accept a single string as one argument. Supplying a bare string should never silently mutate one requested flag into per-character command arguments.

## Impact

Python integrations can launch agents with corrupted extra flags while the wrapper reports normal process startup. Options such as `--verbose`, custom provider flags, or agent-specific switches are lost and replaced by malformed one-character arguments, producing confusing downstream CLI parse failures or unintended execution behavior that is difficult to attribute to the SDK call site.
