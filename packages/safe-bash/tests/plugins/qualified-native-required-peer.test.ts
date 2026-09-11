import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname } from "node:path";
import test, { type TestContext } from "node:test";
import { gzipSync } from "node:zlib";
import { createFsFromVolume, Volume } from "memfs";
import {
  captureRequiredPeer,
  digest
} from "../shell-stress/invocation-cleanup-runtime/migration/binding.js";

const peerCapture = await import(
  new URL("./qualified-current-release/peer.mjs", import.meta.url).href
);
const runtime = "packages/safe-js/dist/safe-fs.js";
const core = "packages/safe-js/dist/safe-fs-core.js";
const directory = "packages/safe-js/dist/native/fs-seek";
const specifier = "#safe-fs-native-seek";
const loaderPath = `${directory}/loader.mjs`;
const binaryPath = `${directory}/linux-x64-glibc.node`;
const prefix = "node_modules/poe-code/";

function archive(files: Map<string, Buffer>): Buffer {
  const chunks: Buffer[] = [];
  for (const [path, bytes] of files) {
    const header = Buffer.alloc(512);
    assert.ok(Buffer.byteLength(`package/${path}`) < 100);
    header.write(`package/${path}`);
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

function fixture(
  native = true,
  empty = false,
  configure?: (files: Map<string, Buffer>) => void,
  release = false
) {
  const root = "/checkout/packages/safe-bash",
    snapshot = "/snapshot";
  const bash = {
    name: "virtual-bash",
    private: true,
    peerDependencies: { "poe-code": ">=13.0.0" },
    devDependencies: { "poe-code": release ? "13.0.0" : "file:../.." },
    ...(release ? {} : { poeCode: { integration: { peerProfile: "checkout-root" } } })
  };
  const metadata = {
    name: "poe-code",
    version: release ? "13.0.0" : "0.0.0-dev",
    type: "module",
    devDependencies: { "poe-code": "file:." },
    exports: {
      "./safe-fs": { types: "./packages/safe-fs/dist/index.d.ts", import: `./${runtime}` },
      "./safe-fs/core": { types: "./packages/safe-fs/dist/core.d.ts", import: `./${core}` }
    },
    ...(native
      ? {
          imports: {
            [specifier]: {
              types: `./${directory}/loader.d.ts`,
              workerd: null,
              browser: null,
              default: `./${loaderPath}`
            }
          }
        }
      : {})
  };
  const loader =
    'import {createRequire} from "node:module"; const require = createRequire(import.meta.url); export function loadBinding() { return require("./linux-x64-glibc.node"); }';
  const declaration = "export declare function loadBinding(): unknown;";
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
            sha256: digest(binary)
          }
        ],
    build: {
      sourceSha256: digest("source"),
      loaderSha256: digest(loader),
      declarationSha256: digest(declaration),
      headers: empty
        ? null
        : { version: "1.9.0", files: { "node_api.h": { size: 42, sha256: digest("header") } } },
      compiler: empty
        ? null
        : { path: "/usr/bin/cc", sha256: digest("compiler"), version: "fixture compiler" }
    }
  };
  const files = new Map<string, Buffer>([
    ["package.json", Buffer.from(JSON.stringify(metadata))],
    [
      runtime,
      Buffer.from(native ? `export {loadBinding} from "${specifier}";` : "export const fs = {};")
    ],
    [core, Buffer.from('export {fs} from "./shared.js";')],
    ["packages/safe-js/dist/shared.js", Buffer.from("export const fs = {};")],
    ["packages/safe-fs/dist/index.d.ts", Buffer.from("export declare const fs: unknown;")],
    ["packages/safe-fs/dist/core.d.ts", Buffer.from("export declare const fs: unknown;")],
    ...(native
      ? ([
          [loaderPath, Buffer.from(loader)],
          [`${directory}/loader.d.ts`, Buffer.from(declaration)],
          [`${directory}/manifest.json`, Buffer.from(JSON.stringify(manifest))],
          ...(empty ? [] : [[binaryPath, binary]])
        ] as [string, Buffer][])
      : [])
  ]);
  configure?.(files);
  const packed = release ? archive(files) : undefined;
  const integrity = packed
    ? `sha512-${createHash("sha512").update(packed).digest("base64")}`
    : null;
  const lock = release
    ? {
        packages: {
          "": { peerDependencies: bash.peerDependencies, devDependencies: bash.devDependencies },
          "node_modules/poe-code": {
            version: "13.0.0",
            resolved: "https://registry.npmjs.org/poe-code/-/poe-code-13.0.0.tgz",
            integrity
          }
        }
      }
    : {
        packages: {
          "packages/safe-bash": { devDependencies: bash.devDependencies },
          "node_modules/poe-code": { resolved: "", link: true }
        }
      };
  const io = createFsFromVolume(
    Volume.fromJSON({
      [`${root}/package.json`]: JSON.stringify(bash),
      "/checkout/package-lock.json": JSON.stringify(lock),
      [`${root}/package-lock.json`]: JSON.stringify(lock),
      [`${snapshot}/package.json`]: JSON.stringify(bash),
      [`${snapshot}/package-lock.json`]: JSON.stringify(lock),
      [`${snapshot}/dist/index.js`]: release
        ? 'import "poe-code/safe-fs";'
        : 'import "poe-code/safe-fs"; import "poe-code/safe-fs/core";'
    })
  );
  const declarations = {
    peer: {
      version: metadata.version,
      integrity,
      metadataSha256: digest(files.get("package.json")!),
      publicEntries: new Map([
        ["poe-code/safe-fs", "packages/safe-fs/dist/index.d.ts"],
        ...(release
          ? []
          : [["poe-code/safe-fs/core", "packages/safe-fs/dist/core.d.ts"] as [string, string]])
      ]),
      declarations: new Map(
        [...files]
          .filter(([path]) => path.endsWith(".d.ts") && !path.startsWith(directory))
          .map(([path, bytes]) => [path, digest(bytes)])
      )
    }
  };
  const bind = () => {
    const source = release ? `${root}/node_modules/poe-code` : "/checkout";
    for (const [path, bytes] of files) {
      io.mkdirSync(dirname(`${source}/${path}`), { recursive: true });
      io.writeFileSync(`${source}/${path}`, bytes);
    }
    if (packed) io.writeFileSync("/peer.tgz", packed);
    return peerCapture.bindPeerArtifact({
      root,
      io,
      declarations,
      checkout: !release,
      ...(release ? { artifact: "/peer.tgz" } : {})
    });
  };
  const binding = bind();
  peerCapture.stagePeerArtifact(binding, snapshot);
  const tools = Object.fromEntries(
    binding.files.map(({ path, sha256 }: { path: string; sha256: string }) => [
      `poe-code/${path}`,
      sha256
    ])
  );
  const emitted = {
    "dist/index.js": digest(io.readFileSync(`${snapshot}/dist/index.js`) as Buffer)
  };
  return { root, snapshot, io, files, metadata, manifest, binding, tools, emitted, bind };
}

async function withIo(
  context: TestContext,
  setup: ReturnType<typeof fixture>,
  run: () => Promise<void>
) {
  for (const name of ["readFile", "lstat", "realpath", "readdir"] as const)
    context.mock.method(filesystem, name, setup.io.promises[name].bind(setup.io.promises));
  syncBuiltinESMExports();
  try {
    await run();
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
}

test("peer artifact scans read each leaf once and freshly detect subsequent tampering", () => {
  const setup = fixture();
  const original = setup.io.readFileSync.bind(setup.io);
  const reads = new Map<string, number>();
  setup.io.readFileSync = ((...args: Parameters<typeof original>) => {
    const path = String(args[0]);
    reads.set(path, (reads.get(path) ?? 0) + 1);
    return original(...args);
  }) as typeof original;
  for (let scan = 1; scan <= 2; scan++) {
    peerCapture.assertPeerArtifact(setup.binding, setup.snapshot);
    for (const { path } of setup.binding.files) assert.equal(reads.get(`${setup.snapshot}/${prefix}${path}`), scan);
  }
  setup.io.writeFileSync(`${setup.snapshot}/${prefix}${runtime}`, "changed");
  assert.throws(() => peerCapture.assertPeerArtifact(setup.binding, setup.snapshot), /Consumer peer bytes changed/);
});

for (const empty of [false, true])
  test(`required peer captures exact native assets and importer edge: empty=${empty}`, async (context) => {
    const setup = fixture(true, empty);
    await withIo(context, setup, async () => {
      const result = await captureRequiredPeer(
        setup.snapshot,
        setup.emitted,
        setup.tools,
        setup.binding
      );
      assert.equal(result.profile, "checkout-root");
      assert.equal(result.integrity, null);
      assert.deepEqual(result.entries, {
        "poe-code/safe-fs": `${prefix}${runtime}`,
        "poe-code/safe-fs/core": `${prefix}${core}`
      });
      assert.deepEqual(result.edges[`${prefix}${runtime}`], {
        [specifier]: `${prefix}${loaderPath}`
      });
      const coreEdges = result.edges[`${prefix}${core}`];
      const loaderEdges = result.edges[`${prefix}${loaderPath}`];
      assert.ok(coreEdges);
      assert.ok(loaderEdges);
      assert.deepEqual(loaderEdges, {});
      assert.equal(coreEdges[specifier], undefined);
      assert.equal(loaderEdges["./linux-x64-glibc.node"], undefined);
      const expected = [...setup.files].filter(
        ([path]) =>
          path !== "package.json" && (!path.endsWith(".d.ts") || path.startsWith(directory))
      );
      assert.deepEqual(
        result.files,
        Object.fromEntries(expected.map(([path, bytes]) => [`${prefix}${path}`, digest(bytes)]))
      );
      assert.equal(result.metadataSha256, digest(setup.files.get("package.json")!));
    });
  });

test("required peer preserves branded no-native relative closure", async (context) => {
  const setup = fixture(false);
  await withIo(context, setup, async () => {
    const result = await captureRequiredPeer(
      setup.snapshot,
      setup.emitted,
      setup.tools,
      setup.binding
    );
    assert.equal(Object.keys(result.files).length, 3);
    assert.deepEqual(result.edges[`${prefix}${core}`], {
      "./shared.js": `${prefix}packages/safe-js/dist/shared.js`
    });
  });
});

for (const forged of ["spread", "serialized"])
  test(`required peer rejects ${forged} binding without native routes`, async (context) => {
    const setup = fixture(false);
    const binding =
      forged === "spread" ? { ...setup.binding } : JSON.parse(JSON.stringify(setup.binding));
    await withIo(context, setup, async () => {
      await assert.rejects(
        captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, binding),
        { message: "Unknown canonical peer binding" }
      );
    });
  });

test("required peer preserves the legacy unbound registry profile", async (context) => {
  const setup = fixture(false);
  const metadata = { ...setup.metadata, version: "13.0.0" };
  const integrity = "sha512-YWJjZA==";
  setup.io.writeFileSync(
    `${setup.snapshot}/package.json`,
    JSON.stringify({
      peerDependencies: { "poe-code": ">=13.0.0" },
      devDependencies: { "poe-code": "13.0.0" }
    })
  );
  setup.io.writeFileSync(
    `${setup.snapshot}/package-lock.json`,
    JSON.stringify({ packages: { "node_modules/poe-code": { version: "13.0.0", integrity } } })
  );
  setup.io.writeFileSync(`${setup.snapshot}/${prefix}package.json`, JSON.stringify(metadata));
  setup.tools["poe-code/package.json"] = digest(JSON.stringify(metadata));
  setup.io.writeFileSync(`${setup.snapshot}/dist/index.js`, 'import "poe-code/safe-fs";');
  setup.emitted["dist/index.js"] = digest('import "poe-code/safe-fs";');
  await withIo(context, setup, async () => {
    const result = await captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools);
    assert.equal(result.profile, "registry-release");
    assert.equal(result.integrity, integrity);
    assert.deepEqual(result.entries, { "poe-code/safe-fs": `${prefix}${runtime}` });
    assert.deepEqual(result.files, { [`${prefix}${runtime}`]: digest(setup.files.get(runtime)!) });
  });
});

test("runtime facts are deeply immutable and require the original binding brand", () => {
  const setup = fixture();
  const facts = peerCapture.capturePeerRuntimeFacts(setup.binding, setup.snapshot);
  assert.ok(Object.isFrozen(facts));
  assert.ok(Object.isFrozen(facts.edges));
  for (const imports of Object.values(facts.edges)) assert.ok(Object.isFrozen(imports));
  for (const entries of [facts.nativeAssets, facts.nativeEdges]) {
    assert.ok(Object.isFrozen(entries));
    for (const entry of entries) assert.ok(Object.isFrozen(entry));
  }
  assert.deepEqual(facts.nativeEdges, [{ importer: runtime, specifier, target: loaderPath }]);
  assert.deepEqual(facts.edges[loaderPath], { "node:module": "node:module" });
  assert.equal(
    facts.nativeAssets.find((entry: { path: string }) => entry.path === binaryPath).maxBytes,
    1048576
  );
  assert.throws(() => {
    facts.edges[runtime][specifier] = binaryPath;
  }, TypeError);
  assert.throws(() => {
    facts.nativeEdges.push({ importer: core, specifier, target: binaryPath });
  }, TypeError);
  for (const candidate of [
    { ...setup.binding },
    JSON.parse(JSON.stringify(setup.binding)),
    { ...setup.binding, runtimeFacts: facts }
  ]) {
    assert.throws(() => peerCapture.capturePeerRuntimeFacts(candidate, setup.snapshot), {
      message: "Unknown canonical peer binding"
    });
  }
});

for (const location of ["source", "staged"])
  for (const member of ["manifest.json", "loader.mjs", "loader.d.ts", "linux-x64-glibc.node"]) {
    test(`required peer rejects changed ${location} native ${member} despite updated tools hash`, async (context) => {
      const setup = fixture();
      const local = `${directory}/${member}`;
      const bytes = Buffer.from("changed");
      setup.io.writeFileSync(
        `${location === "source" ? "/checkout" : `${setup.snapshot}/${prefix}`}/${local}`,
        bytes
      );
      setup.tools[`poe-code/${local}`] = digest(bytes);
      await withIo(context, setup, async () => {
        await assert.rejects(
          captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, setup.binding),
          (error) =>
            error instanceof Error &&
            error.message.includes(
              location === "source" ? "Build peer changed" : "Consumer peer bytes changed"
            )
        );
      });
    });
  }

for (const location of ["source", "staged"])
  for (const change of ["missing", "extra", "symlink"]) {
    test(`required peer rejects ${location} native asset ${change}`, async (context) => {
      const setup = fixture();
      const base = location === "source" ? "/checkout" : `${setup.snapshot}/${prefix}`;
      const binary = `${base}/${binaryPath}`;
      if (change === "extra")
        setup.io.writeFileSync(`${base}/${directory}/foreign.node`, Buffer.from([0, 255]));
      else {
        setup.io.unlinkSync(binary);
        if (change === "symlink")
          setup.io.symlinkSync(`${base}/${directory}/manifest.json`, binary);
      }
      await withIo(context, setup, async () => {
        await assert.rejects(
          captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, setup.binding)
        );
      });
    });
  }

for (const change of ["wrong-parent", "other-private", "binary-import", "wrong-mapping"]) {
  test(`required peer rejects staged ${change} with recaptured tool hashes`, async (context) => {
    const setup = fixture();
    const local =
      change === "wrong-parent" ? core : change === "wrong-mapping" ? "package.json" : runtime;
    const bytes = Buffer.from(
      change === "wrong-mapping"
        ? JSON.stringify({
            ...setup.metadata,
            imports: {
              [specifier]: {
                types: `./${directory}/loader.d.ts`,
                workerd: null,
                browser: null,
                default: `./${binaryPath}`
              }
            }
          })
        : `import "${change === "other-private" ? "#unreviewed" : change === "binary-import" ? "./native/fs-seek/linux-x64-glibc.node" : specifier}";`
    );
    setup.io.writeFileSync(`${setup.snapshot}/${prefix}${local}`, bytes);
    setup.tools[`poe-code/${local}`] = digest(bytes);
    await withIo(context, setup, async () => {
      await assert.rejects(
        captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, setup.binding),
        (error) => error instanceof Error && error.message.includes("Consumer peer bytes changed")
      );
    });
  });
}

test("required peer hashes binary buffers without any text decoding", async (context) => {
  const setup = fixture();
  const original = setup.io.promises.readFile.bind(setup.io.promises);
  let binaryReads = 0;
  setup.io.promises.readFile = (async (...args: Parameters<typeof original>) => {
    const bytes = await original(...args);
    if (String(args[0]).endsWith(".node")) {
      assert.ok(Buffer.isBuffer(bytes));
      assert.equal(args.length, 1);
      binaryReads++;
      Object.defineProperty(bytes, "toString", {
        value: () => assert.fail("Binary must remain opaque")
      });
    }
    return bytes;
  }) as typeof original;
  await withIo(context, setup, async () => {
    const result = await captureRequiredPeer(
      setup.snapshot,
      setup.emitted,
      setup.tools,
      setup.binding
    );
    assert.equal(result.files[`${prefix}${binaryPath}`], digest(setup.files.get(binaryPath)!));
    assert.equal(binaryReads, 1);
    assert.equal(result.edges[`${prefix}${binaryPath}`], undefined);
  });
});

test("full emitted verification reads each fresh leaf once for hashing and peer imports", async (context) => {
  const setup = fixture();
  const map = "dist/index.js.map";
  setup.io.writeFileSync(`${setup.snapshot}/${map}`, "{}");
  const expected = { ...setup.emitted, [map]: digest("{}") };
  const reads = new Map<string, number>();
  const original = setup.io.promises.readFile.bind(setup.io.promises);
  setup.io.promises.readFile = (async (...args: Parameters<typeof original>) => {
    const path = String(args[0]);
    reads.set(path, (reads.get(path) ?? 0) + 1);
    return original(...args);
  }) as typeof original;
  await withIo(context, setup, async () => {
    for (let scan = 1; scan <= 2; scan++) {
      const peer = await captureRequiredPeer(setup.snapshot, expected, setup.tools, setup.binding, true);
      assert.ok(peer.entries["poe-code/safe-fs"]);
      for (const path of Object.keys(expected)) assert.equal(reads.get(`${setup.snapshot}/${path}`), scan);
    }
    setup.io.writeFileSync(`${setup.snapshot}/${map}`, "changed");
    await assert.rejects(captureRequiredPeer(setup.snapshot, expected, setup.tools, setup.binding, true), /Built public artifacts changed/);
  });
});

for (const change of ["changed", "missing", "extra", "symlink", "private-import"] as const) {
  test(`full emitted verification rejects ${change} after a successful fresh capture`, async context => {
    const setup = fixture();
    await withIo(context, setup, async () => {
      await captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, setup.binding, true);
      const path = `${setup.snapshot}/dist/index.js`;
      if (change === "changed") setup.io.writeFileSync(path, "changed");
      if (change === "missing") setup.io.unlinkSync(path);
      if (change === "extra") setup.io.writeFileSync(`${setup.snapshot}/dist/extra.js.map`, "{}");
      if (change === "symlink") {
        setup.io.unlinkSync(path);
        setup.io.symlinkSync(`${setup.snapshot}/package.json`, path);
      }
      if (change === "private-import") {
        const source = 'import "poe-code/private";';
        setup.io.writeFileSync(path, source);
        setup.emitted["dist/index.js"] = digest(source);
      }
      await assert.rejects(captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, setup.binding, true));
    });
  });
}

test("required peer retains emitted-source and captured-tool hash checks", async (context) => {
  const setup = fixture();
  await withIo(context, setup, async () => {
    await assert.rejects(
      captureRequiredPeer(
        setup.snapshot,
        { "dist/index.js": digest("different") },
        setup.tools,
        setup.binding
      ),
      (error) => error instanceof Error && error.message.includes("Emitted bytes changed")
    );
    await assert.rejects(
      captureRequiredPeer(
        setup.snapshot,
        setup.emitted,
        { ...setup.tools, [`poe-code/${runtime}`]: digest("different") },
        setup.binding
      ),
      (error) =>
        error instanceof Error && error.message.includes("Peer differs from captured tools")
    );
  });
});

for (const limit of ["member", "aggregate", "count"])
  test(`required peer preserves ${limit} bound independently of first capture`, async (context) => {
    const setup = fixture(true, false, (files) => {
      if (limit === "count") {
        files.set(
          core,
          Buffer.from(
            Array.from({ length: 124 }, (_, index) => `import "./member-${index}.js";`).join("\n")
          )
        );
        for (let index = 0; index < 124; index++)
          files.set(`packages/safe-js/dist/member-${index}.js`, Buffer.from("export {};"));
      } else if (limit === "member")
        files.set("packages/safe-js/dist/shared.js", Buffer.from(" ".repeat(8 * 1024 * 1024 + 1)));
      else {
        files.set(core, Buffer.from('import "./shared.js"; import "./another.js";'));
        for (const name of ["shared", "another"])
          files.set(`packages/safe-js/dist/${name}.js`, Buffer.from(" ".repeat(8 * 1024 * 1024)));
      }
    });
    await withIo(context, setup, async () => {
      await assert.rejects(
        captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, setup.binding),
        (error) =>
          error instanceof Error &&
          error.message.includes(
            limit === "count"
              ? "Peer runtime closure exceeds file bound"
              : limit === "member"
                ? "bounded regular file"
                : "Peer runtime closure exceeds byte bound"
          )
      );
    });
  });

test("required peer rechecks exact asset membership after asynchronous reads", async (context) => {
  const setup = fixture();
  const original = setup.io.promises.readFile.bind(setup.io.promises);
  setup.io.promises.readFile = (async (...args: Parameters<typeof original>) => {
    const bytes = await original(...args);
    if (String(args[0]).endsWith(".node"))
      setup.io.writeFileSync(
        `${setup.snapshot}/${prefix}${directory}/late.node`,
        Buffer.from([255])
      );
    return bytes;
  }) as typeof original;
  await withIo(context, setup, async () => {
    await assert.rejects(
      captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, setup.binding),
      (error) =>
        error instanceof Error &&
        error.message.includes("Native peer asset closure membership changed")
    );
  });
});

for (const fileName of ["#unreviewed", "./native/fs-seek/linux-x64-glibc.node"])
  test(`first capture still rejects unreviewed runtime edge ${fileName}`, () => {
    assert.throws(() =>
      fixture(true, false, (files) => {
        files.set(core, Buffer.from(`import "${fileName}";`));
      })
    );
  });

for (const native of [false, true])
  for (const empty of native ? [false, true] : [false])
    test(`required peer uses branded registry artifact: native=${native}, empty=${empty}`, async (context) => {
      const setup = fixture(native, empty, undefined, true);
      await withIo(context, setup, async () => {
        const result = await captureRequiredPeer(
          setup.snapshot,
          setup.emitted,
          setup.tools,
          setup.binding
        );
        assert.equal(result.profile, "registry-release");
        assert.equal(result.integrity, setup.binding.integrity);
        assert.deepEqual(result.entries, { "poe-code/safe-fs": `${prefix}${runtime}` });
        assert.deepEqual(
          result.edges[`${prefix}${runtime}`],
          native ? { [specifier]: `${prefix}${loaderPath}` } : {}
        );
        assert.equal(
          result.files[`${prefix}${binaryPath}`],
          native && !empty ? digest(setup.files.get(binaryPath)!) : undefined
        );
        assert.equal(result.files[`${prefix}${core}`], undefined);
      });
    });

test("legacy unbound registry capture does not gain private-edge authority", async (context) => {
  const setup = fixture(true, false, undefined, true);
  await withIo(context, setup, async () => {
    await assert.rejects(captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools), {
      message: `Unreviewed peer runtime dependency: ${specifier}`
    });
  });
});

test("required peer validates binding brand before reading observable metadata", async (context) => {
  const setup = fixture();
  let lookups = 0;
  const forged = {
    ...setup.binding,
    get profile() {
      lookups++;
      throw new Error("untrusted metadata getter");
    }
  };
  await withIo(context, setup, async () => {
    await assert.rejects(captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, forged), {
      message: "Unknown canonical peer binding"
    });
    assert.equal(lookups, 0);
  });
});

for (const member of ["manifest.json", "loader.mjs", "loader.d.ts", "linux-x64-glibc.node"])
  test(`required peer keeps ${member} bound before async payload reads`, async (context) => {
    const setup = fixture();
    const target = `${setup.snapshot}/${prefix}${directory}/${member}`;
    const originalStat = setup.io.promises.lstat.bind(setup.io.promises);
    const originalRead = setup.io.promises.readFile.bind(setup.io.promises);
    const limit = member === "manifest.json" ? 16384 : member.endsWith(".node") ? 1048576 : 65536;
    let payloadReads = 0;
    setup.io.promises.lstat = (async (...args: Parameters<typeof originalStat>) => {
      const stat = await originalStat(...args);
      if (String(args[0]) === target) Object.defineProperty(stat, "size", { value: limit + 1 });
      return stat;
    }) as typeof originalStat;
    setup.io.promises.readFile = (async (...args: Parameters<typeof originalRead>) => {
      if (String(args[0]) === target) payloadReads++;
      return originalRead(...args);
    }) as typeof originalRead;
    await withIo(context, setup, async () => {
      await assert.rejects(
        captureRequiredPeer(setup.snapshot, setup.emitted, setup.tools, setup.binding),
        (error) =>
          error instanceof Error &&
          error.message.includes("Peer input must be a bounded regular file")
      );
      assert.equal(payloadReads, 0);
    });
  });
