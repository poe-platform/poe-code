import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; vi.restoreAllMocks(); });

function fixture(route: string, invalidFirst: boolean) {
  const healthyHandler = vi.fn(async () => "healthy result");
  const invalidHandler = vi.fn();
  const healthy = defineCommand({ name: "healthy", description: "healthy help marker", params: S.Object({}), handler: healthyHandler });
  const invalid = defineCommand({ name: "invalid", params: S.Object({ output: S.String() }), handler: invalidHandler });
  const children = invalidFirst ? [invalid, healthy] : [healthy, invalid];
  const group = defineGroup({ name: "group", children });
  const badGroup = defineGroup({ name: "bad-group", children: [invalid] });
  const root = defineGroup({
    name: "audit",
    children: route === "nested" ? [group] : route === "other group"
      ? invalidFirst ? [badGroup, healthy] : [healthy, badGroup]
      : children
  });
  return {
    root,
    healthyHandler,
    invalidHandler,
    healthyPath: route === "nested" ? ["group", "healthy"] : ["healthy"],
    invalidPath: route === "nested" ? ["group", "invalid"] : route === "other group" ? ["bad-group", "invalid"] : ["invalid"]
  };
}

async function invoke(root: ReturnType<typeof fixture>["root"], args: string[]) {
  const output: string[] = [];
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((entry) => { stdout += String(entry); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await runCLI(root, {
    argv: ["node", "audit", "--output", "json", ...args],
    controls: { output: true },
    errorReports: false,
    outputEmitter: (entry) => output.push(entry)
  });
  return { stdout, output };
}

describe.each(["direct", "nested", "other group"])("healthy help via %s", (route) => {
  describe.each([false, true])("invalid command first=%s", (invalidFirst) => {
    it.each(["-h", "--help"])("renders %s without initializing an unrelated invalid command", async (flag) => {
      const subject = fixture(route, invalidFirst);
      const { stdout, output } = await invoke(subject.root, [...subject.healthyPath, flag]);

      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(stdout).toContain("healthy help marker");
      expect(() => JSON.parse(stdout)).not.toThrow();
      expect(output).toEqual([]);
      expect(subject.healthyHandler).not.toHaveBeenCalled();
      expect(subject.invalidHandler).not.toHaveBeenCalled();
    });

    it("retains definition validation for an ordinary invocation", async () => {
      const subject = fixture(route, invalidFirst);
      const { output } = await invoke(subject.root, subject.healthyPath);

      expect(process.exitCode).toBe(1);
      expect(output.join("\n")).toContain('reserved CLI flag "--output"');
      expect(subject.healthyHandler).not.toHaveBeenCalled();
      expect(subject.invalidHandler).not.toHaveBeenCalled();
    });

    it("still diagnoses invalid metadata on the requested help target", async () => {
      const subject = fixture(route, invalidFirst);
      const { output } = await invoke(subject.root, [...subject.invalidPath, "--help"]);

      expect(process.exitCode).toBe(1);
      expect(output.join("\n")).toContain('reserved CLI flag "--output"');
      expect(subject.healthyHandler).not.toHaveBeenCalled();
      expect(subject.invalidHandler).not.toHaveBeenCalled();
    });
  });
});
