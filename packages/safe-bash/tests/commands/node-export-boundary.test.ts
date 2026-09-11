import assert from "node:assert/strict";
import test from "node:test";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import * as nodeCommands from "../../src/commands/node/index.js";
import * as root from "../../src/index.js";

test("node command entry and root omit the host-only Worker provider", () => {
  assert.equal(Object.hasOwn(nodeCommands, "createNodeWorkerProvider"), false);
  assert.equal(Object.hasOwn(root, "createNodeWorkerProvider"), false);
  assert.equal(typeof nodeCommands.nodeCommands, "function");
  assert.equal(typeof nodeCommands.createNodeCommand, "function");
  assert.equal(typeof nodeCommands.createNodeCommands, "function");
});

test("node command module graph excludes worker_threads without replacing supported native modules", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../../src/commands/node/index.ts", import.meta.url))],
    bundle: true, write: false, metafile: true, platform: "neutral", format: "esm", target: "es2022",
    conditions: ["workerd", "worker", "browser"], external: ["node:*"], logLevel: "silent",
  });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports.map(entry => entry.path));
  assert.equal(imports.includes("node:worker_threads"), false);
  assert.ok(imports.includes("node:util"));
  assert.ok(imports.includes("node:path"));
});

test("host provider remains available exclusively through the explicit public host subpath", async () => {
  const host = await import("poe-code/safe-bash/commands/node/host");
  assert.equal(typeof host.createNodeWorkerProvider, "function");
  assert.throws(() => host.createNodeWorkerProvider({ entry: "relative.js", identity: "explicit-host" }), TypeError);
  const events: string[] = [];
  const provider = host.createNodeWorkerProvider({
    entry: "file:///explicit-not-loaded-engine.mjs", identity: "explicit-host",
    observe: event => { events.push(event.kind); },
  });
  assert.equal(provider.profile, nodeCommands.NODE_PROFILE);
  assert.equal(provider.identity, "explicit-host");
  assert.ok(Object.isFrozen(provider));
  assert.deepEqual(nodeCommands.createNodeCommands({ provider }).map(command => command.name), ["node"]);
  assert.deepEqual(events, []);
});

for (const condition of ["node", "workerd", "worker", "browser"]) {
  test(`public host declarations enforce the ${condition} platform boundary`, () => {
    const diagnostics = platformDiagnostics([
      'import { createNodeWorkerProvider as privateHost } from "virtual-bash/commands/node/host";',
      'import { createNodeWorkerProvider as publicHost } from "poe-code/safe-bash/commands/node/host";',
      'privateHost({ entry: "file:///engine.mjs", identity: "host" });',
      'publicHost({ entry: "file:///engine.mjs", identity: "host" });',
    ].join("\n"), condition);
    assert.deepEqual(diagnostics, condition === "node" ? [] : [2305, 2305]);
  });
}

test("private and public workerd runtime declarations refuse browser imports", () => {
  assert.deepEqual(platformDiagnostics([
    'import { run as privateRun } from "@poe-code/safe-js/workerd";',
    'import { run as publicRun } from "poe-code/safe-js/workerd";',
    'void privateRun; void publicRun;',
  ].join("\n"), "browser"), [2305, 2305]);
});

function platformDiagnostics(source: string, condition: string): number[] {
  const filename = fileURLToPath(new URL("./in-memory-platform-probe.mts", import.meta.url));
  const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, customConditions: [condition], types: [] };
  const host = ts.createCompilerHost(options);
  const overlays = new Map<string, string>([[filename, source]]);
  for (const name of ["safe-bash", "safe-js"]) {
    const packageRoot = new URL(`../../../${name}/`, import.meta.url);
    const unavailable = ts.sys.readFile(fileURLToPath(new URL("src/node-unavailable.ts", packageRoot)));
    if (unavailable !== undefined) overlays.set(fileURLToPath(new URL("dist/node-unavailable.d.ts", packageRoot)), unavailable);
  }
  const exists = host.fileExists.bind(host);
  const getSource = host.getSourceFile.bind(host);
  const overlay = (path: string): string | undefined => overlays.get(path)
    ?? (path.endsWith("/node-unavailable.d.ts") ? overlays.get(join(ts.sys.realpath!(dirname(path)), basename(path))) : undefined);
  host.fileExists = path => overlay(path) !== undefined || exists(path);
  host.getSourceFile = (path, version, onError, fresh) => {
    const contents = overlay(path);
    return contents === undefined ? getSource(path, version, onError, fresh) : ts.createSourceFile(path, contents, version, true);
  };
  const program = ts.createProgram([filename], options, host);
  const probe = program.getSourceFile(filename);
  assert(probe);
  return [...program.getSyntacticDiagnostics(probe), ...program.getSemanticDiagnostics(probe)].map(diagnostic => diagnostic.code);
}
