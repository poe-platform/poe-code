import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";

const peerModule = new URL("../../plugins/qualified-current-release/peer.mjs", import.meta.url).href;
const metadataModule = new URL("../../commands/metadata-stress/canonical-env/runner.mjs", import.meta.url).href;
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const runtimePath = "packages/safe-fs/dist/index.js";
const declarationPath = "packages/safe-fs/dist/index.d.ts";

for (const scenario of ["leaf", "root", "empty", "unknown", "tampered", "foreign", "source", "symlink"] as const) {
  test(`candidate declaration listing authenticates ${scenario} without requiring an unused root import`, async () => {
    const { assertConsumerDeclarationFiles } = await import(peerModule);
    assert.equal(typeof assertConsumerDeclarationFiles, "function");
    const installed = "/consumer/node_modules/virtual-bash";
    const leaf = `${installed}/dist/commands/timeout/index.d.ts`, root = `${installed}/dist/index.d.ts`;
    const volume = Volume.fromJSON({ [leaf]: "export declare const timeout: number;", [root]: "export declare const root: number;" });
    const io = createFsFromVolume(volume);
    const binding = { declarations: new Map([["dist/commands/timeout/index.d.ts", digest(io.readFileSync(leaf) as Buffer)], ["dist/index.d.ts", digest(io.readFileSync(root) as Buffer)]]) };
    let files = [scenario === "root" ? root : leaf];
    if (scenario === "empty") files = [];
    if (scenario === "unknown") { files = [`${installed}/dist/private.d.ts`]; io.writeFileSync(files[0]!, "export {};"); }
    if (scenario === "tampered") io.writeFileSync(leaf, "changed");
    if (scenario === "foreign") files = ["/other/node_modules/virtual-bash/dist/index.d.ts"];
    if (scenario === "source") files = [`${installed}/src/index.ts`];
    if (scenario === "symlink") { io.renameSync(leaf, "/outside.d.ts"); io.symlinkSync("/outside.d.ts", leaf); }
    if (scenario === "root" || scenario === "leaf") assertConsumerDeclarationFiles(files, installed, binding, io);
    else assert.throws(() => assertConsumerDeclarationFiles(files, installed, binding, io));
  });
}

function archive(files: Record<string, string>, type = "0") {
  const chunks: Buffer[] = [];
  for (const [path, text] of Object.entries(files)) {
    const bytes = Buffer.from(text), header = Buffer.alloc(512);
    header.write(path);
    header.write("0000644\0", 100);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const checksum = header.reduce((total, byte) => total + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

function fixture(change: (files: Record<string, string>) => void = () => {}, type = "0") {
  const metadata = { name: "poe-code", version: "13.0.0", type: "module", exports: { "./safe-fs": { types: `./${declarationPath}`, import: `./${runtimePath}` } } };
  const files: Record<string, string> = {
    "package/package.json": JSON.stringify(metadata),
    [`package/${runtimePath}`]: 'export { value } from "./chunk.js";\n',
    "package/packages/safe-fs/dist/chunk.js": "export const value = 42;\n",
    [`package/${declarationPath}`]: "export declare const value: number;\n",
    "package/README.md": "Not part of the admitted executable or declaration closure.\n",
  };
  change(files);
  const bytes = archive(files, type);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const manifest = { name: "virtual-bash", peerDependencies: { "poe-code": ">=13.0.0" }, devDependencies: { "poe-code": "13.0.0" } };
  const lock = { packages: { "": manifest, "node_modules/poe-code": { version: "13.0.0", resolved: "https://registry.npmjs.org/poe-code/-/poe-code-13.0.0.tgz", integrity } } };
  const volume = Volume.fromJSON({ "/work/package.json": JSON.stringify(manifest), "/work/package-lock.json": JSON.stringify(lock), "/consumer/package.json": '{"type":"module"}' });
  const io = createFsFromVolume(volume);
  io.writeFileSync("/peer.tgz", bytes);
  for (const [path, text] of Object.entries(files)) {
    const destination = `/work/node_modules/poe-code/${path.slice("package/".length)}`;
    io.mkdirSync(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
    io.writeFileSync(destination, text);
  }
  const declarations = { peer: { name: "poe-code", version: "13.0.0", integrity, metadataSha256: digest(files["package/package.json"]!), publicEntries: new Map([["poe-code/safe-fs", declarationPath]]), declarations: new Map([[declarationPath, digest(files[`package/${declarationPath}`]!)]]) } };
  return { io, volume, files, bytes, manifest, lock, declarations, root: "/work", artifact: "/peer.tgz" };
}

test("authenticated peer staging contains exactly the public runtime/declaration closure and survives moving", async () => {
  const { bindPeerArtifact, stagePeerArtifact, assertPeerArtifact, assertPeerDeclarationFiles } = await import(peerModule);
  const input = fixture(), binding = bindPeerArtifact(input);
  assert.equal(binding.version, "13.0.0");
  assert.equal(binding.integrity, input.lock.packages["node_modules/poe-code"].integrity);
  stagePeerArtifact(binding, "/consumer");
  assert.equal(input.io.readFileSync(`/consumer/node_modules/poe-code/${runtimePath}`, "utf8"), input.files[`package/${runtimePath}`]);
  assert.equal(input.io.existsSync("/consumer/node_modules/poe-code/README.md"), false);
  input.io.renameSync("/consumer", "/moved");
  assertPeerArtifact(binding, "/moved");
  assertPeerDeclarationFiles(binding, [`/moved/node_modules/poe-code/${declarationPath}`], "/moved");
  assert.throws(() => stagePeerArtifact({ ...binding }, "/other"), /binding/u);
});

for (const mutation of ["missing", "wrong-bytes", "symlink", "optional", "wrong-pin", "wrong-registry", "unrelated-peer", "missing-locked-root"] as const) {
  test(`peer admission refuses ${mutation} before consumer writes`, async () => {
    const { bindPeerArtifact } = await import(peerModule);
    const input = fixture();
    if (mutation === "missing") input.io.unlinkSync(input.artifact);
    if (mutation === "wrong-bytes") input.io.writeFileSync(input.artifact, "not the locked package");
    if (mutation === "symlink") { input.io.renameSync(input.artifact, "/original.tgz"); input.io.symlinkSync("/original.tgz", input.artifact); }
    if (mutation === "optional") input.io.writeFileSync("/work/package.json", JSON.stringify({ ...input.manifest, peerDependenciesMeta: { "poe-code": { optional: true } } }));
    if (mutation === "wrong-pin") input.io.writeFileSync("/work/package.json", JSON.stringify({ ...input.manifest, devDependencies: { "poe-code": "13.0.1" } }));
    if (mutation === "wrong-registry") { input.lock.packages["node_modules/poe-code"].resolved = "file:/untrusted.tgz"; input.io.writeFileSync("/work/package-lock.json", JSON.stringify(input.lock)); }
    if (mutation === "unrelated-peer") input.io.writeFileSync("/work/package.json", JSON.stringify({ ...input.manifest, peerDependencies: { ...input.manifest.peerDependencies, other: "*" } }));
    if (mutation === "missing-locked-root") input.io.writeFileSync("/work/package-lock.json", JSON.stringify({ packages: { "node_modules/poe-code": input.lock.packages["node_modules/poe-code"] } }));
    const before = input.volume.toJSON();
    assert.throws(() => bindPeerArtifact(input));
    assert.deepEqual(input.volume.toJSON(), before);
  });
}

for (const mutation of ["runtime", "declaration", "metadata", "runtime-symlink", "undeclared-import", "private-import", "outside-import", "export-redirection", "missing-closure"] as const) {
  test(`artifact/tooling closure rejects ${mutation}`, async () => {
    const { bindPeerArtifact } = await import(peerModule);
    const input = fixture(files => {
      if (mutation === "undeclared-import") files[`package/${runtimePath}`] = 'import "some-package";';
      if (mutation === "private-import") files[`package/${runtimePath}`] = 'import "poe-code/private";';
      if (mutation === "outside-import") files[`package/${runtimePath}`] = 'import "../../../../outside.js";';
      if (mutation === "missing-closure") files[`package/${runtimePath}`] = 'import "./missing.js";';
      if (mutation === "export-redirection") {
        const metadata = JSON.parse(files["package/package.json"]!);
        metadata.exports["./safe-fs"].types = "./src/index.ts";
        files["package/package.json"] = JSON.stringify(metadata);
      }
    });
    const target = `/work/node_modules/poe-code/${mutation === "declaration" ? declarationPath : mutation === "metadata" ? "package.json" : runtimePath}`;
    if (["runtime", "declaration", "metadata"].includes(mutation)) input.io.writeFileSync(target, "tampered");
    if (mutation === "runtime-symlink") { input.io.renameSync(target, "/redirect.js"); input.io.symlinkSync("/redirect.js", target); }
    assert.throws(() => bindPeerArtifact(input));
    assert.equal(input.io.existsSync("/consumer/node_modules"), false);
  });
}

for (const type of ["1", "2", "5", "x"]) test(`authenticated tar refuses member type ${type} without extracting`, async () => {
  const { bindPeerArtifact } = await import(peerModule);
  const input = fixture(() => {}, type);
  const before = input.volume.toJSON();
  assert.throws(() => bindPeerArtifact(input), /regular/u);
  assert.deepEqual(input.volume.toJSON(), before);
});

test("archive traversal is refused even when its bytes match the supplied lock", async () => {
  const { bindPeerArtifact } = await import(peerModule);
  const input = fixture(files => { files["package/../outside.js"] = "export {};"; });
  assert.throws(() => bindPeerArtifact(input), /path/u);
});

for (const mutation of ["changed-runtime", "changed-metadata", "extra-file", "private-type", "source-type", "foreign-type", "symlink-parent", "changed-before-staging"] as const) {
  test(`moved consumer rejects ${mutation}`, async () => {
    const { bindPeerArtifact, stagePeerArtifact, assertPeerArtifact, assertPeerDeclarationFiles } = await import(peerModule);
    const input = fixture(), binding = bindPeerArtifact(input);
    if (mutation === "changed-before-staging") {
      input.io.writeFileSync(`/work/node_modules/poe-code/${runtimePath}`, "changed");
      assert.throws(() => stagePeerArtifact(binding, "/consumer"));
      assert.equal(input.io.existsSync("/consumer/node_modules"), false);
      return;
    }
    if (mutation === "symlink-parent") {
      input.io.mkdirSync("/elsewhere"); input.io.symlinkSync("/elsewhere", "/consumer/node_modules");
      assert.throws(() => stagePeerArtifact(binding, "/consumer"), /symlink|redirect/u);
      assert.deepEqual(input.io.readdirSync("/elsewhere"), []);
      return;
    }
    stagePeerArtifact(binding, "/consumer");
    if (mutation === "changed-runtime") input.io.writeFileSync(`/consumer/node_modules/poe-code/${runtimePath}`, "changed");
    if (mutation === "changed-metadata") input.io.writeFileSync("/consumer/node_modules/poe-code/package.json", "{}");
    if (mutation === "extra-file") input.io.writeFileSync("/consumer/node_modules/poe-code/extra.js", "export {};");
    if (["changed-runtime", "changed-metadata", "extra-file"].includes(mutation)) assert.throws(() => assertPeerArtifact(binding, "/consumer"));
    else {
      const target = mutation === "foreign-type" ? `/work/node_modules/poe-code/${declarationPath}` : `/consumer/node_modules/poe-code/${mutation === "source-type" ? "src/index.ts" : "private.d.ts"}`;
      assert.throws(() => assertPeerDeclarationFiles(binding, [target], "/consumer"), /declaration|fallback|closure/u);
    }
  });
}

function metadataFixture() {
  const volume = Volume.fromJSON({ "/snapshot/src/new.ts": "export {};", "/snapshot/package.json": "{}", "/snapshot/package-lock.json": "{}", "/snapshot/tsconfig.json": "{}", "/snapshot/tsconfig.build.json": "{}", "/snapshot/tests/kept.ts": "unchanged assertions" });
  const io = createFsFromVolume(volume);
  const sources = ["src/new.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].map(path => ({ path, sha256: digest(io.readFileSync(`/snapshot/${path}`) as Buffer) }));
  const profile = { kind: "committed-current-source", sourceCommit: "c88efaed74968bc27e879b87bae23b44ec01b198", sources, sourceTreeSha256: digest(JSON.stringify(sources)) };
  return { io, volume, profile, sourceRoot: "/snapshot", historicalPaths: ["src/retired.ts", "tests/kept.ts", "package.json"] };
}

test("historical selection retains absent old paths; explicit current profile replaces only committed source inventory", async () => {
  const { selectManifestPaths } = await import(metadataModule);
  const input = metadataFixture();
  assert.deepEqual(selectManifestPaths(input.historicalPaths, undefined, input), input.historicalPaths);
  const selected = selectManifestPaths(input.historicalPaths, input.profile, input);
  assert.ok(selected.includes("tests/kept.ts"));
  assert.ok(selected.includes("src/new.ts"));
  assert.equal(selected.includes("src/retired.ts"), false);
});

for (const mutation of ["wrong-kind", "noncommit", "wrong-digest", "missing-source", "extra-source", "changed-source", "missing-test", "symlink-source", "forged-inventory"] as const) {
  test(`current metadata profile fails closed on ${mutation}`, async () => {
    const { selectManifestPaths } = await import(metadataModule);
    assert.equal(typeof selectManifestPaths, "function");
    const input = metadataFixture();
    if (mutation === "wrong-kind") input.profile.kind = "ignore-missing";
    if (mutation === "noncommit") input.profile.sourceCommit = "WORKTREE";
    if (mutation === "wrong-digest") input.profile.sourceTreeSha256 = "0".repeat(64);
    if (mutation === "missing-source") input.io.unlinkSync("/snapshot/src/new.ts");
    if (mutation === "extra-source") input.io.writeFileSync("/snapshot/src/injected.ts", "export {};");
    if (mutation === "changed-source") input.io.writeFileSync("/snapshot/src/new.ts", "changed");
    if (mutation === "missing-test") input.io.unlinkSync("/snapshot/tests/kept.ts");
    if (mutation === "symlink-source") { input.io.renameSync("/snapshot/src/new.ts", "/outside.ts"); input.io.symlinkSync("/outside.ts", "/snapshot/src/new.ts"); }
    if (mutation === "forged-inventory") { input.profile.sources.push({ path: "tests/kept.ts", sha256: digest("unchanged assertions") }); input.profile.sourceTreeSha256 = digest(JSON.stringify(input.profile.sources)); }
    assert.throws(() => selectManifestPaths(input.historicalPaths, input.profile, input));
  });
}
