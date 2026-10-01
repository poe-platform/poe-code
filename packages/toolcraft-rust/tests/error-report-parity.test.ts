import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { S } from "toolcraft-schema";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:crypto", () => ({ randomUUID: () => "fixture-id" }));

import * as native from "../dist/error-report.js";
import * as reference from "../../toolcraft/src/error-report.js";
import { findProjectRoot as nativeRoot } from "../dist/project-root.js";
import { findProjectRoot as referenceRoot } from "../../toolcraft/src/project-root.js";

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/repo/package.json": '{"name":"fixture"}' });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:34:56Z"));
});
afterEach(() => vi.useRealTimers());

const command = {
  params: S.Object({ api_key: S.String({ secret: true }), public_secret: S.String({ secret: false }),
    rows: S.Array(S.Object({ accessToken: S.String() })) }),
  secrets: { token: { env: "EXAMPLE_TOKEN" }, missing: { env: "MISSING_TOKEN" } }
} as reference.ErrorReportContext["command"];

function context(error: unknown): reference.ErrorReportContext {
  return { command, commandPath: "group.Run Name", error, version: "fixture-version", env: { EXAMPLE_TOKEN: "long-private-value" },
    secrets: { token: "long-private-value", other: "private" },
    params: { api_key: "param-secret", public_secret: "public", rows: [{ accessToken: "row-secret" }] },
    argv: ["--api-key=param-secret", "--token", "long-private-value", "prefix-private-suffix", "--name=public"] };
}

it("renders exact secret redaction, structured fields, cause chains and HTTP transcripts", () => {
  const first = new Error("failed private param-secret");
  first.stack = "stack long-private-value row-secret";
  const cause = new Error("cause private");
  cause.stack = "cause stack param-secret";
  first.cause = cause;
  cause.cause = first;
  Object.assign(first, { details: { authorization: "Bearer secret", row: "row-secret" } });
  const http = Object.assign(new Error("HTTP private"), {
    request: { method: "POST", url: "https://example.test", headers: { authorization: "Bearer secret" }, body: { token: "private" } },
    response: { status: 503, statusText: "Unavailable", headers: { "retry-after": "4" }, body: '{"message":"private"}' }
  });
  http.stack = "http stack";
  for (const error of [first, http, undefined, null, false, 42, Symbol("failure"), { failure: "private" }])
    expect(native.renderErrorReport(context(error))).toEqual(reference.renderErrorReport(context(error)));
});

it("writes exact contents and paths with confinement, slugging and enablement parity", async () => {
  const error = new Error("failure");
  error.stack = "fixed stack";
  for (const errorReports of [undefined, false, true, { dir: "reports" }, { dir: "/outside" }, { dir: "../escape" }]) {
    for (const commandPath of [undefined, "", " Group_Foo.bar ", "ΟΣ🙂", "İTest"])
      for (const forced of [undefined, "1"]) {
        const run = async (lib: typeof reference) => {
          vol.reset(); vol.fromJSON({ "/repo/package.json": "{}" });
          const input = { ...context(error), projectRoot: "/repo", commandPath, errorReports,
            env: { ...context(error).env, TOOLCRAFT_ERROR_REPORTS: forced } };
          try { return { result: await lib.writeErrorReport(input), files: vol.toJSON() }; }
          catch (error) { return { error: [(error as Error).name, (error as Error).message], files: vol.toJSON() }; }
        };
        expect(await run(native)).toEqual(await run(reference));
      }
  }
});

it("rejects a symlinked relative report directory and preserves render getter exceptions", async () => {
  for (const lib of [native, reference]) {
    vol.reset(); vol.fromJSON({ "/repo/package.json": "{}" });
    vol.mkdirSync("/outside", { recursive: true });
    vol.mkdirSync("/repo/.toolcraft", { recursive: true });
    vol.symlinkSync("/outside", "/repo/.toolcraft/errors");
    await expect(lib.writeErrorReport({ ...context(new Error("failure")), projectRoot: "/repo", errorReports: true }))
      .rejects.toThrow("Error report directory resolves outside project root.");
    for (const failure of [undefined, null, Symbol("failure"), { failure: true }]) {
      let caught = false;
      try { lib.renderErrorReport({ get env() { throw failure; } } as never); }
      catch (error) { caught = true; expect(error).toBe(failure); }
      expect(caught).toBe(true);
    }
  }
});

it("project-root discovery retains existence-only traversal and cwd read order", () => {
  vol.fromJSON({ "/repo/pkg/package.json": "not JSON", "/repo/pkg/src/input.ts": "" });
  for (const from of ["/repo/pkg/src", "/repo/pkg/src/input.ts", "/repo/pkg", "/missing", "/"]) {
    expect(nativeRoot(from)).toBe(referenceRoot(from));
  }
  expect(nativeRoot("/repo/pkg/src")).toBe("/repo/pkg");
  const run = (find: typeof referenceRoot) => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValueOnce("/first").mockReturnValueOnce("/first").mockReturnValue("/repo/pkg/src");
    try { const result = find(); return { result, calls: cwd.mock.calls.length }; }
    finally { cwd.mockRestore(); }
  };
  expect(run(nativeRoot)).toEqual(run(referenceRoot));
});

it("report rendering preserves context, schema and diagnostic getter order", () => {
  const run = (lib: typeof reference) => {
    const reads: string[] = [];
    const observe = <T extends object>(value: T, prefix: string): T => new Proxy(value, {
      get(target, key, receiver) { reads.push(`${prefix}.${String(key)}`); return Reflect.get(target, key, receiver); }
    });
    const error = new Error("private"); error.stack = "fixed private stack";
    const params = { kind: "object", shape: { key: observe({ kind: "string", secret: true }, "field") } };
    const input = { ...context(error), command: observe({ params: observe(params, "schema"), secrets: { token: observe({ env: "EXAMPLE_TOKEN" }, "secret") } }, "command"), params: { key: "private" } };
    const report = lib.renderErrorReport(observe(input, "context") as never);
    return { report, reads };
  };
  expect(run(native)).toEqual(run(reference));
});
