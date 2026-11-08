import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { LauncherFileSystem } from "../types.js";
import { createSupervisor } from "./supervisor.js";

describe("supervisor log-write recovery", () => {
  it.each([
    ["stdout", "handler"], ["stderr", "handler"],
    ["stdout", "no-handler"], ["stderr", "no-handler"]
  ])("survives a live %s write failure with %s and stops normally", (output, handler) => {
    const fixture = fileURLToPath(new URL("../../tests/log-write-failure.mjs", import.meta.url));
    const child = spawnSync(process.execPath, ["--import", "tsx", fixture, output, handler], {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, NODE_OPTIONS: "" }
    });

    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.duringFailure).toEqual({ status: "running", errors: handler === "handler" ? 1 : 0, kills: 0 });
    expect(result.errors).toEqual(handler === "handler" ? [{ same: true, code: "ENOSPC" }] : []);
    expect(result.lines).toEqual([{ line: "lost", stream: output }, { line: "saved", stream: output }]);
    expect(result.persisted).toBe("saved\n");
    expect(result.attempts).toBe(2);
    expect(result.kills).toBe(1);
    expect(result.state).toMatchObject({ status: "stopped", pid: null, lastExitCode: 0 });
  });

  it.each(["stdout", "stderr"] as const)("preserves later %s lines, CRLF, and a final partial line", async output => {
    const fixture = createOutputFixture();
    try {
      await fixture.supervisor.start();
      fixture[output].end("lost\nsaved\r\npartial");
      fixture[output === "stdout" ? "stderr" : "stdout"].end();
      fixture.finish({ exitCode: 7 });
      await vi.waitFor(() => expect(fixture.supervisor.getState().lastExitCode).toBe(7));

      expect(fixture.lines).toEqual([
        { line: "lost", stream: output }, { line: "saved", stream: output }, { line: "partial", stream: output }
      ]);
      expect(fixture.errors).toEqual([fixture.failures[output]]);
      expect(fixture.attempts).toHaveLength(3);
      expect(await fixture.fs.readFile(`/state/output/logs/${output}.log`, "utf8")).toBe("saved\npartial\n");
    } finally {
      await fixture.supervisor.stop();
    }
  });

  it.each(["stdout", "stderr"] as const)("reports an unterminated final %s write failure once", async output => {
    const fixture = createOutputFixture();
    try {
      await fixture.supervisor.start();
      fixture[output].end("saved\nlost");
      fixture[output === "stdout" ? "stderr" : "stdout"].end();
      fixture.finish({ exitCode: 0 });
      await vi.waitFor(() => expect(fixture.supervisor.getState().lastExitCode).toBe(0));

      expect(fixture.errors).toEqual([fixture.failures[output]]);
      expect(fixture.lines).toEqual([{ line: "saved", stream: output }, { line: "lost", stream: output }]);
      expect(await fixture.fs.readFile(`/state/output/logs/${output}.log`, "utf8")).toBe("saved\n");
    } finally {
      await fixture.supervisor.stop();
    }
  });

  it("recovers each output stream and reports both independent failures", async () => {
    const fixture = createOutputFixture();
    try {
      await fixture.supervisor.start();
      fixture.stdout.end("lost\nstdout recovered\n");
      fixture.stderr.end("lost\nstderr recovered\n");
      fixture.finish({ exitCode: 0 });
      await vi.waitFor(() => expect(fixture.supervisor.getState().lastExitCode).toBe(0));

      expect(new Set(fixture.errors)).toEqual(new Set(Object.values(fixture.failures)));
      expect(fixture.attempts).toHaveLength(4);
      expect(fixture.lines).toHaveLength(4);
      expect(await fixture.fs.readFile("/state/output/logs/stdout.log", "utf8")).toBe("stdout recovered\n");
      expect(await fixture.fs.readFile("/state/output/logs/stderr.log", "utf8")).toBe("stderr recovered\n");
    } finally {
      await fixture.supervisor.stop();
    }
  });

  it("reports each failure and keeps delivering output while storage remains unavailable", async () => {
    const fixture = createOutputFixture(() => true);
    try {
      await fixture.supervisor.start();
      fixture.stdout.end("first\nsecond\nthird\n");
      fixture.stderr.end();
      fixture.finish({ exitCode: 0 });
      await vi.waitFor(() => expect(fixture.supervisor.getState().lastExitCode).toBe(0));

      expect(fixture.errors).toEqual([fixture.failures.stdout, fixture.failures.stdout, fixture.failures.stdout]);
      expect(fixture.lines.map(entry => entry.line)).toEqual(["first", "second", "third"]);
      expect(fixture.attempts).toHaveLength(3);
      await expect(fixture.fs.readFile("/state/output/logs/stdout.log", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.supervisor.stop();
    }
  });

  it("rotates recovered logs and preserves output across an automatic restart", async () => {
    const fixture = createOutputFixture();
    const supervisor = createSupervisor({
      fs: fixture.fs,
      runner: createMockRunner([
        { exitCode: 1, stdout: ["lost\nsaved\n"], stdoutInterval: 0 },
        { exitCode: 0, stdout: ["restarted\n"], stdoutInterval: 0 }
      ]),
      spec: { id: "output", command: "fixture", restart: "on-failure", backoffMs: 0, maxRestarts: 1 },
      stateDir: "/state",
      startSettleMs: 0,
      onLog: (line, stream) => fixture.lines.push({ line, stream }),
      onError: error => fixture.errors.push(error)
    });
    try {
      await supervisor.start();
      await vi.waitFor(() => expect(supervisor.getState()).toMatchObject({ lastExitCode: 0, restartCount: 1, status: "stopped" }));

      expect(fixture.errors).toEqual([fixture.failures.stdout]);
      expect(fixture.lines.map(entry => entry.line)).toEqual(["lost", "saved", "restarted"]);
      expect(await fixture.fs.readFile("/state/output/logs/stdout.1.log", "utf8")).toBe("saved\n");
      expect(await fixture.fs.readFile("/state/output/logs/stdout.log", "utf8")).toBe("restarted\n");
    } finally {
      await supervisor.stop();
    }
  });
});

function createOutputFixture(shouldFail: (content: string) => boolean = content => content.startsWith("lost")) {
  const fs = createFsFromVolume(new Volume()).promises as unknown as LauncherFileSystem;
  const appendFile = fs.appendFile.bind(fs);
  const failures = {
    stdout: Object.assign(new Error("stdout disk unavailable"), { code: "ENOSPC" }),
    stderr: Object.assign(new Error("stderr disk unavailable"), { code: "ENOSPC" })
  };
  const attempts: string[] = [];
  fs.appendFile = async (filePath, content) => {
    attempts.push(content);
    if (shouldFail(content)) throw failures[filePath.endsWith("stderr.log") ? "stderr" : "stdout"];
    await appendFile(filePath, content);
  };
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let finish!: (result: { exitCode: number }) => void;
  const result = new Promise<{ exitCode: number }>(resolve => { finish = resolve; });
  const lines: Array<{ line: string; stream: "stdout" | "stderr" }> = [];
  const errors: unknown[] = [];
  const supervisor = createSupervisor({
    fs,
    runner: {
      name: "fixture",
      exec: () => ({
        pid: 4242, stdin: null, stdout, stderr, result,
        kill() {
          stdout.end();
          stderr.end();
          finish({ exitCode: 0 });
        }
      })
    },
    spec: { id: "output", command: "fixture", restart: "never" },
    stateDir: "/state",
    startSettleMs: 0,
    onLog: (line, stream) => lines.push({ line, stream }),
    onError: error => errors.push(error)
  });
  return { fs, supervisor, stdout, stderr, finish, lines, errors, attempts, failures };
}
