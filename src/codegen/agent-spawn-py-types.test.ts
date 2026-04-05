import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { generateAgentSpawnPythonTypes } from "./agent-spawn-py-types.js";

describe("generateAgentSpawnPythonTypes", () => {
  it("renders Python enums and dataclasses from the TypeScript AST", () => {
    const project = new Project({
      useInMemoryFileSystem: true
    });
    const acpTypesSourceFile = project.createSourceFile(
      "/packages/agent-spawn/src/acp/types.ts",
      `
export interface ContentChunk {
  type: "text";
  text: string;
}

export interface SessionStartEvent {
  event: "session_start";
  threadId?: string;
  _meta?: Record<string, unknown>;
}

export interface UsageEvent {
  event: "usage";
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
  _meta?: Record<string, unknown>;
}

export interface SpawnResultEvent {
  event: "spawn_result";
  exitCode: number;
  threadId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    costUsd?: number;
  };
  protocolVersion?: number;
}

export type KnownAcpEvent = SessionStartEvent | UsageEvent | SpawnResultEvent;
export type AcpEvent = KnownAcpEvent | { event: string };
`
    );
    const spawnTypesSourceFile = project.createSourceFile(
      "/packages/agent-spawn/src/types.ts",
      `
export type SpawnMode = "yolo" | "edit" | "read";
`
    );

    const output = generateAgentSpawnPythonTypes({
      acpTypesSourceFile,
      spawnTypesSourceFile,
      spawnConfigs: [
        { kind: "cli", agentId: "claude-code" },
        { kind: "file", agentId: "claude-desktop" },
        { kind: "cli", agentId: "codex" }
      ]
    });

    expect(output).toBe(`from dataclasses import dataclass
from enum import Enum
from typing import Literal, Optional, Union


class Agent(str, Enum):
    CLAUDE_CODE = "claude-code"
    CODEX = "codex"


class SpawnMode(str, Enum):
    YOLO = "yolo"
    EDIT = "edit"
    READ = "read"


@dataclass
class SessionStartEvent:
    event: Literal["session_start"]
    thread_id: Optional[str] = None


@dataclass
class UsageEvent:
    event: Literal["usage"]
    input_tokens: int
    output_tokens: int
    cached_tokens: Optional[int] = None
    cost_usd: Optional[float] = None


@dataclass
class SpawnResultEvent:
    event: Literal["spawn_result"]
    exit_code: int
    thread_id: Optional[str] = None
    usage: Optional[UsageEvent] = None
    protocol_version: Optional[int] = None


AcpEvent = Union[
    SessionStartEvent,
    UsageEvent,
]`);
  });

  it("wraps undefined unions as Optional exactly once", () => {
    const project = new Project({
      useInMemoryFileSystem: true
    });
    const acpTypesSourceFile = project.createSourceFile(
      "/packages/agent-spawn/src/acp/types.ts",
      `
export interface ErrorEvent {
  event: "error";
  message: string | undefined;
  stack?: string | undefined;
}

export type KnownAcpEvent = ErrorEvent;
`
    );
    const spawnTypesSourceFile = project.createSourceFile(
      "/packages/agent-spawn/src/types.ts",
      `
export type SpawnMode = "read";
`
    );

    const output = generateAgentSpawnPythonTypes({
      acpTypesSourceFile,
      spawnTypesSourceFile,
      spawnConfigs: []
    });

    expect(output).toContain("message: Optional[str] = None");
    expect(output).toContain("stack: Optional[str] = None");
    expect(output).not.toContain("Optional[Optional[str]]");
  });

  it("renders literal unions from inline types and type aliases", () => {
    const project = new Project({
      useInMemoryFileSystem: true
    });
    const acpTypesSourceFile = project.createSourceFile(
      "/packages/agent-spawn/src/acp/types.ts",
      `
export type ToolCallStatus = "pending" | "completed";

export interface ToolStatusEvent {
  event: "tool_status";
  status: ToolCallStatus;
  source: "cli" | "sdk";
  ok?: boolean | undefined;
}

export type KnownAcpEvent = ToolStatusEvent;
`
    );
    const spawnTypesSourceFile = project.createSourceFile(
      "/packages/agent-spawn/src/types.ts",
      `
export type SpawnMode = "read";
`
    );

    const output = generateAgentSpawnPythonTypes({
      acpTypesSourceFile,
      spawnTypesSourceFile,
      spawnConfigs: []
    });

    expect(output).toContain('status: Literal["pending", "completed"]');
    expect(output).toContain('source: Literal["cli", "sdk"]');
    expect(output).toContain("ok: Optional[bool] = None");
  });
});
