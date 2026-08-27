import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Shell, agentCommands, createMemoryFileSystem } from "virtual-bash";
import { cases, environment } from "./original-cases.mjs";

const casesPath = fileURLToPath(new URL("./original-cases.mjs", import.meta.url));
const casesSha256 = createHash("sha256").update(await readFile(casesPath)).digest("hex");
assert.equal(casesSha256, process.env.EXPECTED_CASES_SHA256);
const specimen = cases.find(item => item.id === "tree-positive");
assert.ok(specimen);
const fs = createMemoryFileSystem();
await fs.mkdir("/fixture");
const directories = new Set(specimen.directories);
for (const path of Object.keys(specimen.files)) {
  let parent = dirname(path);
  while (parent !== ".") { directories.add(parent); parent = dirname(parent); }
}
for (const path of [...directories].sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right))) {
  await fs.mkdir(`/fixture/${path}`);
}
for (const [path, metadata] of Object.entries(specimen.files)) await fs.writeFile(`/fixture/${path}`, Buffer.from(metadata.base64, "base64"));
const shell = new Shell({ fs, cwd: specimen.cwd, env: { ...environment, ...specimen.env } }).use(agentCommands());
let actual;
try { actual = await shell.exec(specimen.script); }
finally { await shell.dispose(); }
const expected = {
  exitCode: specimen.expected.exitCode,
  stdout: Buffer.from(specimen.expected.stdoutBase64, "base64").toString(),
  stderr: Buffer.from(specimen.expected.stderrBase64, "base64").toString(),
};
assert.notDeepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
process.stdout.write(JSON.stringify({
  schema: 1, id: specimen.id, script: specimen.script, casesSha256,
  expected, actual: { exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
  expectedFailureObserved: true,
}, null, 2) + "\n");
