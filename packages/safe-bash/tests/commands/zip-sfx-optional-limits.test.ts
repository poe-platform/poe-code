import assert from "node:assert/strict";
import test from "node:test";
import { archiveBytes } from "./zip-standard-flags.helpers.js";
import { readZipSfx } from "../../src/commands/archive/zip/sfx.js";
import { settings } from "../../src/commands/archive/internal.js";

test("SFX scans more than 64 false candidates without an implicit candidate quota", async () => {
  const zip = await archiveBytes([{ name: "file", body: Buffer.from("content") }]);
  const prefix = Buffer.alloc(1 + 65 * 22);
  const input = Buffer.concat([prefix, zip]);
  for (let offset = 1; offset < prefix.length; offset += 22) {
    input.writeUInt32LE(0x06054b50, offset);
    input.writeUInt32LE(1, offset + 16);
    input.writeUInt16LE(input.length - offset - 22, offset + 20);
  }
  const signal = new AbortController().signal;
  for (const limits of [settings({}), settings({ limits: { maxMembers: 1 } })]) {
    const result = await readZipSfx(input, limits, signal);
    assert.deepEqual(result.entries.map(entry => entry.name), ["file"]);
  }
  await assert.rejects(readZipSfx(input, settings({ limits: { maxPatternSteps: 30 } }), signal), /scan work limit exceeded/);
});
