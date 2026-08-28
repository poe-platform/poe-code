import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./admission.mjs";
import { runObserver } from "./observer.mjs";

export const moduleUrl = import.meta.url;
export async function main(args) {
  assert.equal(args.length, 4, "explicit ROOT authorization file/hash and module seal file/hash required");
  const [authorizationPath, authorizationSha256, sealPath, sealSha256] = args;
  const readBound = (filename, expected) => {
    const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024);
    const bytes = fs.readFileSync(filename); assert.equal(digest(bytes), expected); return JSON.parse(bytes);
  };
  const seal = readBound(sealPath, sealSha256), authorization = readBound(authorizationPath, authorizationSha256);
  assert.equal(authorization.kind, "ROOT_NATIVE_GO");
  assert.equal(process.platform, "darwin"); assert.equal(process.arch, "arm64");
  assert.equal(authorization.moduleSealSha256, sealSha256);
  const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
  const packet = path.resolve(moduleRoot, "../..");
  assert.equal(fs.realpathSync(moduleRoot), moduleRoot);
  const protectedFiles = { [authorizationPath]: authorizationSha256, [sealPath]: sealSha256 };
  for (const [relative, expected] of Object.entries(seal.artifacts)) {
    assert.ok(!path.isAbsolute(relative) && !relative.split("/").includes(".."));
    const filename = path.join(packet, relative);
    const bytes = fs.readFileSync(filename); assert.equal(digest(bytes), expected, relative); protectedFiles[filename] = expected;
  }
  const original = JSON.parse(fs.readFileSync(path.join(packet, "OBSERVATIONS.json")));
  const additions = JSON.parse(fs.readFileSync(path.join(packet, "OBSERVATIONS-addendum-v2.json")));
  const bindings = JSON.parse(fs.readFileSync(path.join(packet, "SOURCE-BINDINGS.json")));
  const rows = [...original.rows, ...additions.rows];
  const recipeSha256 = digest(Buffer.from(JSON.stringify(rows)));
  assert.equal(authorization.recipeSha256, recipeSha256);
  for (const source of bindings.native.sourceMembers) protectedFiles[source.path] = source.sha256;
  const config = { schema: "mapfile-observer-v1", mode: "native", protected: protectedFiles, moduleRoot, moduleFiles: seal.moduleFiles, moduleSealSha256: sealSha256, authorizationPath, authorizationSha256, recipeSha256, rows, rowIds: authorization.rowIds, outputRoot: authorization.outputRoot, binary: bindings.native.binary.path, binarySha256: bindings.native.binary.sha256 };
  const { nodePort } = await import("./node-driver.mjs");
  const report = await runObserver(nodePort("ROOT_NATIVE_GO"), config);
  const text = JSON.stringify(report);
  assert.ok(Buffer.byteLength(text) <= 4 * 1024 * 1024, "final capture ceiling");
  process.stdout.write(text + "\n");
  if (!report.success) process.exitCode = 1;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(JSON.stringify({ phase: "ADMISSION_OR_CAPTURE_FAILURE", message: String(error.message).slice(0, 2048) }) + "\n"); process.exitCode = 78; });
}
