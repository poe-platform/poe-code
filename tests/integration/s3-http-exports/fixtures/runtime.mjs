import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function assertBoundFile(root, binding, localPath) {
  assert.ok(Object.hasOwn(binding.files, localPath), `Unbound file: ${localPath}`);
  const filename = resolve(root, localPath);
  assert.equal(relative(root, filename), localPath, `Noncanonical path: ${localPath}`);
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024, `Unbounded or redirected file: ${localPath}`);
  assert.equal(realpathSync(filename), filename, `Symlink traversal: ${localPath}`);
  assert.equal(createHash("sha256").update(readFileSync(filename)).digest("hex"), binding.files[localPath], `Changed authenticated bytes: ${localPath}`);
}

export function createAdmission(root, binding) {
  return (specifier, parentURL, targetURL) => {
    for (const metadata of binding.metadata) assertBoundFile(root, binding, metadata);
    if (targetURL.startsWith("file:")) {
      const local = relative(root, fileURLToPath(targetURL));
      if (isAbsolute(local) || local === ".." || local.startsWith("../")) throw Object.assign(new Error("Module outside packed consumer"), { code: "OUTSIDE_PACKED_CONSUMER" });
    }
    assert.ok(parentURL?.startsWith("file:"), "Missing authenticated importer");
    const parent = relative(root, fileURLToPath(parentURL));
    const expected = parent === "runtime.mjs" ? binding.entries[specifier] : binding.edges[parent]?.[specifier];
    assert.equal(typeof expected, "string", `Unbound import edge: ${parent} -> ${specifier}`);
    if (parent !== "runtime.mjs") assertBoundFile(root, binding, parent);
    if (targetURL.startsWith("node:")) {
      assert.equal(targetURL, expected, "Unexpected builtin edge");
      return targetURL;
    }
    assert.ok(targetURL.startsWith("file:"), "Unexpected import protocol");
    const filename = fileURLToPath(targetURL);
    const local = relative(root, filename);
    if (isAbsolute(local) || local === ".." || local.startsWith("../")) throw Object.assign(new Error("Module outside packed consumer"), { code: "OUTSIDE_PACKED_CONSUMER" });
    assert.equal(local, expected, "Resolved import differs from authenticated edge");
    assert.ok(local.endsWith(".js") || local.endsWith(".mjs"), "Runtime import must be built JavaScript");
    assertBoundFile(root, binding, local);
    return local;
  };
}

async function main() {
const consumerRoot = realpathSync(process.cwd());
const binding = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : undefined;
const admit = binding ? createAdmission(consumerRoot, binding) : undefined;
const tamperControls = [];
if (binding) {
  const peerEntry = binding.entries["poe-code/safe-fs"];
  for (const local of [peerEntry, "node_modules/poe-code/package.json"]) {
    const filename = resolve(consumerRoot, local), original = readFileSync(filename);
    try {
      writeFileSync(filename, Buffer.concat([original, Buffer.from("\n ")]));
      assert.throws(() => admit("poe-code/safe-fs", pathToFileURL(resolve("runtime.mjs")).href, pathToFileURL(resolve(peerEntry)).href));
      tamperControls.push(local);
    } finally { writeFileSync(filename, original); }
  }
  assert.throws(() => admit("poe-code/private", pathToFileURL(resolve("runtime.mjs")).href, pathToFileURL(resolve(peerEntry)).href));
  tamperControls.push("private-peer-route");
}
const resolvedFiles = new Set();
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (admit) {
      const admitted = admit(specifier, context.parentURL, result.url);
      if (!admitted.startsWith("node:")) resolvedFiles.add(admitted);
      return result;
    }
    if (result.url.startsWith("node:")) return result;
    assert.ok(result.url.startsWith("file:"), `Unexpected module protocol: ${result.url}`);
    const filename = realpathSync(fileURLToPath(result.url));
    const localPath = relative(consumerRoot, filename);
    if (isAbsolute(localPath) || localPath === ".." || localPath.startsWith("../")) {
      throw Object.assign(new Error("Module outside packed consumer"), { code: "OUTSIDE_PACKED_CONSUMER" });
    }
    assert.ok(!filename.endsWith(".ts"), `Unexpected source import: ${filename}`);
    resolvedFiles.add(localPath);
    return result;
  },
});

try {
  const rootApi = await import("virtual-bash");
  const httpApi = await import("virtual-bash/fs/s3/http");
  if (binding) {
    const canonical = await import("poe-code/safe-fs");
    assert.equal(rootApi.createS3HttpTransport, canonical.createS3HttpTransport);
    assert.equal(rootApi.FsError, canonical.FsError);
    assert.equal(rootApi.MemoryFileSystem, canonical.MemoryFileSystem);
    await assert.rejects(import("poe-code/packages/safe-fs/src/index.ts"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  }
  assert.deepEqual(Object.keys(httpApi), ["createS3HttpTransport"]);
  assert.equal(typeof rootApi.createS3HttpTransport, "function");
  assert.equal(rootApi.createS3HttpTransport, httpApi.createS3HttpTransport);
  for (const [specifier, entrypoint] of [
    ["virtual-bash", "index.js"],
    ["virtual-bash/fs/s3/http", "fs/s3/http/index.js"],
  ]) {
    assert.equal(
      realpathSync(fileURLToPath(import.meta.resolve(specifier))),
      realpathSync(resolve("node_modules/virtual-bash/dist", entrypoint)),
    );
  }
  let requests = 0;
  let credentialCalls = 0;
  const credentials = { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" };
  const request = () => {
    requests += 1;
    throw new Error("Mechanical export check must not send requests");
  };
  const transports = [
    rootApi.createS3HttpTransport({ endpoint: "https://example.invalid", region: "us-east-1", credentials, request }),
    httpApi.createS3HttpTransport({
      endpoint: "https://example.invalid", region: "us-east-1", request,
      credentials: async () => {
        credentialCalls += 1;
        return credentials;
      },
    }),
  ];
  for (const transport of transports) {
    for (const method of ["headObject", "getObject", "putObject", "copyObject", "deleteObject", "listObjectsV2"]) {
      assert.equal(typeof transport[method], "function", method);
    }
  }
  assert.equal(requests, 0);
  assert.equal(credentialCalls, 0);
  await assert.rejects(import(pathToFileURL(process.argv[2]).href), { code: "OUTSIDE_PACKED_CONSUMER" });
  await assert.rejects(import("virtual-bash/src/fs/s3/http/index.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  assert.ok(resolvedFiles.has("node_modules/virtual-bash/dist/index.js"));
  assert.ok(resolvedFiles.has("node_modules/virtual-bash/dist/fs/s3/http/index.js"));
  assert.ok([...resolvedFiles].every((filename) => filename.startsWith("node_modules/virtual-bash/dist/") || (binding && Object.hasOwn(binding.files, filename))));
  process.stdout.write(JSON.stringify({
    publicImports: ["virtual-bash", "virtual-bash/fs/s3/http"],
    factoryIdentity: true, constructionCount: transports.length, requests, credentialCalls,
    outsideSourceRejected: true, privateSourceSubpathRejected: true,
    resolvedFiles: [...resolvedFiles].sort(),
    canonicalIdentity: Boolean(binding), tamperControls,
  }));
} finally {
  hooks.deregister();
}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) await main();
