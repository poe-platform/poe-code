import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const consumerRoot = realpathSync(process.cwd());
const resolvedFiles = new Set();
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
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
  assert.ok([...resolvedFiles].every((filename) => filename.startsWith("node_modules/virtual-bash/dist/")));
  process.stdout.write(JSON.stringify({
    publicImports: ["virtual-bash", "virtual-bash/fs/s3/http"],
    factoryIdentity: true, constructionCount: transports.length, requests, credentialCalls,
    outsideSourceRejected: true, privateSourceSubpathRejected: true,
    resolvedFiles: [...resolvedFiles].sort(),
  }));
} finally {
  hooks.deregister();
}
