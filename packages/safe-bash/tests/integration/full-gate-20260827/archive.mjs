import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { hash, repository } from "./inspect.mjs";

const scope = "tests/integration/full-gate-20260827/evidence";
const paths = [["/tmp/full-gate-e36dab2-first", "first"], ["/tmp/full-gate-e36dab2-recheck", "recheck"], ["/tmp/full-gate-e36dab2-native", "native"]];
const entries = [], additions = [];
for (const [root, label] of paths) {
  const visit = directory => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) { visit(path); continue; }
      assert.ok(stat.isFile()); const bytes = readFileSync(path), text = bytes.toString("utf8");
      const encoded = !Buffer.from(text).equals(bytes) || (bytes.length > 0 && !text.endsWith("\n"));
      const target = join(scope, label, relative(root, path) + (encoded ? ".bytes.base64" : ""));
      assert.equal(existsSync(join(repository, target)), false, "Preserve prior capture: " + target);
      const content = encoded ? bytes.toString("base64") + "\n" : text;
      additions.push({ target, content, bytes, encoded });
      entries.push({ original: path, archived: target, encoding: encoded ? "base64" : "raw", bytes: bytes.length, sha256: hash(bytes) });
    }
  };
  visit(root);
}
const manifest = join(scope, "capture-manifest.json");
assert.equal(existsSync(join(repository, manifest)), false);
additions.push({ target: manifest, content: JSON.stringify({ capturedAt: new Date().toISOString(), entries }, null, 2) + "\n" });
for (const { target, content, bytes, encoded } of additions) {
  const lines = content.length ? content.slice(0, -1).split("\n").map(line => "+" + line).join("\n") + "\n" : "";
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${target}\n${lines}*** End Patch\n`, maxBuffer: 1024 * 1024 });
  const written = readFileSync(join(repository, target));
  if (bytes) assert.deepEqual(encoded ? Buffer.from(written.toString().trim(), "base64") : written, bytes, target);
  else assert.equal(written.toString(), content);
}
console.log(JSON.stringify({ files: entries.length, originalBytes: entries.reduce((total, entry) => total + entry.bytes, 0), allRoundtripsEqual: true }, null, 2));
