#!/usr/bin/env python3

"""Run poe-code install/configure flows for each supported coding assistant."""

from __future__ import annotations

import os
import json
import shlex
import subprocess
import sys
from pathlib import Path
from typing import List, Optional


COMMAND_GROUPS: List[List[str]] = [
  [
    "poe-code install claude-code",
    "poe-code configure claude-code --yes",
    "poe-code test claude-code",
  ],
  [
    "poe-code install claude-code",
    "poe-code test claude-code --isolated",
  ],
  [
    "poe-code install codex",
    "poe-code configure codex --yes",
    "poe-code test codex",
  ],
  [
    "poe-code install codex",
    "poe-code test codex --isolated",
  ],
  [
    "poe-code install opencode",
    "poe-code configure opencode --yes",
    "poe-code test opencode",
  ],
  [
    "poe-code install opencode",
    "poe-code test opencode --isolated",
  ]
]


def repo_root() -> Path:
  return Path(__file__).resolve().parents[1]


def colima_runner_path() -> Path:
  path = repo_root() / "scripts" / "colima-runner.sh"
  if not path.exists():
    raise FileNotFoundError(f"colima runner not found at {path}")
  return path


def load_local_api_key() -> str:
  api_key = os.environ.get("POE_API_KEY") or os.environ.get("POE_CODE_API_KEY")
  if api_key:
    api_key = api_key.strip()
    if api_key:
      return api_key

  credentials_path = Path.home() / ".poe-code" / "credentials.json"
  try:
    payload = json.loads(credentials_path.read_text(encoding="utf8"))
  except FileNotFoundError as exc:
    raise RuntimeError(
      "Missing Poe credentials; set POE_API_KEY or login locally via `poe-code login`."
    ) from exc
  except json.JSONDecodeError as exc:
    raise RuntimeError(
      f"Invalid JSON in {credentials_path}; set POE_API_KEY to override."
    ) from exc

  value = payload.get("apiKey")
  if not isinstance(value, str) or not value.strip():
    raise RuntimeError(
      f"Missing apiKey in {credentials_path}; set POE_API_KEY to override."
    )
  return value.strip()


def make_login_command(api_key: str) -> str:
  return f"poe-code login --api-key {shlex.quote(api_key)}"


def redact_command(command: str) -> str:
  prefix = "poe-code login --api-key "
  if command.startswith(prefix):
    return f"{prefix}***"
  return command


def redact_failed_command(cmd: object) -> str:
  if isinstance(cmd, str):
    return redact_command(cmd)
  if isinstance(cmd, (list, tuple)):
    redacted: List[str] = []
    for item in cmd:
      redacted.append(redact_command(item) if isinstance(item, str) else str(item))
    return str(redacted)
  return str(cmd)


def run_commands(command_groups: Optional[List[List[str]]] = None) -> None:
  runner = str(colima_runner_path())
  env = os.environ.copy()
  api_key = load_local_api_key()
  env["POE_API_KEY"] = api_key

  docker_args = env.get("RUNNER_DOCKER_ARGS") or env.get("COLIMA_DOCKER_ARGS", "")
  extra_args = ["-e POE_CODE_STDERR_LOGS=1", "-e POE_API_KEY"]
  for extra_arg in extra_args:
    if extra_arg not in docker_args:
      docker_args = f"{docker_args} {extra_arg}".strip()
  env["RUNNER_DOCKER_ARGS"] = docker_args
  env["COLIMA_DOCKER_ARGS"] = docker_args

  login_cmd = make_login_command(api_key)

  groups = command_groups or COMMAND_GROUPS
  for index, commands in enumerate(groups, start=1):
    commands_with_login = [login_cmd, *commands]

    print(f"\n=== Command group {index} ===", flush=True)
    for command in commands_with_login:
      print(f"\n>>> {redact_command(command)}", flush=True)
    subprocess.run([runner, *commands_with_login], check=True, env=env)


def main() -> int:
  try:
    run_commands()
  except subprocess.CalledProcessError as exc:
    print(
      f"\nCommand failed with exit code {exc.returncode}: {redact_failed_command(exc.cmd)}",
      file=sys.stderr,
    )
    return exc.returncode
  except Exception as exc:  # pragma: no cover - defensive
    print(f"\nUnexpected error: {exc}", file=sys.stderr)
    return 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
