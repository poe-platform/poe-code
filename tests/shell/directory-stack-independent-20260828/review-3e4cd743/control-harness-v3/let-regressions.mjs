import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const admission = JSON.parse(readFileSync(process.env.DS_ADMISSION));
const api = await import(pathToFileURL(admission.publicEntry).href);
const rows = JSON.parse(readFileSync(admission.regressionManifest)).let.rows;
const results = [];
for (const row of rows) {
  const fs = api.createMemoryFileSystem(); await fs.mkdir("/work");
  const shell = new api.Shell({ fs, cwd: "/work" }).use(api.agentCommands());
  try {
    const result = await shell.exec(row.script);
    assert.equal(result.stdout, row.stdout); assert.equal(result.stderr, row.stderr); assert.equal(result.exitCode, row.exitCode);
    results.push({ id: row.id, status: "pass", result });
  } catch (error) { results.push({ id: row.id, status: "assertion-failure", error: { name: error?.name, message: error?.message, actual: error?.actual, expected: error?.expected } }); }
  finally { await shell.dispose(); }
}
process.stdout.write(JSON.stringify(results) + "\n");
if (results.some(row => row.status !== "pass")) process.exitCode = 1;
