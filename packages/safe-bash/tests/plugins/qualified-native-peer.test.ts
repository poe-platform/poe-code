import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";

const { bindPeerArtifact, stagePeerArtifact, assertPeerArtifact, assertPeerDeclarationFiles } =
  await import(new URL("./qualified-current-release/peer.mjs", import.meta.url).href);
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const directory = "packages/safe-js/dist/native/fs-seek";
const runtime = "packages/safe-js/dist/safe-fs.js";
const types = "packages/safe-fs/dist/index.d.ts";
const specifier = "#safe-fs-native-seek";
const loader =
  'import { createRequire } from "node:module";\nimport { fileURLToPath } from "node:url";\nexport function loadBinding(target) { const filename = fileURLToPath(new URL(`${target.platform}-${target.arch}-${target.libc}.node`, import.meta.url)); const require = createRequire(import.meta.url); return require(filename); }\n';
const declaration = "export declare function loadBinding(): unknown;\n";
const binaryName = "linux-x64-glibc.node";

function tar(files: Map<string, Buffer>) {
  const chunks: Buffer[] = [];
  for (const [path, bytes] of files) {
    const header = Buffer.alloc(512);
    const name = `package/${path}`;
    assert.ok(Buffer.byteLength(name) < 100);
    header.write(name);
    header.write("0000644\0", 100);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    header.fill(32, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.write(
      header
        .reduce((total, byte) => total + byte, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148
    );
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

function fixture(empty = false) {
  const root = "/checkout/packages/safe-bash";
  const bash = {
    name: "virtual-bash",
    private: true,
    peerDependencies: { "poe-code": ">=13.0.0" },
    devDependencies: { "poe-code": "file:../.." },
    poeCode: { integration: { peerProfile: "checkout-root" } }
  };
  const peer = {
    name: "poe-code",
    version: "0.0.0-dev",
    type: "module",
    devDependencies: { "poe-code": "file:." },
    exports: { "./safe-fs": { types: { default: `./${types}` }, import: `./${runtime}` } },
    imports: {
      [specifier]: {
        types: `./${directory}/loader.d.ts`,
        workerd: null,
        browser: null,
        default: `./${directory}/loader.mjs`
      }
    }
  };
  const binary = Buffer.from([0, 255, 128, 195, 40, 0, 13, 10]);
  const manifest = {
    version: 1,
    napi: 6,
    maxBinaryBytes: 1048576,
    targets: empty
      ? []
      : [
          {
            platform: "linux",
            arch: "x64",
            libc: "glibc",
            minimumLibc: "2.31",
            size: binary.length,
            sha256: hash(binary)
          }
        ],
    build: {
      sourceSha256: hash("original source fixture"),
      loaderSha256: hash(loader),
      declarationSha256: hash(declaration),
      headers: empty
        ? null
        : { version: "1.9.0", files: { "node_api.h": { size: 42, sha256: hash("header") } } },
      compiler: empty
        ? null
        : { path: "/usr/bin/cc", sha256: hash("compiler"), version: "compiler fixture" }
    }
  };
  const files = new Map<string, Buffer>([
    ["package.json", Buffer.from(JSON.stringify(peer))],
    [runtime, Buffer.from(`export { loadBinding } from "${specifier}";\n`)],
    [types, Buffer.from("export declare const fileSystem: unknown;\n")],
    [`${directory}/loader.mjs`, Buffer.from(loader)],
    [`${directory}/loader.d.ts`, Buffer.from(declaration)],
    [`${directory}/manifest.json`, Buffer.from(JSON.stringify(manifest))],
    ...(empty ? [] : [[`${directory}/${binaryName}`, binary] as [string, Buffer]])
  ]);
  const lock = {
    packages: {
      "packages/safe-bash": { devDependencies: bash.devDependencies },
      "node_modules/poe-code": { resolved: "", link: true }
    }
  };
  const io = createFsFromVolume(
    Volume.fromJSON({
      [`${root}/package.json`]: JSON.stringify(bash),
      "/checkout/package-lock.json": JSON.stringify(lock),
      "/consumer/package.json": '{"type":"module"}'
    })
  );
  const declarations = {
    peer: {
      version: peer.version,
      integrity: null,
      metadataSha256: "",
      publicEntries: new Map([["poe-code/safe-fs", types]]),
      declarations: new Map([[types, hash(files.get(types)!)]])
    }
  };
  const sync = () => {
    files.set("package.json", Buffer.from(JSON.stringify(peer)));
    files.set(`${directory}/manifest.json`, Buffer.from(JSON.stringify(manifest)));
    for (const [path, bytes] of files) {
      const destination = `/checkout/${path}`;
      io.mkdirSync(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
      io.writeFileSync(destination, bytes);
    }
    io.writeFileSync("/peer.tgz", tar(files));
    declarations.peer.metadataSha256 = hash(files.get("package.json")!);
  };
  sync();
  return { root, io, peer, files, manifest, binary, declarations, sync };
}

for (const checkout of [true, false])
  for (const empty of [false, true])
    test(`peer captures finite native closure synchronously: checkout=${checkout}, empty=${empty}`, () => {
      const setup = fixture(empty);
      const binding = bindPeerArtifact({
        ...setup,
        checkout,
        ...(checkout ? {} : { artifact: "/peer.tgz" })
      });
      assert.equal(typeof binding.then, "undefined");
      assert.equal(binding.runtimeFiles, 2);
      assert.equal(binding.declarationFiles, 2);
      assert.deepEqual(
        binding.files.map((file: { path: string }) => file.path).sort(),
        [...setup.files.keys()].sort()
      );
      stagePeerArtifact(binding, "/consumer");
      if (!empty)
        assert.deepEqual(
          setup.io.readFileSync(`/consumer/node_modules/poe-code/${directory}/${binaryName}`),
          setup.binary
        );
      setup.io.renameSync("/consumer", "/moved");
      assertPeerArtifact(binding, "/moved");
      assertPeerDeclarationFiles(
        binding,
        [`/moved/node_modules/poe-code/${directory}/loader.d.ts`],
        "/moved"
      );
      assert.throws(() => stagePeerArtifact({ ...binding }, "/moved"));
    });

for (const defect of [
  "unknown",
  "types",
  "default",
  "browser",
  "workerd",
  "order",
  "foreign-profile",
  "browser-profile",
  "relative-entry"
])
  test(`peer refuses unsafe private native edge: ${defect}`, () => {
    const setup = fixture();
    const mapping = setup.peer.imports[specifier];
    if (defect === "unknown") setup.files.set(runtime, Buffer.from('export * from "#unreviewed";'));
    if (defect === "types") mapping.types = "./packages/safe-fs/dist/native/loader.d.ts";
    if (defect === "default") mapping.default = "./packages/safe-js/dist/native/other/loader.mjs";
    if (defect === "browser") Reflect.set(mapping, "browser", mapping.default);
    if (defect === "workerd") Reflect.set(mapping, "workerd", mapping.default);
    if (defect === "order")
      setup.peer.imports[specifier] = {
        default: mapping.default,
        types: mapping.types,
        workerd: null,
        browser: null
      };
    if (defect === "foreign-profile" || defect === "browser-profile") {
      const local =
        defect === "foreign-profile"
          ? "packages/safe-fs/dist/foreign.js"
          : "packages/safe-js/dist/browser/foreign.js";
      setup.files.set(
        runtime,
        Buffer.from(
          `export * from "${defect === "foreign-profile" ? "../../safe-fs/dist/foreign.js" : "./browser/foreign.js"}";`
        )
      );
      setup.files.set(local, Buffer.from(`export * from "${specifier}";`));
    }
    if (defect === "relative-entry")
      setup.files.set(runtime, Buffer.from('export * from "./native/fs-seek/loader.mjs";'));
    setup.sync();
    assert.throws(() => bindPeerArtifact({ ...setup, checkout: true }));
  });

for (const checkout of [true, false])
  for (const name of ["loader.mjs", "loader.d.ts", "manifest.json", binaryName])
    test(`peer refuses missing native asset ${name}, checkout=${checkout}`, () => {
      const setup = fixture();
      setup.files.delete(`${directory}/${name}`);
      setup.io.unlinkSync(`/checkout/${directory}/${name}`);
      setup.io.writeFileSync("/peer.tgz", tar(setup.files));
      assert.throws(() =>
        bindPeerArtifact({ ...setup, checkout, ...(checkout ? {} : { artifact: "/peer.tgz" }) })
      );
    });

for (const checkout of [true, false])
  for (const name of ["stale.node", "package.json", "nested/extra.mjs"])
    test(`peer refuses extra native asset ${name}, checkout=${checkout}`, () => {
      const setup = fixture();
      setup.files.set(`${directory}/${name}`, Buffer.from("extra"));
      setup.sync();
      assert.throws(() =>
        bindPeerArtifact({ ...setup, checkout, ...(checkout ? {} : { artifact: "/peer.tgz" }) })
      );
    });

for (const defect of [
  "hash",
  "size",
  "oversize",
  "foreign-target",
  "duplicate-target",
  "extra-schema",
  "nullable-toolchain",
  "loader-hash",
  "types-hash"
])
  test(`peer rejects invalid native manifest ${defect}`, () => {
    const setup = fixture();
    if (defect === "hash") setup.manifest.targets[0]!.sha256 = "0".repeat(64);
    if (defect === "size") setup.manifest.targets[0]!.size++;
    if (defect === "oversize") setup.manifest.targets[0]!.size = 1048577;
    if (defect === "foreign-target") setup.manifest.targets[0]!.platform = "foreign";
    if (defect === "duplicate-target")
      setup.manifest.targets.push({ ...setup.manifest.targets[0]! });
    if (defect === "extra-schema") Reflect.set(setup.manifest, "extra", true);
    if (defect === "nullable-toolchain") setup.manifest.build.compiler = null;
    if (defect === "loader-hash") setup.manifest.build.loaderSha256 = "0".repeat(64);
    if (defect === "types-hash") setup.manifest.build.declarationSha256 = "0".repeat(64);
    setup.sync();
    assert.throws(() => bindPeerArtifact({ ...setup, checkout: true }));
  });

for (const source of [
  'import "foreign";',
  'export * from "./foreign.mjs";',
  "await import(variable);",
  "require(variable);",
  'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); require("foreign");',
  'import { createRequire } from "node:module"; const require = createRequire("/outside.js"); require("./linux-x64-glibc.node");',
  'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const alias = require; alias("foreign");',
  'import * as module from "node:module"; module.createRequire(import.meta.url)("foreign");',
  loader.replace("${target.libc}.node", "${target.libc}/foreign.node"),
  loader.replace("import.meta.url));", '"file:///outside/"));')
])
  test(`peer does not skip native loader AST validation: ${source.slice(0, 70)}`, () => {
    const setup = fixture();
    setup.files.set(`${directory}/loader.mjs`, Buffer.from(source));
    setup.manifest.build.loaderSha256 = hash(source);
    setup.sync();
    assert.throws(() => bindPeerArtifact({ ...setup, checkout: true }));
  });

for (const path of [
  directory,
  `${directory}/manifest.json`,
  `${directory}/loader.mjs`,
  `${directory}/${binaryName}`
])
  test(`peer refuses native symlink/redirect ${path}`, () => {
    const setup = fixture();
    setup.io.renameSync(`/checkout/${path}`, `/checkout/${path}-old`);
    setup.io.symlinkSync(`/checkout/${path}-old`, `/checkout/${path}`);
    assert.throws(() => bindPeerArtifact({ ...setup, checkout: true }));
  });

for (const phase of ["source-change", "source-extra", "staged-change", "staged-extra"])
  test(`peer preserves native post-admission tamper rejection: ${phase}`, () => {
    const setup = fixture();
    const binding = bindPeerArtifact({ ...setup, checkout: true });
    if (phase.startsWith("source")) {
      if (phase === "source-change")
        setup.io.writeFileSync(
          `/checkout/${directory}/${binaryName}`,
          Buffer.alloc(setup.binary.length)
        );
      else setup.io.writeFileSync(`/checkout/${directory}/extra.node`, "extra");
      assert.throws(() => stagePeerArtifact(binding, "/consumer"));
      assert.equal(setup.io.existsSync("/consumer/node_modules/poe-code"), false);
    } else {
      stagePeerArtifact(binding, "/consumer");
      setup.io.writeFileSync(
        `/consumer/node_modules/poe-code/${directory}/${phase === "staged-change" ? binaryName : "extra.node"}`,
        "changed"
      );
      assert.throws(() => assertPeerArtifact(binding, "/consumer"));
    }
  });

test("peer copies binary bytes without text decoding or retaining borrowed buffers", () => {
  const setup = fixture();
  const read = setup.io.readFileSync.bind(setup.io);
  const borrowed: Buffer[] = [];
  setup.io.readFileSync = ((path: string, ...args: unknown[]) => {
    const bytes = Reflect.apply(read, setup.io, [path, ...args]);
    if (String(path).endsWith(".node")) {
      assert.equal(args.length, 0);
      assert.ok(Buffer.isBuffer(bytes));
      const copy = Buffer.from(bytes);
      copy.toString = () => {
        assert.fail("binary must never be decoded");
      };
      borrowed.push(copy);
      return copy;
    }
    return bytes;
  }) as typeof setup.io.readFileSync;
  const binding = bindPeerArtifact({ ...setup, checkout: true });
  for (const bytes of borrowed) bytes.fill(42);
  stagePeerArtifact(binding, "/consumer");
  assert.deepEqual(
    read(`/consumer/node_modules/poe-code/${directory}/${binaryName}`),
    setup.binary
  );
});

for (const phase of ["source", "staged"])
  test(`peer reapplies native byte ceilings before ${phase} payload reads`, () => {
    const setup = fixture();
    const binding = bindPeerArtifact({ ...setup, checkout: true });
    if (phase === "staged") stagePeerArtifact(binding, "/consumer");
    const filename = `${phase === "source" ? "/checkout" : "/consumer/node_modules/poe-code"}/${directory}/${binaryName}`;
    setup.io.writeFileSync(filename, Buffer.alloc(1048577));
    const read = setup.io.readFileSync.bind(setup.io);
    let reads = 0;
    setup.io.readFileSync = ((path: string, ...args: unknown[]) => {
      if (path === filename) reads++;
      return Reflect.apply(read, setup.io, [path, ...args]);
    }) as typeof setup.io.readFileSync;
    assert.throws(() =>
      phase === "source"
        ? stagePeerArtifact(binding, "/consumer")
        : assertPeerArtifact(binding, "/consumer")
    );
    assert.equal(reads, 0);
  });

test("peer loader permits ordinary array indexing without allowing indirect require", () => {
  const setup = fixture();
  const source =
    loader + "\nexport function version() { const parts = [2, 31]; return parts[0]; }\n";
  setup.files.set(`${directory}/loader.mjs`, Buffer.from(source));
  setup.manifest.build.loaderSha256 = hash(source);
  setup.sync();
  const binding = bindPeerArtifact({ ...setup, checkout: true });
  stagePeerArtifact(binding, "/consumer");
  assertPeerArtifact(binding, "/consumer");
});

for (const source of [
  'export type Foreign = import("foreign").Thing;',
  '/// <reference path="foreign.d.ts" />\nexport {};',
  "export type Broken = ;"
])
  test(`peer validates native declaration bytes beyond their digest: ${source}`, () => {
    const setup = fixture();
    setup.files.set(`${directory}/loader.d.ts`, Buffer.from(source));
    setup.manifest.build.declarationSha256 = hash(source);
    setup.sync();
    assert.throws(() => bindPeerArtifact({ ...setup, checkout: true }));
  });

for (const source of [
  'import { createRequire as factory } from "node:module"; const alias = factory; alias(import.meta.url)("foreign");',
  'import * as namespace from "node:module"; const key = "createRequire"; namespace[key](import.meta.url)("foreign");',
  loader.replace("const filename =", "let filename ="),
  loader.replace(
    "return require(filename);",
    'function nested(filename) { return require(filename); } return nested("foreign");'
  )
])
  test(`peer rejects unbound or escaped native path/factory bindings: ${source.slice(0, 65)}`, () => {
    const setup = fixture();
    setup.files.set(`${directory}/loader.mjs`, Buffer.from(source));
    setup.manifest.build.loaderSha256 = hash(source);
    setup.sync();
    assert.throws(() => bindPeerArtifact({ ...setup, checkout: true }));
  });

for (const checkout of [true, false])
  test(`peer rejects malformed UTF8 native manifest bytes without normalization: checkout=${checkout}`, () => {
    const setup = fixture();
    const filename = `${directory}/manifest.json`;
    const bytes = Buffer.from(setup.files.get(filename)!);
    const position = bytes.indexOf("compiler fixture");
    assert.ok(position > 0);
    bytes[position] = 255;
    setup.files.set(filename, bytes);
    setup.io.writeFileSync(`/checkout/${filename}`, bytes);
    setup.io.writeFileSync("/peer.tgz", tar(setup.files));
    assert.throws(() =>
      bindPeerArtifact({ ...setup, checkout, ...(checkout ? {} : { artifact: "/peer.tgz" }) })
    );
    assert.deepEqual(setup.io.readFileSync(`/checkout/${filename}`), bytes);
    assert.equal(setup.io.existsSync("/consumer/node_modules"), false);
  });

test("peer declaration checks preserve the native declaration byte ceiling before reading", () => {
  const setup = fixture();
  const binding = bindPeerArtifact({ ...setup, checkout: true });
  stagePeerArtifact(binding, "/consumer");
  const filename = `/consumer/node_modules/poe-code/${directory}/loader.d.ts`;
  setup.io.writeFileSync(filename, Buffer.alloc(65537));
  const read = setup.io.readFileSync.bind(setup.io);
  let reads = 0;
  setup.io.readFileSync = ((path: string, ...args: unknown[]) => {
    if (path === filename) reads++;
    return Reflect.apply(read, setup.io, [path, ...args]);
  }) as typeof setup.io.readFileSync;
  assert.throws(() => assertPeerDeclarationFiles(binding, [filename], "/consumer"));
  assert.equal(reads, 0);
});
