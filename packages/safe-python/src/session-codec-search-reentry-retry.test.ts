import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecSearchReentryRetryCases} from "./codec-search-reentry-retry-cases.js";
import reference from "./runtime/__snapshots__/codec-search-reentry-retry-oracle.json" with {type: "json"};

it.each(codecSearchReentryRetryCases)("preserves recursive cache publication after outer $mode", ({mode, source}) => {
  const row = reference.cases.find(item => item.mode === mode)!;
  expect(reference.reference).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  for (const cancellation of ["none", "return", "throw"] as const) {
    const controller = new AbortController();
    let output = "", reads = 0;
    const session = new PythonSession({
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {
        reads++;
        if (cancellation !== "none") controller.abort();
        if (cancellation === "throw") throw new Error("service failed after abort");
        return "continue\n";
      }},
      output: {write(text) {output += text;}, flush() {}}
    });
    const result = session.exec(source);
    if (cancellation === "none") {
      let diagnostic = "";
      if (result.status === "exception") {
        session.globals.set("failure", result.exception);
        const detail = session.eval("repr(failure)");
        if (detail.status === "ok") diagnostic = String(detail.value.primitive);
      }
      expect(result.status, diagnostic).toBe("ok");
      expect(output).toBe(row.stdout);
    } else {
      expect(result).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
      expect(session.exec(source)).toEqual(result);
      expect(session.eval("1")).toEqual(result);
      expect(output).toBe("");
    }
    expect(reads).toBe(1);
  }
});
