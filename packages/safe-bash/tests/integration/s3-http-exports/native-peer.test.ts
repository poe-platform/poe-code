import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";

const { bindPackedConsumer } = await import(new URL("./verify.mjs", import.meta.url).href);
const { bindPeerArtifact, stagePeerArtifact } = await import(new URL("../../plugins/qualified-current-release/peer.mjs", import.meta.url).href);
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const runtime = "packages/safe-js/dist/safe-fs.js";
const directory = "packages/safe-js/dist/native/fs-seek";
const specifier = "#safe-fs-native-seek";
const prefix = "node_modules/poe-code/";

function fixture(native = true, empty = false) {
  const loader = 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); export function loadBinding() { return require("./linux-x64-glibc.node"); }';
  const declaration = "export declare function loadBinding(): unknown;";
  const binary = Buffer.from([0, 255, 128, 195, 40, 0, 13, 10]);
  const metadata = {
    name: "poe-code", version: "0.0.0-dev", type: "module", devDependencies: { "poe-code": "file:." },
    exports: { "./safe-fs": { types: "./packages/safe-fs/dist/index.d.ts", import: `./${runtime}` } },
    ...(native ? { imports: { [specifier]: { types: `./${directory}/loader.d.ts`, workerd: null, browser: null, default: `./${directory}/loader.mjs` } } } : {}),
  };
  const manifest = {
    version: 1, napi: 6, maxBinaryBytes: 1048576,
    targets: empty ? [] : [{ platform: "linux", arch: "x64", libc: "glibc", minimumLibc: "2.31", size: binary.length, sha256: digest(binary) }],
    build: { sourceSha256: digest("source"), loaderSha256: digest(loader), declarationSha256: digest(declaration),
      headers: empty ? null : { version: "1.9.0", files: { "node_api.h": { size: 6, sha256: digest("header") } } },
      compiler: empty ? null : { path: "/usr/bin/cc", sha256: digest("compiler"), version: "fixture compiler" },
    },
  };
  const files = new Map<string, string | Buffer>([
    ["package.json", JSON.stringify(metadata)],
    [runtime, native ? `export { loadBinding } from "${specifier}";` : 'export { value } from "./shared.js";'],
    ["packages/safe-js/dist/shared.js", "export const value = 1;"],
    ["packages/safe-fs/dist/index.d.ts", "export declare const value: unknown;"],
    ...(native ? [
      [`${directory}/loader.mjs`, loader], [`${directory}/loader.d.ts`, declaration],
      [`${directory}/manifest.json`, JSON.stringify(manifest)],
      ...(empty ? [] : [[`${directory}/linux-x64-glibc.node`, binary]]),
    ] as [string, string | Buffer][] : []),
  ]);
  const io = createFsFromVolume(Volume.fromJSON({
    "/checkout/packages/safe-bash/package.json": JSON.stringify({ name: "virtual-bash", private: true,
      peerDependencies: { "poe-code": ">=13.0.0" }, devDependencies: { "poe-code": "file:../.." },
      poeCode: { integration: { peerProfile: "checkout-root" } },
    }),
    "/checkout/package-lock.json": JSON.stringify({ packages: {
      "packages/safe-bash": { devDependencies: { "poe-code": "file:../.." } },
      "node_modules/poe-code": { resolved: "", link: true },
    } }),
    "/consumer/node_modules/virtual-bash/package.json": '{"type":"module"}',
    "/consumer/node_modules/virtual-bash/dist/index.js": 'export * from "poe-code/safe-fs";',
    "/consumer/node_modules/virtual-bash/dist/fs/s3/http/index.js": "export {};",
  }));
  for (const [path, bytes] of files) {
    io.mkdirSync(dirname(`/checkout/${path}`), { recursive: true });
    io.writeFileSync(`/checkout/${path}`, bytes);
  }
  const declarations = {
    version: metadata.version, integrity: null, metadataSha256: digest(files.get("package.json")!),
    publicEntries: new Map([["poe-code/safe-fs", "packages/safe-fs/dist/index.d.ts"]]),
    declarations: new Map([["packages/safe-fs/dist/index.d.ts", digest(files.get("packages/safe-fs/dist/index.d.ts")!)]]),
  };
  const peer = bindPeerArtifact({ root: "/checkout/packages/safe-bash", checkout: true, io, declarations: { peer: declarations } });
  stagePeerArtifact(peer, "/consumer");
  const packed = ["package.json", "dist/index.js", "dist/fs/s3/http/index.js"];
  return { io, peer, packed, declarations, binary };
}

for (const empty of [false, true]) test(`S3 packed consumer admits authenticated native assets with empty=${empty}`, () => {
  const setup = fixture(true, empty);
  const binding = bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, setup.io);
  assert.equal(binding.edges[`${prefix}${runtime}`][specifier], `${prefix}${directory}/loader.mjs`);
  assert.deepEqual(binding.edges[`${prefix}${directory}/loader.mjs`], { "node:module": "node:module" });
  assert.equal(binding.entries[specifier], undefined);
  assert.equal(binding.edges[`${prefix}${directory}/linux-x64-glibc.node`], undefined);
  assert.equal(binding.files[`${prefix}${directory}/linux-x64-glibc.node`], empty ? undefined : digest(setup.binary));
});

test("S3 packed consumer preserves nonnative branded and legacy closures", () => {
  const setup = fixture(false);
  const branded = bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, setup.io);
  const legacy = { entries: setup.peer.entries, files: setup.peer.files };
  assert.deepEqual(bindPackedConsumer("/consumer", setup.packed, legacy, setup.declarations, ts, setup.io), branded);
  assert.equal(branded.edges[`${prefix}${runtime}`]["./shared.js"], `${prefix}packages/safe-js/dist/shared.js`);
});

test("S3 packed consumer rejects a serialized peer instead of trusting native metadata", () => {
  const setup = fixture();
  assert.throws(() => bindPackedConsumer("/consumer", setup.packed, { ...setup.peer }, setup.declarations, ts, setup.io), /Unknown canonical peer binding/);
});

test("S3 packed consumer rejects a private specifier disguised as a legacy public entry", () => {
  const setup = fixture(false);
  setup.io.writeFileSync("/consumer/node_modules/virtual-bash/dist/index.js", `import "${specifier}";`);
  const legacy = { entries: { ...setup.peer.entries, [specifier]: runtime }, files: setup.peer.files };
  assert.throws(() => bindPackedConsumer("/consumer", setup.packed, legacy, setup.declarations, ts, setup.io), /Unbound runtime dependency/);
});

test("S3 packed consumer denies a direct relative route into the native loader", () => {
  const setup = fixture();
  setup.io.writeFileSync("/consumer/node_modules/virtual-bash/dist/index.js", `import "../../poe-code/${directory}/loader.mjs";`);
  assert.throws(() => bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, setup.io), /Native peer assets require/);
});

for (const route of [specifier, "#foreign-native", `../../poe-code/${directory}/linux-x64-glibc.node`]) test(`S3 native proof does not authorize a foreign importer: ${route}`, () => {
  const setup = fixture();
  setup.io.writeFileSync("/consumer/node_modules/virtual-bash/dist/index.js", `import "${route}";`);
  assert.throws(() => bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, setup.io), /Unbound runtime dependency|Native peer assets require/);
});

test("S3 native proof cannot gain authority by removing its brand profile", () => {
  const setup = fixture();
  const legacy = { entries: setup.peer.entries, files: setup.peer.files };
  assert.throws(() => bindPackedConsumer("/consumer", setup.packed, legacy, setup.declarations, ts, setup.io), /Unbound runtime dependency/);
});

for (const root of ["/checkout", "/consumer/node_modules/poe-code"]) {
  for (const path of ["package.json", runtime, `${directory}/loader.mjs`, `${directory}/loader.d.ts`, `${directory}/manifest.json`, `${directory}/linux-x64-glibc.node`]) {
    test(`S3 native proof rejects changed bytes: ${root}/${path}`, () => {
      const setup = fixture();
      setup.io.appendFileSync(`${root}/${path}`, Buffer.from([0]));
      assert.throws(() => bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, setup.io), /changed|differs|bytes/);
    });
  }
  for (const mutation of ["missing", "extra", "symlink"]) test(`S3 native proof rejects ${mutation} membership at ${root}`, () => {
    const setup = fixture();
    const binary = `${root}/${directory}/linux-x64-glibc.node`;
    if (mutation === "extra") setup.io.writeFileSync(`${root}/${directory}/foreign.node`, Buffer.from([255]));
    else {
      setup.io.unlinkSync(binary);
      if (mutation === "symlink") setup.io.symlinkSync(`${directory}/loader.mjs`, binary);
    }
    assert.throws(() => bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, setup.io));
  });
  for (const [name, maximum] of [["manifest.json", 16384], ["loader.mjs", 65536], ["loader.d.ts", 65536], ["linux-x64-glibc.node", 1048576]] as const) {
    test(`S3 native proof retains pre-read ${name} limit at ${root}`, context => {
      const setup = fixture();
      const filename = `${root}/${directory}/${name}`;
      const originalStat = setup.io.lstatSync;
      const originalRead = setup.io.readFileSync;
      let reads = 0;
      context.mock.method(setup.io, "lstatSync", (...args: unknown[]) => {
        const stat = Reflect.apply(originalStat, setup.io, args);
        if (args[0] === filename) stat.size = maximum + 1;
        return stat;
      });
      context.mock.method(setup.io, "readFileSync", (...args: unknown[]) => {
        if (args[0] === filename) reads++;
        return Reflect.apply(originalRead, setup.io, args);
      });
      assert.throws(() => bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, setup.io), /bounded regular file/);
      assert.equal(reads, 0);
    });
  }
}

test("S3 native proof rechecks staged membership after candidate reads", () => {
  const setup = fixture();
  const fileSystem = { ...setup.io, readAdmittedInput(filename: string, maximum: number) {
    const bytes = setup.io.readFileSync(filename) as Buffer;
    assert.ok(bytes.length <= maximum);
    if (filename === "/consumer/node_modules/virtual-bash/dist/index.js") setup.io.writeFileSync(`/consumer/${prefix}${directory}/late.node`, "late");
    return bytes;
  } };
  assert.throws(() => bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, fileSystem), /membership changed/);
});

test("S3 native proof rechecks source bytes after candidate reads", () => {
  const setup = fixture();
  const fileSystem = { ...setup.io, readAdmittedInput(filename: string, maximum: number) {
    const bytes = setup.io.readFileSync(filename) as Buffer;
    assert.ok(bytes.length <= maximum);
    if (filename === "/consumer/node_modules/virtual-bash/dist/index.js") setup.io.appendFileSync(`/checkout/${directory}/linux-x64-glibc.node`, Buffer.from([0]));
    return bytes;
  } };
  assert.throws(() => bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, fileSystem), /changed/);
});

for (const reason of [false, undefined, null, 0, ""]) test(`S3 native proof preserves falsey read failure ${String(reason)}`, context => {
  const setup = fixture();
  const originalRead = setup.io.readFileSync;
  context.mock.method(setup.io, "readFileSync", (...args: unknown[]) => {
    if (args[0] === `/checkout/${directory}/linux-x64-glibc.node`) throw reason;
    return Reflect.apply(originalRead, setup.io, args);
  });
  assert.throws(() => bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, ts, setup.io), error => error === reason);
});

test("S3 native proof never parses opaque assets or repeats the native loader parser", () => {
  const setup = fixture();
  const parsed: string[] = [];
  const compiler = { ...ts, createSourceFile(...args: Parameters<typeof ts.createSourceFile>) {
    parsed.push(args[0]);
    assert.ok(!args[0].startsWith(prefix));
    return ts.createSourceFile(...args);
  } };
  bindPackedConsumer("/consumer", setup.packed, setup.peer, setup.declarations, compiler, setup.io);
  assert.deepEqual(parsed.sort(), ["node_modules/virtual-bash/dist/fs/s3/http/index.js", "node_modules/virtual-bash/dist/index.js"]);
});
