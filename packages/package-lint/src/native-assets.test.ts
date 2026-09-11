import { createHash } from "node:crypto";
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import * as policy from "./bundle-policy.js";
import * as nativeAssets from "./native-assets.js";
import { constants } from "node:fs";
import { canonicalBundleFixture } from "./fixtures.js";
import { loadBuildView, type LintFs } from "./model.js";

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const assetRoot = "packages/safe-js/dist/native/fs-seek";
const specifier = "#safe-fs-native-seek";

function fixture(empty = false) {
  const base = canonicalBundleFixture();
  const registry = {
    version: 1,
    specifier,
    directory: "native/fs-seek",
    source: "native/seek.c",
    loader: "native/loader.mjs",
    declaration: "src/native/loader.d.ts",
    napi: 6,
    maxBinaryBytes: 1048576,
    targets: [{ platform: "linux", arch: "x64", libc: "glibc", minimumLibc: "2.31" }]
  };
  const source = "int original_seek(void) { return 0; }\n";
  const loader =
    'import { createRequire } from "node:module";\nexport const loadBinding = () => createRequire(import.meta.url)("./linux-x64-glibc.node");\n';
  const declaration = "export declare function loadBinding(): Promise<unknown>;\n";
  const binary = Uint8Array.of(0, 255, 128, 13, 10, 195, 40);
  const manifest = {
    version: 1,
    napi: 6,
    maxBinaryBytes: 1048576,
    targets: empty ? [] : [{ ...registry.targets[0], size: binary.length, sha256: digest(binary) }],
    build: {
      sourceSha256: digest(source),
      loaderSha256: digest(loader),
      declarationSha256: digest(declaration),
      headers: empty
        ? null
        : { version: "1.9.0", files: { "node_api.h": { size: 100, sha256: digest("headers") } } },
      compiler: empty
        ? null
        : { path: "/usr/bin/cc", sha256: digest("compiler"), version: "cc test fixture" }
    }
  };
  const volume = Volume.fromJSON({
    "/repo/packages/safe-fs/native/assets.json": JSON.stringify(registry),
    "/repo/packages/safe-fs/native/seek.c": source,
    "/repo/packages/safe-fs/native/loader.mjs": loader,
    "/repo/packages/safe-fs/src/native/loader.d.ts": declaration,
    [`/repo/${assetRoot}/loader.mjs`]: loader,
    [`/repo/${assetRoot}/loader.d.ts`]: declaration,
    [`/repo/${assetRoot}/manifest.json`]: JSON.stringify(manifest),
    "/repo/dist/metafile.json": JSON.stringify(base.metafile)
  });
  if (!empty) volume.writeFileSync(`/repo/${assetRoot}/linux-x64-glibc.node`, binary);
  for (const filename of base.packed) {
    if (!filename.endsWith(".d.ts")) continue;
    volume.mkdirSync(path.dirname(`/repo/${filename}`), { recursive: true });
    const edges = base.metafile.canonicalTypes[filename];
    volume.writeFileSync(
      `/repo/${filename}`,
      edges?.map((edge) => `export * from ${JSON.stringify(edge)};`).join("\n") || "export {};"
    );
  }
  const promises = createFsFromVolume(volume).promises;
  const fs: LintFs = {
    readFile: vi.fn(async (filename) => {
      if (filename.endsWith(".node")) throw new Error("binary was decoded as UTF8");
      return String(await promises.readFile(filename, "utf8"));
    }),
    readBytes: vi.fn(async (filename, maximum) => {
      return nativeAssets.readBoundedNativeBytes(
        (requested, flags) => promises.open(requested, flags),
        filename,
        maximum
      );
    }),
    readdir: async (filename) =>
      (await promises.readdir(filename, { withFileTypes: true })) as Awaited<
        ReturnType<LintFs["readdir"]>
      >,
    lstat: async (filename) => promises.lstat(filename),
    realpath: async (filename) => String(await promises.realpath(filename))
  };
  const imports = {
    ...base.manifest.imports,
    [specifier]: {
      types: `./${assetRoot}/loader.d.ts`,
      workerd: null,
      browser: null,
      default: `./${assetRoot}/loader.mjs`
    }
  };
  base.metafile.canonicalBundle.metafile.outputs[base.chunk].imports.push({
    path: specifier,
    external: true
  });
  for (const filename of [
    "loader.mjs",
    "loader.d.ts",
    "manifest.json",
    ...(empty ? [] : ["linux-x64-glibc.node"])
  ])
    base.packed.add(`${assetRoot}/${filename}`);
  return {
    ...base,
    manifest: { ...base.manifest, imports },
    volume,
    fs,
    registry,
    nativeManifest: manifest,
    binary,
    saveManifest() {
      volume.writeFileSync(`/repo/${assetRoot}/manifest.json`, JSON.stringify(manifest));
    },
    saveRegistry() {
      volume.writeFileSync("/repo/packages/safe-fs/native/assets.json", JSON.stringify(registry));
    }
  };
}

it("keeps the private edge rejected without a freshly collected closure", () => {
  const { manifest, metafile, packed } = fixture();
  expect(policy.findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
    external: "poe-code/safe-fs",
    reason: "external-canonical-dependency"
  });
});

for (const empty of [false, true])
  it(`authorizes only the freshly collected registry-owned Node closure: empty=${empty}`, async () => {
    const { fs, manifest, metafile, packed } = fixture(empty);
    const facts = await policy.collectCanonicalNativeAssets("/repo", fs);
    expect(facts.canonicalNativeAssets?.assets).toHaveLength(empty ? 3 : 4);
    expect(policy.findBundleIssues(manifest, new Set(), { ...metafile, ...facts }, packed)).toEqual(
      []
    );
    expect(
      vi.mocked(fs.readFile).mock.calls.filter(([filename]) => filename.endsWith(".node"))
    ).toEqual([]);
  });

it("does not authorize deserialized native claims", async () => {
  const { fs, manifest, metafile, packed } = fixture();
  const facts = JSON.parse(JSON.stringify(await policy.collectCanonicalNativeAssets("/repo", fs)));
  expect(
    policy.findBundleIssues(manifest, new Set(), { ...metafile, ...facts }, packed).length
  ).toBeGreaterThan(0);
});

it("keeps registry-free canonical fixtures valid and removes stale serialized facts", async () => {
  const { fs, volume, metafile } = fixture();
  volume.unlinkSync("/repo/packages/safe-fs/native/assets.json");
  expect(await policy.collectCanonicalNativeAssets("/repo", fs)).toEqual({
    canonicalNativeAssets: undefined
  });
  volume.writeFileSync(
    "/repo/dist/metafile.json",
    JSON.stringify({ ...metafile, canonicalNativeAssets: { forged: true } })
  );
  expect((await loadBuildView(fs, "/repo"))?.metafile.canonicalNativeAssets).toBeUndefined();
});

it("requires raw-byte support without decoding binaries", async () => {
  const { fs } = fixture();
  delete fs.readBytes;
  await expect(policy.collectCanonicalNativeAssets("/repo", fs)).rejects.toThrow("readBytes");
  expect(fs.readFile).not.toHaveBeenCalled();
});

for (const method of ["lstat", "realpath"] as const)
  it(`requires ${method} metadata for native collection`, async () => {
    const { fs } = fixture();
    delete fs[method];
    await expect(policy.collectCanonicalNativeAssets("/repo", fs)).rejects.toThrow("metadata");
    expect(fs.readBytes).not.toHaveBeenCalled();
  });

for (const name of ["loader.mjs", "loader.d.ts", "manifest.json", "linux-x64-glibc.node"]) {
  it(`rejects a missing packed asset: ${name}`, async () => {
    const { fs, volume } = fixture();
    volume.unlinkSync(`/repo/${assetRoot}/${name}`);
    await expect(policy.collectCanonicalNativeAssets("/repo", fs)).rejects.toThrow();
  });
  it(`rejects tampered copied bytes: ${name}`, async () => {
    const { fs, volume } = fixture();
    volume.appendFileSync(`/repo/${assetRoot}/${name}`, "x");
    await expect(policy.collectCanonicalNativeAssets("/repo", fs)).rejects.toThrow();
  });
}

for (const name of ["stale.node", "foreign.txt", "package.json", "nested"])
  it(`rejects an undeclared asset entry: ${name}`, async () => {
    const { fs, volume } = fixture();
    if (name === "nested") volume.mkdirSync(`/repo/${assetRoot}/${name}`);
    else volume.writeFileSync(`/repo/${assetRoot}/${name}`, "{}");
    await expect(policy.collectCanonicalNativeAssets("/repo", fs)).rejects.toThrow();
  });

for (const relative of [
  "packages/safe-fs/native/assets.json",
  "packages/safe-fs/native/loader.mjs",
  `${assetRoot}/linux-x64-glibc.node`,
  assetRoot
])
  it(`rejects symlink traversal before payload reads: ${relative}`, async () => {
    const { fs, volume } = fixture();
    const filename = `/repo/${relative}`;
    volume.renameSync(filename, `${filename}-old`);
    volume.symlinkSync(`${filename}-old`, filename);
    await expect(policy.collectCanonicalNativeAssets("/repo", fs)).rejects.toThrow();
    expect(
      vi
        .mocked(fs.readBytes!)
        .mock.calls.some(([read]) => read === filename || read.startsWith(filename + "/"))
    ).toBe(false);
  });

for (const key of ["source", "loader", "declaration", "directory"] as const)
  it(`rejects traversal in registry ${key}`, async () => {
    const setup = fixture();
    setup.registry[key] = "../escape";
    setup.saveRegistry();
    await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
  });

for (const kind of ["source", "loader", "declaration"] as const)
  it(`rejects stale source provenance: ${kind}`, async () => {
    const setup = fixture();
    setup.volume.appendFileSync(`/repo/packages/safe-fs/${setup.registry[kind]}`, "\n");
    await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
  });

for (const edge of [
  'import "foreign";',
  'export * from "./foreign.mjs";',
  'await import("./foreign.mjs");',
  'require("foreign");',
  "await import(variable);"
])
  it(`rejects loader import outside builtin closure: ${edge}`, async () => {
    const setup = fixture();
    const loader = `${edge}\nexport function loadBinding() {}\n`;
    setup.volume.writeFileSync("/repo/packages/safe-fs/native/loader.mjs", loader);
    setup.volume.writeFileSync(`/repo/${assetRoot}/loader.mjs`, loader);
    setup.nativeManifest.build.loaderSha256 = digest(loader);
    setup.saveManifest();
    await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
  });

for (const mutate of [
  (value: ReturnType<typeof fixture>) => {
    Object.assign(value.nativeManifest, { unexpected: true });
  },
  (value: ReturnType<typeof fixture>) => {
    Object.assign(value.nativeManifest.build, { unexpected: true });
  },
  (value: ReturnType<typeof fixture>) => {
    value.nativeManifest.targets[0]!.minimumLibc = "2.30";
  },
  (value: ReturnType<typeof fixture>) => {
    value.nativeManifest.targets[0]!.sha256 = "A".repeat(64);
  },
  (value: ReturnType<typeof fixture>) => {
    value.nativeManifest.targets[0]!.size = 1048577;
  },
  (value: ReturnType<typeof fixture>) => {
    value.nativeManifest.build.headers = null;
  },
  (value: ReturnType<typeof fixture>) => {
    value.nativeManifest.build.compiler = null;
  },
  (value: ReturnType<typeof fixture>) => {
    value.nativeManifest.targets.push({ ...value.nativeManifest.targets[0]! });
  }
])
  it(`rejects malformed manifest/provenance ${String(mutate)}`, async () => {
    const setup = fixture();
    mutate(setup);
    setup.saveManifest();
    await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
  });

it("rejects an empty target set with nonnull toolchain provenance", async () => {
  const setup = fixture();
  setup.nativeManifest.targets = [];
  setup.volume.unlinkSync(`/repo/${assetRoot}/linux-x64-glibc.node`);
  setup.saveManifest();
  await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
});

it("refreshes source and binary facts instead of trusting saved metafile claims", async () => {
  const setup = fixture();
  const facts = await policy.collectCanonicalNativeAssets("/repo", setup.fs);
  setup.volume.writeFileSync(
    "/repo/dist/metafile.json",
    JSON.stringify({ ...setup.metafile, ...facts })
  );
  const build = await loadBuildView(setup.fs, "/repo");
  expect(policy.findBundleIssues(setup.manifest, new Set(), build!.metafile, setup.packed)).toEqual(
    []
  );
  setup.volume.writeFileSync(
    `/repo/${assetRoot}/linux-x64-glibc.node`,
    new Uint8Array(setup.binary.length)
  );
  await expect(loadBuildView(setup.fs, "/repo")).rejects.toThrow();
});

for (const defect of [
  "browser",
  "mapping",
  "packed-missing",
  "packed-extra",
  "nested-scope",
  "duplicate-runtime",
  "consumer-edge",
  "unknown-private"
])
  it(`fresh closure does not exempt ${defect}`, async () => {
    const setup = fixture();
    const facts = await policy.collectCanonicalNativeAssets("/repo", setup.fs);
    if (defect === "browser")
      setup.metafile.browserCanonicalBundle.metafile.outputs[
        "packages/safe-js/dist/browser/chunks/fs.js"
      ].imports.push({ path: specifier, external: true });
    if (defect === "mapping") setup.manifest.imports[specifier].default = "./wrong.mjs";
    if (defect === "packed-missing") setup.packed.delete(`${assetRoot}/linux-x64-glibc.node`);
    if (defect === "packed-extra") setup.packed.add(`${assetRoot}/extra.node`);
    if (defect === "nested-scope") setup.packed.add("packages/safe-js/dist/package.json");
    if (defect === "duplicate-runtime") setup.packed.add("packages/safe-fs/dist/index.js");
    if (defect === "consumer-edge")
      setup.metafile.outputs["dist/index.js"].imports.push({
        path: specifier,
        external: true,
        kind: "import-statement"
      });
    if (defect === "unknown-private")
      setup.metafile.canonicalBundle.metafile.outputs[setup.chunk].imports.push({
        path: "#arbitrary",
        external: true
      });
    expect(
      policy.findBundleIssues(
        setup.manifest,
        new Set(),
        { ...setup.metafile, ...facts },
        setup.packed
      ).length
    ).toBeGreaterThan(0);
  });

function byteHandle(bytes = Uint8Array.of(255, 128, 0)) {
  return {
    stat: vi.fn(async () => ({ size: bytes.length, isFile: (): boolean => true })),
    read: vi.fn(async (buffer: Uint8Array, offset: number, length: number, position: number) => {
      const count = Math.min(length, bytes.length - position, 2);
      buffer.set(bytes.subarray(position, position + count), offset);
      return { bytesRead: count };
    }),
    close: vi.fn(async () => {})
  };
}

it("uses bounded raw descriptor reads, EOF validation and no-follow/nonblocking admission", async () => {
  const handle = byteHandle();
  const open = vi.fn(async () => handle);
  expect(await nativeAssets.readBoundedNativeBytes(open, "/asset.node", 8)).toEqual(
    Uint8Array.of(255, 128, 0)
  );
  expect(open).toHaveBeenCalledWith(
    "/asset.node",
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  expect(handle.read.mock.calls.map(([, , length, position]) => [length, position])).toEqual([
    [3, 0],
    [1, 2],
    [1, 3]
  ]);
  expect(handle.close).toHaveBeenCalledTimes(1);
});

for (const failure of ["oversize", "special", "short", "growth", "bad-count", "changed-stat"])
  it(`rejects ${failure} raw descriptor reads and closes once`, async () => {
    const handle = byteHandle();
    if (failure === "oversize") handle.stat.mockResolvedValue({ size: 9, isFile: () => true });
    if (failure === "special") handle.stat.mockResolvedValue({ size: 3, isFile: () => false });
    if (failure === "short") handle.read.mockResolvedValue({ bytesRead: 0 });
    if (failure === "growth") handle.read.mockImplementation(async () => ({ bytesRead: 1 }));
    if (failure === "bad-count") handle.read.mockResolvedValue({ bytesRead: NaN });
    if (failure === "changed-stat")
      handle.stat
        .mockResolvedValueOnce({ size: 3, isFile: () => true })
        .mockResolvedValue({ size: 2, isFile: () => true });
    await expect(
      nativeAssets.readBoundedNativeBytes(async () => handle, "/asset.node", 8)
    ).rejects.toThrow();
    if (failure === "oversize" || failure === "special") expect(handle.read).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

for (const primary of [undefined, null, false, 0, -0, "", NaN])
  it(`preserves primary raw-read failure over close failure: ${String(primary)}`, async () => {
    const handle = byteHandle();
    handle.read.mockRejectedValue(primary);
    handle.close.mockRejectedValue(new Error("secondary close"));
    await expect(
      nativeAssets.readBoundedNativeBytes(async () => handle, "/asset.node", 8)
    ).rejects.toBe(primary);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

it("reports close failure after a successful raw read", async () => {
  const handle = byteHandle();
  handle.close.mockRejectedValue(false);
  await expect(
    nativeAssets.readBoundedNativeBytes(async () => handle, "/asset.node", 8)
  ).rejects.toBe(false);
  expect(handle.close).toHaveBeenCalledTimes(1);
});

for (const limit of [0, -1, NaN, Infinity, 1048577])
  it(`rejects invalid read budget before open: ${limit}`, async () => {
    const open = vi.fn(async () => byteHandle());
    await expect(nativeAssets.readBoundedNativeBytes(open, "/asset.node", limit)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });

it("rejects a symlink workspace boundary before reading payloads", async () => {
  const setup = fixture();
  setup.volume.renameSync("/repo", "/elsewhere");
  setup.volume.symlinkSync("/elsewhere", "/repo");
  await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
  expect(setup.fs.readBytes).not.toHaveBeenCalled();
});

it("rejects missing metadata without an unbounded textual registry probe", async () => {
  const setup = fixture();
  delete setup.fs.lstat;
  delete setup.fs.realpath;
  await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow("metadata");
  expect(setup.fs.readFile).not.toHaveBeenCalled();
});

it("refreshes native facts even when the saved canonical graph is absent", async () => {
  const setup = fixture();
  setup.volume.writeFileSync(
    "/repo/dist/metafile.json",
    JSON.stringify({ canonicalNativeAssets: { forged: true } })
  );
  const build = await loadBuildView(setup.fs, "/repo");
  expect(build?.metafile.canonicalNativeAssets?.assets).toHaveLength(4);
});

it("does not authorize a private consumer edge through an unrooted canonical claim", async () => {
  const setup = fixture();
  const facts = await policy.collectCanonicalNativeAssets("/repo", setup.fs);
  const output = { imports: [{ path: specifier, external: true }] };
  Object.assign(setup.metafile.canonicalBundle.metafile.outputs, { "dist/consumer.js": output });
  Object.assign(setup.metafile.outputs, { "dist/consumer.js": output });
  expect(
    policy.findBundleIssues(
      setup.manifest,
      new Set(),
      { ...setup.metafile, ...facts },
      setup.packed
    )
  ).toContainEqual({ external: specifier, reason: "invalid-external" });
});

for (const loader of [
  'import { createRequire } from "node:module"; const make = createRequire; make(import.meta.url)("foreign");',
  'import { createRequire } from "node:module"; createRequire("/foreign/loader.mjs")("foreign");',
  'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const alias = require; alias("foreign");',
  'import * as module from "node:module"; module.createRequire(import.meta.url)("foreign");',
  'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); require.resolve("foreign");'
])
  it(`rejects escaped or unsupported loader require form: ${loader}`, async () => {
    const setup = fixture();
    setup.volume.writeFileSync("/repo/packages/safe-fs/native/loader.mjs", loader);
    setup.volume.writeFileSync(`/repo/${assetRoot}/loader.mjs`, loader);
    setup.nativeManifest.build.loaderSha256 = digest(loader);
    setup.saveManifest();
    await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
  });

it("accepts the maintained local createRequire and registry-template dispatch form", async () => {
  const setup = fixture();
  const loader =
    'import { createRequire } from "node:module"; import { fileURLToPath } from "node:url"; export function loadBinding(target) { const filename = fileURLToPath(new URL(`${target.platform}-${target.arch}-${target.libc}.node`, import.meta.url)); const require = createRequire(import.meta.url); return require(filename); }';
  setup.volume.writeFileSync("/repo/packages/safe-fs/native/loader.mjs", loader);
  setup.volume.writeFileSync(`/repo/${assetRoot}/loader.mjs`, loader);
  setup.nativeManifest.build.loaderSha256 = digest(loader);
  setup.saveManifest();
  const facts = await policy.collectCanonicalNativeAssets("/repo", setup.fs);
  expect(
    policy.findBundleIssues(
      setup.manifest,
      new Set(),
      { ...setup.metafile, ...facts },
      setup.packed
    )
  ).toEqual([]);
});

it("requires browser/workerd null conditions before the default loader condition", async () => {
  const setup = fixture();
  const facts = await policy.collectCanonicalNativeAssets("/repo", setup.fs);
  const mapping = setup.manifest.imports[specifier];
  setup.manifest.imports[specifier] = {
    default: mapping.default,
    types: mapping.types,
    browser: null,
    workerd: null
  };
  expect(
    policy.findBundleIssues(
      setup.manifest,
      new Set(),
      { ...setup.metafile, ...facts },
      setup.packed
    ).length
  ).toBeGreaterThan(0);
});

for (const reason of ["node-type", "browser-type", "foreign-declaration", "declaration-reference"])
  it(`validates native declaration closure: ${reason}`, async () => {
    const setup = fixture();
    if (reason === "foreign-declaration" || reason === "declaration-reference") {
      const declaration =
        reason === "foreign-declaration"
          ? 'export type Foreign = import("foreign").Thing;'
          : '/// <reference path="foreign.d.ts" />\nexport {};';
      setup.volume.writeFileSync("/repo/packages/safe-fs/src/native/loader.d.ts", declaration);
      setup.volume.writeFileSync(`/repo/${assetRoot}/loader.d.ts`, declaration);
      setup.nativeManifest.build.declarationSha256 = digest(declaration);
      setup.saveManifest();
      await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
    } else {
      const facts = await policy.collectCanonicalNativeAssets("/repo", setup.fs);
      setup.metafile.canonicalTypes[
        `packages/safe-fs/dist/platform/${reason === "node-type" ? "node" : "browser"}.d.ts`
      ].push(specifier);
      expect(
        policy.findBundleIssues(
          setup.manifest,
          new Set(),
          { ...setup.metafile, ...facts },
          setup.packed
        ).length
      ).toBe(reason === "node-type" ? 0 : 1);
    }
  });

for (const defect of [
  "size",
  "identity",
  "realpath",
  "oversize-registry",
  "oversize-source",
  "oversize-binary",
  "truncated-bytes"
])
  it(`rejects incomplete raw asset admission: ${defect}`, async () => {
    const setup = fixture();
    const filename =
      defect === "oversize-registry"
        ? "/repo/packages/safe-fs/native/assets.json"
        : defect === "oversize-source"
          ? "/repo/packages/safe-fs/native/seek.c"
          : `/repo/${assetRoot}/linux-x64-glibc.node`;
    const lstat = setup.fs.lstat!;
    setup.fs.lstat = async (requested) => {
      const stat = await lstat(requested);
      if (requested !== filename) return stat;
      if (defect === "size") Object.defineProperty(stat, "size", { value: undefined });
      if (defect === "identity") Object.defineProperty(stat, "ino", { value: undefined });
      if (defect.startsWith("oversize")) Object.defineProperty(stat, "size", { value: 1048577 });
      return stat;
    };
    if (defect === "realpath") {
      const realpath = setup.fs.realpath!;
      setup.fs.realpath = async (requested) =>
        requested === filename ? "/foreign/asset.node" : realpath(requested);
    }
    if (defect === "truncated-bytes") {
      const readBytes = setup.fs.readBytes!;
      setup.fs.readBytes = async (requested, maximum) =>
        requested === filename ? new Uint8Array() : readBytes(requested, maximum);
    }
    await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
  });

for (const primary of [undefined, false, 0, null, "", NaN])
  it(`preserves raw collector failure identity: ${String(primary)}`, async () => {
    const setup = fixture();
    setup.fs.readBytes = async () => {
      throw primary;
    };
    await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toBe(primary);
  });

for (const key of [
  "sourceSha256",
  "loaderSha256",
  "declarationSha256",
  "headers",
  "compiler"
] as const)
  it(`rejects missing or malformed build provenance: ${key}`, async () => {
    const setup = fixture();
    Reflect.set(setup.nativeManifest.build, key, null);
    setup.saveManifest();
    await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
  });

it("rejects one-null toolchain provenance with empty targets", async () => {
  const setup = fixture(true);
  setup.nativeManifest.build.headers = {
    version: "1.9.0",
    files: { "node_api.h": { size: 100, sha256: digest("headers") } }
  };
  setup.saveManifest();
  await expect(policy.collectCanonicalNativeAssets("/repo", setup.fs)).rejects.toThrow();
});

it("cannot mutate or clone a collected closure into fresh authorization", async () => {
  const setup = fixture();
  const { canonicalNativeAssets: closure } = await policy.collectCanonicalNativeAssets(
    "/repo",
    setup.fs
  );
  expect(Object.isFrozen(closure)).toBe(true);
  expect(Object.isFrozen(closure!.assets)).toBe(true);
  expect(closure!.assets.every(Object.isFrozen)).toBe(true);
  expect(Object.isFrozen(closure!.imports)).toBe(true);
  expect(
    policy.findBundleIssues(
      setup.manifest,
      new Set(),
      { ...setup.metafile, canonicalNativeAssets: { ...closure! } },
      setup.packed
    ).length
  ).toBeGreaterThan(0);
});
