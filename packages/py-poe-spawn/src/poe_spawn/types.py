from dataclasses import dataclass
from enum import Enum
from typing import Literal, Optional, Union


class Agent(str, Enum):
    CLAUDE_CODE = "claude-code"
    CLAUDE = "claude"
    CODEX = "codex"
    CURSOR = "cursor"
    CURSOR_AGENT = "cursor-agent"
    GEMINI_CLI = "gemini-cli"
    GEMINI = "gemini"
    GOOSE = "goose"
    KIMI = "kimi"
    KIMI_CLI = "kimi-cli"
    OPENCODE = "opencode"
    PI = "pi"
    PI_AGENT = "pi-agent"
    POE_AGENT = "poe-agent"


class SpawnMode(str, Enum):
    YOLO = "yolo"
    AUTO = "auto"
    EDIT = "edit"
    READ = "read"


@dataclass
class SessionStartEvent:
    event: Literal["session_start"]
    thread_id: Optional[str] = None


@dataclass
class AgentMessageEvent:
    event: Literal["agent_message"]
    text: str


@dataclass
class ToolStartEvent:
    event: Literal["tool_start"]
    kind: str
    title: str
    id: Optional[str] = None


@dataclass
class ToolCompleteEvent:
    event: Literal["tool_complete"]
    kind: str
    path: str
    id: Optional[str] = None


@dataclass
class ReasoningEvent:
    event: Literal["reasoning"]
    text: str


@dataclass
class UsageEvent:
    event: Literal["usage"]
    input_tokens: int
    output_tokens: int
    cached_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    cost_source: Optional[Literal["reported", "estimated"]] = None


@dataclass
class ErrorEvent:
    event: Literal["error"]
    message: str
    stack: Optional[str] = None


@dataclass
class PermissionRejectedEvent:
    event: Literal["permission_rejected"]
    title: str


@dataclass
class SpawnResultEvent:
    event: Literal["spawn_result"]
    exit_code: int
    thread_id: Optional[str] = None
    usage: Optional[UsageEvent] = None
    protocol_version: Optional[int] = None


AcpEvent = Union[
    SessionStartEvent,
    AgentMessageEvent,
    ToolStartEvent,
    ToolCompleteEvent,
    ReasoningEvent,
    UsageEvent,
    ErrorEvent,
    PermissionRejectedEvent,
]
