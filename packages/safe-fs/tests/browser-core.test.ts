import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("browser-selected actual filesystem graph", () => {
  it("bundles without Node externals and runs identity, authority and wrapper checks", async () => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL("./helpers/browser-checks.ts", import.meta.url))],
      bundle: true,
      platform: "browser",
      conditions: ["browser"],
      format: "iife",
      globalName: "safeFsBrowserChecks",
      target: "es2022",
      write: false,
      metafile: true,
      logLevel: "silent"
    });
    expect(Object.values(output.metafile!.inputs).flatMap(input => input.imports).filter(input => input.external)).toEqual([]);
    expect(Object.keys(output.metafile!.inputs).some(input => input.endsWith("platform/browser.ts"))).toBe(true);
    expect(Object.keys(output.metafile!.inputs).some(input => input.endsWith("platform/node.ts"))).toBe(false);
    const context = createContext({
      AbortController, AbortSignal, Headers, Response, Request, URL, TextEncoder, TextDecoder,
      ReadableStream, Uint8Array, crypto: webcrypto
    });
    runInContext(output.outputFiles[0]!.text, context);
    const checks = await runInContext("safeFsBrowserChecks.runBrowserChecks()", context) as string[];
    expect(checks).toContain("one constructor graph");
    expect(checks).toContain("discarded-options callback refused");
    expect(checks).toContain("overlay whiteouts and recreated directories never expose lower descendants");
  });
});
