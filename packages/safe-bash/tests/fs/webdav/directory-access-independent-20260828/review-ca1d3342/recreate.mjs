import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { own, hash, inventory, unpack, restore, write, originalFreeze } from "./common.mjs";

const scratch = path.join(own, "scratch");
assert.ok(!fs.existsSync(scratch), "requires absent scratch; never overwrite evidence");
originalFreeze();
const composition = unpack(path.join(own, "composition.json.gz"));
const tools = JSON.parse(fs.readFileSync(path.join(own, "TOOLS.json")));
restore(composition.files, path.join(scratch, "composition"));
for (const [name, record] of Object.entries(tools)) {
  if (record.inventory) for (const [relative, expected] of Object.entries(record.inventory)) {
    const bytes = fs.readFileSync(path.join(record.origin, relative));
    assert.equal(hash(bytes), expected.sha256, "pinned tool missing or changed; no substitute/download");
    const target = path.join(scratch, "tools", name, relative);
    write(target, bytes); fs.chmodSync(target, expected.mode);
  } else {
    const bytes = fs.readFileSync(record.origin);
    assert.equal(hash(bytes), record.sha256);
    const target = path.join(scratch, "tools", name);
    write(target, bytes); fs.chmodSync(target, 0o755);
  }
}
for (const name of ["@types/node", "undici-types"]) {
  const source = path.join(scratch, "tools/node_modules", name);
  for (const [relative, expected] of Object.entries(inventory(source))) {
    const target = path.join(scratch, "composition/node_modules", name, relative);
    write(target, fs.readFileSync(path.join(source, relative))); fs.chmodSync(target, expected.mode);
  }
}
const freeze = unpack(path.join(own, "FROZEN-INPUTS.json.gz"));
for (const name of ["cases.mjs", "typed-inputs.ts"]) write(path.join(scratch, "fixtures", name), Buffer.from(freeze.files[name].base64, "base64"));
for (const name of ["home", "cache", "tmp", "artifacts"]) fs.mkdirSync(path.join(scratch, name), { recursive: true });
assert.deepEqual(inventory(scratch), unpack(path.join(own, "PREPARED-INVENTORY.json.gz")));
console.log("Reconstructed authenticated prepared inputs without Git source objects; no product executed.");
