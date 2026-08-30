import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageResolution, runChecks } from "./original-service-checks.mjs";

const [binary, tooling, evidence] = process.argv.slice(2);
const save = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const modules = Object.entries(packageResolution).map(([name, url]) => {
  assert.ok(url.startsWith(process.env.INDEPENDENT_PACKAGE_URL));
  return { name, url, sha256: createHash("sha256").update(readFileSync(fileURLToPath(url))).digest("hex") };
});
save("service-runtime-resolution.json", { modules, checksSha256: createHash("sha256").update(readFileSync(new URL("./original-service-checks.mjs", import.meta.url))).digest("hex") });
const harness = await import(pathToFileURL(join(tooling, "service.mjs")).href);
await harness.withService(binary, async service => {
  await runChecks(service);
  const original = JSON.parse(readFileSync(join(service.output, "results.json")));
  assert.equal(original.results.length, 20);
  assert.equal(original.results.filter(result => result.passed).length, 20);
  assert.equal(original.positivePublicWorkflows, 4);
  save("service-observations.json", { output: service.output, independentlyExecuted: true, originalMetadataUnchanged: true,
    categories: Object.fromEntries([...new Set(original.results.map(result => result.kind))].map(kind =>
      [kind, original.results.filter(result => result.kind === kind).length])), results: original.results });
  const prefix = "independent-wire/target/";
  const markerPath = `/${service.bucket}/${prefix}`;
  const childPath = markerPath + ".hidden";
  const payload = Buffer.from([0, 255, 128, 10]);
  assert.equal((await service.wire("PUT", markerPath, { body: Buffer.alloc(0) })).status, 200);
  assert.equal((await service.wire("PUT", childPath, { body: payload })).status, 200);
  const observations = [];
  for (const delimiter of [undefined, "/"]) {
    for (const maxKeys of [1, 2, 1000]) {
      const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": String(maxKeys) });
      if (delimiter !== undefined) query.set("delimiter", delimiter);
      const response = await service.wire("GET", `/${service.bucket}?${query}`);
      assert.equal(response.status, 200);
      const keys = [...response.bodyText.matchAll(/<Key>(.*?)<\/Key>/g)].map(match => match[1]);
      const truncated = /<IsTruncated>(.*?)<\/IsTruncated>/.exec(response.bodyText)?.[1];
      const token = /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(response.bodyText)?.[1];
      assert.deepEqual(keys, maxKeys === 1 ? [prefix] : [prefix, prefix + ".hidden"]);
      assert.equal(truncated, "false");
      assert.equal(token, undefined);
      observations.push({ maxKeys, delimiter: delimiter ?? null, sequence: response.sequence, keys, truncated, token: token ?? null,
        classification: maxKeys === 1 ? "pinned false-completion deviation" : "bounded shortcut bypass" });
    }
  }
  const marker = await service.wire("GET", markerPath);
  const child = await service.wire("GET", childPath);
  assert.equal(marker.status, 200);
  assert.equal(marker.body.length, 0);
  assert.equal(child.status, 200);
  assert.deepEqual(child.body, payload);
  save("wire-shortcut.json", { observations, markerSequence: marker.sequence, childSequence: child.sequence,
    childBase64: child.bodyBase64, serviceSource: harness.lock.sourceCommit, noNativeDeleteInThisProbe: true });
});
