import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";

interface DependencyBinding {
  name: string;
  directory: string;
  files: Map<string, string>;
}

interface Binding {
  exports: Record<string, { types: string }>;
  declarations: Map<string, string>;
  publicAliases?: string[];
  dependencies?: DependencyBinding[];
  peer?: {
    name: string;
    metadataSha256: string;
    declarations: Map<string, string>;
    publicEntries: Map<string, string>;
    privateEntries: Map<string, string>;
    publicAliases?: string[];
  };
}
const { createBuiltPackageBinding, assertBuiltConsumerResolution, publicDeclarationEntries, stageConsumerDependencies } = await import(
  new URL("../../scripts/typecheck-consumers.mjs", import.meta.url).href
) as {
  createBuiltPackageBinding(root: string, options: { includePeer: boolean }): Binding;
  assertBuiltConsumerResolution(trace: string, consumer: string, root: string, binding: Binding): void;
  publicDeclarationEntries(binding: { exports: Record<string, { types: string }>; declarations: Map<string, string> }): Map<string, string>;
  stageConsumerDependencies(root: string, temporary: string, packageRoots: string[]): DependencyBinding[];
};
const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const resolution = (specifier: string, target: string, importer: string): string =>
  `======== Resolving module '${specifier}' from '${importer}'. ========\n======== Module name '${specifier}' was successfully resolved to '${target}'. ========\n`;

test("public wildcard selectors expand only authenticated artifact declarations and honor explicit exports", t => {
  const exports = { "./contracts/*": { types: "./dist/contracts/*.d.ts" }, "./contracts/private": { types: "./dist/other.d.ts" } };
  const memory = createFsFromVolume(Volume.fromJSON({
    "/artifact/package.json": JSON.stringify({ name: "artifact", exports }),
    "/artifact/dist/contracts/path.d.ts": "export {};", "/artifact/dist/contracts/private.d.ts": "export {};",
    "/artifact/dist/contracts/nested/value.d.ts": "export {};", "/artifact/dist/other.d.ts": "export {};",
    "/artifact/src/secret.ts": "export {};",
  }));
  for (const name of ["existsSync", "lstatSync", "readFileSync", "readdirSync", "realpathSync"] as const) t.mock.method(fs, name, memory[name]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const binding = createBuiltPackageBinding("/artifact", { includePeer: false });
  const declarations = binding.declarations;
  assert.deepEqual(publicDeclarationEntries(binding), new Map([
    ["./contracts/path", "dist/contracts/path.d.ts"], ["./contracts/nested/value", "dist/contracts/nested/value.d.ts"],
    ["./contracts/private", "dist/other.d.ts"],
  ]));
  assert.throws(() => publicDeclarationEntries({ exports: { "./empty/*": { types: "./dist/missing/*.d.ts" } }, declarations }), /authenticated declarations/);
  assert.throws(() => publicDeclarationEntries({ exports: { ".": { types: "../src/index.ts" } }, declarations }), /built declaration/);
  assert.throws(() => publicDeclarationEntries({ exports: { "./wrong/*": { types: "./dist/other.d.ts" } }, declarations }), /wildcard/);
});

function fixture(t: TestContext, overlapping = true) {
  const consumer = overlapping ? "/checkout" : "/consumer";
  const candidate = overlapping ? "/checkout/packages/safe-bash" : "/consumer/node_modules/@poe-platform/safe-bash";
  const peer = overlapping ? "/checkout" : "/consumer/node_modules/poe-code";
  const manifest = JSON.stringify({ name: "@poe-platform/safe-bash", exports: { ".": { types: "./dist/index.d.ts" } } });
  const peerManifest = JSON.stringify({ name: "poe-code" });
  const declarations = { "packages/safe-fs/dist/index.d.ts": "export interface FileSystem {}", "packages/safe-fs/dist/platform.d.ts": "export {};" };
  const memory = createFsFromVolume(Volume.fromJSON({
    [join(candidate, "package.json")]: manifest,
    [join(candidate, "dist/index.d.ts")]: "export interface Shell {}",
    [join(candidate, "dist/other.d.ts")]: "export interface Other {}",
    [join(candidate, "src/helper.ts")]: "export {};",
    [join(candidate, "tests/consumer.ts")]: "export {};",
    [join(peer, "package.json")]: peerManifest,
    ...Object.fromEntries(Object.entries(declarations).map(([path, text]) => [join(peer, path), text])),
    [join(peer, "packages/safe-fs/src/private.ts")]: "export {};",
    [join(peer, "packages/safe-fs/dist/unadmitted.d.ts")]: "export {};",
    [join(consumer, "node_modules/@types/node/index.d.ts")]: "export {};",
    [join(consumer, "node_modules/undici-types/index.d.ts")]: "export {};",
    ["/foreign/index.d.ts"]: "export {};",
  }));
  if (overlapping) memory.mkdirSync(join(consumer, "node_modules/@poe-platform"), { recursive: true });
  if (overlapping) memory.symlinkSync(candidate, join(consumer, "node_modules/@poe-platform/safe-bash"));
  if (overlapping) memory.symlinkSync(peer, join(consumer, "node_modules/poe-code"));
  for (const name of ["existsSync", "lstatSync", "readFileSync", "readdirSync", "realpathSync"] as const) {
    t.mock.method(fs, name, memory[name]);
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const binding = createBuiltPackageBinding(candidate, { includePeer: false });
  binding.peer = {
    name: "poe-code", metadataSha256: hash(peerManifest),
    declarations: new Map(Object.entries(declarations).map(([path, text]) => [path, hash(text)])),
    publicEntries: new Map([["poe-code/safe-fs", "packages/safe-fs/dist/index.d.ts"]]),
    privateEntries: new Map([["#safe-fs-platform", "packages/safe-fs/dist/platform.d.ts"]]),
  };
  const importer = join(candidate, "tests/consumer.ts");
  const publicTrace = resolution("@poe-platform/safe-bash", join(candidate, "dist/index.d.ts"), importer);
  return {
    candidate, peer, consumer, importer, memory, binding, publicTrace,
    check(trace = publicTrace) { assertBuiltConsumerResolution(trace, consumer, candidate, binding); },
  };
}

for (const overlapping of [true, false]) {
  test(`consumer ownership admits authenticated candidate and peer exports (overlap=${overlapping})`, t => {
    const f = fixture(t, overlapping);
    f.check(f.publicTrace + resolution("poe-code/safe-fs", join(f.peer, "packages/safe-fs/dist/index.d.ts"), f.importer));
  });
}

test("source consumer retains explicit fixture and ambient dependency resolutions", t => {
  const f = fixture(t);
  f.check(f.publicTrace
    + resolution("../src/helper.js", join(f.candidate, "src/helper.ts"), f.importer)
    + resolution("undici-types", join(f.consumer, "node_modules/undici-types/index.d.ts"), join(f.consumer, "node_modules/@types/node/index.d.ts"))
    + resolution("./other.js", join(f.candidate, "dist/other.d.ts"), join(f.candidate, "dist/index.d.ts")));
});

test("authenticated peer private and relative closure stays admitted", t => {
  const f = fixture(t);
  const importer = join(f.peer, "packages/safe-fs/dist/index.d.ts");
  f.check(f.publicTrace
    + resolution("#safe-fs-platform", join(f.peer, "packages/safe-fs/dist/platform.d.ts"), importer)
    + resolution("./platform.js", join(f.peer, "packages/safe-fs/dist/platform.d.ts"), importer));
});

for (const [label, specifier, destination, origin, message] of [
  ["peer public import cannot select candidate", "poe-code/safe-fs", "candidate", "fixture", /authenticated public closure/],
  ["peer relative import cannot select candidate", "../../../safe-bash/dist/index.js", "candidate", "peer", /authenticated public closure/],
  ["peer private import cannot select candidate", "#safe-fs-platform", "candidate", "peer", /authenticated public closure/],
  ["fixture private import cannot select candidate", "#safe-fs-platform", "candidate", "fixture", /authenticated public closure/],
  ["peer public import cannot select ambient dependency", "poe-code/safe-fs", "ambient", "fixture", /authenticated public closure/],
  ["peer relative import cannot select ambient dependency", "../../../node_modules/undici-types/index.js", "ambient", "peer", /authenticated public closure/],
  ["fixture cannot borrow peer private mapping", "#safe-fs-platform", "platform", "fixture", /must originate/],
  ["unadmitted private mapping rejected", "#unknown", "platform", "peer", /unadmitted peer private/],
  ["wrong private target rejected", "#safe-fs-platform", "public", "peer", /wrong declaration/],
  ["wrong public target rejected", "poe-code/safe-fs", "platform", "fixture", /wrong declaration/],
  ["unadmitted public subpath rejected", "poe-code/private", "public", "fixture", /unadmitted peer public/],
  ["unknown peer declaration rejected", "./unadmitted.js", "unknown", "fixture", /authenticated public closure/],
  ["peer source fallback rejected", "../src/private.js", "source", "fixture", /authenticated public closure/],
  ["peer foreign fallback rejected", "./foreign.js", "foreign", "peer", /foreign peer/],
] as const) {
  test(label, t => {
    const f = fixture(t);
    const targets = {
      candidate: join(f.candidate, "dist/index.d.ts"), platform: join(f.peer, "packages/safe-fs/dist/platform.d.ts"),
      public: join(f.peer, "packages/safe-fs/dist/index.d.ts"), unknown: join(f.peer, "packages/safe-fs/dist/unadmitted.d.ts"),
      source: join(f.peer, "packages/safe-fs/src/private.ts"), foreign: "/foreign/index.d.ts",
      ambient: join(f.consumer, "node_modules/undici-types/index.d.ts"),
    };
    const importer = origin === "peer" ? targets.public : f.importer;
    assert.throws(() => f.check(resolution(specifier, targets[destination], importer) + f.publicTrace), message);
  });
}

test("candidate public and relative resolutions retain export and dist checks", t => {
  const f = fixture(t);
  assert.throws(() => f.check(resolution("@poe-platform/safe-bash", join(f.candidate, "dist/other.d.ts"), f.importer)), /wrong candidate export/);
  assert.throws(() => f.check(resolution("@poe-platform/safe-bash", join(f.candidate, "src/helper.ts"), f.importer)), /foreign candidate/);
  assert.throws(() => f.check(resolution("../src/helper.js", join(f.candidate, "src/helper.ts"), join(f.candidate, "dist/index.d.ts"))), /foreign candidate/);
});

test("legacy candidate aliases require the same authenticated public export", t => {
  const f = fixture(t, false);
  f.binding.publicAliases = ["virtual-bash"];
  f.check(resolution("virtual-bash", join(f.candidate, "dist/index.d.ts"), f.importer));
  assert.throws(() => f.check(f.publicTrace + resolution("virtual-bash", "/foreign/index.d.ts", f.importer)), /foreign candidate/);
  assert.throws(() => f.check(f.publicTrace + resolution("virtual-bash", join(f.candidate, "dist/other.d.ts"), f.importer)), /wrong candidate export/);
});

test("legacy filesystem aliases cannot borrow foreign or private declarations", t => {
  const f = fixture(t, false);
  f.binding.peer!.publicAliases = ["@poe-code/safe-fs"];
  const target = join(f.peer, "packages/safe-fs/dist/index.d.ts");
  f.binding.peer!.publicEntries.set("@poe-code/safe-fs/core", "packages/safe-fs/dist/index.d.ts");
  f.check(f.publicTrace + resolution("@poe-code/safe-fs/core", target, f.importer));
  assert.throws(() => f.check(f.publicTrace + resolution("@poe-code/safe-fs/core", "/foreign/index.d.ts", f.importer)), /foreign peer/);
  assert.throws(() => f.check(f.publicTrace + resolution("@poe-code/safe-fs/private", target, f.importer)), /unadmitted peer public/);
});

test("changed peer declaration bytes rejected", t => {
  const f = fixture(t);
  const target = join(f.peer, "packages/safe-fs/dist/index.d.ts");
  f.memory.writeFileSync(target, "changed");
  assert.throws(() => f.check(resolution("poe-code/safe-fs", target, f.importer) + f.publicTrace), /peer declaration bytes changed/);
});

test("changed candidate declaration bytes rejected", t => {
  const f = fixture(t);
  f.memory.writeFileSync(join(f.candidate, "dist/index.d.ts"), "changed");
  assert.throws(() => f.check(), /candidate declaration bytes or file set changed/);
});

test("authenticated peer closure bytes remain checked inside a competing dependency namespace", t => {
  const f = fixture(t);
  const path = "node_modules/undici-types/index.d.ts";
  f.binding.peer!.declarations.set(path, hash("export {};"));
  f.memory.writeFileSync(join(f.peer, path), "changed");
  assert.throws(() => f.check(resolution("undici-types", join(f.peer, path), f.importer) + f.publicTrace), /peer declaration bytes changed/);
});

for (const owner of ["candidate", "peer"] as const) {
  test(`changed ${owner} metadata rejected`, t => {
    const f = fixture(t);
    f.memory.writeFileSync(join(f[owner], "package.json"), JSON.stringify({ name: owner, exports: {} }));
    assert.throws(() => f.check(), new RegExp(`${owner} (package )?metadata changed`));
  });
}

function dependencyFixture(t: TestContext) {
  const candidate = "/consumer/node_modules/@poe-platform/safe-bash";
  const memory = createFsFromVolume(Volume.fromJSON({
    [join(candidate, "package.json")]: JSON.stringify({ name: "@poe-platform/safe-bash", version: "1.0.0", type: "module",
      exports: { ".": { types: "./dist/index.d.ts" } }, dependencies: { "pdf-lib": "1.17.1", "shape-types": "2.0.0" } }),
    [join(candidate, "dist/index.d.ts")]: 'import type { PDFContext } from "pdf-lib"; export declare function serializePdf(context: PDFContext): number;',
    "/checkout/node_modules/pdf-lib/package.json": JSON.stringify({ name: "pdf-lib", version: "1.17.1", type: "module",
      types: "cjs/index.d.ts", dependencies: { "shape-types": "^1.0.0" } }),
    "/checkout/node_modules/pdf-lib/cjs/index.d.ts": 'import type { Shape } from "shape-types"; export interface PDFContext { readonly shape: Shape; }',
    "/checkout/node_modules/pdf-lib/cjs/index.js": 'throw new Error("runtime must not be read");',
    "/checkout/node_modules/pdf-lib/node_modules/shape-types/package.json": JSON.stringify({ name: "shape-types", version: "1.2.0", type: "module", types: "index.d.ts" }),
    "/checkout/node_modules/pdf-lib/node_modules/shape-types/index.d.ts": 'export interface Shape { readonly id: number; }',
    "/checkout/node_modules/shape-types/package.json": JSON.stringify({ name: "shape-types", version: "2.0.0", type: "module", types: "index.d.ts" }),
    "/checkout/node_modules/shape-types/index.d.ts": 'export interface Shape { readonly label: string; }',
    "/consumer/check.mts": 'import { serializePdf } from "@poe-platform/safe-bash"; serializePdf({ shape: { id: 1 } });',
    "/consumer/globals.d.ts": 'interface Array<T> { readonly length: number; [index: number]: T; } interface Boolean {} interface Function {} interface CallableFunction {} interface NewableFunction {} interface IArguments {} interface Number {} interface Object {} interface RegExp {} interface String {}',
  }));
  for (const name of ["existsSync", "lstatSync", "readFileSync", "readdirSync", "realpathSync", "mkdirSync", "writeFileSync"] as const) t.mock.method(fs, name, memory[name]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const diagnostics = () => {
    const options: ts.CompilerOptions = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noLib: true, noEmit: true, types: [] };
    const host: ts.CompilerHost = {
      ...ts.createCompilerHost(options),
      fileExists: path => memory.existsSync(path),
      readFile: path => memory.existsSync(path) ? memory.readFileSync(path, "utf8") as string : undefined,
      directoryExists: path => memory.existsSync(path) && memory.statSync(path).isDirectory(),
      getSourceFile: (path, version) => memory.existsSync(path) ? ts.createSourceFile(path, memory.readFileSync(path, "utf8") as string, version, true) : undefined,
      realpath: path => memory.realpathSync(path) as string,
    };
    return ts.getPreEmitDiagnostics(ts.createProgram(["/consumer/check.mts", "/consumer/globals.d.ts"], options, host));
  };
  return { candidate, memory, diagnostics, stage: () => stageConsumerDependencies("/checkout/packages/safe-bash", "/consumer", [candidate]) };
}

test("standalone consumers receive declared dependency types with their nested versions", t => {
  const f = dependencyFixture(t);
  assert.ok(f.diagnostics().some(diagnostic => diagnostic.code === 2307));
  const dependencies = f.stage();
  assert.deepEqual(f.diagnostics().map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
  assert.equal(f.memory.existsSync("/consumer/node_modules/pdf-lib/cjs/index.js"), false);
  assert.deepEqual(dependencies.map(binding => binding.name).sort(), ["pdf-lib", "shape-types", "shape-types"]);
  f.memory.writeFileSync("/consumer/check.mts", 'import { serializePdf } from "@poe-platform/safe-bash"; serializePdf({ shape: { id: "wrong" } });');
  assert.ok(f.diagnostics().some(diagnostic => diagnostic.code === 2322), "consumer strictness must still reject an incompatible argument");
});

for (const [rootVersion, workspaceVersion, accepted] of [
  ["25.9.4", "22.20.1", true],
  ["22.20.1", "25.9.4", false],
] as const) test(`artifact dependencies use the publishing root installation (${rootVersion}, nested ${workspaceVersion})`, t => {
  const f = dependencyFixture(t);
  const metadata = JSON.parse(f.memory.readFileSync(join(f.candidate, "package.json"), "utf8") as string);
  metadata.dependencies["@types/node"] = "^25.2.2";
  f.memory.writeFileSync(join(f.candidate, "package.json"), JSON.stringify(metadata));
  f.memory.writeFileSync("/checkout/package.json", JSON.stringify({ name: "poe-code", devDependencies: { "@types/node": "^25.2.2" } }));
  for (const [origin, version] of [["/checkout", rootVersion], ["/checkout/packages/safe-bash", workspaceVersion]] as const) {
    const directory = join(origin, "node_modules/@types/node");
    f.memory.mkdirSync(directory, { recursive: true });
    f.memory.writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@types/node", version, types: "index.d.ts" }));
    f.memory.writeFileSync(join(directory, "index.d.ts"), `export type SelectedVersion = "${version}";`);
  }
  if (!accepted) {
    assert.throws(f.stage, /installed dependency version does not satisfy @types\/node@\^25\.2\.2/);
    return;
  }
  const dependencies = f.stage();
  const selected = dependencies.find(binding => binding.name === "@types/node")!;
  assert.equal(f.memory.readFileSync(join(selected.directory, "index.d.ts"), "utf8"), 'export type SelectedVersion = "25.9.4";');
  assert.equal(selected.files.get("index.d.ts"), hash('export type SelectedVersion = "25.9.4";'));
});

test("staged dependency declarations and metadata remain authenticated", t => {
  const f = dependencyFixture(t);
  const binding = createBuiltPackageBinding(f.candidate, { includePeer: false });
  binding.dependencies = f.stage();
  const entry = "/consumer/node_modules/pdf-lib/cjs/index.d.ts";
  const trace = resolution("@poe-platform/safe-bash", join(f.candidate, "dist/index.d.ts"), "/consumer/check.mts")
    + resolution("pdf-lib", entry, join(f.candidate, "dist/index.d.ts"))
    + resolution("shape-types", "/consumer/node_modules/pdf-lib/node_modules/shape-types/index.d.ts", entry);
  assertBuiltConsumerResolution(trace, "/consumer", f.candidate, binding);
  f.memory.writeFileSync(entry, "export interface PDFContext { readonly changed: true; }");
  assert.throws(() => assertBuiltConsumerResolution(trace, "/consumer", f.candidate, binding), /dependency declaration bytes changed/);
});

test("a staged dependency cannot fall back to declarations outside its admitted package", t => {
  const f = dependencyFixture(t);
  const binding = createBuiltPackageBinding(f.candidate, { includePeer: false });
  binding.dependencies = f.stage();
  const trace = resolution("@poe-platform/safe-bash", join(f.candidate, "dist/index.d.ts"), "/consumer/check.mts")
    + resolution("pdf-lib", "/checkout/node_modules/pdf-lib/cjs/index.d.ts", join(f.candidate, "dist/index.d.ts"));
  assert.throws(() => assertBuiltConsumerResolution(trace, "/consumer", f.candidate, binding), /foreign dependency/);
});

test("dependency staging rejects an installed version outside the declared range", t => {
  const f = dependencyFixture(t);
  f.memory.writeFileSync("/checkout/node_modules/pdf-lib/package.json", JSON.stringify({ name: "pdf-lib", version: "2.0.0", types: "cjs/index.d.ts" }));
  assert.throws(f.stage, /dependency version/);
});

test("staged dependency metadata cannot change after admission", t => {
  const f = dependencyFixture(t);
  const binding = createBuiltPackageBinding(f.candidate, { includePeer: false });
  binding.dependencies = f.stage();
  f.memory.writeFileSync("/consumer/node_modules/pdf-lib/package.json", JSON.stringify({ name: "pdf-lib", version: "1.17.1", types: "other.d.ts" }));
  assert.throws(() => assertBuiltConsumerResolution(
    resolution("@poe-platform/safe-bash", join(f.candidate, "dist/index.d.ts"), "/consumer/check.mts"),
    "/consumer", f.candidate, binding,
  ), /dependency metadata changed/);
});

test("dependency staging terminates manifest cycles using the existing ancestor installation", t => {
  const f = dependencyFixture(t);
  f.memory.writeFileSync("/checkout/node_modules/pdf-lib/node_modules/shape-types/package.json", JSON.stringify({
    name: "shape-types", version: "1.2.0", type: "module", types: "index.d.ts", dependencies: { "pdf-lib": "1.17.1" },
  }));
  assert.equal(f.stage().length, 3);
  assert.equal(f.memory.existsSync("/consumer/node_modules/pdf-lib/node_modules/shape-types/node_modules/pdf-lib"), false);
  assert.deepEqual(f.diagnostics().map(diagnostic => diagnostic.code), []);
});

test("dependency imports of the canonical filesystem retain the peer's existing authentication", t => {
  const f = fixture(t, false);
  const directory = "/consumer/node_modules/renderer";
  const metadata = JSON.stringify({ name: "renderer", version: "1.0.0" });
  f.memory.mkdirSync(directory, { recursive: true });
  f.memory.writeFileSync(join(directory, "package.json"), metadata);
  f.memory.writeFileSync(join(directory, "index.d.ts"), "export {};");
  f.binding.dependencies = [{ name: "renderer", directory, files: new Map([["package.json", hash(metadata)], ["index.d.ts", hash("export {};")]]) }];
  f.check(f.publicTrace + resolution("poe-code/safe-fs", join(f.peer, "packages/safe-fs/dist/index.d.ts"), join(directory, "index.d.ts")));
  assert.throws(() => f.check(f.publicTrace + resolution("poe-code/safe-fs", "/foreign/index.d.ts", join(directory, "index.d.ts"))), /foreign peer/);
});
