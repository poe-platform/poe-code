import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { frozenCases } from "./fixture.mjs";
import { verdict, syntheticState } from "./verdict.mjs";

const [kind, id, input] = process.argv.slice(2);
const receipt = { kind, id, boundaryReached: false, status: "running", checks: [] };
try {
  if (kind === "aggregate") {
    receipt.input = syntheticState(id);
    receipt.boundaryReached = true;
    receipt.verdict = verdict(receipt.input);
    process.exitCode = receipt.verdict.exitCode;
  } else if (kind === "cases") {
    receipt.boundaryReached = true;
    frozenCases(input);
  } else if (kind === "permission") {
    const paths = JSON.parse(input);
    receipt.boundaryReached = true;
    assert.equal(process.permission.has("fs.write", paths.emission), true);
    const emitted = join(paths.emission, "nested/canary.txt");
    mkdirSync(join(paths.emission, "nested"));
    writeFileSync(emitted, "owned emission\n", { flag: "wx" });
    assert.equal(readFileSync(emitted, "utf8"), "owned emission\n");
    receipt.checks.push({ name: "nested-emission", status: "pass", path: emitted });
    for (const filename of paths.deniedCanaries) {
      let failure;
      try { writeFileSync(filename, "DENIED CANARY\n"); } catch (error) { failure = error; }
      receipt.checks.push({ name: "negative-write", path: filename, code: failure?.code, permission: failure?.permission });
      assert.equal(failure?.code, "ERR_ACCESS_DENIED");
      assert.equal(failure?.permission, "FileSystemWrite");
    }
    for (const filename of paths.deniedBindings) {
      const allowed = process.permission.has("fs.write", filename);
      receipt.checks.push({ name: "write-permission-query", path: filename, allowed });
      assert.equal(allowed, false);
    }
  } else throw new Error(`Unknown probe: ${kind}`);
  receipt.status = "pass";
} catch (error) {
  receipt.status = "fail";
  receipt.error = { code: error.code, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify(receipt));
}
