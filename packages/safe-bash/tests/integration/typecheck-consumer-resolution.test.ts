import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createFsFromVolume, Volume } from "memfs";

interface Binding {
  peer?: {
    name: string;
    metadataSha256: string;
    declarations: Map<string, string>;
    publicEntries: Map<string, string>;
    privateEntries: Map<string, string>;
  };
}
const { createBuiltPackageBinding, assertBuiltConsumerResolution } = await import(
  new URL("../../scripts/typecheck-consumers.mjs", import.meta.url).href
) as {
  createBuiltPackageBinding(root: string, options: { includePeer: boolean }): Binding;
  assertBuiltConsumerResolution(trace: string, consumer: string, root: string, binding: Binding): void;
};
const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const resolution = (specifier: string, target: string, importer: string): string =>
  `======== Resolving module '${specifier}' from '${importer}'. ========\n======== Module name '${specifier}' was successfully resolved to '${target}'. ========\n`;

function fixture(t: TestContext, overlapping = true) {
  const consumer = overlapping ? "/checkout" : "/consumer";
  const candidate = overlapping ? "/checkout/packages/safe-bash" : "/consumer/node_modules/virtual-bash";
  const peer = overlapping ? "/checkout" : "/consumer/node_modules/poe-code";
  const manifest = JSON.stringify({ name: "virtual-bash", exports: { ".": { types: "./dist/index.d.ts" } } });
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
  if (overlapping) memory.symlinkSync(candidate, join(consumer, "node_modules/virtual-bash"));
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
  const publicTrace = resolution("virtual-bash", join(candidate, "dist/index.d.ts"), importer);
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
  assert.throws(() => f.check(resolution("virtual-bash", join(f.candidate, "dist/other.d.ts"), f.importer)), /wrong candidate export/);
  assert.throws(() => f.check(resolution("virtual-bash", join(f.candidate, "src/helper.ts"), f.importer)), /foreign candidate/);
  assert.throws(() => f.check(resolution("../src/helper.js", join(f.candidate, "src/helper.ts"), join(f.candidate, "dist/index.d.ts"))), /foreign candidate/);
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
