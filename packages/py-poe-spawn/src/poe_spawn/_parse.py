from __future__ import annotations

import json
from dataclasses import fields
from typing import Any, Optional, Tuple, Type, cast

from .types import (
    AcpEvent,
    AgentMessageEvent,
    ErrorEvent,
    ReasoningEvent,
    SessionStartEvent,
    SpawnResultEvent,
    ToolCompleteEvent,
    ToolStartEvent,
    UsageEvent,
)

_EVENT_TYPES: dict[str, Type[Any]] = {
    "session_start": SessionStartEvent,
    "agent_message": AgentMessageEvent,
    "tool_start": ToolStartEvent,
    "tool_complete": ToolCompleteEvent,
    "reasoning": ReasoningEvent,
    "usage": UsageEvent,
    "error": ErrorEvent,
}


def parse_jsonl_line(line: str) -> Tuple[Optional[AcpEvent], Optional[SpawnResultEvent]]:
    stripped = line.strip()
    if not stripped:
        return None, None

    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        return None, None

    if not isinstance(payload, dict):
        return None, None

    event_name = payload.get("event")
    if not isinstance(event_name, str):
        return None, None

    normalized = _normalize_keys(payload)

    if event_name == "spawn_result":
        return None, _parse_spawn_result(normalized)

    event_type = _EVENT_TYPES.get(event_name)
    if event_type is None:
        return None, None

    event = _instantiate_dataclass(event_type, normalized)
    if event is None:
        return None, None

    return cast(AcpEvent, event), None


def _parse_spawn_result(payload: dict[str, Any]) -> Optional[SpawnResultEvent]:
    usage_payload = payload.get("usage")
    usage = None

    if isinstance(usage_payload, dict):
        usage_fields = dict(usage_payload)
        usage_fields["event"] = "usage"
        usage = _instantiate_dataclass(UsageEvent, usage_fields)

    spawn_result_fields = dict(payload)
    spawn_result_fields["usage"] = usage
    return cast(Optional[SpawnResultEvent], _instantiate_dataclass(SpawnResultEvent, spawn_result_fields))


def _instantiate_dataclass(dataclass_type: Type[Any], payload: dict[str, Any]) -> Optional[Any]:
    field_names = {field.name for field in fields(dataclass_type)}
    kwargs = {
        key: value for key, value in payload.items() if key in field_names
    }

    try:
        return dataclass_type(**kwargs)
    except TypeError:
        return None


def _normalize_keys(payload: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in payload.items():
        normalized[_to_snake_case(key)] = _normalize_value(value)
    return normalized


def _normalize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return _normalize_keys(value)
    if isinstance(value, list):
        return [_normalize_value(item) for item in value]
    return value


def _to_snake_case(value: str) -> str:
    chars: list[str] = []
    previous_was_lower_or_digit = False

    for index, char in enumerate(value):
        if char.isupper():
            if index > 0 and previous_was_lower_or_digit:
                chars.append("_")
            chars.append(char.lower())
            previous_was_lower_or_digit = False
            continue

        chars.append(char)
        previous_was_lower_or_digit = char.islower() or char.isdigit()

    return "".join(chars)
