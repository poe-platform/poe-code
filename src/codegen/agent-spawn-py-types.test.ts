import { describe, expect, it } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import { Project } from "ts-morph";
import { generateAgentSpawnPythonTypes, runAgentSpawnPythonTypeCodegen } from "./agent-spawn-py-types.js";

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

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
export const SPAWN_MODES = ["yolo", "auto", "edit", "read"] as const;
export type SpawnMode = (typeof SPAWN_MODES)[number];
`
    );

    const output = generateAgentSpawnPythonTypes({
      acpTypesSourceFile,
      spawnTypesSourceFile,
      spawnConfigs: [
        { kind: "cli", agentId: "claude-code", aliases: ["claude"] },
        { kind: "file", agentId: "claude-desktop" },
        { kind: "cli", agentId: "codex" }
      ]
    });

    expect(output).toBe(`from dataclasses import dataclass
from enum import Enum
from typing import Literal, Optional, Union


class Agent(str, Enum):
    CLAUDE_CODE = "claude-code"
    CLAUDE = "claude"
    CODEX = "codex"


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
  }, 15_000);

  it("rejects a generated Python types symlink outside the repository", async () => {
    const repoRoot = "/repo";
    const outputPath = `${repoRoot}/packages/py-poe-spawn/src/poe_spawn/types.py`;
    const volume = Volume.fromJSON({
      "/outside.py": "EXTERNAL ORIGINAL\n"
    });
    volume.mkdirSync(`${repoRoot}/packages/py-poe-spawn/src/poe_spawn`, { recursive: true });
    volume.symlinkSync("/outside.py", outputPath);
    const fileSystem = createFsFromVolume(volume).promises;
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/acp/types.ts`,
      'export interface SpawnResultEvent { event: "spawn_result"; exitCode: number; } export type KnownAcpEvent = SpawnResultEvent;'
    );
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/types.ts`,
      'export type SpawnMode = "read";'
    );

    await expect(runAgentSpawnPythonTypeCodegen({
      repoRoot,
      project,
      spawnConfigs: [],
      fileSystem
    })).rejects.toThrow("outside the repository");
    await expect(fileSystem.readFile("/outside.py", "utf8")).resolves.toBe("EXTERNAL ORIGINAL\n");
  });

  it("rejects a generated Python types symlink outside the repository in check mode", async () => {
    const repoRoot = "/repo";
    const outputPath = `${repoRoot}/packages/py-poe-spawn/src/poe_spawn/types.py`;
    const volume = Volume.fromJSON({
      "/outside.py": "EXTERNAL ORIGINAL\n"
    });
    volume.mkdirSync(`${repoRoot}/packages/py-poe-spawn/src/poe_spawn`, { recursive: true });
    volume.symlinkSync("/outside.py", outputPath);
    const fileSystem = createFsFromVolume(volume).promises;
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/acp/types.ts`,
      'export interface SpawnResultEvent { event: "spawn_result"; exitCode: number; } export type KnownAcpEvent = SpawnResultEvent;'
    );
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/types.ts`,
      'export type SpawnMode = "read";'
    );

    await expect(runAgentSpawnPythonTypeCodegen({
      check: true,
      repoRoot,
      project,
      spawnConfigs: [],
      fileSystem
    })).rejects.toThrow("outside the repository");
    await expect(fileSystem.readFile("/outside.py", "utf8")).resolves.toBe("EXTERNAL ORIGINAL\n");
  });

  it("does not treat inherited realpath codes as missing Python types output", async () => {
    const repoRoot = "/repo";
    const outputPath = `${repoRoot}/packages/py-poe-spawn/src/poe_spawn/types.py`;
    const volume = Volume.fromJSON({});
    volume.mkdirSync(`${repoRoot}/packages/py-poe-spawn/src/poe_spawn`, { recursive: true });
    const rawFileSystem = createFsFromVolume(volume).promises;
    const realpathError = new Error("realpath denied");
    const fileSystem = {
      ...rawFileSystem,
      async realpath(filePath: Parameters<typeof rawFileSystem.realpath>[0]) {
        if (String(filePath) === outputPath) {
          throw realpathError;
        }
        return rawFileSystem.realpath(filePath);
      }
    };
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/acp/types.ts`,
      'export interface SpawnResultEvent { event: "spawn_result"; exitCode: number; } export type KnownAcpEvent = SpawnResultEvent;'
    );
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/types.ts`,
      'export type SpawnMode = "read";'
    );

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(runAgentSpawnPythonTypeCodegen({
        repoRoot,
        project,
        spawnConfigs: [],
        fileSystem
      })).rejects.toBe(realpathError);
    });
  });

  it("does not treat inherited read codes as missing generated Python types", async () => {
    const repoRoot = "/repo";
    const outputPath = `${repoRoot}/packages/py-poe-spawn/src/poe_spawn/types.py`;
    const volume = Volume.fromJSON({});
    volume.mkdirSync(`${repoRoot}/packages/py-poe-spawn/src/poe_spawn`, { recursive: true });
    const rawFileSystem = createFsFromVolume(volume).promises;
    const readError = new Error("read denied");
    const fileSystem = {
      ...rawFileSystem,
      async readFile(
        filePath: Parameters<typeof rawFileSystem.readFile>[0],
        options?: Parameters<typeof rawFileSystem.readFile>[1]
      ) {
        if (String(filePath) === outputPath) {
          throw readError;
        }
        return rawFileSystem.readFile(filePath, options);
      }
    };
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/acp/types.ts`,
      'export interface SpawnResultEvent { event: "spawn_result"; exitCode: number; } export type KnownAcpEvent = SpawnResultEvent;'
    );
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/types.ts`,
      'export type SpawnMode = "read";'
    );

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(runAgentSpawnPythonTypeCodegen({
        repoRoot,
        project,
        spawnConfigs: [],
        fileSystem
      })).rejects.toBe(readError);
    });
  });

  it("does not follow generated Python types symlinks inserted during publish", async () => {
    const repoRoot = "/repo";
    const outputPath = `${repoRoot}/packages/py-poe-spawn/src/poe_spawn/types.py`;
    const volume = Volume.fromJSON({
      "/outside.py": "EXTERNAL ORIGINAL\n"
    });
    const rawFileSystem = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;
    const fileSystem = {
      ...rawFileSystem,
      async writeFile(
        filePath: Parameters<typeof rawFileSystem.writeFile>[0],
        data: Parameters<typeof rawFileSystem.writeFile>[1],
        options?: Parameters<typeof rawFileSystem.writeFile>[2]
      ) {
        const pathText = String(filePath);
        if (
          temporaryPath === undefined &&
          pathText.startsWith(`${repoRoot}/packages/py-poe-spawn/src/poe_spawn/.types.py.`) &&
          pathText.endsWith(".tmp")
        ) {
          temporaryPath = pathText;
          volume.symlinkSync("/outside.py", outputPath);
        }

        return rawFileSystem.writeFile(filePath, data, options);
      }
    };
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/acp/types.ts`,
      'export interface SpawnResultEvent { event: "spawn_result"; exitCode: number; } export type KnownAcpEvent = SpawnResultEvent;'
    );
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/types.ts`,
      'export type SpawnMode = "read";'
    );

    await expect(runAgentSpawnPythonTypeCodegen({
      repoRoot,
      project,
      spawnConfigs: [],
      fileSystem
    })).rejects.toThrow("outside the repository");

    expect(temporaryPath).toBeDefined();
    await expect(fileSystem.readFile("/outside.py", "utf8")).resolves.toBe("EXTERNAL ORIGINAL\n");
    await expect(fileSystem.lstat(temporaryPath as string)).rejects.toThrow("ENOENT");
    expect((await fileSystem.lstat(outputPath)).isSymbolicLink()).toBe(true);
  });

  it("cleans partial generated Python types temp files", async () => {
    const repoRoot = "/repo";
    const outputPath = `${repoRoot}/packages/py-poe-spawn/src/poe_spawn/types.py`;
    const volume = Volume.fromJSON({});
    volume.mkdirSync(repoRoot, { recursive: true });
    const rawFileSystem = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;
    const fileSystem = {
      ...rawFileSystem,
      async writeFile(
        filePath: Parameters<typeof rawFileSystem.writeFile>[0],
        data: Parameters<typeof rawFileSystem.writeFile>[1],
        options?: Parameters<typeof rawFileSystem.writeFile>[2]
      ) {
        const pathText = String(filePath);
        if (
          temporaryPath === undefined &&
          pathText.startsWith(`${repoRoot}/packages/py-poe-spawn/src/poe_spawn/.types.py.`) &&
          pathText.endsWith(".tmp")
        ) {
          temporaryPath = pathText;
          await rawFileSystem.writeFile(filePath, "partial", options);
          throw new Error("python types disk full");
        }

        return rawFileSystem.writeFile(filePath, data, options);
      }
    };
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/acp/types.ts`,
      'export interface SpawnResultEvent { event: "spawn_result"; exitCode: number; } export type KnownAcpEvent = SpawnResultEvent;'
    );
    project.createSourceFile(
      `${repoRoot}/packages/agent-spawn/src/types.ts`,
      'export type SpawnMode = "read";'
    );

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(runAgentSpawnPythonTypeCodegen({
        repoRoot,
        project,
        spawnConfigs: [],
        fileSystem
      })).rejects.toThrow("python types disk full");
    });

    expect(temporaryPath).toBeDefined();
    await expect(fileSystem.lstat(temporaryPath as string)).rejects.toThrow("ENOENT");
    await expect(fileSystem.lstat(outputPath)).rejects.toThrow("ENOENT");
  });
});
