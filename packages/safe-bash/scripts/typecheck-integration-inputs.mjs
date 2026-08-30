import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { join, posix } from "node:path";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function assertLiteralInputPath(path) {
  assert.equal(typeof path, "string", "input path must be a literal string");
  assert.ok(path.split("/").every(part => part !== "" && part !== "." && part !== ".."), `nonliteral input path: ${path}`);
  assert.ok(!["*", "?", "[", "]", "{", "}", "\\", "\n", "\r", "\0", "@(", "+(", "!("].some(character => path.includes(character)), `nonliteral input path: ${path}`);
}

export function isHeldInputPath(path, boundaries) {
  assertLiteralInputPath(path);
  const folded = path.toLowerCase();
  const held = [...boundaries.heldEvidenceDirectories, ...boundaries.heldSourceFiles.map(file => posix.dirname(file))];
  const directory = held.find(directory => folded === directory.toLowerCase() || folded.startsWith(`${directory.toLowerCase()}/`));
  if (!directory) return false;
  assert.equal(path.slice(0, directory.length), directory, `case alias of held type-input path: ${path}`);
  return true;
}

export function assertAdmittedInputPath(path, boundaries) {
  assert.ok(!isHeldInputPath(path, boundaries), `held type-input path: ${path}`);
}

export function readRegularInput(root, path, maximum, fileSystem = fs, boundaries) {
  if (boundaries) assertAdmittedInputPath(path, boundaries);
  else assertLiteralInputPath(path);
  if (fileSystem.readAdmittedInput !== undefined) {
    assert.equal(typeof fileSystem.readAdmittedInput, "function", "invalid guarded read capability");
    return fileSystem.readAdmittedInput(root + (root.endsWith("/") ? "" : "/") + path, maximum);
  }
  const parts = path.split("/");
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    assert.ok(fileSystem.readdirSync(directory).includes(part), `nonliteral type-input directory: ${path}`);
    directory = join(directory, part);
    assert.ok(fileSystem.lstatSync(directory).isDirectory(), `type-input ancestor must be a regular directory: ${path}`);
  }
  assert.ok(fileSystem.readdirSync(directory).includes(parts.at(-1)), `nonliteral type-input filename: ${path}`);
  const absolute = join(root, path);
  const stat = fileSystem.lstatSync(absolute);
  assert.ok(stat.isFile() && stat.size <= maximum, `unadmitted type-input file or size: ${path}`);
  return fileSystem.readFileSync(absolute);
}

function literal(path, boundaries) {
  assertAdmittedInputPath(path, boundaries);
  const parts = path.split("/");
  assert.ok(path.startsWith("tests/") && parts.length >= 3, `nonliteral type-input path: ${path}`);
}

export function readIntegrationTypeInputs(root, boundaries, fileSystem = fs) {
  const data = JSON.parse(readRegularInput(root, "integration-type-inputs.json", 100000, fileSystem, boundaries));
  assert.equal(data.version, 1);
  assert.ok(Array.isArray(data.cohorts));
  const entries = [];
  for (const cohort of data.cohorts) {
    assert.ok(typeof cohort.name === "string" && typeof cohort.reason === "string" && cohort.reason.length > 0);
    literal(cohort.owner.path, boundaries);
    assert.ok(cohort.owner.path.endsWith(".json"));
    assert.ok(Array.isArray(cohort.entries));
    for (const entry of cohort.entries) {
      literal(entry.path, boundaries);
      assert.ok((entry.path.endsWith(".ts") || entry.path.endsWith(".mts")) && !entry.path.endsWith(".test.ts"), `maintained tests cannot be captured type data: ${entry.path}`);
    }
    const ownerBytes = readRegularInput(root, cohort.owner.path, 1048576, fileSystem, boundaries);
    assert.equal(ownerBytes.length, cohort.owner.bytes, `owner size changed: ${cohort.owner.path}`);
    assert.equal(sha256(ownerBytes), cohort.owner.sha256, `owner changed: ${cohort.owner.path}`);
    const owner = JSON.parse(ownerBytes);
    assert.ok([null, "inputs", "fixtures", "finalCensus"].includes(cohort.owner.members));
    const members = cohort.owner.members === null ? owner : owner[cohort.owner.members];
    assert.ok(Array.isArray(members));
    for (const entry of cohort.entries) {
      const records = members.filter(member => member.path === entry.ownerPath);
      assert.equal(records.length, 1, `missing or ambiguous owning record: ${entry.path}`);
      assert.equal(records[0].sha256, entry.sha256, `owner does not bind fixture: ${entry.path}`);
      const bytes = readRegularInput(root, entry.path, 50000, fileSystem, boundaries);
      assert.equal(bytes.length, entry.bytes, `fixture size changed: ${entry.path}`);
      assert.equal(sha256(bytes), entry.sha256, `fixture changed: ${entry.path}`);
      entries.push({ path: entry.path, classification: "frozen-evidence", sha256: entry.sha256, owner: cohort.owner.path });
    }
  }
  assert.equal(new Set(entries.map(entry => entry.path)).size, entries.length, "duplicate type-input classification");
  return {
    entries,
    standaloneEntries: entries.filter(entry => entry.path.endsWith(".mts")),
    capturedPaths: entries.filter(entry => entry.path.endsWith(".ts")).map(entry => entry.path),
    cohorts: data.cohorts.map(cohort => ({ name: cohort.name, reason: cohort.reason, owner: cohort.owner, count: cohort.entries.length })),
  };
}
