import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { e2bExecutionEnvFactory } from "./factory.js";

describe.skipIf(!process.env.E2B_API_KEY)("e2bExecutionEnvFactory integration", () => {
  it("builds a minimal template, opens a sandbox, runs echo, downloads, and closes", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "poe-e2b-integration-"));
    await writeFile(path.join(cwd, "Dockerfile"), "FROM node:22-slim\n", "utf8");
    const env = await e2bExecutionEnvFactory.open({
      cwd,
      runtime: {
        type: "e2b",
        dockerfile: "Dockerfile",
        build_context: ".",
        build_args: {},
        mounts: [],
        timeout_minutes: 10
      },
      env: {},
      uploadIgnoreFiles: [],
      jobLabel: { tool: "node", argv: ["node", "-e", "console.log('ok')"] }
    });

    try {
      expect("/workspace").not.toBe(cwd);
      await env.uploadWorkspace();
      const handle = env.exec({
        command: "sh",
        args: ["-c", "pwd > e2b-pwd.txt && echo ok > e2b-output.txt"],
        cwd
      });
      await expect(handle.result).resolves.toEqual({ exitCode: 0 });
      await expect(env.downloadWorkspace({ conflictPolicy: "overwrite" })).resolves.toMatchObject({
        conflicts: []
      });
      await expect(readFile(path.join(cwd, "e2b-pwd.txt"), "utf8")).resolves.toBe("/workspace\n");
      await expect(readFile(path.join(cwd, "e2b-output.txt"), "utf8")).resolves.toBe("ok\n");
    } finally {
      await env.close();
    }
  }, 300_000);
});
