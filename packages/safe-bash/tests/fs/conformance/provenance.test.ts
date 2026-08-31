import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalPeerState, sourceState } from "./fixtures.js";

test("canonical conformance identifies the public peer without conflating checkout and release", async () => {
  const source = await sourceState();
  assert.ok(["workspace-checkout", "installed-release"].includes(source["canonical:profile"]!));
  assert.ok(source["canonical:version"]);
  assert.equal(Object.hasOwn(source, "canonical:lock-integrity"), source["canonical:profile"] === "installed-release");
});

function peerFixture(checkout: boolean) {
  const packageRoot = checkout ? "/fixture/packages/safe-bash" : "/fixture/bash";
  const peerRoot = checkout ? "/fixture" : "/fixture/bash/node_modules/poe-code";
  const target = checkout ? "./packages/safe-js/dist/safe-fs.js" : "./dist/safe-fs.js";
  const moduleUrl = pathToFileURL(`${peerRoot}/${target.slice(2)}`).href;
  const metadata = { name: "poe-code", version: checkout ? "0.0.0-dev" : "13.0.0", workspaces: ["packages/*"], exports: { "./safe-fs": { import: target } } };
  const lock = checkout ? {
    packages: { "": { name: "poe-code", version: metadata.version }, "packages/safe-bash": { name: "virtual-bash", devDependencies: { "poe-code": "file:../.." } } },
  } : { packages: { "node_modules/poe-code": { version: metadata.version, integrity: "sha512-synthetic-registry-binding" } } };
  const files = new Map<string, string>([
    [`${peerRoot}/package.json`, JSON.stringify(metadata)],
    [`${checkout ? peerRoot : packageRoot}/package-lock.json`, JSON.stringify(lock)],
    [`${packageRoot}/package.json`, JSON.stringify({ name: "virtual-bash", private: true })],
    [fileURLToPath(moduleUrl), "synthetic canonical module"],
  ]);
  const reads: string[] = [];
  const read = async (location: string | URL): Promise<Uint8Array> => {
    const filename = location instanceof URL ? fileURLToPath(location) : location;
    reads.push(filename);
    const value = files.get(filename);
    if (value === undefined) throw Object.assign(new Error(`Missing ${filename}`), { code: "ENOENT" });
    return Buffer.from(value);
  };
  return { packageRoot, peerRoot, moduleUrl, metadata, files, reads, read };
}

for (const checkout of [true, false]) {
  test(`canonical provenance preserves the ${checkout ? "checkout" : "registry"} identity contract`, async () => {
    const fixture = peerFixture(checkout);
    const state = await canonicalPeerState(fixture.packageRoot, fixture.moduleUrl, fixture.read);
    assert.equal(state["canonical:profile"], checkout ? "workspace-checkout" : "installed-release");
    assert.equal(state["canonical:version"], checkout ? "0.0.0-dev" : "13.0.0");
    assert.equal(Object.hasOwn(state, "canonical:lock-integrity"), !checkout);
    if (checkout) assert.ok(!fixture.reads.includes(`${fixture.packageRoot}/package-lock.json`));
  });
}

for (const fault of ["missing workspace", "private route", "root lock drift", "second registry graph", "wrong workspace", "malformed metadata"] as const) {
  test(`canonical checkout provenance rejects ${fault}`, async () => {
    const fixture = peerFixture(true);
    if (fault === "missing workspace") fixture.metadata.workspaces = [];
    if (fault === "private route") fixture.metadata.exports["./safe-fs"].import = "./packages/safe-fs/dist/index.js";
    fixture.files.set(`${fixture.peerRoot}/package.json`, fault === "malformed metadata" ? "{" : JSON.stringify(fixture.metadata));
    if (fault === "wrong workspace") fixture.files.set(`${fixture.packageRoot}/package.json`, JSON.stringify({ name: "other", private: true }));
    if (fault === "root lock drift" || fault === "second registry graph") {
      const lock = JSON.parse(fixture.files.get(`${fixture.peerRoot}/package-lock.json`)!);
      if (fault === "root lock drift") lock.packages[""].version = "13.0.0";
      else lock.packages["packages/safe-bash"].devDependencies["poe-code"] = "13.0.0";
      fixture.files.set(`${fixture.peerRoot}/package-lock.json`, JSON.stringify(lock));
    }
    await assert.rejects(canonicalPeerState(fixture.packageRoot, fixture.moduleUrl, fixture.read));
  });
}

for (const fault of ["version", "integrity"] as const) {
  test(`canonical registry provenance still rejects ${fault} drift`, async () => {
    const fixture = peerFixture(false);
    const lock = JSON.parse(fixture.files.get(`${fixture.packageRoot}/package-lock.json`)!);
    if (fault === "version") lock.packages["node_modules/poe-code"].version = "12.0.0";
    else delete lock.packages["node_modules/poe-code"].integrity;
    fixture.files.set(`${fixture.packageRoot}/package-lock.json`, JSON.stringify(lock));
    await assert.rejects(canonicalPeerState(fixture.packageRoot, fixture.moduleUrl, fixture.read));
  });
}
