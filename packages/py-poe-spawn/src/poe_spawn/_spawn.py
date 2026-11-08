from __future__ import annotations

import inspect
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import warnings
from collections.abc import Iterator, Mapping, Sequence
from typing import Any, Optional

from ._parse import parse_jsonl_line
from .types import AcpEvent, Agent, SessionStartEvent, SpawnMode, SpawnResultEvent, UsageEvent


class PoeCodeNotFoundError(RuntimeError):
    pass


class SpawnHandle:
    def __init__(
        self,
        process: subprocess.Popen[str],
        cancel_event: Any = None,
    ) -> None:
        self._process = process
        self._cancel_event = cancel_event
        self._cancel_error: Optional[BaseException] = None
        self._cancel_attempted = False
        self._cancel_lock = threading.Lock()
        self._cancel_watcher_done = threading.Event()
        self._cancel_watcher = _start_cancel_watcher(
            cancel_event=self._cancel_event,
            done=self._cancel_watcher_done,
            request_cancel=self._request_cancel,
        )
        self._completed = False
        self._result_event: Optional[SpawnResultEvent] = None
        self._last_thread_id: Optional[str] = None
        self._last_usage: Optional[UsageEvent] = None
        self.events = self._iter_events()

    @property
    def result(self) -> SpawnResultEvent:
        if not self._completed or self._result_event is None:
            raise RuntimeError("Result is not available until all events have been consumed.")
        return self._result_event

    def cancel(self) -> None:
        _send_interrupt(self._process)

    def _request_cancel(self) -> None:
        with self._cancel_lock:
            if self._cancel_attempted:
                return
            self._cancel_attempted = True

        try:
            _send_interrupt(self._process)
        except BaseException as error:
            self._cancel_error = error

    def _request_pending_cancel(self) -> None:
        if self._cancel_event is not None and _cancel_event_is_set(self._cancel_event):
            self._request_cancel()

    def _iter_events(self) -> Iterator[AcpEvent]:
        stdout = self._process.stdout
        if stdout is None:
            self._finalize()
            return

        try:
            while True:
                line = stdout.readline()
                if line == "":
                    break

                event, result = parse_jsonl_line(line)

                if result is not None:
                    self._result_event = result
                    continue

                if event is None:
                    continue

                if isinstance(event, SessionStartEvent) and event.thread_id:
                    self._last_thread_id = event.thread_id

                if isinstance(event, UsageEvent):
                    self._last_usage = event

                yield event
        finally:
            self._finalize()

    def _finalize(self) -> None:
        if self._completed:
            return

        self._request_pending_cancel()
        exit_code = self._process.wait()
        parsed = self._result_event
        self._result_event = SpawnResultEvent(
            event="spawn_result",
            exit_code=parsed.exit_code if parsed else exit_code,
            thread_id=(parsed.thread_id if parsed else None) or self._last_thread_id,
            usage=(parsed.usage if parsed else None) or self._last_usage,
            protocol_version=parsed.protocol_version if parsed else None,
        )
        self._completed = True
        self._cancel_watcher_done.set()
        if self._cancel_watcher is not None:
            self._cancel_watcher.join(timeout=0.1)
        if self._cancel_error is not None:
            raise self._cancel_error


class _SpawnInvoker:
    def __call__(
        self,
        agent: Agent | str,
        prompt: str,
        *,
        cwd: Optional[str] = None,
        model: Optional[str] = None,
        mode: SpawnMode | str | None = None,
        args: Optional[Sequence[str]] = None,
        mcp_servers: Optional[Mapping[str, Any]] = None,
        mcp_config: Optional[Mapping[str, Any]] = None,
        log_dir: Optional[str] = None,
        activity_timeout_ms: Optional[int] = None,
        cancel_event: Any = None,
    ) -> SpawnHandle:
        _validate_cancel_event(cancel_event)
        command = _build_spawn_command(
            agent=agent,
            prompt=prompt,
            cwd=cwd,
            model=model,
            mode=mode,
            args=args,
            mcp_servers=mcp_servers,
            mcp_config=mcp_config,
            log_dir=log_dir,
            activity_timeout_ms=activity_timeout_ms,
        )
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=None,
            text=True,
            bufsize=1,
            env=_child_env("json"),
        )
        return SpawnHandle(process, cancel_event=cancel_event)

    def pretty(
        self,
        agent: Agent | str,
        prompt: str,
        *,
        cwd: Optional[str] = None,
        model: Optional[str] = None,
        mode: SpawnMode | str | None = None,
        args: Optional[Sequence[str]] = None,
        mcp_servers: Optional[Mapping[str, Any]] = None,
        mcp_config: Optional[Mapping[str, Any]] = None,
        log_dir: Optional[str] = None,
        activity_timeout_ms: Optional[int] = None,
        cancel_event: Any = None,
    ) -> SpawnResultEvent:
        _validate_cancel_event(cancel_event)
        command = _build_spawn_command(
            agent=agent,
            prompt=prompt,
            cwd=cwd,
            model=model,
            mode=mode,
            args=args,
            mcp_servers=mcp_servers,
            mcp_config=mcp_config,
            log_dir=log_dir,
            activity_timeout_ms=activity_timeout_ms,
        )
        process = subprocess.Popen(
            command,
            stdout=None,
            stderr=None,
            text=True,
            env=_child_env("terminal"),
        )
        watcher_done = threading.Event()
        cancel_error: list[BaseException] = []

        def request_cancel() -> None:
            try:
                _send_interrupt(process)
            except BaseException as error:
                cancel_error.append(error)

        watcher = _start_cancel_watcher(cancel_event=cancel_event, done=watcher_done, request_cancel=request_cancel)

        try:
            exit_code = process.wait()
        finally:
            watcher_done.set()
            if watcher is not None:
                watcher.join(timeout=0.1)

        if cancel_error:
            raise cancel_error[0]

        return SpawnResultEvent(event="spawn_result", exit_code=exit_code)


spawn = _SpawnInvoker()


def _build_spawn_command(
    *,
    agent: Agent | str,
    prompt: str,
    cwd: Optional[str],
    model: Optional[str],
    mode: SpawnMode | str | None,
    args: Optional[Sequence[str]],
    mcp_servers: Optional[Mapping[str, Any]],
    mcp_config: Optional[Mapping[str, Any]],
    log_dir: Optional[str],
    activity_timeout_ms: Optional[int],
) -> list[str]:
    agent_value = _enum_string_value("agent", agent, (Agent,))
    prompt_value = _require_string("prompt", prompt)
    model_value = _require_optional_string("model", model)
    cwd_value = _require_optional_string("cwd", cwd)
    mode_value = _enum_string_value("mode", mode, (SpawnMode,)) if mode is not None else None
    log_dir_value = _require_optional_string("log_dir", log_dir)
    args_values = _validate_args(args)
    command = [*_resolve_cli_command(), "--yes", "spawn"]

    if model_value is not None:
        command.extend(["--model", model_value])

    if cwd_value is not None:
        command.extend(["--cwd", cwd_value])

    if mode_value is not None:
        command.extend(["--mode", mode_value])

    resolved_mcp_servers = _resolve_mcp_servers(mcp_servers, mcp_config)
    if resolved_mcp_servers is not None:
        command.extend(["--mcp-servers", json.dumps(resolved_mcp_servers, separators=(",", ":"))])

    if log_dir_value is not None:
        command.extend(["--log-dir", log_dir_value])

    if activity_timeout_ms is not None:
        if not isinstance(activity_timeout_ms, int) or isinstance(activity_timeout_ms, bool) or activity_timeout_ms <= 0:
            raise ValueError("activity_timeout_ms must be a positive integer.")
        command.extend(["--activity-timeout-ms", str(activity_timeout_ms)])

    command.extend([agent_value, prompt_value])

    if args_values:
        command.extend(args_values)

    return command


def _require_string(field: str, value: Any) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{field} must be a string.")
    return value


def _require_optional_string(field: str, value: Any) -> Optional[str]:
    if value is None:
        return None
    return _require_string(field, value)


def _enum_string_value(field: str, value: Any, enum_types: tuple[type[Any], ...]) -> str:
    if isinstance(value, enum_types):
        return value.value
    return _require_string(field, value)


def _validate_args(args: Optional[Sequence[str]]) -> Optional[list[str]]:
    if args is None:
        return None

    if isinstance(args, (str, bytes)):
        raise TypeError("args must be a sequence of strings, not a string.")

    if not isinstance(args, Sequence):
        raise TypeError("args must be a sequence of strings.")

    values = list(args)
    for index, value in enumerate(values):
        if not isinstance(value, str):
            raise TypeError(f"args[{index}] must be a string.")

    return values


def _resolve_mcp_servers(
    mcp_servers: Optional[Mapping[str, Any]],
    mcp_config: Optional[Mapping[str, Any]],
) -> Optional[Mapping[str, Any]]:
    if mcp_servers is not None and mcp_config is not None:
        raise ValueError("Pass either mcp_servers or mcp_config, not both.")

    if mcp_config is not None:
        warnings.warn(
            "mcp_config is deprecated; use mcp_servers instead.",
            DeprecationWarning,
            stacklevel=3,
        )
        return mcp_config

    return mcp_servers


def _resolve_cli_command() -> list[str]:
    poe_code = shutil.which("poe-code")
    if poe_code:
        return [poe_code]

    npx = shutil.which("npx")
    if npx:
        return [npx, "--yes", "poe-code"]

    raise PoeCodeNotFoundError(_build_not_found_message())


def _build_not_found_message() -> str:
    python_version = sys.version.split()[0]
    python_executable = sys.executable or "unknown"
    path_value = os.environ.get("PATH", "")
    node_version = _read_command_version("node")
    npm_version = _read_command_version("npm")

    return "\n".join(
        [
            "poe-code CLI not found on PATH.",
            "",
            "Environment:",
            f"  Python: {python_version} ({python_executable})",
            f"  PATH: {path_value}",
            f"  Node: {node_version}",
            f"  npm: {npm_version}",
            "",
            "Install with:",
            "  npm install -g poe-code",
        ]
    )


def _read_command_version(command: str) -> str:
    if shutil.which(command) is None:
        return "not found"

    try:
        completed = subprocess.run(
            [command, "--version"],
            capture_output=True,
            check=False,
            text=True,
            timeout=2,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return "not found"

    output = completed.stdout.strip() or completed.stderr.strip()
    return output or "not found"


def _child_env(output_format: str) -> dict[str, str]:
    env = dict(os.environ)
    env["OUTPUT_FORMAT"] = output_format
    return env


def _validate_cancel_event(cancel_event: Any) -> None:
    if cancel_event is None:
        return

    has_wait = hasattr(cancel_event, "wait") and callable(cancel_event.wait)
    has_is_set = hasattr(cancel_event, "is_set") and callable(cancel_event.is_set)

    if not has_wait and not has_is_set:
        raise TypeError("cancel_event must expose wait() or is_set().")

    if has_wait and not has_is_set:
        try:
            inspect.signature(cancel_event.wait).bind(0.05)
        except (TypeError, ValueError):
            raise TypeError("wait-only cancel_event.wait() must accept a timeout.") from None

def _cancel_event_is_set(cancel_event: Any) -> bool:
    return bool(hasattr(cancel_event, "is_set") and callable(cancel_event.is_set) and cancel_event.is_set())


def _start_cancel_watcher(
    *,
    cancel_event: Any,
    done: threading.Event,
    request_cancel: Any,
) -> Optional[threading.Thread]:
    _validate_cancel_event(cancel_event)
    if cancel_event is None:
        return None

    has_is_set = hasattr(cancel_event, "is_set") and callable(cancel_event.is_set)

    if has_is_set and cancel_event.is_set():
        request_cancel()
        return None

    target = _poll_cancel_event if has_is_set else _wait_for_cancel_event
    thread = threading.Thread(target=target, args=(cancel_event, done, request_cancel), daemon=True)
    thread.start()
    return thread


def _wait_for_cancel_event(
    cancel_event: Any,
    done: threading.Event,
    request_cancel: Any,
) -> None:
    while not done.is_set():
        did_cancel = bool(cancel_event.wait(0.05))
        if did_cancel and not done.is_set():
            request_cancel()
            return


def _poll_cancel_event(
    cancel_event: Any,
    done: threading.Event,
    request_cancel: Any,
) -> None:
    while not done.is_set():
        if cancel_event.is_set():
            request_cancel()
            return
        time.sleep(0.05)


def _send_interrupt(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.send_signal(_interrupt_signal())


def _interrupt_signal() -> int:
    if os.name == "nt" and hasattr(signal, "CTRL_BREAK_EVENT"):
        return signal.CTRL_BREAK_EVENT
    return signal.SIGINT
