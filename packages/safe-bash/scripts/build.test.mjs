import assert from "node:assert/strict";
import test from "node:test";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { createFsFromVolume, Volume } from "memfs";
import { buildPackage } from "./build.mjs";
import { bindPeerArtifact, resolvePeerProfile, stagePeerArtifact, assertPeerArtifact } from "../tests/plugins/qualified-current-release/peer.mjs";

const root = "/owned/package";
const tools = { typescriptLib: "/owned/node_modules/typescript/lib", nodeTypes: "/owned/node_modules/@types/node", undiciTypes: "/owned/node_modules/undici-types" };
const globals = "interface Array<T> { length: number; } interface Boolean {} interface Function {} interface CallableFunction {} interface NewableFunction {} interface IArguments {} interface Number {} interface Object {} interface RegExp {} interface String {}";

function fixture(extra = {}, compilerOptions = {}) {
  const volume = Volume.fromJSON({
    [root + "/package.json"]: JSON.stringify({ name: "virtual-bash", type: "module" }),
    [root + "/integration-boundaries.json"]: JSON.stringify({ version: 1, heldSourceFiles: ["src/commands/held/index.ts"], heldEvidenceDirectories: ["src/commands/held/design-evidence"], fixtureDirectories: [] }),
    [root + "/tsconfig.json"]: JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: ["node"], lib: ["ES2023"], ...compilerOptions } }),
    [root + "/tsconfig.build.json"]: JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { rootDir: "src", outDir: "dist", declaration: true, declarationMap: true, sourceMap: true }, include: ["src/**/*.ts"], exclude: ["src/excluded.ts"] }),
    [root + "/src/index.ts"]: 'export const answer: number = 42;\n',
    [root + "/src/excluded.ts"]: 'this is excluded, not silently included',
    [root + "/src/commands/held/index.ts"]: 'HELD sentinel',
    [root + "/src/commands/held/design-evidence/hidden.ts"]: 'HELD sentinel',
    [tools.typescriptLib + "/lib.es2023.d.ts"]: globals,
    [tools.nodeTypes + "/package.json"]: JSON.stringify({ name: "@types/node", types: "index.d.ts" }),
    [tools.nodeTypes + "/index.d.ts"]: 'declare const nodeFixture: number;\n',
    [tools.undiciTypes + "/package.json"]: JSON.stringify({ name: "undici-types", types: "index.d.ts" }),
    [tools.undiciTypes + "/index.d.ts"]: 'export interface Dispatcher { dispatch(): void; }\n',
    ...Object.fromEntries(Object.entries(extra).map(([path, value]) => [root + "/" + path, value])),
  });
  const memory = createFsFromVolume(volume);
  const reads = [], metadata = [], listings = [], descriptors = new Set(), writes = [];
  const fileSystem = Object.create(memory);
  fileSystem.lstatSync = path => { metadata.push(String(path)); return memory.lstatSync(path); };
  fileSystem.readdirSync = (path, ...args) => { listings.push(String(path)); return memory.readdirSync(path, ...args); };
  fileSystem.openSync = (path, flags, ...args) => { const nativeFlags = flags; flags = ["O_WRONLY", "O_CREAT", "O_TRUNC", "O_NOFOLLOW", "O_NONBLOCK"].reduce((value, name) => value | ((nativeFlags & constants[name]) !== 0 ? memory.constants[name] : 0), 0); const descriptor = memory.openSync(path, flags, ...args); descriptors.add(descriptor); if ((nativeFlags & constants.O_WRONLY) !== 0) writes.push(String(path)); else reads.push(String(path)); return descriptor; };
  fileSystem.closeSync = descriptor => { memory.closeSync(descriptor); descriptors.delete(descriptor); };
  return { memory, fileSystem, reads, metadata, listings, descriptors, writes, output: [], run(args = []) { return buildPackage({ root, tools, fileSystem, args, write: text => this.output.push(text) }); } };
}

function noHeldReads(owned) {
  assert.equal(owned.reads.filter(path => path.toLowerCase().includes("/held/")).length, 0);
  assert.equal(owned.listings.filter(path => path.toLowerCase().includes("/held")).length, 0);
  assert.equal(owned.metadata.filter(path => path.toLowerCase().includes("/held/")).length, 0);
  assert.equal(owned.descriptors.size, 0);
}

test("guarded compiler resolves the public peer declaration without admitting peer source or runtime", async () => {
  const owned = fixture({
    "package.json": JSON.stringify({ name: "virtual-bash", type: "module", peerDependencies: { "poe-code": ">=13.0.0" }, devDependencies: { "poe-code": "13.0.0" } }),
    "src/index.ts": 'export type { Canonical } from "poe-code/safe-fs";\n',
    "node_modules/poe-code/package.json": JSON.stringify({ name: "poe-code", version: "13.0.0", type: "module", exports: { "./safe-fs": { types: "./packages/safe-fs/dist/index.d.ts", import: "./packages/safe-js/dist/safe-fs.js" } } }),
    "node_modules/poe-code/packages/safe-fs/dist/index.d.ts": 'export interface Canonical { identity: "public"; }\n',
    "node_modules/poe-code/packages/safe-fs/src/index.ts": 'UNADMITTED SOURCE',
    "node_modules/poe-code/packages/safe-js/dist/safe-fs.js": 'UNEXECUTED RUNTIME',
  });
  const result = await owned.run();
  assert.equal(result.status, 0, owned.output.join(""));
  assert.ok(owned.reads.includes(root + "/node_modules/poe-code/packages/safe-fs/dist/index.d.ts"));
  assert.ok(!owned.reads.some(path => path.includes("/safe-fs/src/") || path.endsWith("/safe-js/dist/safe-fs.js")));
  noHeldReads(owned);
});

function checkoutPeerFixture() {
  const checkout = "/checkout", packageRoot = checkout + "/packages/safe-bash";
  const manifest = { name: "virtual-bash", private: true, peerDependencies: { "poe-code": ">=13.0.0" }, devDependencies: { "poe-code": "file:../.." }, poeCode: { integration: { peerProfile: "checkout-root" } } };
  const peer = { name: "poe-code", version: "0.0.0-dev", type: "module", devDependencies: { "poe-code": "file:." }, exports: { "./safe-fs": { types: { default: "./packages/safe-fs/dist/index.d.ts" }, import: "./packages/safe-js/dist/safe-fs.js" } } };
  const lock = { packages: { "packages/safe-bash": { devDependencies: { "poe-code": "file:../.." } }, "node_modules/poe-code": { resolved: "", link: true } } };
  const declaration = "export interface Canonical {}\n";
  const io = createFsFromVolume(Volume.fromJSON({
    [packageRoot + "/package.json"]: JSON.stringify(manifest), [checkout + "/package.json"]: JSON.stringify(peer),
    [checkout + "/package-lock.json"]: JSON.stringify(lock),
    [checkout + "/packages/safe-fs/dist/index.d.ts"]: declaration,
    [checkout + "/packages/safe-js/dist/safe-fs.js"]: 'export { identity } from "./shared.js";\n',
    [checkout + "/packages/safe-js/dist/shared.js"]: 'export const identity = {};\n',
  }));
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const declarations = { peer: { version: peer.version, integrity: null, metadataSha256: hash(JSON.stringify(peer)), declarations: new Map([["packages/safe-fs/dist/index.d.ts", hash(declaration)]]), publicEntries: new Map([["poe-code/safe-fs", "packages/safe-fs/dist/index.d.ts"]]) } };
  return { checkout, root: packageRoot, io, manifest, peer, lock, declarations };
}

test("checkout peer preserves dev-root identity without claiming released peer-range satisfaction", () => {
  const owned = checkoutPeerFixture();
  const result = resolvePeerProfile(owned.root, owned.io);
  assert.equal(result.profile, "checkout-root");
  assert.equal(result.peer.version, "0.0.0-dev");
  assert.equal(result.integrity, null);
  assert.match(result.qualification, /not published peer-range satisfaction/);
  assert.throws(() => bindPeerArtifact({ root: owned.root, io: owned.io, declarations: owned.declarations }), /explicit canonical peer artifact/);
});

for (const defect of ["registry-dev", "root-self", "raw-runtime", "lock-link", "fake-release"]) test(`checkout peer rejects ${defect} without registry fallback`, () => {
  const owned = checkoutPeerFixture();
  if (defect === "registry-dev") owned.manifest.devDependencies["poe-code"] = "13.0.0";
  if (defect === "root-self") owned.peer.devDependencies["poe-code"] = "13.0.0";
  if (defect === "raw-runtime") owned.peer.exports["./safe-fs"].import = "./packages/safe-fs/dist/index.js";
  if (defect === "lock-link") owned.lock.packages["node_modules/poe-code"] = { version: "13.0.0" };
  if (defect === "fake-release") delete owned.manifest.poeCode;
  for (const [path, value] of [[owned.root + "/package.json", owned.manifest], [owned.checkout + "/package.json", owned.peer], [owned.checkout + "/package-lock.json", owned.lock]]) owned.io.writeFileSync(path, JSON.stringify(value));
  assert.throws(() => resolvePeerProfile(owned.root, owned.io));
});

test("explicit checkout capture stages only the canonical public closure and detects later drift", () => {
  const owned = checkoutPeerFixture();
  const binding = bindPeerArtifact({ ...owned, checkout: true });
  assert.equal(binding.profile, "checkout-root");
  assert.equal(binding.tarballSha256, null);
  assert.equal(binding.runtimeFiles, 2);
  assert.equal(binding.declarationFiles, 1);
  owned.io.mkdirSync("/consumer");
  stagePeerArtifact(binding, "/consumer");
  assertPeerArtifact(binding, "/consumer");
  assert.equal(owned.io.existsSync("/consumer/node_modules/poe-code/packages/safe-fs/src"), false);
  owned.io.writeFileSync("/consumer/node_modules/poe-code/packages/safe-js/dist/shared.js", "changed");
  assert.throws(() => assertPeerArtifact(binding, "/consumer"), /changed/);
});

test("build emits admitted ESM, declarations and both maps while pruning held discovery", async () => {
  const owned = fixture();
  const result = await owned.run(["--listEmittedFiles"]);
  assert.equal(result.status, 0, owned.output.join(""));
  assert.deepEqual(result.rootNames, [root + "/src/index.ts"]);
  assert.deepEqual(result.emittedFiles.map(path => path.slice(root.length + 1)).sort(), ["dist/index.d.ts", "dist/index.d.ts.map", "dist/index.js", "dist/index.js.map"]);
  assert.match(owned.memory.readFileSync(root + "/dist/index.js", "utf8"), /export const answer = 42/);
  assert.match(owned.output.join(""), /TSFILE: .*dist\/index.d.ts/);
  assert.ok(owned.reads.includes(tools.nodeTypes + "/index.d.ts"));
  noHeldReads(owned);
});

for (const specifier of ["./commands/held/index.js", "./commands/held/design-evidence/hidden.js", "./commands/HELD/index.js"]) {
  test("build refuses transitive held import before read: " + specifier, async () => {
    const owned = fixture({ "src/index.ts": 'import "' + specifier + '"; export const answer = 42;' });
    await assert.rejects(owned.run(), /held|alias/i);
    assert.equal(owned.writes.length, 0);
    noHeldReads(owned);
  });
}

test("build refuses a paths-mapped held import before payload or descendant discovery", async () => {
  const owned = fixture({ "src/index.ts": 'import "hidden"; export const answer = 42;' }, { baseUrl: ".", paths: { hidden: ["src/commands/held/design-evidence/hidden.ts"] } });
  await assert.rejects(owned.run(), /held/i);
  noHeldReads(owned);
});

test("build preserves an admitted paths mapping and compiler noEmit option", async () => {
  const owned = fixture({ "src/index.ts": 'export { value } from "mapped";', "src/value.ts": "export const value = 7;" }, { baseUrl: ".", paths: { mapped: ["src/value.ts"] } });
  const result = await owned.run(["--noEmit"]);
  assert.equal(result.status, 0, owned.output.join(""));
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

test("build rejects held case aliases during discovery", async () => {
  const owned = fixture({ "src/commands/HELD/other.ts": "alias sentinel" });
  await assert.rejects(owned.run(), /alias|spelling/i);
  noHeldReads(owned);
});

for (const kind of ["file", "directory", "hardlink"]) {
  test("build refuses " + kind + " alias before held target read", async () => {
    const owned = fixture();
    if (kind === "hardlink") owned.memory.linkSync(root + "/src/commands/held/index.ts", root + "/src/linked.ts");
    else owned.memory.symlinkSync(root + "/src/commands/held" + (kind === "file" ? "/index.ts" : ""), root + "/src/alias" + (kind === "file" ? ".ts" : ""));
    await assert.rejects(owned.run(), /link|regular/i);
    noHeldReads(owned);
  });
}

test("build rejects out-of-scope imports without opening their payload", async () => {
  const owned = fixture({ "src/index.ts": 'import { value } from "../tests/escape.js"; export { value };', "tests/escape.ts": "export const value = 1;" });
  const result = await owned.run(["--noEmit"]);
  assert.notEqual(result.status, 0);
  assert.equal(owned.reads.includes(root + "/tests/escape.ts"), false);
  noHeldReads(owned);
});

test("build preserves genuine semantic diagnostics and noEmitOnError", async () => {
  const owned = fixture({ "src/index.ts": 'export const answer: number = "not a number";' });
  const result = await owned.run(["--noEmitOnError"]);
  assert.notEqual(result.status, 0);
  assert.match(owned.output.join(""), /TS2322/);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

for (const args of [["--outDir", "../escape"], ["--project", "../other.json"], ["--watch"], ["src/commands/held/index.ts"]]) {
  test("build refuses contract-changing arguments " + args.join(" "), async () => {
    const owned = fixture();
    await assert.rejects(owned.run(args));
    assert.equal(owned.writes.length, 0);
    noHeldReads(owned);
  });
}

test("build invokes existing dist guard before source reads or emit", async () => {
  const owned = fixture();
  owned.memory.mkdirSync("/outside");
  owned.memory.symlinkSync("/outside", root + "/dist");
  await assert.rejects(owned.run(), /output directory/);
  assert.equal(owned.reads.length, 0);
  assert.equal(owned.writes.length, 0);
});

test("build refuses a symlinked output leaf without truncating target", async () => {
  const owned = fixture();
  owned.memory.mkdirSync(root + "/dist");
  owned.memory.symlinkSync(root + "/src/commands/held/index.ts", root + "/dist/index.js");
  await assert.rejects(owned.run(), /link|regular/i);
  noHeldReads(owned);
});


test("build resolves trusted hoisted Node and undici declaration inputs", async () => {
  const owned = fixture({ "src/index.ts": 'import type { Dispatcher } from "undici-types"; export function use(value: Dispatcher): void { value.dispatch(); }' });
  const result = await owned.run(["--emitDeclarationOnly", "--declarationMap", "false"]);
  assert.equal(result.status, 0, owned.output.join(""));
  assert.deepEqual(result.emittedFiles, [root + "/dist/index.d.ts"]);
  assert.ok(owned.reads.includes(tools.undiciTypes + "/index.d.ts"));
  noHeldReads(owned);
});

test("build blocks held references originating in trusted declarations", async () => {
  const owned = fixture();
  owned.memory.writeFileSync(tools.nodeTypes + "/index.d.ts", '/// <reference path="../../../package/src/commands/held/index.ts" />');
  await assert.rejects(owned.run(), /held/i);
  noHeldReads(owned);
});

test("build blocks held config extends before payload read", async () => {
  const owned = fixture({ "tsconfig.json": JSON.stringify({ extends: "./src/commands/held/design-evidence/config.json" }) });
  await assert.rejects(owned.run(), /held/i);
  noHeldReads(owned);
});

test("build cannot fall back to unguarded TypeScript system reads", async () => {
  const owned = fixture();
  const saved = new Map(["readFile", "readDirectory", "fileExists", "directoryExists", "getDirectories", "realpath", "writeFile"].map(name => [name, ts.sys[name]]));
  try {
    for (const name of saved.keys()) ts.sys[name] = () => { throw new Error("unguarded TypeScript system " + name); };
    const result = await owned.run();
    assert.equal(result.status, 0, owned.output.join(""));
  } finally {
    for (const [name, value] of saved) ts.sys[name] = value;
  }
  noHeldReads(owned);
});

test("build preserves falsey input and cleanup failure identities and closes descriptors", async () => {
  for (const reason of [undefined, null, false, 0, "", NaN]) for (const mode of ["read", "close", "combined"]) {
    const owned = fixture();
    const open = owned.fileSystem.openSync, close = owned.fileSystem.closeSync;
    let selected;
    owned.fileSystem.openSync = (...args) => { const descriptor = open(...args); if (String(args[0]) === root + "/src/index.ts") selected = descriptor; return descriptor; };
    const cleanup = Object.freeze({ reason });
    owned.fileSystem.readFileSync = descriptor => {
      if (descriptor === selected && mode !== "close") throw reason;
      return owned.memory.readFileSync(descriptor);
    };
    owned.fileSystem.closeSync = descriptor => { close(descriptor); if (descriptor === selected && mode !== "read") throw cleanup; };
    let caught = false, failure;
    try { await owned.run(); } catch (error) { caught = true; failure = error; }
    assert.ok(caught);
    if (mode === "combined") {
      assert.ok(failure instanceof AggregateError);
      assert.ok(Object.is(failure.errors[0], reason));
      assert.equal(failure.errors[1], cleanup);
    } else assert.ok(Object.is(failure, mode === "read" ? reason : cleanup));
    assert.equal(owned.writes.length, 0);
    noHeldReads(owned);
  }
});

test("build refuses declaration output redirection before creating any outputs", async () => {
  const owned = fixture();
  await assert.rejects(owned.run(["--declarationDir", "../escape"]), /dist|declarationDir/);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

test("build reports unknown compiler options without reading source payloads", async () => {
  const owned = fixture();
  const result = await owned.run(["--notACompilerOption"]);
  assert.equal(result.status, 1);
  assert.match(owned.output.join(""), /Unknown compiler option/);
  assert.equal(owned.reads.some(path => path.startsWith(root + "/src/")), false);
  noHeldReads(owned);
});


test("build preserves relative project/output options, declaration subdirectories and BOM", async () => {
  const owned = fixture();
  const result = await owned.run(["-p", "tsconfig.build.json", "--outDir", "dist", "--declarationDir", "dist/types", "--emitBOM"]);
  assert.equal(result.status, 0, owned.output.join(""));
  assert.ok(result.emittedFiles.includes(root + "/dist/types/index.d.ts"));
  assert.equal(owned.memory.readFileSync(root + "/dist/index.js", "utf8").charCodeAt(0), 0xfeff);
  noHeldReads(owned);
});

test("unbound raw config discovery reaches synthetic held candidates that guarded discovery prunes", () => {
  const owned = fixture();
  const raw = ts.parseJsonConfigFileContent(JSON.parse(owned.memory.readFileSync(root + "/tsconfig.build.json", "utf8")), {
    useCaseSensitiveFileNames: true,
    readFile: path => { try { return owned.memory.readFileSync(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } },
    fileExists: path => owned.memory.existsSync(path),
    readDirectory: (path, extensions, excludes, includes, depth) => ts.matchFiles(path, extensions, excludes, includes, true, root, depth, directory => {
      const files = [], directories = [];
      for (const name of owned.memory.readdirSync(directory)) {
        const stat = owned.memory.lstatSync(directory + "/" + name);
        (stat.isDirectory() ? directories : files).push(name);
      }
      return { files, directories };
    }, path => path),
  }, root);
  assert.ok(raw.fileNames.includes(root + "/src/commands/held/index.ts"));
  assert.ok(raw.fileNames.includes(root + "/src/commands/held/design-evidence/hidden.ts"));
});


for (const valid of [true, false]) {
  test("build preserves boundary-owner authentication: " + valid, async () => {
    const owned = fixture();
    const owner = "tests/owned-capture/owner.mjs";
    const bytes = "this is authenticated metadata ownership, never executed";
    owned.memory.mkdirSync(root + "/tests/owned-capture", { recursive: true });
    owned.memory.writeFileSync(root + "/" + owner, bytes);
    const boundary = JSON.parse(owned.memory.readFileSync(root + "/integration-boundaries.json", "utf8"));
    boundary.fixtureDirectories.push({ path: "tests/owned-capture/data", owner, sha256: valid ? createHash("sha256").update(bytes).digest("hex") : "0".repeat(64) });
    owned.memory.writeFileSync(root + "/integration-boundaries.json", JSON.stringify(boundary));
    if (valid) {
      const result = await owned.run();
      assert.equal(result.status, 0, owned.output.join(""));
      assert.equal(owned.reads.filter(path => path === root + "/" + owner).length, 1);
      assert.equal(owned.listings.includes(root + "/tests/owned-capture/data"), false);
    } else {
      await assert.rejects(owned.run(), /fixture owner changed/);
      assert.equal(owned.reads.some(path => path.startsWith(root + "/src/")), false);
      assert.equal(owned.writes.length, 0);
    }
    noHeldReads(owned);
  });
}

test("build refuses content identity drift and closes the source descriptor", async () => {
  const owned = fixture();
  const open = owned.fileSystem.openSync;
  let selected;
  owned.fileSystem.openSync = (...args) => { const descriptor = open(...args); if (String(args[0]) === root + "/src/index.ts") selected = descriptor; return descriptor; };
  owned.fileSystem.readFileSync = descriptor => {
    const bytes = owned.memory.readFileSync(descriptor);
    if (descriptor === selected) owned.memory.appendFileSync(root + "/src/index.ts", " ");
    return bytes;
  };
  await assert.rejects(owned.run(), /identity changed/);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});


test("build refuses transitive resurrection of an explicitly excluded source", async () => {
  const owned = fixture({ "src/index.ts": 'export { value } from "./excluded.js";', "src/excluded.ts": "export const value = 1;" });
  await assert.rejects(owned.run(), /outside admitted root names/);
  assert.equal(owned.reads.includes(root + "/src/excluded.ts"), false);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});


for (const target of ["./references/child", "./src/commands/held", "./src/commands/HELD", "../outside/child"]) {
  test("build rejects nonempty project references before source or target reads: " + target, async () => {
    const owned = fixture({
      "references/child/tsconfig.json": JSON.stringify({ compilerOptions: { composite: false }, files: ["child.ts"] }),
      "references/child/child.ts": "export const child = 1;",
    });
    const config = JSON.parse(owned.memory.readFileSync(root + "/tsconfig.build.json", "utf8"));
    config.references = [{ path: target }];
    owned.memory.writeFileSync(root + "/tsconfig.build.json", JSON.stringify(config));
    await assert.rejects(owned.run(["--noEmitOnError"]), /project references are not supported/);
    const configInputs = ["integration-boundaries.json", "tsconfig.json", "tsconfig.build.json"].map(path => root + "/" + path);
    assert.ok(owned.reads.every(path => configInputs.includes(path)), JSON.stringify(owned.reads));
    assert.equal(owned.writes.length, 0);
    assert.equal(owned.metadata.some(path => path.startsWith(root + "/references/") || path.startsWith("/owned/outside/")), false);
    noHeldReads(owned);
  });
}

test("build accepts an empty project-reference list and retains four-file emit", async () => {
  const owned = fixture();
  const config = JSON.parse(owned.memory.readFileSync(root + "/tsconfig.build.json", "utf8"));
  config.references = [];
  owned.memory.writeFileSync(root + "/tsconfig.build.json", JSON.stringify(config));
  const result = await owned.run();
  assert.equal(result.status, 0, owned.output.join(""));
  assert.equal(result.emittedFiles.length, 4);
  noHeldReads(owned);
});

test("real TypeScript reports TS6306 for an owned non-composite referenced project", () => {
  const owned = fixture({
    "references/child/tsconfig.json": JSON.stringify({ compilerOptions: { composite: false }, files: ["child.ts"] }),
    "references/child/child.ts": "export const child = 1;",
  });
  const readFile = path => {
    try { return owned.memory.readFileSync(path, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  };
  const host = {
    getCurrentDirectory: () => root,
    getCanonicalFileName: path => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    getDefaultLibFileName: () => tools.typescriptLib + "/lib.es2023.d.ts",
    readFile,
    fileExists: path => owned.memory.existsSync(path) && owned.memory.lstatSync(path).isFile(),
    directoryExists: path => owned.memory.existsSync(path) && owned.memory.lstatSync(path).isDirectory(),
    readDirectory: () => [],
    getDirectories: () => [],
    getSourceFile(path, languageVersion) {
      const text = readFile(path);
      return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
    },
    writeFile() { assert.fail("reference diagnostic comparison must not emit"); },
  };
  const program = ts.createProgram({
    rootNames: [root + "/src/index.ts", tools.typescriptLib + "/lib.es2023.d.ts"],
    options: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noLib: true, types: [], noEmit: true },
    host,
    projectReferences: [{ path: root + "/references/child" }],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 6306), JSON.stringify(diagnostics.map(diagnostic => diagnostic.code)));
  assert.equal(owned.writes.length, 0);
});
