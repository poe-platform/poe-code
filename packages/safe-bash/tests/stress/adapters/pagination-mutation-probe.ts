import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { MockS3Client, createS3Transport } from "../../../src/fs/s3/index.js";
import { errno } from "../../fs/conformance/fixtures.js";

const filename = new URL("../../../src/fs/s3/filesystem.ts", import.meta.url);
const original = await readFile(filename, "utf8");
assert.ok(original.includes(" || tokens.has(token)"));
const mutated = original.replace(" || tokens.has(token)", "");
const compiled = ts.transpileModule(mutated, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText;
const linked = compiled.replace(/from "(\.\.?\/[^"]+)"/g,
  (_match, specifier: string) => `from "${new URL(specifier, filename).href}"`);
const { S3FileSystem } = await import(`data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`);
const mock = new MockS3Client({ buckets: ["mutation-proof"] });
const transport = createS3Transport(mock, mock.capabilities);
let calls = 0;
transport.listObjectsV2 = async (input) => {
  if (input.Delimiter === undefined) return { Contents: [], IsTruncated: false };
  calls++;
  assert.ok(calls <= 3, "pagination must terminate");
  return { Contents: [], IsTruncated: true, NextContinuationToken: "same" };
};
await assert.rejects(new S3FileSystem({ transport, bucket: "mutation-proof", prefix: "scope" }).readdir("/"), errno("EIO"));
assert.equal(calls, 4);
assert.throws(() => assert.equal(calls, 2), { code: "ERR_ASSERTION" });
console.log("MUTATION CAUGHT: removing cycle detection makes the old EIO check pass; the outside calls===2 assertion fails at calls=4. No source files edited.");
