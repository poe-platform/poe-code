import { expect, test } from "vitest";
import { Miniflare } from "miniflare";
import { buildNativeFixture } from "./browser-native-fixture.js";

test.each(["recording", "archive"] as const)("native %s trace overflow returns a shell result and permits a later request to recover", async failure => {
  const script = await buildNativeFixture(new URL("./browser-trace-shell.test.worker.ts", import.meta.url));
  const worker = new Miniflare({ modules: true, script, compatibilityDate: "2026-07-08", compatibilityFlags: ["nodejs_compat"], browserRendering: { binding: "BROWSER" },
    durableObjects: { TRACE: { className: "TraceShellSessions", useSQLite: true } } });
  const run = async (path: string) => {
    const response = await worker.dispatchFetch(`http://fixture/${path}`);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    return JSON.parse(body) as { results: { exitCode: number; stdout: string; stderr: string }[]; sessions: unknown[]; files: string[] };
  };
  try {
    const started = await run(`start?failure=${failure}`);
    expect(started.results.map(result => result.exitCode)).toEqual([0, 0, 0, 0]);
    const overflow = await run(failure);
    expect(overflow.results.map(result => result.exitCode)).toEqual([1]);
    expect(overflow.results.map(result => result.stdout + result.stderr).join("\n")).toMatch(/trace .*limit exceeded/i);
    expect(overflow.sessions).toEqual([]);
    expect(overflow.files.filter(name => name.endsWith(".zip"))).toEqual([]);
    const recovered = await run("recover");
    expect(recovered.results.map(result => result.exitCode)).toEqual([0, 0, 0]);
    expect(recovered.results[1]!.stdout).toContain("Recovered browser");
    expect(recovered.sessions).toEqual([]);
    await run("dispose");
  } finally {
    await worker.dispatchFetch("http://fixture/dispose");
    await worker.dispose();
  }
});
