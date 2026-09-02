import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { resolve } from "node:path";

export function planTestShards(files, weights, count, unknownWeightMs) {
  assert.ok(count === 1 || count === 4, "Bash supports one cohort or four shards");
  assert.ok(Array.isArray(files) && files.every(file => typeof file === "string" && file.length > 0), "Invalid discovered test paths");
  assert.equal(new Set(files).size, files.length, "Duplicate discovered test path");
  assert.ok(weights && typeof weights === "object" && !Array.isArray(weights), "Invalid duration weights");
  assert.ok(Number.isFinite(unknownWeightMs) && unknownWeightMs > 0, "Invalid unknown-file weight");
  for (const weight of Object.values(weights)) assert.ok(Number.isFinite(weight) && weight > 0, "Invalid duration weight");
  const weighted = files.map(file => ({ file, weight: Object.hasOwn(weights, file) ? weights[file] : unknownWeightMs }));
  weighted.sort((left, right) => right.weight - left.weight || (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
  const shards = Array.from({ length: count }, () => ({ files: [], estimatedMs: 0 }));
  for (const entry of weighted) {
    let selected = shards[0];
    for (const shard of shards) if (shard.estimatedMs < selected.estimatedMs) selected = shard;
    selected.files.push(entry.file);
    selected.estimatedMs += entry.weight;
    assert.ok(Number.isFinite(selected.estimatedMs), "Duration estimate overflow");
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

export function planTestPhases(root, files, concurrency, review, fileSystem = fs) {
  assert.ok(concurrency === 1 || concurrency === 2, "Bash file concurrency must be one or two");
  if (concurrency === 1) return files.length ? [{ concurrency: 1, files: [...files] }] : [];
  assert.equal(review.version, 1, "Unsupported parallel review version");
  assert.ok(review.files && typeof review.files === "object" && !Array.isArray(review.files), "Invalid parallel review");
  const parallel = [];
  const serial = [];
  for (const file of files) {
    const inputs = Object.hasOwn(review.files, file) ? review.files[file] : undefined;
    const reviewed = inputs && typeof inputs === "object" && !Array.isArray(inputs) && Object.hasOwn(inputs, file)
      && Object.entries(inputs).every(([path, expected]) => {
        if (!path.startsWith("tests/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) return false;
        try {
          const absolute = resolve(root, path);
          const stat = fileSystem.lstatSync(absolute);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return false;
          return createHash("sha256").update(fileSystem.readFileSync(absolute)).digest("hex") === expected;
        } catch {
          return false;
        }
      });
    (reviewed ? parallel : serial).push(file);
  }
  if (parallel.length < 2) return files.length ? [{ concurrency: 1, files: [...files] }] : [];
  return [
    ...(parallel.length ? [{ concurrency: 2, files: parallel }] : []),
    ...(serial.length ? [{ concurrency: 1, files: serial }] : []),
  ];
}

export function validateShardArguments(args) {
  const valued = ["--test-name-pattern", "--test-skip-pattern", "--test-reporter"];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (valued.some(flag => argument.startsWith(`${flag}=`))) continue;
    assert.ok(valued.includes(argument), `Unsupported argument with Bash scheduling: ${argument}`);
    index++;
    assert.ok(index < args.length && !args[index].startsWith("--"), `Missing value for ${argument}`);
  }
}
