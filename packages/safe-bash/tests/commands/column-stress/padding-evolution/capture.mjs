import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, constants, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scratch = process.argv[2];
assert.equal(process.argv.length, 3, "Usage: node capture.mjs /tmp/safe-bash-column-stress-prep-UNIQUE");
assert(/^\/(?:private\/)?tmp\/safe-bash-column-stress-prep-[A-Za-z0-9]+$/u.test(scratch));
const directory = fileURLToPath(new URL(".", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const legacyRunner = join(directory, "..", "capture-native.mjs");
assert.equal(hash(await readFile(legacyRunner)), "01f1cd28e16b61eda0b1dbc74d25aca64ed74b975c25835701cd2b033326f264");
const profiles = [
  ["bsd-darwin", "/usr/bin/column", "c6d7b469d8e8437c7185bedd356626ca69867c9c6b002cbb0020d995a6e4cc5f"],
  ["util-linux-2.41.2-darwin", "/tmp/safe-bash-column-stress-prep-Y7nUWq/util-linux-2.41.2/column", "a599976edf85eaa3222ac745309596023b5e63283a8b8ee3c3834d741214dd88"],
];
for (const [, executable, expectedHash] of profiles) {
  assert.equal(hash(await readFile(await realpath(executable))), expectedHash);
}
await copyFile(legacyRunner, join(scratch, "capture-native.mjs"), constants.COPYFILE_EXCL);
await copyFile(join(directory, "recipes.json"), join(scratch, "recipes.json"), constants.COPYFILE_EXCL);
const childArgs = [join(scratch, "capture-native.mjs"), "--scratch", scratch];
for (const [profile, executable] of profiles) childArgs.push("--native", `${profile}=${executable}`);
const child = spawn(process.execPath, childArgs, { stdio: "inherit" });
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (status, signal) => resolve({ status, signal }));
});
assert.equal(result.signal, null);
assert.equal(result.status, 0);
for (const [, executable, expectedHash] of profiles) {
  assert.equal(hash(await readFile(await realpath(executable))), expectedHash);
}
