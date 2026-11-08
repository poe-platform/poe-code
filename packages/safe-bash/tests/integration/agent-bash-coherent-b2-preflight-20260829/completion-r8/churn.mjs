import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.argv[2];
assert.match(root, /^\/private\/tmp\/safe-bash-b2-r8-controls\/H0[12]\/cache$/);
const filename = path.join(root, "ephemeral");
for (let turn = 0; turn < 256; turn++) {
  fs.mkdirSync(filename);
  fs.writeFileSync(path.join(filename, "bytes"), Buffer.alloc(256, turn & 255), { flag: "wx" });
  await new Promise(resolve => setTimeout(resolve, 1));
  fs.unlinkSync(path.join(filename, "bytes")); fs.rmdirSync(filename);
  await new Promise(resolve => setTimeout(resolve, 1));
}
process.stdout.write("CHURN256\n");
