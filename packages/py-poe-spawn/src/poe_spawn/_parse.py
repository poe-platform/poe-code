from __future__ import annotations

import json
import math
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

    if event_type is ToolCompleteEvent and "kind" not in normalized:
        normalized["kind"] = None

    event = _instantiate_dataclass(event_type, normalized)
    if event is None or not _is_valid_event(event):
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
    result = cast(Optional[SpawnResultEvent], _instantiate_dataclass(SpawnResultEvent, spawn_result_fields))
    return result if result is not None and _is_valid_spawn_result(result) else None


def _instantiate_dataclass(dataclass_type: Type[Any], payload: dict[str, Any]) -> Optional[Any]:
    field_names = {field.name for field in fields(dataclass_type)}
    kwargs = {
        key: value for key, value in payload.items() if key in field_names
    }

    try:
        return dataclass_type(**kwargs)
    except TypeError:
        return None


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_non_negative_int(value: Any) -> bool:
    return _is_int(value) and value >= 0


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_optional_str(value: Any) -> bool:
    return value is None or isinstance(value, str)


def _is_valid_usage(event: UsageEvent) -> bool:
    return (
        event.event == "usage"
        and _is_non_negative_int(event.input_tokens)
        and _is_non_negative_int(event.output_tokens)
        and (event.cached_tokens is None or _is_non_negative_int(event.cached_tokens))
        and (event.cost_usd is None or _is_finite_number(event.cost_usd))
    )


def _is_valid_event(event: Any) -> bool:
    if isinstance(event, SessionStartEvent):
        return event.event == "session_start" and _is_optional_str(event.thread_id)
    if isinstance(event, AgentMessageEvent):
        return event.event == "agent_message" and isinstance(event.text, str)
    if isinstance(event, ToolStartEvent):
        return (
            event.event == "tool_start"
            and isinstance(event.kind, str)
            and isinstance(event.title, str)
            and _is_optional_str(event.id)
        )
    if isinstance(event, ToolCompleteEvent):
        return (
            event.event == "tool_complete"
            and _is_optional_str(event.kind)
            and isinstance(event.path, str)
            and _is_optional_str(event.id)
        )
    if isinstance(event, ReasoningEvent):
        return event.event == "reasoning" and isinstance(event.text, str)
    if isinstance(event, UsageEvent):
        return _is_valid_usage(event)
    if isinstance(event, ErrorEvent):
        return event.event == "error" and isinstance(event.message, str) and _is_optional_str(event.stack)
    return False


def _is_valid_spawn_result(result: SpawnResultEvent) -> bool:
    return (
        result.event == "spawn_result"
        and _is_non_negative_int(result.exit_code)
        and _is_optional_str(result.thread_id)
        and (result.usage is None or _is_valid_usage(result.usage))
        and (result.protocol_version is None or _is_non_negative_int(result.protocol_version))
    )


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
