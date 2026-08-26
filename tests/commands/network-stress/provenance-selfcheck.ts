import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadEvidence } from "./evidence.js";
import { originalRevision, validateSourceRevision } from "./source-gate.js";

await loadEvidence();
const source = await validateSourceRevision();
const owned = "tests/commands/network-stress";
const read = (name: string) => readFile(`${owned}/${name}`, "utf8");
const originalLab = await read("lab.ts");
const expectedLab = originalLab.replace('import assert from "node:assert/strict";', 'import assert from "node:assert/strict";\nimport { closeResources } from "./close-resources.js";')
  .replace('      for (const socket of sockets) socket.destroy();\n      await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));\n      assert.equal(sockets.size, 0, "Fixture socket cleanup incomplete");', '      await closeResources(servers, sockets);');
assert.equal(await read("lab-v2.ts"), expectedLab, "Only the reviewed cleanup delta is allowed");
const product = await read("product.ts");
const expectedProduct = 'import { validateSourceRevision } from "./source-gate.js";\n' + product.replace('from "./lab.js"', 'from "./lab-v2.js"').replace('const publicEntry =', 'await validateSourceRevision();\n  const publicEntry =');
assert.equal(await read("product-v2.ts"), expectedProduct, "All original rows and assertions are unchanged");
const supplement = await read("supplement.ts");
const expectedSupplement = 'import { validateSourceRevision } from "./source-gate.js";\n' + supplement.replace('  api = await import(', '  await validateSourceRevision();\n  api = await import(');
assert.equal(await read("supplement-v2.ts"), expectedSupplement, "Supplement assertions and original source checks are unchanged");
const previous = process.env.CURL_VERIFY_SOURCE_REVISION;
try {
  process.env.CURL_VERIFY_SOURCE_REVISION = "HEAD";
  await assert.rejects(validateSourceRevision(), /explicit full committed source revision/);
  process.env.CURL_VERIFY_SOURCE_REVISION = originalRevision;
  await assert.rejects(validateSourceRevision(), /Network source differs from revision/);
} finally {
  if (previous === undefined) delete process.env.CURL_VERIFY_SOURCE_REVISION;
  else process.env.CURL_VERIFY_SOURCE_REVISION = previous;
}
assert.deepEqual(await validateSourceRevision(), source);
process.stdout.write(`${JSON.stringify({ source, productExecutions: 0, wrapperChecks: 3, sourceGateChecks: 3, passed: 6, failed: 0 })}\n`);
