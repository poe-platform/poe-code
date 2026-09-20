import assert from "node:assert/strict";
import test from "node:test";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import { createFsFromVolume, Volume } from "memfs";
import { buildPackage } from "./build.mjs";
import { buildOptionalPackage } from "./build-optional.mjs";
import { renderNativeStorageSources } from "./generate-native-storage-sources.mjs";
import { bindPeerArtifact, resolvePeerProfile, stagePeerArtifact, assertPeerArtifact } from "../tests/plugins/qualified-current-release/peer.mjs";

const root = "/owned/package";
const tools = { typescriptLib: "/owned/node_modules/typescript/lib", nodeTypes: "/owned/node_modules/@types/node", undiciTypes: "/owned/node_modules/undici-types" };
const globals = "interface Array<T> { length: number; } interface Boolean {} interface Function {} interface CallableFunction {} interface NewableFunction {} interface IArguments {} interface Number {} interface Object {} interface RegExp {} interface String {}";

function fixture(extra = {}, compilerOptions = {}) {
  const volume = Volume.fromJSON({
    [root + "/package.json"]: JSON.stringify({ name: "@poe-platform/safe-bash", type: "module" }),
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
  return { volume, memory, fileSystem, reads, metadata, listings, descriptors, writes, output: [], run(args = []) { return buildPackage({ root, tools, fileSystem, args, write: text => this.output.push(text) }); } };
}

for (const defect of ['none', 'stale', 'canonical-change', 'missing-literal', 'missing-canonical']) test(`native storage literals are synchronized before guarded emission: ${defect}`, async () => {
  const canonical = 'export function collectStorageOrigin(): number { return 1; }\nexport function restoreStorageOrigin(): boolean { return true; }\n';
  const sources = renderNativeStorageSources(canonical);
  const extra = {};
  if (defect !== 'missing-canonical') extra['src/playwright/native-storage-realm.ts'] = defect === 'canonical-change' ? canonical.replace('return 1', 'return 2') : canonical;
  if (defect !== 'missing-literal') extra['src/playwright/native-storage-sources.generated.ts'] = defect === 'stale' ? sources + '// stale\n' : sources;
  const owned = fixture(extra);
  if (defect === 'none') assert.equal((await owned.run()).status, 0, owned.output.join(''));
  else {
    await assert.rejects(owned.run(), defect.startsWith('missing') ? /sources are incomplete/ : /literals are stale/);
    assert.equal(owned.writes.length, 0);
  }
  noHeldReads(owned);
});

for (const defect of ["none", "public", "closure", "source", "link"]) test(`build qualified private command declarations: ${defect}`, async () => {
  const name = "safe-bash-command-fixture";
  const implementation = {
    name, version: "0.0.1", private: defect !== "public", type: "module", dependencies: defect === "closure" ? { forbidden: "1" } : {},
    exports: { ".": { types: defect === "source" ? "./src/index.d.ts" : "./dist/index.d.ts", import: "./dist/index.js" } },
  };
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", devDependencies: { [name]: "*" }, poeCode: { integration: { privateWorkspaces: { [name]: { version: "0.0.1", dependencies: {}, devDependencies: {} } } } } }),
    "src/index.ts": `export { answer } from "${name}";`,
    [`../${name}/package.json`]: JSON.stringify(implementation),
    [`../${name}/dist/index.d.ts`]: "export declare const answer: number;",
    [`../${name}/src/index.d.ts`]: "export declare const answer: number;",
  });
  if (defect === "link") {
    owned.memory.unlinkSync(root + `/../${name}/dist/index.d.ts`);
    owned.memory.symlinkSync(root + `/../${name}/src/index.d.ts`, root + `/../${name}/dist/index.d.ts`);
  }
  if (defect === "none") assert.equal((await owned.run()).status, 0, owned.output.join(""));
  else await assert.rejects(owned.run());
  assert.equal(owned.reads.some(path => path.endsWith(`/../${name}/src/index.d.ts`)), false);
  assert.equal(owned.descriptors.size, 0);
});

for (const defect of ["none", "pin", "name", "version", "export", "closure", "link", "source-import", "runtime-import", "unapproved-import"]) test(`build explicit Pandoc SDK declaration admission: ${defect}`, async () => {
  const exports = {".": {types: "./dist/index.d.ts", import: "./dist/index.js"}};
  const pandoc = {name: "@poe-code/pandoc", version: "0.0.1", private: true, type: "module", exports, dependencies: {"@poe-code/office-package": "*", entities: "^6.0.1", "jpeg-js": "^0.4.4", "jsonc-parser": "^3.3.1", parse5: "7.3.0", saxes: "6.0.0", "@poe-code/pdf": "0.0.1", pptx: "*"}};
  const pdf = {name: "@poe-code/pdf", version: "0.0.1", private: true, type: "module", exports, dependencies: {"pdf-lib": "1.17.1", "@pdf-lib/fontkit": "1.1.1", pako: "3.0.1"}};
  const owned = fixture({
    "package.json": JSON.stringify({name: "virtual-bash", private: true, type: "module", devDependencies: {"@poe-code/pandoc": defect === "pin" ? "unapproved" : "*"}}),
    "src/index.ts": 'import type { Page } from "@poe-code/pandoc"; export const page: Page = { width: 12 };',
    "../pandoc/package.json": JSON.stringify(pandoc),
    "../pandoc/dist/index.d.ts": 'export type { Page } from "@poe-code/pdf";',
    "../pdf/package.json": JSON.stringify(pdf),
    "../pdf/dist/index.d.ts": 'export type { Page } from "./model.js";',
    "../pdf/dist/model.d.ts": 'export interface Page { width: number; }',
    "../pandoc/src/private.d.ts": 'export declare const hidden: number;',
    "../pandoc/dist/runtime.js": 'export const hidden = 12;',
    "node_modules/unapproved/index.d.ts": 'export declare const hidden: number;',
  });
  if (defect === "name") pandoc.name = "other";
  if (defect === "version") pdf.version = "0.0.2";
  if (defect === "export") pandoc.exports = {".": {types: "./src/private.d.ts", import: "./dist/index.js"}};
  if (defect === "closure") pandoc.dependencies.extra = "1.0.0";
  if (["name", "version", "export", "closure"].includes(defect)) {
    owned.memory.writeFileSync(root + "/../pandoc/package.json", JSON.stringify(pandoc));
    owned.memory.writeFileSync(root + "/../pdf/package.json", JSON.stringify(pdf));
  }
  if (defect === "link") {
    owned.memory.unlinkSync(root + "/../pdf/dist/model.d.ts");
    owned.memory.symlinkSync(root + "/../pandoc/src/private.d.ts", root + "/../pdf/dist/model.d.ts");
  }
  if (["source-import", "runtime-import", "unapproved-import"].includes(defect)) {
    const target = defect === "source-import" ? "../src/private.js" : defect === "runtime-import" ? "./runtime.js" : "unapproved";
    owned.memory.writeFileSync(root + "/../pandoc/dist/index.d.ts", `export { hidden } from "${target}";`);
    assert.notEqual((await owned.run()).status, 0);
    assert.equal(owned.reads.some(path => path.endsWith("/src/private.d.ts") || path.endsWith("/dist/runtime.js") || path.includes("/unapproved/")), false);
  } else if (defect === "none") {
    assert.equal((await owned.run()).status, 0, owned.output.join(""));
    assert.ok(owned.reads.includes("/owned/pdf/dist/model.d.ts"));
  } else await assert.rejects(owned.run(), defect === "link" ? /symlink/ : /Pandoc SDK/);
  assert.equal(owned.descriptors.size, 0);
});

function noHeldReads(owned) {
  assert.equal(owned.reads.filter(path => path.toLowerCase().includes("/held/")).length, 0);
  assert.equal(owned.listings.filter(path => path.toLowerCase().includes("/held")).length, 0);
  assert.equal(owned.metadata.filter(path => path.toLowerCase().includes("/held/")).length, 0);
  assert.equal(owned.descriptors.size, 0);
}

function afterInputRead(owned, path, action) {
  const open = owned.fileSystem.openSync;
  let selected, acted = false;
  owned.fileSystem.openSync = (...args) => {
    const descriptor = open(...args);
    if (String(args[0]) === path) selected = descriptor;
    return descriptor;
  };
  owned.fileSystem.readFileSync = descriptor => {
    const bytes = owned.memory.readFileSync(descriptor);
    if (descriptor === selected && !acted) { acted = true; action(); }
    return bytes;
  };
}

for (const profile of ["dependencies", "devDependencies"]) for (const defect of ["none", "version", "name", "dependency", "link", "unapproved-import"]) test(`build pinned portable dependency declaration admission: ${defect}${profile === "devDependencies" ? " development profile" : ""}`, async () => {
  const dependencies = { "@noble/hashes": "2.4.0", pako: "3.0.1" };
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", [profile]: dependencies }),
    "src/index.ts": 'import { value } from "@noble/hashes/sha2.js"; import { inflate } from "pako"; export const answer = inflate(value);',
    "node_modules/@noble/hashes/package.json": JSON.stringify({ name: "@noble/hashes", version: "2.4.0", type: "module", exports: { "./sha2.js": "./sha2.js" } }),
    "node_modules/@noble/hashes/sha2.d.ts": "export declare const value: number;",
    "node_modules/pako/package.json": JSON.stringify({ name: "pako", version: "3.0.1", types: "./dist/pako.d.ts" }),
    "node_modules/pako/dist/pako.d.ts": "export declare function inflate(value: number): number;",
    "node_modules/unapproved/package.json": JSON.stringify({ name: "unapproved", types: "index.d.ts" }),
    "node_modules/unapproved/index.d.ts": "export declare const secret: number;",
  });
  if (defect === "none") {
    assert.equal((await owned.run()).status, 0, owned.output.join(""));
    assert.ok(owned.reads.includes(root + "/node_modules/@noble/hashes/sha2.d.ts"));
    assert.ok(owned.reads.includes(root + "/node_modules/pako/dist/pako.d.ts"));
  } else if (defect === "unapproved-import") {
    owned.memory.writeFileSync(root + "/src/index.ts", 'export { secret } from "unapproved";');
    assert.notEqual((await owned.run()).status, 0);
    assert.equal(owned.reads.some(path => path.includes("/unapproved/")), false);
  } else if (defect === "link") {
    owned.memory.unlinkSync(root + "/node_modules/pako/dist/pako.d.ts");
    owned.memory.symlinkSync(root + "/node_modules/unapproved/index.d.ts", root + "/node_modules/pako/dist/pako.d.ts");
    await assert.rejects(owned.run(), /symlink/);
  } else if (defect === "dependency") {
    owned.memory.writeFileSync(root + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", dependencies: { ...dependencies, unapproved: "1.0.0" } }));
    await assert.rejects(owned.run(), /portable dependency contract/);
  } else {
    owned.memory.writeFileSync(root + "/node_modules/pako/package.json", JSON.stringify({ name: defect === "name" ? "other" : "pako", version: defect === "version" ? "3.0.0" : "3.0.1", types: "./dist/pako.d.ts" }));
    await assert.rejects(owned.run(), /portable dependency identity/);
  }
  assert.equal(owned.descriptors.size, 0);
});

for (const dependency of ["@noble/hashes", "pako", "@poe-code/office-package"]) test(`build refuses changed development declaration pin: ${dependency}`, async () => {
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", devDependencies: {
      "@noble/hashes": "2.4.0", pako: "3.0.1", "@poe-code/office-package": "*", [dependency]: "unapproved",
    } }),
  });
  await assert.rejects(owned.run(), /portable dependency contract/);
  assert.equal(owned.reads.some(path => path.includes("/node_modules/")), false);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

for (const profile of ["dependencies", "devDependencies"]) for (const defect of ["none", "version", "dependency", "export", "link", "source-import"]) test(`build shared archive declaration admission: ${defect}${profile === "devDependencies" ? " development profile" : ""}`, async () => {
  const shared = "node_modules/@poe-code/office-package";
  const metadata = {
    name: "@poe-code/office-package", version: "0.0.1", type: "module",
    dependencies: { pako: "3.0.1" },
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./zip": { types: "./dist/zip.d.ts", import: "./dist/zip.js" },
      "./compression": { types: "./dist/compression.d.ts", import: "./dist/compression.js" },
    },
  };
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", [profile]: { "@noble/hashes": "2.4.0", pako: "3.0.1", "@poe-code/office-package": "*" } }),
    "src/index.ts": 'export { archive } from "@poe-code/office-package/zip";',
    "node_modules/@noble/hashes/package.json": JSON.stringify({ name: "@noble/hashes", version: "2.4.0" }),
    "node_modules/pako/package.json": JSON.stringify({ name: "pako", version: "3.0.1" }),
    [shared + "/package.json"]: JSON.stringify(metadata),
    [shared + "/dist/index.d.ts"]: 'export { archive } from "./zip.js";',
    [shared + "/dist/zip.d.ts"]: "export declare const archive: number;",
    [shared + "/dist/compression.d.ts"]: "export declare const compression: number;",
    [shared + "/src/private.d.ts"]: "export declare const hidden: number;",
  });
  if (defect === "version") metadata.version = "0.0.2";
  if (defect === "dependency") metadata.dependencies.extra = "1.0.0";
  if (defect === "export") metadata.exports["./zip"].types = "./src/private.d.ts";
  if (["version", "dependency", "export"].includes(defect)) {
    owned.memory.writeFileSync(root + "/" + shared + "/package.json", JSON.stringify(metadata));
    await assert.rejects(owned.run(), /shared archive/);
  } else if (defect === "link") {
    owned.memory.unlinkSync(root + "/" + shared + "/dist/zip.d.ts");
    owned.memory.symlinkSync(root + "/" + shared + "/src/private.d.ts", root + "/" + shared + "/dist/zip.d.ts");
    await assert.rejects(owned.run(), /symlink/);
  } else if (defect === "source-import") {
    owned.memory.writeFileSync(root + "/" + shared + "/dist/zip.d.ts", 'export { hidden } from "../src/private.js";');
    assert.notEqual((await owned.run()).status, 0);
    assert.equal(owned.reads.some(path => path.endsWith("/src/private.d.ts")), false);
  } else {
    assert.equal((await owned.run()).status, 0, owned.output.join(""));
    assert.ok(owned.reads.includes(root + "/" + shared + "/dist/zip.d.ts"));
  }
  assert.equal(owned.descriptors.size, 0);
});

for (const defect of ["none", "detached", "declaration", "runtime"]) test(`build portable SafeFS declaration admission: ${defect}`, async () => {
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", peerDependencies: { "poe-code": ">=13.0.0" }, devDependencies: { "poe-code": "file:../.." }, poeCode: { integration: { peerProfile: "checkout-root" } } }),
    "src/index.ts": 'import type { FileSystem } from "poe-code/safe-fs/core"; export const filesystem: FileSystem = { portable: true };',
    "../../package.json": JSON.stringify({ name: "poe-code", type: "module", exports: {
      "./safe-fs": { types: "./packages/safe-fs/dist/index.d.ts", import: "./packages/safe-js/dist/safe-fs.js" },
      "./safe-fs/core": { types: { default: "./packages/safe-fs/dist/core.d.ts" }, import: "./packages/safe-js/dist/safe-fs-core.js" },
    } }),
    "../../packages/safe-fs/dist/index.d.ts": "export interface FileSystem { portable: boolean; }",
    "../../packages/safe-fs/dist/core.d.ts": "export interface FileSystem { portable: boolean; }",
  });
  if (defect === "detached") owned.memory.writeFileSync("/package.json", JSON.stringify({ name: "poe-code", type: "module", exports: {} }));
  if (defect === "none" || defect === "detached") {
    assert.equal((await owned.run()).status, 0, owned.output.join(""));
    assert.ok(owned.reads.includes("/packages/safe-fs/dist/core.d.ts"));
  } else {
    const peer = JSON.parse(owned.memory.readFileSync("/package.json", "utf8"));
    if (defect === "declaration") peer.exports["./safe-fs/core"].types.default = "./private/core.d.ts";
    else peer.exports["./safe-fs/core"].import = "./packages/safe-fs/dist/core.js";
    owned.memory.writeFileSync("/package.json", JSON.stringify(peer));
    await assert.rejects(owned.run(), /canonical public SafeFS core/);
    assert.ok(!owned.reads.includes("/packages/safe-fs/dist/core.d.ts"));
  }
  noHeldReads(owned);
});

test("build directory index reuses large stable listings with fresh metadata", async () => {
  const owned = fixture();
  const listing = owned.fileSystem.readdirSync;
  const neighbors = Array.from({ length: 6334 }, (_, index) => "ambient-" + index);
  owned.fileSystem.readdirSync = (path, ...args) => {
    const names = listing(path, ...args);
    return path === "/owned" ? [...names, ...neighbors] : names;
  };
  assert.equal((await owned.run()).status, 0, owned.output.join(""));
  assert.equal(owned.listings.filter(path => path === "/owned").length, 1);
  assert.ok(owned.metadata.filter(path => path === "/owned").length > 20);
  noHeldReads(owned);
});

test("build directory index is never shared across invocations", async () => {
  const owned = fixture();
  assert.equal((await owned.run()).status, 0, owned.output.join(""));
  const listing = owned.fileSystem.readdirSync;
  owned.fileSystem.readdirSync = (path, ...args) => path === "/owned" ? [...listing(path, ...args), "PACKAGE"] : listing(path, ...args);
  await assert.rejects(owned.run(), /noncanonical compiler path spelling/);
  noHeldReads(owned);
});

for (const field of ["dev", "ino", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) test(
  `build directory index invalidates changed ${field} before using cached names`, async () => {
    const owned = fixture();
    const before = owned.memory.lstatSync("/owned");
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    let changed = false;
    owned.fileSystem.lstatSync = path => {
      const stat = metadata(path);
      if (path === "/owned") {
        for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) stat[key] = before[key];
        if (changed) stat[field] += 1;
      }
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      const names = listing(path, ...args);
      return path === "/owned" && changed ? [...names, "PACKAGE"] : names;
    };
    afterInputRead(owned, root + "/integration-boundaries.json", () => { changed = true; });
    await assert.rejects(owned.run(), /noncanonical compiler path spelling/);
    assert.equal(owned.listings.filter(path => path === "/owned").length, 2);
    noHeldReads(owned);
  },
);

for (const fields of [["nlink"], ["size"], ["mtimeMs"], ["ctimeMs"], ["nlink", "size", "mtimeMs", "ctimeMs"]]) test(
  `build directory index rebuilds outside ancestor membership after ${fields.join("/")} churn`, async () => {
    const owned = fixture();
    const before = owned.memory.lstatSync("/owned");
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    let enumerations = 0;
    owned.fileSystem.lstatSync = path => {
      const stat = metadata(path);
      if (path === "/owned") for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) {
        stat[key] = before[key] + (enumerations > 0 && fields.includes(key) ? 1 : 0);
      }
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      const names = listing(path, ...args);
      if (path === "/owned") {
        enumerations += 1;
        if (enumerations === 1) owned.memory.mkdirSync("/owned/ambient-new");
      }
      return names;
    };
    assert.equal((await owned.run()).status, 0, owned.output.join(""));
    assert.equal(enumerations, 2);
    assert.ok(owned.reads.includes(root + "/src/index.ts"));
    noHeldReads(owned);
  },
);

test("build directory index tolerates sustained outside churn with bounded uncached lookups", async () => {
  const owned = fixture();
  const before = owned.memory.lstatSync("/owned");
  const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
  let enumerations = 0, consumed = 0, traversals = 0, pending = false;
  owned.fileSystem.lstatSync = path => {
    const stat = metadata(path);
    if (path === "/owned") { stat.nlink = before.nlink + enumerations; pending = true; }
    if (pending && [root, "/owned/node_modules"].includes(path)) {
      if (enumerations) {
        assert.equal(enumerations - consumed, 3);
        consumed = enumerations;
        traversals += 1;
      }
      pending = false;
    }
    return stat;
  };
  owned.fileSystem.readdirSync = (path, ...args) => {
    const names = listing(path, ...args);
    if (path === "/owned") enumerations += 1;
    return names;
  };
  assert.equal((await owned.run()).status, 0, owned.output.join(""));
  assert.ok(traversals > 2);
  assert.equal(enumerations, traversals * 3);
  assert.ok(owned.reads.includes(root + "/src/index.ts"));
  noHeldReads(owned);
});

for (const laterVersion of [2, 3]) test(`build directory fallback never caches unstable version ${laterVersion}`, async () => {
  const owned = fixture();
  const before = owned.memory.lstatSync("/owned");
  const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
  let enumerations = 0, changed = false;
  afterInputRead(owned, root + "/integration-boundaries.json", () => { changed = true; });
  owned.fileSystem.lstatSync = path => {
    const stat = metadata(path);
    if (path === "/owned") stat.nlink = before.nlink + (changed ? laterVersion : enumerations);
    return stat;
  };
  owned.fileSystem.readdirSync = (path, ...args) => {
    const names = listing(path, ...args);
    if (path !== "/owned") return names;
    enumerations += 1;
    return changed ? [...names, "PACKAGE"] : names;
  };
  await assert.rejects(owned.run(), /noncanonical compiler path spelling/);
  assert.equal(enumerations, 4);
  assert.equal(owned.reads.length, 1);
  noHeldReads(owned);
});

test("build directory fallback still caches a stable third observation", async () => {
  const owned = fixture();
  const before = owned.memory.lstatSync("/owned");
  const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
  let enumerations = 0;
  owned.fileSystem.lstatSync = path => {
    const stat = metadata(path);
    if (path === "/owned") stat.nlink = before.nlink + Math.min(enumerations, 2);
    return stat;
  };
  owned.fileSystem.readdirSync = (path, ...args) => {
    const names = listing(path, ...args);
    if (path === "/owned") enumerations += 1;
    return names;
  };
  assert.equal((await owned.run()).status, 0, owned.output.join(""));
  assert.equal(enumerations, 3);
  noHeldReads(owned);
});

for (const defect of ["dev", "ino", "mode", "symlink", "special"]) test(
  `build directory fallback refuses terminal outside ${defect} replacement`, async () => {
    const owned = fixture();
    const before = owned.memory.lstatSync("/owned");
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    let enumerations = 0;
    owned.fileSystem.lstatSync = path => {
      const stat = metadata(path);
      if (path === "/owned") {
        stat.nlink = before.nlink + enumerations;
        if (enumerations === 3) {
          if (defect === "symlink") stat.isSymbolicLink = () => true;
          else if (defect === "special") stat.isDirectory = () => false;
          else stat[defect] += 1;
        }
      }
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      const names = listing(path, ...args);
      if (path === "/owned") enumerations += 1;
      return names;
    };
    await assert.rejects(owned.run(), /identity changed|nonlink directory/);
    assert.equal(enumerations, 3);
    assert.equal(owned.reads.length, 0);
    noHeldReads(owned);
  },
);

for (const defect of ["alias", "rename", "missing", "child-link", "child-special"]) test(
  `build directory fallback rejects latest terminal ${defect}`, async () => {
    const owned = fixture();
    const before = owned.memory.lstatSync("/owned");
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    let enumerations = 0;
    owned.fileSystem.lstatSync = path => {
      const stat = metadata(path);
      if (path === "/owned") stat.nlink = before.nlink + enumerations;
      if (path === root && enumerations === 3) {
        if (defect === "child-link") stat.isSymbolicLink = () => true;
        if (defect === "child-special") stat.isDirectory = () => false;
      }
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      const names = listing(path, ...args);
      if (path !== "/owned") return names;
      enumerations += 1;
      if (enumerations !== 3) return names;
      if (defect === "alias") return [...names, "PACKAGE"];
      if (defect === "rename") return names.map(name => name === "package" ? "PACKAGE" : name);
      if (defect === "missing") return names.filter(name => name !== "package");
      return names;
    };
    await assert.rejects(owned.run(), error => {
      assert.doesNotMatch(error.message, /membership remained unstable/);
      if (defect === "alias" || defect === "rename") assert.match(error.message, /noncanonical compiler path spelling/);
      if (defect === "child-link") assert.match(error.message, /symlink/);
      if (defect === "child-special") assert.match(error.message, /nonlink directory/);
      if (defect === "missing") assert.ok(error instanceof SyntaxError);
      return true;
    });
    assert.equal(enumerations, 3);
    assert.equal(owned.reads.length, 0);
    noHeldReads(owned);
  },
);

for (const operation of ["readdir", "lstat"]) for (const failure of [0, new Error("owned terminal failure")]) test(
  `build directory fallback preserves terminal ${operation} ${failure === 0 ? "falsey" : "I/O"} error and closes its input`, async () => {
    const owned = fixture();
    const before = owned.memory.lstatSync("/owned");
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    let enumerations = 0, active = false;
    afterInputRead(owned, root + "/integration-boundaries.json", () => { active = true; });
    owned.fileSystem.lstatSync = path => {
      if (path === "/owned" && active && enumerations === 3 && operation === "lstat") throw failure;
      const stat = metadata(path);
      if (path === "/owned") stat.nlink = before.nlink + (active ? enumerations + 1 : 0);
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      if (path === "/owned" && active && ++enumerations === 3 && operation === "readdir") throw failure;
      return listing(path, ...args);
    };
    let caught = false;
    try { await owned.run(); } catch (error) { caught = true; assert.equal(error, failure); }
    assert.equal(caught, true);
    assert.equal(enumerations, 3);
    assert.equal(owned.reads.length, 1);
    noHeldReads(owned);
  },
);

for (const directory of [root, root + "/src", tools.typescriptLib]) for (const field of ["dev", "ino", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) test(
  `build directory index keeps ${directory} ${field} strict during population`, async () => {
    const owned = fixture();
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    const population = directory === root + "/src" ? 2 : 1;
    let enumerations = 0;
    owned.fileSystem.lstatSync = path => {
      const stat = metadata(path);
      if (path === directory && enumerations >= population) stat[field] += 1;
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      const names = listing(path, ...args);
      if (path === directory) enumerations += 1;
      return names;
    };
    await assert.rejects(owned.run(), /identity changed/);
    assert.equal(enumerations, population);
    if (directory === root) assert.equal(owned.reads.length, 0);
    if (directory === root + "/src") assert.ok(!owned.reads.includes(root + "/src/index.ts"));
    if (directory === tools.typescriptLib) assert.ok(!owned.reads.includes(directory + "/lib.es2023.d.ts"));
    noHeldReads(owned);
  },
);

for (const defect of ["dev", "ino", "mode", "symlink", "special"]) test(
  `build directory index refuses outside ${defect} replacement during rebuilding`, async () => {
    const owned = fixture();
    const before = owned.memory.lstatSync("/owned");
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    let enumerations = 0;
    owned.fileSystem.lstatSync = path => {
      const stat = metadata(path);
      if (path === "/owned") {
        stat.nlink = before.nlink + Math.min(enumerations, 1);
        if (enumerations === 2) {
          if (defect === "symlink") stat.isSymbolicLink = () => true;
          else if (defect === "special") stat.isDirectory = () => false;
          else stat[defect] += 1;
        }
      }
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      const names = listing(path, ...args);
      if (path === "/owned") enumerations += 1;
      return names;
    };
    await assert.rejects(owned.run(), /identity changed|nonlink directory/);
    assert.equal(enumerations, 2);
    assert.equal(owned.reads.length, 0);
    noHeldReads(owned);
  },
);

for (const defect of ["alias", "rename", "child-link"]) test(
  `build directory index rejects ${defect} from a rebuilt outside listing`, async () => {
    const owned = fixture();
    const before = owned.memory.lstatSync("/owned");
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    let enumerations = 0;
    owned.fileSystem.lstatSync = path => {
      const stat = metadata(path);
      if (path === "/owned") stat.nlink = before.nlink + Math.min(enumerations, 1);
      if (path === root && enumerations === 2 && defect === "child-link") stat.isSymbolicLink = () => true;
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      const names = listing(path, ...args);
      if (path !== "/owned") return names;
      enumerations += 1;
      if (enumerations === 2 && defect === "alias") return [...names, "PACKAGE"];
      if (enumerations === 2 && defect === "rename") return names.map(name => name === "package" ? "PACKAGE" : name);
      return names;
    };
    await assert.rejects(owned.run(), /noncanonical compiler path spelling|symlink/);
    assert.equal(enumerations, 2);
    assert.equal(owned.reads.length, 0);
    noHeldReads(owned);
  },
);

for (const failure of [0, new Error("owned rebuilding failure")]) test(
  `build directory index propagates rebuilding ${failure === 0 ? "falsey" : "I/O"} errors without retry`, async () => {
    const owned = fixture();
    const before = owned.memory.lstatSync("/owned");
    const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
    let enumerations = 0;
    owned.fileSystem.lstatSync = path => {
      const stat = metadata(path);
      if (path === "/owned") stat.nlink = before.nlink + Math.min(enumerations, 1);
      return stat;
    };
    owned.fileSystem.readdirSync = (path, ...args) => {
      if (path === "/owned" && ++enumerations === 2) throw failure;
      return listing(path, ...args);
    };
    let caught = false;
    try { await owned.run(); } catch (error) { caught = true; assert.equal(error, failure); }
    assert.equal(caught, true);
    assert.equal(enumerations, 2);
    assert.equal(owned.reads.length, 0);
    noHeldReads(owned);
  },
);

test("build directory index refuses identity changes while listing", async () => {
  const owned = fixture();
  const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
  let changed = false;
  owned.fileSystem.lstatSync = path => {
    const stat = metadata(path);
    if (path === "/owned" && changed) stat.ino += 1;
    return stat;
  };
  owned.fileSystem.readdirSync = (path, ...args) => {
    const names = listing(path, ...args);
    if (path === "/owned") changed = true;
    return names;
  };
  await assert.rejects(owned.run(), /identity changed/);
  assert.equal(owned.reads.length, 0);
  noHeldReads(owned);
});

for (const kind of ["rename", "ancestor-link", "held-leaf-link", "special"]) test(
  `build directory index retains fresh child admission after ${kind} replacement`, async () => {
    const owned = fixture();
    afterInputRead(owned, root + "/integration-boundaries.json", () => {
      if (kind === "rename") owned.memory.renameSync(root, "/owned/PACKAGE");
      if (kind === "ancestor-link") {
        owned.memory.renameSync(root + "/src", root + "/source-target");
        owned.memory.symlinkSync("source-target", root + "/src");
      }
      if (kind === "held-leaf-link") {
        owned.memory.unlinkSync(root + "/src/index.ts");
        owned.memory.symlinkSync("commands/held/index.ts", root + "/src/index.ts");
      }
      if (kind === "special") {
        const metadata = owned.fileSystem.lstatSync;
        owned.fileSystem.lstatSync = path => {
          const stat = metadata(path);
          if (path === root + "/src/index.ts") { stat.isFile = () => false; stat.isDirectory = () => false; }
          return stat;
        };
      }
    });
    await assert.rejects(owned.run(), /noncanonical|ENOENT|symlink|regular/);
    assert.ok(!owned.reads.includes(root + "/src/index.ts"));
    noHeldReads(owned);
  },
);

for (const limit of ["names", "characters"]) test(`build directory index falls back safely above its ${limit} bound`, async () => {
  const owned = fixture();
  const listing = owned.fileSystem.readdirSync;
  const names = Array.from({ length: limit === "names" ? 32769 : 20000 }, (_, index) => (limit === "names" ? "extra-" : "extra-".repeat(10)) + index);
  owned.fileSystem.readdirSync = (path, ...args) => path === "/owned" ? [...listing(path, ...args), ...names] : listing(path, ...args);
  assert.equal((await owned.run()).status, 0, owned.output.join(""));
  assert.ok(owned.listings.filter(path => path === "/owned").length > 1);
  noHeldReads(owned);
});

for (const limit of ["names", "characters"]) test(`build directory index enforces its aggregate ${limit} bound`, async () => {
  const owned = fixture();
  const listing = owned.fileSystem.readdirSync;
  const neighbors = Array.from({ length: limit === "names" ? 17000 : 6000 }, (_, index) => (limit === "names" ? "extra-" : "extra-".repeat(10)) + index);
  let changed = false;
  afterInputRead(owned, tools.typescriptLib + "/lib.es2023.d.ts", () => { changed = true; });
  owned.fileSystem.readdirSync = (path, ...args) => {
    const names = listing(path, ...args);
    if (path === "/owned") return [...names, ...neighbors, ...(changed ? ["PACKAGE"] : [])];
    return path === "/owned/node_modules" ? [...names, ...neighbors] : names;
  };
  await assert.rejects(owned.run(), /noncanonical compiler path spelling/);
  assert.ok(owned.listings.filter(path => path === "/owned").length > 1);
  noHeldReads(owned);
});

test("build directory index safely rereads evicted directories", async () => {
  const sources = Object.fromEntries(Array.from({ length: 270 }, (_, index) => ["src/group" + String(index).padStart(3, "0") + "/entry.ts", "export const value = 1;\n"]));
  const owned = fixture(sources);
  const listing = owned.fileSystem.readdirSync;
  let changed = false;
  afterInputRead(owned, root + "/src/index.ts", () => { changed = true; });
  owned.fileSystem.readdirSync = (path, ...args) => {
    const names = listing(path, ...args);
    return path === root + "/src/group000" && changed ? [...names, "ENTRY.ts"] : names;
  };
  await assert.rejects(owned.run(), /noncanonical compiler path spelling/);
  assert.ok(owned.listings.filter(path => path === root + "/src/group000").length >= 2);
  noHeldReads(owned);
});

test("build directory index does not reuse incomplete identities", async () => {
  const owned = fixture();
  const metadata = owned.fileSystem.lstatSync;
  owned.fileSystem.lstatSync = path => {
    const stat = metadata(path);
    if (path === "/owned") stat.ctimeMs = undefined;
    return stat;
  };
  assert.equal((await owned.run()).status, 0, owned.output.join(""));
  assert.ok(owned.listings.filter(path => path === "/owned").length > 1);
  noHeldReads(owned);
});

for (const reason of [0, Object.freeze({ cause: "listing denied" })]) test("build directory index preserves invalidation errors and descriptor cleanup", async () => {
  const owned = fixture();
  const metadata = owned.fileSystem.lstatSync, listing = owned.fileSystem.readdirSync;
  let changed = false;
  owned.fileSystem.lstatSync = path => {
    const stat = metadata(path);
    if (path === "/owned" && changed) stat.ino += 1;
    return stat;
  };
  owned.fileSystem.readdirSync = (path, ...args) => {
    if (path === "/owned" && changed) throw reason;
    return listing(path, ...args);
  };
  afterInputRead(owned, root + "/integration-boundaries.json", () => { changed = true; });
  let caught = false, failure;
  try { await owned.run(); } catch (error) { caught = true; failure = error; }
  assert.ok(caught);
  assert.equal(failure, reason);
  noHeldReads(owned);
});

test("guarded compiler resolves the public peer declaration without admitting peer source or runtime", async () => {
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", peerDependencies: { "poe-code": ">=13.0.0" }, devDependencies: { "poe-code": "13.0.0" } }),
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

test("guarded compiler admits only declared private op types, not its source or runtime", async () => {
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", private: true, type: "module", devDependencies: { "@poe-platform/op": "*" } }),
    "../op/package.json": JSON.stringify({ name: "@poe-platform/op", private: true, type: "module", exports: { ".": { types: "./dist/index.d.ts" } } }),
    "../op/dist/index.d.ts": 'export interface Backend { name: string; }',
    "../op/dist/index.js": 'RUNTIME MUST NOT BE READ',
    "../op/src/index.ts": 'SOURCE MUST NOT BE READ',
    "src/index.ts": 'import type { Backend } from "@poe-platform/op"; export const backend: Backend = { name: "fixture" };'
  });
  const result = await owned.run();
  assert.equal(result.status, 0, owned.output.join(""));
  assert.ok(owned.reads.includes("/owned/op/dist/index.d.ts"));
  assert.ok(!owned.reads.some(path => path.startsWith("/owned/op/src/") || path.endsWith("/op/dist/index.js")));
  noHeldReads(owned);
});

for (const nested of [false, true]) test(`guarded compiler carries private op declaration closure inside portable dist (nested declarations: ${nested})`, async () => {
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", private: true, type: "module", devDependencies: { "@poe-platform/op": "*" } }),
    "../op/package.json": JSON.stringify({ name: "@poe-platform/op", private: true, type: "module", exports: { ".": { types: "./dist/index.d.ts" } } }),
    "../op/dist/index.d.ts": 'export type { Backend } from "./types.js";',
    "../op/dist/types.d.ts": 'export interface Backend { name: string; }',
    "../op/dist/unreferenced.d.ts": 'UNREFERENCED SENTINEL',
    "src/commands/op/index.ts": 'export type { Backend } from "@poe-platform/op"; export type Options = import("@poe-platform/op").Backend;',
  }, nested ? { declarationDir: root + "/dist/types" } : {});
  const result = await owned.run();
  assert.equal(result.status, 0, owned.output.join(""));
  const declarationDirectory = nested ? "/dist/types" : "/dist";
  const output = owned.memory.readFileSync(root + declarationDirectory + "/commands/op/index.d.ts", "utf8");
  assert.ok(output.includes(nested ? '"../../../internal/op/index.js"' : '"../../internal/op/index.js"'), output);
  assert.ok(!output.includes("@poe-platform/op"), output);
  assert.equal(owned.memory.readFileSync(root + "/dist/internal/op/index.d.ts", "utf8"), 'export type { Backend } from "./types.js";');
  assert.equal(owned.memory.readFileSync(root + "/dist/internal/op/types.d.ts", "utf8"), 'export interface Backend { name: string; }');
  assert.ok(!owned.reads.includes("/owned/op/dist/unreferenced.d.ts"));
  assert.ok(!owned.memory.existsSync(root + "/dist/internal/op/unreferenced.d.ts"));
  const relocated = createFsFromVolume(new Volume());
  for (const path of result.emittedFiles.filter(path => path.endsWith(".d.ts"))) {
    const destination = path.replace(root, "/relocated");
    relocated.mkdirSync(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
    relocated.writeFileSync(destination, owned.memory.readFileSync(path));
  }
  relocated.writeFileSync("/relocated/globals.d.ts", globals);
  relocated.writeFileSync("/relocated/consumer.ts", `import type { Backend, Options } from ".${declarationDirectory}/commands/op/index.js"; const backend: Backend = { name: "portable" }; const options: Options = backend;`);
  const options = { strict: true, noEmit: true, noLib: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  host.fileExists = path => relocated.existsSync(path);
  host.readFile = path => relocated.existsSync(path) ? relocated.readFileSync(path, "utf8") : undefined;
  host.directoryExists = path => relocated.existsSync(path) && relocated.statSync(path).isDirectory();
  host.getSourceFile = (path, version) => { const text = host.readFile(path); return text === undefined ? undefined : ts.createSourceFile(path, text, version, true); };
  const consumer = ts.createProgram(["/relocated/globals.d.ts", "/relocated/consumer.ts"], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(consumer).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
  noHeldReads(owned);
});

for (const defect of ["name", "private", "types"]) test(`guarded compiler rejects untrusted op declaration metadata: ${defect}`, async () => {
  const op = { name: "@poe-platform/op", private: true, exports: { ".": { types: "./dist/index.d.ts" } } };
  if (defect === "name") op.name = "other";
  if (defect === "private") op.private = false;
  if (defect === "types") op.exports["."].types = "./src/index.ts";
  const owned = fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", private: true, type: "module", devDependencies: { "@poe-platform/op": "*" } }),
    "../op/package.json": JSON.stringify(op),
    "../op/src/index.ts": "SOURCE MUST NOT BE READ"
  });
  await assert.rejects(owned.run(), /internal op|remain private/);
  assert.ok(!owned.reads.some(path => path.startsWith("/owned/op/src/")));
});

function checkoutPeerFixture(optionalYaml = false) {
  const checkout = "/checkout", packageRoot = checkout + "/packages/safe-bash";
  const manifest = { name: "@poe-platform/safe-bash", private: true, peerDependencies: { "poe-code": ">=13.0.0" }, devDependencies: { "poe-code": "file:../.." }, poeCode: { integration: { peerProfile: "checkout-root" } } };
  if (optionalYaml) {
    manifest.peerDependencies.yaml = "2.9.0";
    manifest.peerDependenciesMeta = { yaml: { optional: true } };
  }
  const peer = { name: "poe-code", version: "0.0.0-dev", type: "module", devDependencies: { "poe-code": "file:." }, exports: { "./safe-fs": { types: { default: "./packages/safe-fs/dist/index.d.ts" }, import: "./packages/safe-js/dist/safe-fs.js" } } };
  const lock = { packages: { "packages/safe-bash": {
    peerDependencies: structuredClone(manifest.peerDependencies),
    ...(optionalYaml ? { peerDependenciesMeta: structuredClone(manifest.peerDependenciesMeta) } : {}),
    devDependencies: { "poe-code": "file:../.." },
  }, "node_modules/poe-code": { resolved: "", link: true } } };
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
  return { checkout, root: packageRoot, io, manifest, peer, lock, declarations, lockPath: checkout + "/package-lock.json", lockEntry: "packages/safe-bash" };
}

function registryPeerFixture(optionalYaml = false) {
  const original = checkoutPeerFixture(optionalYaml);
  const packageRoot = "/registry/candidate", directory = packageRoot + "/node_modules/poe-code";
  const manifest = structuredClone(original.manifest), peer = structuredClone(original.peer);
  delete manifest.poeCode;
  delete manifest.private;
  manifest.devDependencies["poe-code"] = "13.0.0";
  peer.version = "13.0.0";
  delete peer.devDependencies;
  const files = new Map([["package.json", Buffer.from(JSON.stringify(peer))]]);
  for (const path of ["packages/safe-fs/dist/index.d.ts", "packages/safe-js/dist/safe-fs.js", "packages/safe-js/dist/shared.js"]) {
    files.set(path, original.io.readFileSync(original.checkout + "/" + path));
  }
  const blocks = [];
  for (const [path, bytes] of files) {
    const header = Buffer.alloc(512);
    header.write("package/" + path);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar\0" + "00", 257);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  const archive = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
  const artifact = "/registry/poe-code-13.0.0.tgz";
  const integrity = "sha512-" + createHash("sha512").update(archive).digest("base64");
  const lock = { packages: {
    "": { peerDependencies: structuredClone(manifest.peerDependencies), devDependencies: { ...manifest.devDependencies },
      ...(optionalYaml ? { peerDependenciesMeta: structuredClone(manifest.peerDependenciesMeta) } : {}) },
    "node_modules/poe-code": { version: "13.0.0", resolved: "https://registry.npmjs.org/poe-code/-/poe-code-13.0.0.tgz", integrity },
  } };
  const lockPath = packageRoot + "/package-lock.json";
  const io = createFsFromVolume(Volume.fromJSON({
    [packageRoot + "/package.json"]: JSON.stringify(manifest), [lockPath]: JSON.stringify(lock), [artifact]: archive,
    ...Object.fromEntries([...files].map(([path, bytes]) => [directory + "/" + path, bytes])),
  }));
  const declarations = { peer: { ...original.declarations.peer, version: "13.0.0", integrity,
    metadataSha256: createHash("sha256").update(files.get("package.json")).digest("hex") } };
  return { root: packageRoot, io, manifest, peer, lock, declarations, lockPath, lockEntry: "", artifact, directory };
}

for (const [profile, create] of [["checkout-root", checkoutPeerFixture], ["registry-release", registryPeerFixture]]) {
  for (const operation of ["resolve", "bind"]) for (const missing of ["nothing", "peer path", "lock"]) {
    test(`peer admission ordering ${profile} rejects unknown required peers before ${operation} inputs with missing ${missing}`, () => {
      const owned = create(true), manifestPath = owned.root + "/package.json";
      owned.manifest.peerDependencies.unapproved = "1.0.0";
      owned.io.writeFileSync(manifestPath, JSON.stringify(owned.manifest));
      if (missing === "peer path") {
        if (profile === "checkout-root") owned.io.unlinkSync(owned.checkout + "/package.json");
        else owned.io.rmSync(owned.directory, { recursive: true });
      }
      if (missing === "lock") owned.io.unlinkSync(owned.lockPath);
      const inspected = [];
      for (const method of ["realpathSync", "lstatSync", "readFileSync"]) {
        const original = owned.io[method].bind(owned.io);
        owned.io[method] = (path, ...args) => {
          if (path !== owned.root && path !== manifestPath) inspected.push({ method, path: String(path) });
          return original(path, ...args);
        };
      }
      assert.throws(() => operation === "resolve" ? resolvePeerProfile(owned.root, owned.io)
        : bindPeerArtifact({ ...owned, checkout: profile === "checkout-root" }), /Unknown peer dependency/);
      assert.deepEqual(inspected, []);
    });
  }

  for (const missingLock of [false, true]) {
    test(`peer admission ordering ${profile} rejects a changed manifest before rereading lock with missing lock ${missingLock}`, () => {
      const owned = create(true), manifestPath = owned.root + "/package.json";
      const read = owned.io.readFileSync.bind(owned.io), inspected = [];
      let manifestReads = 0, rereading = false;
      for (const method of ["realpathSync", "lstatSync"]) {
        const original = owned.io[method].bind(owned.io);
        owned.io[method] = (path, ...args) => {
          if (rereading && path !== manifestPath) inspected.push({ method, path: String(path) });
          return original(path, ...args);
        };
      }
      owned.io.readFileSync = (path, ...args) => {
        if (path === manifestPath && ++manifestReads === 2) {
          rereading = true;
          if (missingLock) owned.io.unlinkSync(owned.lockPath);
        }
        if (rereading && path !== manifestPath) inspected.push({ method: "readFileSync", path: String(path) });
        const bytes = read(path, ...args);
        if (path === manifestPath && manifestReads === 1) {
          owned.manifest.peerDependencies.unapproved = "1.0.0";
          owned.io.writeFileSync(manifestPath, JSON.stringify(owned.manifest));
        }
        return bytes;
      };
      assert.throws(() => bindPeerArtifact({ ...owned, checkout: profile === "checkout-root" }), /Unknown peer dependency/);
      assert.equal(manifestReads, 2);
      assert.deepEqual(inspected, []);
    });
  }

  for (const optionalYaml of [false, true]) for (const explicitRequired of [false, true]) {
    test(`peer metadata ${profile} admits canonical requiredness ${explicitRequired} with optional YAML ${optionalYaml} without staging YAML`, () => {
      const owned = create(optionalYaml);
      if (explicitRequired) {
        owned.manifest.peerDependenciesMeta = { ...owned.manifest.peerDependenciesMeta, "poe-code": { optional: false } };
        owned.lock.packages[owned.lockEntry].peerDependenciesMeta = structuredClone(owned.manifest.peerDependenciesMeta);
        owned.io.writeFileSync(owned.root + "/package.json", JSON.stringify(owned.manifest));
        owned.io.writeFileSync(owned.lockPath, JSON.stringify(owned.lock));
      }
      const read = owned.io.readFileSync.bind(owned.io), reads = [];
      owned.io.readFileSync = (path, ...args) => { reads.push(String(path)); return read(path, ...args); };
      assert.equal(resolvePeerProfile(owned.root, owned.io).profile, profile);
      const binding = bindPeerArtifact({ ...owned, checkout: profile === "checkout-root" });
      assert.equal(binding.profile, profile);
      assert.equal(binding.runtimeFiles, 2);
      assert.equal(binding.declarationFiles, 1);
      assert.equal(binding.tarballSha256 !== null, profile === "registry-release");
      owned.io.mkdirSync("/consumer");
      stagePeerArtifact(binding, "/consumer");
      assertPeerArtifact(binding, "/consumer");
      assert.deepEqual(owned.io.readdirSync("/consumer/node_modules"), ["poe-code"]);
      assert.equal(reads.some(path => path.includes("/node_modules/yaml")), false);
      assert.equal(owned.io.existsSync(owned.root + "/node_modules/yaml"), false);
    });
  }

  const defects = [
    ["missing canonical peer", manifest => { delete manifest.peerDependencies["poe-code"]; }],
    ["canonical range", manifest => { manifest.peerDependencies["poe-code"] = "^13.0.0"; }],
    ["optional canonical peer", manifest => { manifest.peerDependenciesMeta["poe-code"] = { optional: true }; }],
    ["nonboolean canonical optional flag", manifest => { manifest.peerDependenciesMeta["poe-code"] = { optional: "false" }; }],
    ["null peer map", manifest => { manifest.peerDependencies = null; }],
    ["array peer map", manifest => { manifest.peerDependencies = []; }],
    ["null metadata", manifest => { manifest.peerDependenciesMeta = null; }],
    ["array metadata", manifest => { manifest.peerDependenciesMeta = []; }],
    ["null peer metadata", manifest => { manifest.peerDependenciesMeta["poe-code"] = null; }],
    ["array peer metadata", manifest => { manifest.peerDependenciesMeta["poe-code"] = []; }],
    ["orphan YAML metadata", manifest => { delete manifest.peerDependencies.yaml; }],
    ["unknown required peer", manifest => { manifest.peerDependencies.extra = "1.0.0"; }],
    ["unknown optional peer", manifest => { manifest.peerDependencies.extra = "1.0.0"; manifest.peerDependenciesMeta.extra = { optional: true }; }],
    ["orphan metadata", manifest => { manifest.peerDependenciesMeta.extra = { optional: true }; }],
    ["YAML range", manifest => { manifest.peerDependencies.yaml = "^2.9.0"; }],
    ["YAML other pin", manifest => { manifest.peerDependencies.yaml = "2.8.0"; }],
    ["YAML implicit requiredness", manifest => { delete manifest.peerDependenciesMeta; }],
    ["YAML missing optional flag", manifest => { manifest.peerDependenciesMeta.yaml = {}; }],
    ["YAML required", manifest => { manifest.peerDependenciesMeta.yaml.optional = false; }],
    ["YAML nonboolean flag", manifest => { manifest.peerDependenciesMeta.yaml.optional = "true"; }],
    ["YAML extra metadata", manifest => { manifest.peerDependenciesMeta.yaml.extra = true; }],
    ["canonical extra metadata", manifest => { manifest.peerDependenciesMeta["poe-code"] = { extra: true }; }],
  ];
  for (const location of ["manifest", "lock"]) for (const [name, mutate] of defects) {
    test(`peer metadata ${profile} rejects ${location} ${name} in resolution and binding`, () => {
      const owned = create(true);
      mutate(location === "manifest" ? owned.manifest : owned.lock.packages[owned.lockEntry]);
      owned.io.writeFileSync(owned.root + "/package.json", JSON.stringify(owned.manifest));
      owned.io.writeFileSync(owned.lockPath, JSON.stringify(owned.lock));
      assert.throws(() => resolvePeerProfile(owned.root, owned.io), /peer|metadata|YAML|Canonical|Locked/i);
      assert.throws(() => bindPeerArtifact({ ...owned, checkout: profile === "checkout-root" }), /peer|metadata|YAML|Canonical|Locked/i);
    });
  }

  for (const defect of ["missing record", "valid but different peer set", "valid but different metadata"]) {
    test(`peer metadata ${profile} rejects selected lock ${defect}`, () => {
      const owned = create(true), selected = owned.lock.packages[owned.lockEntry];
      if (defect === "missing record") delete owned.lock.packages[owned.lockEntry];
      if (defect === "valid but different peer set") { delete selected.peerDependencies.yaml; delete selected.peerDependenciesMeta; }
      if (defect === "valid but different metadata") selected.peerDependenciesMeta["poe-code"] = { optional: false };
      owned.io.writeFileSync(owned.lockPath, JSON.stringify(owned.lock));
      assert.throws(() => resolvePeerProfile(owned.root, owned.io), /peer|metadata|Locked/i);
      assert.throws(() => bindPeerArtifact({ ...owned, checkout: profile === "checkout-root" }), /peer|metadata|Locked/i);
    });
  }

  for (const location of ["manifest", "lock"]) {
    test(`peer metadata ${profile} revalidates ${location} between profile resolution and binding`, () => {
      const owned = create(true);
      const path = location === "manifest" ? owned.root + "/package.json" : owned.lockPath;
      const read = owned.io.readFileSync.bind(owned.io);
      let changed = false;
      owned.io.readFileSync = (filename, ...args) => {
        const bytes = read(filename, ...args);
        if (filename === path && !changed) {
          changed = true;
          (location === "manifest" ? owned.manifest : owned.lock.packages[owned.lockEntry]).peerDependenciesMeta.yaml.optional = false;
          owned.io.writeFileSync(path, JSON.stringify(location === "manifest" ? owned.manifest : owned.lock));
        }
        return bytes;
      };
      assert.throws(() => bindPeerArtifact({ ...owned, checkout: profile === "checkout-root" }), /peer|metadata|YAML|Locked/i);
      assert.equal(changed, true);
    });

    test(`peer metadata ${profile} keeps ${location} authenticated after admission`, () => {
      const owned = create(true);
      const binding = bindPeerArtifact({ ...owned, checkout: profile === "checkout-root" });
      const path = location === "manifest" ? owned.root + "/package.json" : owned.lockPath;
      (location === "manifest" ? owned.manifest : owned.lock.packages[owned.lockEntry]).peerDependenciesMeta.yaml.optional = false;
      owned.io.writeFileSync(path, JSON.stringify(location === "manifest" ? owned.manifest : owned.lock));
      owned.io.mkdirSync("/consumer");
      assert.throws(() => stagePeerArtifact(binding, "/consumer"), /Source .* changed after peer admission/);
      assert.equal(owned.io.existsSync("/consumer/node_modules"), false);
    });
  }
}

for (const defect of ["archive", "declaration", "installed declaration", "foreign runtime closure", "profile selector"]) {
  test(`peer metadata optional YAML does not bypass registry ${defect} authentication`, () => {
    const owned = registryPeerFixture(true);
    if (defect === "archive") {
      const bytes = owned.io.readFileSync(owned.artifact);
      bytes[bytes.length - 1] ^= 1;
      owned.io.writeFileSync(owned.artifact, bytes);
    }
    if (defect === "declaration") owned.declarations.peer.declarations.set("packages/safe-fs/dist/index.d.ts", "0".repeat(64));
    if (defect === "installed declaration") owned.io.writeFileSync(owned.directory + "/packages/safe-fs/dist/index.d.ts", "forged");
    if (defect === "foreign runtime closure") owned.declarations.peer.publicEntries.set("yaml", "packages/safe-fs/dist/index.d.ts");
    assert.throws(() => bindPeerArtifact({ ...owned, checkout: defect === "profile selector" }), /SRI|declaration|differs|public|checkout/i);
  });
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

function optionalFixture(extra = {}) {
  return fixture({
    "package.json": JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", files: ["dist", "!dist/optional.js", "!dist/optional.d.ts", "!dist/optional.js.map", "!dist/optional.d.ts.map", "!dist/commands/yes"] }),
    "tsconfig.build.json": JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { rootDir: "src", outDir: "dist", declaration: true, declarationMap: true, sourceMap: true }, include: ["src/**/*.ts"], exclude: ["src/excluded.ts", "src/optional.ts", "src/commands/yes"] }),
    "tsconfig.optional.json": JSON.stringify({ extends: "./tsconfig.build.json", files: ["src/optional.ts"], include: [] }),
    "src/optional.ts": 'export { answer } from "./index.js"; export { yes } from "./commands/yes/index.js";\n',
    "src/commands/yes/index.ts": 'export { value as yes } from "./helper.js";\n',
    "src/commands/yes/helper.ts": 'export const value: number = 7;\n',
    ...extra,
  });
}

test("optional profile compiles its declared root and reachable admitted sources with byte bindings", async () => {
  const owned = optionalFixture();
  const result = await buildPackage({ root, tools, fileSystem: owned.fileSystem, profile: "optional", write: text => owned.output.push(text) });
  assert.equal(result.status, 0, owned.output.join(""));
  assert.deepEqual(result.rootNames, [root + "/src/optional.ts"]);
  assert.equal(result.emittedFiles.length, 16);
  assert.deepEqual(Object.keys(result.emittedHashes).sort(), [...result.emittedFiles].sort());
  for (const [filename, digest] of Object.entries({ ...result.inputHashes, ...result.emittedHashes })) {
    assert.equal(digest, createHash("sha256").update(owned.memory.readFileSync(filename)).digest("hex"), filename);
  }
  for (const filename of ["src/optional.ts", "src/commands/yes/helper.ts", "tsconfig.optional.json", "tsconfig.build.json", "tsconfig.json", "package.json", "integration-boundaries.json"]) assert.ok(result.inputHashes[root + "/" + filename], filename);
  assert.ok(result.inputHashes[tools.typescriptLib + "/lib.es2023.d.ts"]);
  assert.equal(owned.reads.includes(root + "/src/excluded.ts"), false);
  noHeldReads(owned);
});

test("optional CLI flag selects the same fixed profile without selecting arbitrary projects", async () => {
  const owned = optionalFixture();
  const result = await owned.run(["--optional", "-p", "tsconfig.optional.json"]);
  assert.equal(result.status, 0, owned.output.join(""));
  assert.deepEqual(result.rootNames, [root + "/src/optional.ts"]);
  assert.ok(result.inputHashes[root + "/tsconfig.optional.json"]);
  noHeldReads(owned);
});

test("default profile retains root membership, result shape, and optional exclusion", async () => {
  const owned = optionalFixture();
  const result = await owned.run();
  assert.equal(result.status, 0, owned.output.join(""));
  assert.deepEqual(result.rootNames, [root + "/src/index.ts"]);
  assert.deepEqual(Object.keys(result).sort(), ["emittedFiles", "rootNames", "status"]);
  assert.equal(owned.reads.some(filename => filename.endsWith("/optional.ts") || filename.includes("/commands/yes/")), false);
  assert.equal(owned.reads.includes(root + "/tsconfig.optional.json"), false);
  noHeldReads(owned);
});

test("optional compilation never inventories stale output as a fresh emit", async () => {
  const owned = optionalFixture({ "dist/stale.js": "stale", "dist/optional.js": "prior optional" });
  const result = await owned.run(["--optional"]);
  assert.equal(result.status, 0, owned.output.join(""));
  assert.equal(result.emittedFiles.includes(root + "/dist/stale.js"), false);
  assert.equal(Object.hasOwn(result.emittedHashes, root + "/dist/stale.js"), false);
  assert.notEqual(owned.memory.readFileSync(root + "/dist/optional.js", "utf8"), "prior optional");
  assert.equal(owned.memory.readFileSync(root + "/dist/stale.js", "utf8"), "stale");
  noHeldReads(owned);
});

test("optional diagnostics leave prior output untouched and return no eligible emits", async () => {
  const owned = optionalFixture({ "src/commands/yes/helper.ts": "export const value: number = 'invalid';", "dist/optional.js": "previous" });
  const result = await owned.run(["--optional"]);
  assert.equal(result.status, 1);
  assert.match(owned.output.join(""), /TS2322/);
  assert.deepEqual(result.emittedFiles, []);
  assert.deepEqual(result.emittedHashes, {});
  assert.equal(owned.memory.readFileSync(root + "/dist/optional.js", "utf8"), "previous");
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

for (const target of ["./excluded.js", "./commands/held/index.js", "./commands/HELD/index.js"]) test("optional profile refuses excluded or held import " + target, async () => {
  const owned = optionalFixture({ "src/optional.ts": `export * from ${JSON.stringify(target)};` });
  await assert.rejects(owned.run(["--optional"]), /outside admitted root names|held|alias/i);
  assert.equal(owned.reads.includes(root + "/src/excluded.ts"), false);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

for (const args of [["--optional", "--optional"], ["--optional", "-p", "tsconfig.build.json"], ["--optional", "--outDir", "dist/other"], ["--optional", "--noEmit"], ["--optional", "--emitDeclarationOnly"], ["--optional", "--noEmitOnError", "false"]]) test("optional profile refuses override " + args.join(" "), async () => {
  const owned = optionalFixture();
  await assert.rejects(owned.run(args));
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

test("unrecognized API profiles fail before payload reads", async () => {
  const owned = optionalFixture();
  await assert.rejects(buildPackage({ root, tools, fileSystem: owned.fileSystem, profile: "other" }));
  assert.equal(owned.reads.length, 0);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

for (const reason of [undefined, null, false, 0, ""]) test("optional pre-aborted compile preserves reason " + String(reason), async () => {
  const owned = optionalFixture();
  let caught = false;
  try { await buildPackage({ root, tools, fileSystem: owned.fileSystem, profile: "optional", signal: { aborted: true, reason } }); }
  catch (error) { caught = true; assert.equal(error, reason); }
  assert.equal(caught, true);
  assert.equal(owned.reads.length, 0);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

test("optional cancellation during an input read closes its descriptor before settling", async () => {
  const owned = optionalFixture();
  const controller = new AbortController();
  afterInputRead(owned, root + "/src/commands/yes/helper.ts", () => controller.abort(0));
  let caught = false;
  try { await buildPackage({ root, tools, fileSystem: owned.fileSystem, profile: "optional", signal: controller.signal }); }
  catch (error) { caught = true; assert.equal(error, 0); }
  assert.equal(caught, true);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

test("optional input changes after close cannot produce a successful bound result", async () => {
  const owned = optionalFixture();
  const open = owned.fileSystem.openSync, close = owned.fileSystem.closeSync;
  let selected;
  owned.fileSystem.openSync = (...args) => { const descriptor = open(...args); if (String(args[0]) === root + "/src/commands/yes/helper.ts") selected = descriptor; return descriptor; };
  owned.fileSystem.closeSync = descriptor => { close(descriptor); if (descriptor === selected) { selected = undefined; owned.memory.appendFileSync(root + "/src/commands/yes/helper.ts", "\n"); } };
  await assert.rejects(owned.run(["--optional"]), /input identity changed|input bytes changed/);
  noHeldReads(owned);
});

test("real guarded optional compilation feeds the frozen graph stage entirely in memory", async () => {
  const owned = optionalFixture();
  const core = "/owned/packages/safe-bash";
  for (const [filename, contents] of Object.entries(owned.volume.toJSON())) {
    if (!filename.startsWith(root + "/")) continue;
    const destination = core + filename.slice(root.length);
    owned.memory.mkdirSync(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
    owned.memory.writeFileSync(destination, contents);
  }
  const manifest = JSON.parse(owned.memory.readFileSync(core + "/package.json", "utf8"));
  manifest.version = "1.0.0";
  manifest.devDependencies = { ...manifest.devDependencies, "@poe-code/safe-fs": "*" };
  manifest.exports = { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } };
  owned.memory.writeFileSync(core + "/package.json", JSON.stringify(manifest));
  for (const [directory, value] of [
    ["safe-fs", { name: "@poe-platform/safe-fs", exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } } }],
  ]) {
    owned.memory.mkdirSync("/owned/packages/" + directory, { recursive: true });
    owned.memory.writeFileSync("/owned/packages/" + directory + "/package.json", JSON.stringify(value));
  }
  let calls = 0, compilerResult;
  const result = await buildOptionalPackage({ rootDir: "/owned", fileSystem: owned.fileSystem, compile: async options => {
    calls++;
    compilerResult = await buildPackage({ ...options, tools, write: text => owned.output.push(text) });
    return compilerResult;
  } });
  assert.equal(calls, 1);
  assert.equal(compilerResult.status, 0, owned.output.join(""));
  assert.equal(result.status, 0);
  assert.equal(result.files.length, 8);
  assert.ok(result.files.includes("entrypoints/yes.js"));
  assert.ok(result.files.includes("entrypoints/yes.d.ts"));
  assert.deepEqual(result.peerImports, ["@poe-platform/safe-bash"]);
  assert.equal(result.files.includes("index.js"), false);
  assert.equal(result.files.some(filename => filename.endsWith(".map")), false);
  assert.match(owned.memory.readFileSync("/owned/packages/safe-bash/dist/opt-in/optional.js", "utf8"), /from "@poe-platform\/safe-bash"/);
  assert.equal(owned.descriptors.size, 0);
});

for (const phase of ["read-open", "write-open", "write"]) test("optional cancellation at " + phase + " stops further payload work and closes handles", async () => {
  const owned = optionalFixture();
  const signal = { aborted: false, reason: false };
  const open = owned.fileSystem.openSync;
  let selected, payloads = 0;
  owned.fileSystem.openSync = (...args) => {
    const descriptor = open(...args);
    if ((phase === "read-open" && String(args[0]) === root + "/src/optional.ts") || (phase !== "read-open" && String(args[0]).startsWith(root + "/dist/"))) {
      selected = descriptor;
      if (phase !== "write") signal.aborted = true;
    }
    return descriptor;
  };
  const read = owned.memory.readFileSync.bind(owned.memory), write = owned.memory.writeFileSync.bind(owned.memory);
  owned.fileSystem.readFileSync = (...args) => { if (args[0] === selected) payloads++; return read(...args); };
  owned.fileSystem.writeFileSync = (...args) => { if (args[0] === selected) { payloads++; if (phase === "write") signal.aborted = true; } return write(...args); };
  let caught = false;
  try { await buildPackage({ root, tools, fileSystem: owned.fileSystem, profile: "optional", signal }); }
  catch (error) { caught = true; assert.equal(error, false); }
  assert.equal(caught, true);
  assert.equal(payloads, phase === "write" ? 1 : 0);
  assert.ok(owned.writes.length <= (phase === "read-open" ? 0 : 1));
  noHeldReads(owned);
});

for (const failure of [undefined, null, false, 0, ""]) for (const mode of ["write", "close", "combined"]) test("optional output " + mode + " preserves failure " + String(failure), async () => {
  const owned = optionalFixture();
  const open = owned.fileSystem.openSync, close = owned.fileSystem.closeSync;
  const secondary = { cleanup: true };
  let selected, caught = false;
  owned.fileSystem.openSync = (...args) => { const descriptor = open(...args); if (String(args[0]).startsWith(root + "/dist/")) selected = descriptor; return descriptor; };
  owned.fileSystem.writeFileSync = (...args) => { if (args[0] === selected && mode !== "close") throw failure; return owned.memory.writeFileSync(...args); };
  owned.fileSystem.closeSync = descriptor => { close(descriptor); if (descriptor === selected && mode !== "write") throw mode === "combined" ? secondary : failure; };
  try { await owned.run(["--optional"]); }
  catch (error) {
    caught = true;
    if (mode === "combined") assert.deepEqual(error.errors, [failure, secondary]);
    else assert.equal(error, failure);
  }
  assert.equal(caught, true);
  assert.equal(owned.writes.length, 1);
  noHeldReads(owned);
});

test("optional output bytes are verified after write rather than assumed from compiler arguments", async () => {
  const owned = optionalFixture({ "dist/prior.js": "old" });
  const metadata = owned.fileSystem.lstatSync;
  owned.fileSystem.lstatSync = path => {
    const stat = metadata(path);
    if (String(path) === root + "/dist") { stat.mtimeMs = 0; stat.ctimeMs = 0; }
    return stat;
  };
  owned.fileSystem.writeFileSync = (descriptor, text) => owned.memory.writeFileSync(descriptor, "x".repeat(Buffer.byteLength(text)));
  await assert.rejects(owned.run(["--optional"]), /output bytes changed/);
  assert.equal(owned.writes.length, 1, JSON.stringify(owned.writes.map(path => [path, owned.memory.readFileSync(path, "utf8").slice(0, 20)])));
  noHeldReads(owned);
});

function optionalYamlFixture() {
  const owned = optionalFixture({ "src/commands/yes/helper.ts": 'import type { YamlValue } from "yaml"; export const value: YamlValue = 7;' });
  const manifest = JSON.parse(owned.memory.readFileSync(root + "/package.json", "utf8"));
  manifest.peerDependencies = { yaml: "2.9.0" };
  manifest.peerDependenciesMeta = { yaml: { optional: true } };
  owned.memory.writeFileSync(root + "/package.json", JSON.stringify(manifest));
  const yaml = "/owned/node_modules/yaml";
  owned.memory.mkdirSync(yaml + "/dist", { recursive: true });
  owned.memory.writeFileSync(yaml + "/package.json", JSON.stringify({ name: "yaml", version: "2.9.0", type: "module", types: "./dist/index.d.ts", main: "./dist/index.js" }));
  owned.memory.writeFileSync(yaml + "/dist/index.d.ts", "export type YamlValue = number;\n");
  owned.memory.writeFileSync(yaml + "/dist/index.js", "throw new Error('must not read or execute');\n");
  return { owned, yaml };
}

test("optional YAML has one explicitly bound declaration root without importing its runtime", async () => {
  const { owned, yaml } = optionalYamlFixture();
  const result = await buildPackage({ root, tools: { ...tools, yaml }, fileSystem: owned.fileSystem, profile: "optional", write: text => owned.output.push(text) });
  assert.equal(result.status, 0, owned.output.join(""));
  assert.ok(result.inputHashes[yaml + "/package.json"]);
  assert.ok(result.inputHashes[yaml + "/dist/index.d.ts"]);
  assert.equal(owned.reads.includes(yaml + "/dist/index.js"), false);
  noHeldReads(owned);
});

for (const defect of ["name", "version", "not-optional", "undeclared"]) test("optional YAML rejects " + defect + " rather than broadening declaration admission", async () => {
  const { owned, yaml } = optionalYamlFixture();
  if (defect === "name" || defect === "version") {
    const manifest = JSON.parse(owned.memory.readFileSync(yaml + "/package.json", "utf8"));
    manifest[defect] = "unrelated";
    owned.memory.writeFileSync(yaml + "/package.json", JSON.stringify(manifest));
  } else {
    const manifest = JSON.parse(owned.memory.readFileSync(root + "/package.json", "utf8"));
    if (defect === "not-optional") delete manifest.peerDependenciesMeta;
    else delete manifest.peerDependencies;
    owned.memory.writeFileSync(root + "/package.json", JSON.stringify(manifest));
  }
  await assert.rejects(buildPackage({ root, tools: { ...tools, yaml }, fileSystem: owned.fileSystem, profile: "optional" }), /YAML/);
  assert.equal(owned.reads.includes(yaml + "/dist/index.d.ts"), false);
  assert.equal(owned.writes.length, 0);
  noHeldReads(owned);
});

test("optional hashes bind actual BOM and UTF-8 bytes, not decoded character counts", async () => {
  const owned = optionalFixture({ "src/commands/yes/helper.ts": "\ufeffexport const value: number = 7; // é\n" });
  const config = JSON.parse(owned.memory.readFileSync(root + "/tsconfig.json", "utf8"));
  config.compilerOptions.emitBOM = true;
  owned.memory.writeFileSync(root + "/tsconfig.json", JSON.stringify(config));
  const result = await owned.run(["--optional"]);
  assert.equal(result.status, 0, owned.output.join(""));
  const emitted = owned.memory.readFileSync(root + "/dist/commands/yes/helper.js");
  assert.deepEqual([...emitted.subarray(0, 3)], [239, 187, 191]);
  assert.equal(result.emittedHashes[root + "/dist/commands/yes/helper.js"], createHash("sha256").update(emitted).digest("hex"));
  assert.equal(result.inputHashes[root + "/src/commands/yes/helper.ts"], createHash("sha256").update(owned.memory.readFileSync(root + "/src/commands/yes/helper.ts")).digest("hex"));
  noHeldReads(owned);
});

for (const defect of ['none', 'declaration', 'runtime', 'source-import']) test(`build focused Playwright public declaration admission: ${defect}`, async () => {
  const owned = fixture({
    'package.json': JSON.stringify({ name: 'virtual-bash', type: 'module', peerDependencies: { 'poe-code': '>=13.0.0' }, devDependencies: { 'poe-code': 'file:../..', '@poe-code/safe-playwright': '*' }, poeCode: { integration: { peerProfile: 'checkout-root' } } }),
    'src/index.ts': 'export { createPlaywrightController } from "poe-code/safe-playwright"; export type { PlaywrightAdapter } from "poe-code/safe-playwright/adapter";',
    '../../package.json': JSON.stringify({ name: 'poe-code', type: 'module', exports: {
      './safe-fs': { types: './packages/safe-fs/dist/index.d.ts', import: './packages/safe-js/dist/safe-fs.js' },
      './safe-playwright': { types: './packages/safe-playwright/dist/index.d.ts', import: './packages/safe-playwright/dist/index.js' },
      './safe-playwright/adapter': { types: './packages/safe-playwright/dist/adapter.d.ts', import: './packages/safe-playwright/dist/adapter.js' },
    } }),
    '../../packages/safe-fs/dist/index.d.ts': 'export interface FileSystem {}',
    '../../packages/safe-playwright/dist/index.d.ts': 'export declare function createPlaywrightController(): void;',
    '../../packages/safe-playwright/dist/adapter.d.ts': 'export interface PlaywrightAdapter {}',
    '../../packages/safe-playwright/src/private.d.ts': 'export declare function hidden(): void;',
  });
  if (defect === 'declaration' || defect === 'runtime') {
    const peer = JSON.parse(owned.memory.readFileSync('/package.json', 'utf8'));
    if (defect === 'declaration') peer.exports['./safe-playwright'].types = './packages/safe-playwright/src/private.d.ts';
    else peer.exports['./safe-playwright'].import = './packages/safe-playwright/src/private.js';
    owned.memory.writeFileSync('/package.json', JSON.stringify(peer));
    await assert.rejects(owned.run(), /canonical public Playwright/);
  } else if (defect === 'source-import') {
    owned.memory.writeFileSync('/packages/safe-playwright/dist/index.d.ts', 'export { hidden as createPlaywrightController } from "../src/private.js";');
    assert.notEqual((await owned.run()).status, 0);
    assert.equal(owned.reads.includes('/packages/safe-playwright/src/private.d.ts'), false);
  } else {
    assert.equal((await owned.run()).status, 0, owned.output.join(''));
    assert.equal(owned.reads.includes('/packages/safe-playwright/dist/adapter.d.ts'), true);
  }
  noHeldReads(owned);
});
