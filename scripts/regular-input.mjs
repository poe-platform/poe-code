import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";

export function assertLiteralInputPath(path) {
  assert.equal(typeof path, "string", "input path must be a literal string");
  assert.ok(path.split("/").every(part => part !== "" && part !== "." && part !== ".."), `nonliteral input path: ${path}`);
  assert.ok(!["*", "?", "[", "]", "{", "}", "\\", "\n", "\r", "\0", "@(", "+(", "!("].some(character => path.includes(character)), `nonliteral input path: ${path}`);
}

export function readRegularInput(root, path, maximum, fileSystem = fs) {
  assertLiteralInputPath(path);
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
