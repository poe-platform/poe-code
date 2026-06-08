import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerExecutionEnvFactory,
  type ExecutionEnvFactory,
  type OpenSpec,
  type RunHandle,
  type RunSpec
} from "@poe-code/agent-harness-tools";
import { e2bExecutionEnvFactory } from "@poe-code/runner-e2b";
import { spawn } from "./spawn.js";

describe("spawn through e2b with captured sandbox fake", () => {
  const repoRoot = process.cwd();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      POE_API_KEY: "sk-poe-captured-sandbox"
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    registerExecutionEnvFactory(e2bExecutionEnvFactory);
  });

  it("uploads a fresh tmp workspace, configures claude-code, and runs in the sandbox", async () => {
    const sandbox = createCapturedSandbox();
    registerExecutionEnvFactory(createCapturedE2bFactory(sandbox));

    const workspace = await mkdtemp(path.join(tmpdir(), "poe-e2b-spawn-"));
    try {
      await writeFile(
        path.join(workspace, "README.md"),
        "This is a tiny throwaway workspace for validating e2b spawn wiring.\n",
        "utf8"
      );
      await writeFile(path.join(workspace, "hello.txt"), "hello from the sandbox\n", "utf8");
      await expect(readdir(workspace).then((files) => files.sort())).resolves.toEqual([
        "README.md",
        "hello.txt"
      ]);

      const result = await spawn(
        "claude-code",
        {
          prompt: "read hello.txt and summarize in one sentence",
          cwd: workspace,
          runtime: "e2b",
          runtimeConfigCwd: repoRoot
        },
        {
          homeDir: path.join(workspace, ".home"),
          state: createMemoryState()
        }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).not.toBe("");
      expect(sandbox.uploadedWorkspaces).toEqual([
        { cwd: workspace, files: ["README.md", "hello.txt"] }
      ]);
      expect(sandbox.downloadedWorkspaces).toEqual([workspace]);
      expect(sandbox.openSpecs).toHaveLength(1);
      expect(sandbox.openSpecs[0]).toMatchObject({
        cwd: workspace,
        runtimeCwd: repoRoot,
        runtime: expect.objectContaining({ type: "e2b" })
      });
      expect(sandbox.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ command: "which", args: ["claude"] }),
          expect.objectContaining({
            command: "poe-code",
            args: [
              "configure",
              "--yes",
              "--provider",
              "poe",
              "claude-code"
            ]
          }),
          expect.objectContaining({ command: "claude" })
        ])
      );
      expect(sandbox.requestLog).toContain("https://api.poe.com/v1/chat/completions");
      await expect(readdir(repoRoot)).resolves.not.toContain("hello.txt");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

interface CapturedSandbox {
  openSpecs: OpenSpec[];
  commands: Array<{ command: string; args: string[]; cwd?: string; env?: Record<string, string> }>;
  uploadedWorkspaces: Array<{ cwd: string; files: string[] }>;
  downloadedWorkspaces: string[];
  requestLog: string[];
}

function createCapturedSandbox(): CapturedSandbox {
  return {
    openSpecs: [],
    commands: [],
    uploadedWorkspaces: [],
    downloadedWorkspaces: [],
    requestLog: []
  };
}

function createCapturedE2bFactory(sandbox: CapturedSandbox): ExecutionEnvFactory {
  return {
    type: "e2b",
    supportsDetach: true,
    async open(spec) {
      sandbox.openSpecs.push(spec);
      return {
        id: "captured-sandbox",
        job: null,
        async uploadWorkspace() {
          sandbox.uploadedWorkspaces.push({
            cwd: spec.cwd,
            files: (await readdir(spec.cwd)).sort()
          });
          return { files: 2, bytes: 1, skipped: [] };
        },
        async downloadWorkspace() {
          sandbox.downloadedWorkspaces.push(spec.cwd);
          return { files: 0, bytes: 0, conflicts: [] };
        },
        exec(runSpec) {
          sandbox.commands.push({
            command: runSpec.command,
            args: runSpec.args ?? [],
            cwd: runSpec.cwd,
            env: runSpec.env
          });
          return runCapturedCommand(sandbox, runSpec);
        },
        async detach() {
          throw new Error("captured e2b fake does not support detach");
        },
        shell() {
          throw new Error("captured e2b fake does not support shell");
        },
        async close() {}
      };
    },
    async attach() {
      throw new Error("captured e2b fake does not support attach");
    }
  };
}

function runCapturedCommand(sandbox: CapturedSandbox, spec: RunSpec): RunHandle {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const result = new Promise<{ exitCode: number }>((resolve) => {
    queueMicrotask(() => {
      const response = capturedCommandResponse(sandbox, spec);
      if (response.stdout) {
        stdout.write(response.stdout);
      }
      if (response.stderr) {
        stderr.write(response.stderr);
      }
      stdout.end();
      stderr.end();
      resolve({ exitCode: response.exitCode });
    });
  });

  return {
    pid: 123,
    stdin: null,
    stdout,
    stderr,
    result,
    kill: vi.fn()
  };
}

function capturedCommandResponse(
  sandbox: CapturedSandbox,
  spec: RunSpec
): { exitCode: number; stdout?: string; stderr?: string } {
  if (spec.command === "which" && spec.args?.[0] === "claude") {
    return { exitCode: 0, stdout: "/usr/local/bin/claude\n" };
  }

  if (spec.command === "poe-code" && spec.args?.[0] === "configure") {
    return { exitCode: 0, stdout: "configured claude-code for poe\n" };
  }

  if (spec.command === "claude") {
    if (!spec.env?.POE_API_KEY) {
      return { exitCode: 1, stderr: "missing POE_API_KEY\n" };
    }
    sandbox.requestLog.push("https://api.poe.com/v1/chat/completions");
    return {
      exitCode: 0,
      stdout: [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "hello.txt says hello from the sandbox." }]
          }
        }),
        JSON.stringify({ type: "result", usage: { input_tokens: 1, output_tokens: 1 } }),
        ""
      ].join("\n")
    };
  }

  return { exitCode: 127, stderr: `${spec.command}: command not found\n` };
}

function createMemoryState() {
  const jobs = new Map<string, Record<string, unknown>>();
  return {
    templates: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      list: vi.fn(async () => [])
    },
    jobs: {
      get: vi.fn(async (id: string) => jobs.get(id) ?? null),
      put: vi.fn(async (entry: Record<string, unknown>) => {
        jobs.set(String(entry.id), entry);
      }),
      update: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        const current = jobs.get(id);
        if (!current) {
          return null;
        }
        const updated = { ...current, ...patch, id };
        jobs.set(id, updated);
        return updated;
      }),
      list: vi.fn(async () => Array.from(jobs.values())),
      remove: vi.fn(async (id: string) => {
        jobs.delete(id);
      })
    }
  };
}
