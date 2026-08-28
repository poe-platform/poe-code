import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertOwnData, snapshotOwnData } from "./data.mjs";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const moduleUrl = import.meta.url;
export function inside(root, filename) {
  return path.isAbsolute(filename) && filename.startsWith(root + path.sep) && path.normalize(filename) === filename;
}
export function statData(port, filename) {
  const stat = snapshotOwnData(port.stat(filename));
  assertOwnData(Object.keys(stat).sort(), ["bytes", "identity", "kind", "mode"]);
  assert.ok(["file", "directory", "symlink", "other"].includes(stat.kind));
  assert.ok(Number.isSafeInteger(stat.bytes) && stat.bytes >= 0);
  assert.ok(Number.isSafeInteger(stat.mode) && stat.mode >= 0 && stat.mode <= 0o7777);
  assert.ok(typeof stat.identity === "string" || Number.isSafeInteger(stat.identity));
  return stat;
}
export function authenticate(port, config) {
  config = snapshotOwnData(config);
  assertOwnData(Object.keys(config).sort(), ["schema", "mode", "runtime", "protected", "protectedModes", "moduleRoot", "moduleFiles", "moduleSealSha256", "authorizationPath", "authorizationSha256", "recipeSha256", "rows", "rowIds", "outputRoot", "binary", "binaryBytes", "binaryMode", "binarySha256"].sort());
  assert.equal(config.schema, "mapfile-observer-v1");
  assert.ok(["native", "synthetic"].includes(config.mode));
  assert.ok(Object.keys(config.protected).length > 0 && Object.keys(config.protected).length <= 128);
  assertOwnData(Object.keys(config.protectedModes).sort(), Object.keys(config.protected).sort(), "complete protected modes");
  let total = 0;
  for (const [filename, expected] of Object.entries(config.protected)) {
    assert.equal(port.canonical(filename), filename, "canonical control path");
    const stat = statData(port, filename);
    assert.equal(stat.kind, "file", `protected regular file: ${filename}`);
    assert.equal(config.protectedModes[filename], 0o644, "sealed control mode policy");
    assert.equal(stat.mode, config.protectedModes[filename], `protected mode: ${filename}`);
    assert.ok(stat.bytes <= 16 * 1024 * 1024);
    total += stat.bytes; assert.ok(total <= 64 * 1024 * 1024);
    assert.equal(digest(port.read(filename)), expected, `protected bytes: ${filename}`);
  }
  assertOwnData(snapshotOwnData(port.list(config.moduleRoot)).sort(), config.moduleFiles.slice().sort(), "complete module directory");
  for (const filename of config.moduleFiles) assert.ok(config.protected[path.join(config.moduleRoot, filename)], "every module must be byte-bound");
  const authorization = JSON.parse(port.read(config.authorizationPath));
  assertOwnData(authorization, { kind: config.mode === "native" ? "ROOT_NATIVE_GO" : "SYNTHETIC_ONLY", runtime: config.runtime, moduleSealSha256: config.moduleSealSha256, recipeSha256: config.recipeSha256, outputRoot: config.outputRoot, rowIds: config.rowIds }, "exact route authorization");
  assert.equal(digest(port.read(config.authorizationPath)), config.authorizationSha256, "authorization bytes");
  assert.equal(authorization.kind, config.mode === "native" ? "ROOT_NATIVE_GO" : "SYNTHETIC_ONLY");
  assert.equal(authorization.moduleSealSha256, config.moduleSealSha256);
  assert.equal(authorization.recipeSha256, config.recipeSha256);
  assert.equal(authorization.outputRoot, config.outputRoot);
  assertOwnData(authorization.rowIds, config.rowIds);
  assertOwnData(authorization.runtime, config.runtime, "explicit runtime authorization");
  const { bytes: runtimeBytes, sha256: runtimeHash, mode: runtimeMode, ...runtimeIdentity } = config.runtime;
  assertOwnData(port.runtimeIdentity(), runtimeIdentity, "executing runtime identity");
  assert.equal(runtimeMode, 0o755, "sealed runtime mode policy");
  assert.ok(Number.isSafeInteger(runtimeBytes) && runtimeBytes > 0 && runtimeBytes <= 256 * 1024 * 1024);
  assert.equal(port.canonical(runtimeIdentity.path), runtimeIdentity.path);
  const runtimeStat = statData(port, runtimeIdentity.path);
  assert.equal(runtimeStat.kind, "file");
  assert.equal(runtimeStat.mode, runtimeMode, "runtime executable mode");
  assert.equal(runtimeStat.bytes, runtimeBytes);
  assert.equal(port.hash(runtimeIdentity.path, runtimeBytes), runtimeHash, "runtime binary bytes");
  assert.equal(port.canonical(config.binary), config.binary);
  const binaryStat = statData(port, config.binary);
  assert.equal(binaryStat.kind, "file");
  assert.equal(config.binaryMode, 0o755, "sealed native mode policy");
  assert.equal(binaryStat.mode, config.binaryMode, "native executable mode");
  assert.ok(Number.isSafeInteger(config.binaryBytes) && config.binaryBytes > 0 && config.binaryBytes <= 16 * 1024 * 1024);
  assert.equal(binaryStat.bytes, config.binaryBytes);
  assert.equal(port.hash(config.binary, config.binaryBytes), config.binarySha256, "binary bytes");
  assert.equal(path.normalize(config.outputRoot), config.outputRoot);
  assert.ok(path.isAbsolute(config.outputRoot) && config.outputRoot !== "/");
  if (config.mode === "native") assert.match(config.outputRoot, /^\/private\/tmp\/mapfile-observer-[A-Za-z0-9-]+$/u);
  assert.equal(port.canonical(path.dirname(config.outputRoot)), path.dirname(config.outputRoot), "stable canonical parent");
  assert.ok(config.rowIds.length > 0 && config.rowIds.length <= 43);
  assert.equal(new Set(config.rowIds).size, config.rowIds.length);
  let scripts = 0, input = 0;
  const selected = config.rowIds.map(id => {
    assert.match(id, /^(N|A)\d{2}$/u);
    const row = config.rows.find(item => item.id === id);
    assert.ok(row, `unselected recipe: ${id}`);
    assert.equal(row.expectation, null);
    assert.equal(digest(Buffer.from(row.script)), row.scriptSha256);
    assert.match(row.stdinHex, /^(?:[a-f0-9]{2})*$/u);
    assert.equal(digest(Buffer.from(row.stdinHex, "hex")), row.stdinSha256);
    const bytes = Buffer.byteLength(row.script), stdin = row.stdinHex.length / 2;
    assert.ok(bytes <= 4096 && stdin <= 4096);
    scripts += bytes; input += stdin;
    return row;
  });
  assert.ok(scripts <= 32768 && input <= 32768);
  assert.equal(digest(Buffer.from(JSON.stringify(config.rows))), config.recipeSha256, "recipe serialization");
  return selected;
}
