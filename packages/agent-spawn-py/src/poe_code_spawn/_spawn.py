from __future__ import annotations

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
        self._cancel_watcher_done = threading.Event()
        self._cancel_watcher = _start_cancel_watcher(
            process=self._process,
            cancel_event=self._cancel_event,
            done=self._cancel_watcher_done,
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

        exit_code = self._process.wait()
        parsed = self._result_event
        self._result_event = SpawnResultEvent(
            event="spawn_result",
            exit_code=exit_code,
            thread_id=(parsed.thread_id if parsed else None) or self._last_thread_id,
            usage=(parsed.usage if parsed else None) or self._last_usage,
            protocol_version=parsed.protocol_version if parsed else None,
        )
        self._completed = True
        self._cancel_watcher_done.set()
        if self._cancel_watcher is not None:
            self._cancel_watcher.join(timeout=0.1)


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
        mcp_config: Optional[Mapping[str, Any]] = None,
        mcp_servers: Optional[Mapping[str, Any]] = None,
        log_dir: Optional[str] = None,
        activity_timeout_ms: Optional[int] = None,
        cancel_event: Any = None,
    ) -> SpawnHandle:
        command = _build_spawn_command(
            agent=agent,
            prompt=prompt,
            cwd=cwd,
            model=model,
            mode=mode,
            args=args,
            mcp_config=mcp_config,
            mcp_servers=mcp_servers,
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
        mcp_config: Optional[Mapping[str, Any]] = None,
        mcp_servers: Optional[Mapping[str, Any]] = None,
        log_dir: Optional[str] = None,
        activity_timeout_ms: Optional[int] = None,
        cancel_event: Any = None,
    ) -> SpawnResultEvent:
        command = _build_spawn_command(
            agent=agent,
            prompt=prompt,
            cwd=cwd,
            model=model,
            mode=mode,
            args=args,
            mcp_config=mcp_config,
            mcp_servers=mcp_servers,
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
        watcher = _start_cancel_watcher(
            process=process,
            cancel_event=cancel_event,
            done=watcher_done,
        )

        try:
            exit_code = process.wait()
        finally:
            watcher_done.set()
            if watcher is not None:
                watcher.join(timeout=0.1)

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
    mcp_config: Optional[Mapping[str, Any]],
    mcp_servers: Optional[Mapping[str, Any]],
    log_dir: Optional[str],
    activity_timeout_ms: Optional[int],
) -> list[str]:
    command = [*_resolve_cli_command(), "--yes", "spawn"]

    if model is not None:
        command.extend(["--model", model])

    if cwd is not None:
        command.extend(["--cwd", cwd])

    if mode is not None:
        command.extend(["--mode", _enum_value(mode)])

    resolved_mcp_config = _resolve_mcp_config(mcp_config, mcp_servers)
    if resolved_mcp_config is not None:
        command.extend(["--mcp-config", json.dumps(resolved_mcp_config, separators=(",", ":"))])

    if log_dir is not None:
        command.extend(["--log-dir", log_dir])

    if activity_timeout_ms is not None:
        timeout = int(activity_timeout_ms)
        if timeout <= 0:
            raise ValueError("activity_timeout_ms must be a positive integer.")
        command.extend(["--activity-timeout-ms", str(timeout)])

    command.extend([_enum_value(agent), prompt])

    if args:
        command.extend(args)

    return command


def _resolve_mcp_config(
    mcp_config: Optional[Mapping[str, Any]],
    mcp_servers: Optional[Mapping[str, Any]],
) -> Optional[Mapping[str, Any]]:
    if mcp_config is not None and mcp_servers is not None:
        raise ValueError("Pass either mcp_config or mcp_servers, not both.")

    if mcp_servers is not None:
        warnings.warn(
            "mcp_servers is deprecated; use mcp_config instead.",
            DeprecationWarning,
            stacklevel=3,
        )
        return mcp_servers

    return mcp_config


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


def _enum_value(value: Agent | SpawnMode | str) -> str:
    if isinstance(value, (Agent, SpawnMode)):
        return value.value
    return value


def _start_cancel_watcher(
    *,
    process: subprocess.Popen[str],
    cancel_event: Any,
    done: threading.Event,
) -> Optional[threading.Thread]:
    if cancel_event is None:
        return None

    has_wait = hasattr(cancel_event, "wait") and callable(cancel_event.wait)
    has_is_set = hasattr(cancel_event, "is_set") and callable(cancel_event.is_set)

    if not has_wait and not has_is_set:
        raise TypeError("cancel_event must expose wait() or is_set().")

    if has_is_set and cancel_event.is_set():
        _send_interrupt(process)
        return None

    target = _poll_cancel_event if has_is_set else _wait_for_cancel_event
    thread = threading.Thread(target=target, args=(process, cancel_event, done), daemon=True)
    thread.start()
    return thread


def _wait_for_cancel_event(
    process: subprocess.Popen[str],
    cancel_event: Any,
    done: threading.Event,
) -> None:
    while not done.is_set():
        try:
            did_cancel = bool(cancel_event.wait(0.05))
        except TypeError:
            cancel_event.wait()
            did_cancel = True

        if did_cancel and not done.is_set():
            _send_interrupt(process)
            return


def _poll_cancel_event(
    process: subprocess.Popen[str],
    cancel_event: Any,
    done: threading.Event,
) -> None:
    while not done.is_set():
        if cancel_event.is_set():
            _send_interrupt(process)
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
