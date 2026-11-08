import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = "/tmp/safe-bash-webdav-consumer-types-zz3ea1";
const source = "/tmp/safe-bash-webdav-public-consumer-ZevNbp/archive";
const declaration = "dist/fs/webdav/webdav.d.ts";
const original = readFileSync(join(source, declaration), "utf8");
const line = original.split("\n").find(value => value.includes("readonly compareEntry?:"));
assert.ok(line);
const changes = [
  ["required-callback", line.replace("compareEntry?:", "compareEntry:")],
  ["wrong-receiver", line.replace("this: FileSystem", "this: number")],
  ["wrong-result", line.replace('ReturnType<NonNullable<FileSystem["compareEntry"]>>', 'Promise<"different">')],
];
for (const [name, replacement] of changes) {
  const folder = join(root, name);
  mkdirSync(folder);
  cpSync(join(source, "dist"), join(folder, "dist"), { recursive: true });
  cpSync(join(source, "package.json"), join(folder, "package.json"));
  cpSync(join(source, "tests/fs/webdav/consumer/types.mts"), join(folder, "types.mts"));
  symlinkSync("/Users/kjopek/Workspace/safe-bash/node_modules", join(folder, "node_modules"));
  execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Update File: ${join(folder, declaration)}\n@@\n-${line}\n+${replacement}\n*** End Patch\n` });
  const args = ["node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--target", "ES2023", "--exactOptionalPropertyTypes", "types.mts"];
  const result = spawnSync(process.execPath, args, { cwd: folder, encoding: "utf8" });
  writeFileSync(join(root, name + ".json"), JSON.stringify({ args, declarationBefore: line, declarationAfter: replacement,
    status: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2) + "\n");
  assert.equal(result.status, 2);
  assert.match(result.stdout, /types\.mts\(.*error TS2344/);
  console.log(name, "rejected by public type assertions");
}
