import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RustWasmBash } from "./index.js";

// Independent XlsxWriter workbook, then ElementTree reserialization with aliases
// and numeric character references. Openpyxl reads identical values in both.
const expected = [["Text", "Value"], ["café 🚀 & <tag>", " lead bold tail "]];
for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} rejects a missing worksheet relationship before export`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      await fs.writeFile("/input.xlsx", readFileSync(new URL("../tests/fixtures/missing-sheet-relationship.xlsx", import.meta.url)));
      for (const command of ["ssconvert /input.xlsx /output.csv", "pandoc -f xlsx -t json /input.xlsx -o /output.csv"]) {
        await fs.writeFile("/output.csv", new TextEncoder().encode("saved export"));
        const result = await shell.exec(command);
        assert.notEqual(result.exitCode, 0, command);
        assert.equal(Buffer.from(await fs.readFile("/output.csv")).toString(), "saved export");
      }
      if (runtime === "Rust") { assert.equal(shell._companion, null); assert.equal(shell.forceNative, true); }
    } finally { await shell.dispose(); }
  });
  for (const fixture of ["xml-text", "xml-prefixes"]) {
    test(`${runtime} XLSX ${fixture} preserves XML text in ssconvert and Pandoc`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
      const fs = memory ?? shell.fs;
      try {
        await fs.writeFile("/input.xlsx", readFileSync(new URL(`../tests/fixtures/${fixture}.xlsx`, import.meta.url)));
        const names = await shell.exec("in2csv --names /input.xlsx");
        assert.equal(names.exitCode, 0, names.stderr);
        assert.equal(names.stdout, "R&D 🚀\nSecond\n");
        const csv = await shell.exec("in2csv /input.xlsx");
        assert.equal(csv.exitCode, 0, csv.stderr);
        assert.equal(csv.stdout, "Text,Value\ncafé 🚀 & <tag>, lead bold tail \n");
        const converted = await shell.exec("ssconvert -S /input.xlsx /sheet-%n.csv");
        assert.equal(converted.exitCode, 0, converted.stderr);
        assert.equal(Buffer.from(await fs.readFile("/sheet-0.csv")).toString(), 'Text,Value\n"café 🚀 & <tag>"," lead bold tail "\n');
        assert.equal(Buffer.from(await fs.readFile("/sheet-1.csv")).toString(), '"second sheet"\n');
        const result = await shell.exec("pandoc -f xlsx -t json /input.xlsx -o /output.json");
        assert.equal(result.exitCode, 0, result.stderr);
        const tables = JSON.parse(Buffer.from(await fs.readFile("/output.json")).toString()).blocks.filter(block => block.t === "Table");
        const table = tables[0].c;
        const rows = [...table[3][1], ...table[4].flatMap(body => [...body[2], ...body[3]])];
        const values = rows.map(row => row[1].map(cell => cell[4].flatMap(block => block.c).map(inline => inline.t === "Space" ? " " : inline.c).join("")));
        assert.deepEqual(values, expected);
        if (runtime === "Rust") { assert.equal(shell._companion, null); assert.equal(shell.forceNative, true); }
      } finally { await shell.dispose(); }
    });
  }
}
