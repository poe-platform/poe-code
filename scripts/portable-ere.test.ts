import path from "node:path";
import { build } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

let source: string;
beforeAll(async () => {
  const options = resolveBrowserShellBuild(process.cwd());
  const { entryPoints: ignoredEntries, ...recipe } = options;
  const result = await build({
    ...recipe, inject: [], external: [], alias: { ...recipe.alias, "@poe-code/safe-fs/runtime-core": path.resolve("packages/safe-fs/src/runtime-core.ts"), "@poe-code/safe-fs": path.resolve("packages/safe-fs/src"), "@poe-code/xml-ast": path.resolve("packages/xml-ast/src/index.ts") }, splitting: false, sourcemap: false, format: "iife", globalName: "ere",
    stdin: { contents: 'export { EreTransportRoot } from "./packages/safe-bash/src/commands/regex-execution/ere/transport/root.js"; export { randomBytes } from "./packages/safe-bash-network-engine/src/platform-portable.ts";', resolveDir: process.cwd() },
    outdir: path.join(process.cwd(), "out"),
  });
  source = result.outputFiles![0]!.text;
});

it("matches, validates, cancels and retires the portable transport in workerd", async () => {
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false,
    script: `${source}
      export default { async fetch() {
        const entropy = ere.randomBytes(16);
        const portableEntropy = entropy instanceof Uint8Array && entropy.length === 16 && typeof Buffer === "undefined";
        const cleanup = [];
        const root = new ere.EreTransportRoot({ maxExpansionBytes: 1048576, maxExpansionFields: 10000 }, fn => cleanup.push(fn));
        const session = root.openSession(fn => cleanup.push(fn));
        const input = text => ({ pattern: [{ text, literal: false }], subject: "abc123" });
        const match = await session.execute(input("([a-z]+)([0-9]+)"));
        const miss = await session.execute(input("z"));
        let syntax;
        try { await session.execute(input("[")); } catch (error) { syntax = error.category; }
        const controller = new AbortController();
        const reason = new Error("cancelled"); controller.abort(reason);
        let cancelled = false;
        try { await session.execute(input("abc"), controller.signal); } catch (error) { cancelled = error === reason; }
        await Promise.all(cleanup.map(fn => fn()));
        let closed;
        try { await session.execute(input("abc")); } catch (error) { closed = error.code; }
        const bounded = new ere.EreTransportRoot({ maxExpansionBytes: 1, maxExpansionFields: 1 }, () => {});
        const boundedSession = bounded.openSession(() => {});
        let limited = false;
        try { await boundedSession.execute(input("abc")); } catch (error) { limited = error.name === "EreProfileLimitError"; }
        await bounded.close();
        const activeRoot = new ere.EreTransportRoot({ maxExpansionBytes: 1048576, maxExpansionFields: 10000 }, () => {});
        const activeSession = activeRoot.openSession(() => {});
        const stop = new AbortController();
        const active = activeSession.execute({ pattern: [{ text: "(a|aa)*b", literal: false }], subject: "a".repeat(10000) }, stop.signal);
        await Promise.resolve(); await Promise.resolve();
        stop.abort(reason);
        let activeCancelled = false;
        try { await active; } catch (error) { activeCancelled = error === reason; }
        try { await activeRoot.close(); } catch (error) { if (error !== reason && error.code !== "CLOSED") throw error; }
        return Response.json({ portableEntropy, limited, activeCancelled, activeRetired: activeRoot.retirementState, match: match.spans, missed: !miss.matched, syntax, cancelled, closed, retired: root.retirementState });
      } }`,
  });
  try {
    const response = await runtime.dispatchFetch("https://test.invalid");
    expect(await response.json()).toEqual({
      portableEntropy: true, limited: true, activeCancelled: true, activeRetired: "RETIRED",
      match: [{ start: 0, end: 6 }, { start: 0, end: 3 }, { start: 3, end: 6 }],
      missed: true, syntax: "syntax", cancelled: true, closed: "CLOSED", retired: "RETIRED",
    });
  } finally { await runtime.dispose(); }
});
