import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RustWasmBash } from "./index.js";

const original = readFileSync(new URL("../tests/fixtures/xml-prefixes.xlsx", import.meta.url));
const crc = Buffer.from(original);
const central = crc.indexOf(Buffer.from("PK\x01\x02"));
let shared;
for (let record = central; crc.readUInt32LE(record) === 0x02014b50;) {
  const nameLength = crc.readUInt16LE(record + 28), extraLength = crc.readUInt16LE(record + 30), commentLength = crc.readUInt16LE(record + 32);
  if (crc.subarray(record + 46, record + 46 + nameLength).toString() === "xl/sharedStrings.xml") { shared = record; break; }
  record += 46 + nameLength + extraLength + commentLength;
}
assert.notEqual(shared, undefined);
const local = crc.readUInt32LE(shared + 42);
crc[shared + 16] ^= 1;
crc[local + 14] ^= 1;
const inputs = [
  ["missing end record", original.subarray(0, original.length - 22)],
  ["missing central directory", original.subarray(0, central)],
  ["corrupt CRC", crc],
  ["streamed workbook", readFileSync(new URL("../tests/fixtures/streamed-workbook.xlsx", import.meta.url))],
];
for (const runtime of ["TypeScript", "Rust"]) {
  for (const [name, bytes] of inputs) {
    test(`${runtime} XLSX archive: ${name}`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
      const fs = memory ?? shell.fs;
      const valid = name === "streamed workbook";
      try {
        await fs.writeFile("/input.xlsx", bytes);
        for (const command of ["ssconvert /input.xlsx /output.csv", "pandoc -f xlsx -t json /input.xlsx -o /output.csv", "in2csv /input.xlsx"]) {
          await fs.writeFile("/output.csv", new TextEncoder().encode("saved export"));
          const result = await shell.exec(command);
          if (valid) {
            assert.equal(result.exitCode, 0, result.stderr);
            const output = command.startsWith("in2csv") ? result.stdout : Buffer.from(await fs.readFile("/output.csv")).toString();
            assert.ok(output.includes("café"), command);
          } else {
            assert.notEqual(result.exitCode, 0, command);
            assert.equal(Buffer.from(await fs.readFile("/output.csv")).toString(), "saved export");
          }
        }
        if (runtime === "Rust") { assert.equal(shell._companion, null); assert.equal(shell.forceNative, true); }
      } finally { await shell.dispose(); }
    });
  }
}
