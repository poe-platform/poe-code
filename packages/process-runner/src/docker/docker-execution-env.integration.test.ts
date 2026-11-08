import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dockerExecutionEnvFactory } from "./docker-execution-env.js";
import type { OpenSpec } from "../types.js";

const dockerAvailable = spawnSync("docker", ["info"], {
  stdio: "ignore",
  timeout: 3000
}).status === 0;

describe.skipIf(!dockerAvailable)("dockerExecutionEnvFactory integration", () => {
  it("builds a local Dockerfile image and copies workspace changes back", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "poe-docker-env-"));
    const dockerfilePath = path.join(cwd, "Dockerfile");
    writeFileSync(dockerfilePath, "FROM alpine:latest\nWORKDIR /workspace\n", "utf8");
    writeFileSync(path.join(cwd, "input.txt"), "from-host", "utf8");

    const state = createMemoryState();
    const env = await dockerExecutionEnvFactory.open({
      cwd,
      runtime: {
        type: "docker",
        dockerfile: "Dockerfile",
        build_context: ".",
        build_args: {},
        mounts: []
      },
      state,
      env: {},
      uploadIgnoreFiles: [],
      jobLabel: {
        tool: "sh",
        argv: ["sh", "-c", "cat input.txt > output.txt"]
      }
    } satisfies OpenSpec);

    try {
      await env.uploadWorkspace();
      const handle = env.exec({
        command: "sh",
        args: ["-c", "cat input.txt > output.txt"],
        cwd,
        stdout: "pipe",
        stderr: "pipe"
      });

      await expect(handle.result).resolves.toEqual({ exitCode: 0 });
      await env.downloadWorkspace({ conflictPolicy: "overwrite" });
      expect(readFileSync(path.join(cwd, "output.txt"), "utf8")).toBe("from-host");
      expect(state.entries).toHaveLength(1);
    } finally {
      await env.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});

function createMemoryState() {
  const entries: unknown[] = [];
  return {
    entries,
    templates: {
      async get() {
        return null;
      },
      async put(_backend: string, entry: unknown) {
        entries.push(entry);
      }
    }
  };
}
