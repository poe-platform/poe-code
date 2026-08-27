import assert from "node:assert/strict";
import { join } from "node:path";
import { bucket, save, withService } from "./service.mjs";

const source = Buffer.from([0, 255, 128, 65, 13, 10]);
const target = Buffer.from([79, 76, 68]);
const replacement = Buffer.from([78, 69, 87]);
await withService(process.argv[2], async ({ wire, output }) => {
  const path = key => `/${bucket}/${key}`;
  const put = async (key, body) => { const result = await wire("PUT", path(key), { body }); assert.equal(result.status, 200, result.bodyText); return result.headers.etag; };
  const read = async key => { const result = await wire("GET", path(key)); return { status: result.status, bytes: result.bodyBase64 }; };
  const cases = [];
  const probe = async (id, method, key, options, expectedStatus, expectedBytes) => {
    const response = await wire(method, path(key), options);
    const actual = await read(key);
    const sourceAfter = await read("source");
    const preservedSource = sourceAfter.status === 200 && sourceAfter.bytes === source.toString("base64");
    const bytesMatch = actual.status === (expectedBytes === undefined ? 404 : 200)
      && (expectedBytes === undefined || actual.bytes === expectedBytes.toString("base64"));
    const passed = response.status === expectedStatus && bytesMatch && preservedSource;
    cases.push({ id, expectedStatus, actualStatus: response.status, expectedBytes: expectedBytes?.toString("base64"), actual, preservedSource, passed,
      requestSequence: response.sequence });
    save(join(output, "guards.json"), cases);
  };
  await put("source", source);
  const sourceTag = (await wire("HEAD", path("source"))).headers.etag;
  await probe("unsigned-read-denied", "GET", "source", { unsigned: true }, 403, source);
  await probe("wrong-signature-put-denied", "PUT", "source", { secret: "wrong-synthetic-secret", body: replacement }, 403, source);
  await put("put-match", target);
  await probe("put-ifmatch-stale", "PUT", "put-match", { headers: { "If-Match": '"stale"' }, body: replacement }, 412, target);
  const putTag = (await wire("HEAD", path("put-match"))).headers.etag;
  await probe("put-ifmatch-positive", "PUT", "put-match", { headers: { "If-Match": putTag }, body: replacement }, 200, replacement);
  await probe("put-ifmatch-missing", "PUT", "put-missing", { headers: { "If-Match": putTag }, body: replacement }, 404, undefined);
  await put("put-exclusive", target);
  await probe("put-ifnonematch-existing", "PUT", "put-exclusive", { headers: { "If-None-Match": "*" }, body: replacement }, 412, target);
  await probe("put-ifnonematch-missing", "PUT", "put-new", { headers: { "If-None-Match": "*" }, body: replacement }, 200, replacement);
  const copyHeaders = { "x-amz-copy-source": path("source") };
  await put("copy-source", target);
  await probe("copy-source-stale", "PUT", "copy-source", { headers: { ...copyHeaders, "x-amz-copy-source-if-match": '"stale"' } }, 412, target);
  await probe("copy-source-positive", "PUT", "copy-source", { headers: { ...copyHeaders, "x-amz-copy-source-if-match": sourceTag } }, 200, source);
  await put("copy-match", target);
  const copyTag = (await wire("HEAD", path("copy-match"))).headers.etag;
  await probe("copy-destination-stale", "PUT", "copy-match", { headers: { ...copyHeaders, "If-Match": '"stale"' } }, 412, target);
  await put("copy-match", target);
  await probe("copy-destination-positive", "PUT", "copy-match", { headers: { ...copyHeaders, "If-Match": copyTag } }, 200, source);
  await probe("copy-destination-missing", "PUT", "copy-missing", { headers: { ...copyHeaders, "If-Match": copyTag } }, 412, undefined);
  await put("copy-exclusive", target);
  await probe("copy-ifnonematch-existing", "PUT", "copy-exclusive", { headers: { ...copyHeaders, "If-None-Match": "*" } }, 412, target);
  await probe("copy-ifnonematch-missing", "PUT", "copy-new", { headers: { ...copyHeaders, "If-None-Match": "*" } }, 200, source);
  await put("delete-match", target);
  const deleteTag = (await wire("HEAD", path("delete-match"))).headers.etag;
  await probe("delete-ifmatch-stale", "DELETE", "delete-match", { headers: { "If-Match": '"stale"' } }, 412, target);
  await put("delete-match", target);
  await probe("delete-ifmatch-positive", "DELETE", "delete-match", { headers: { "If-Match": deleteTag } }, 204, undefined);
  await probe("delete-ifmatch-missing", "DELETE", "delete-missing", { headers: { "If-Match": deleteTag } }, 204, undefined);
  const all = prefix => cases.filter(entry => entry.id.startsWith(prefix)).every(entry => entry.passed);
  const profile = { conditionalPut: all("put-"), conditionalCopy: all("copy-"), conditionalDelete: all("delete-"),
    authentication: cases.slice(0, 2).every(entry => entry.passed), passed: cases.filter(entry => entry.passed).length, total: cases.length };
  save(join(output, "profile.json"), profile);
  console.log(JSON.stringify(profile));
  assert.ok(profile.authentication, "Actual SigV4 negative controls must reject");
  process.exitCode = cases.every(entry => entry.passed) ? 0 : 1;
});
