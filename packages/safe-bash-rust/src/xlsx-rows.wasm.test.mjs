import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RustWasmBash } from "./index.js";

// Written independently with XlsxWriter: B2, C5 and A6 contain their addresses.
// Openpyxl confirms that the leading and intervening rows remain empty.
const workbook = readFileSync(new URL("../tests/fixtures/sparse-rows.xlsx", import.meta.url));
const expected = [["", "", ""], ["", "B2", ""], ["", "", ""], ["", "", ""], ["", "", "C5"], ["A6", "", ""]];
for (const runtime of ["TypeScript", "Rust"]) {
for (const command of ["ssconvert", "pandoc", "in2csv"]) {
  test(`${runtime} ${command} XLSX conversion preserves sparse row coordinates`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs:memory}).use(agentCommands()) : new RustWasmBash({cwd:"/", forceNative:true});
    const fs = memory ?? shell.fs;
    try {
      await fs.writeFile("/input.xlsx", workbook);
      const result = await shell.exec(command === "ssconvert" ? "ssconvert /input.xlsx /output.csv" : command === "in2csv" ? "in2csv /input.xlsx > /output.csv" : "pandoc -f xlsx -t json /input.xlsx -o /output.csv");
      assert.equal(result.exitCode, 0, result.stderr);
      const output = Buffer.from(await fs.readFile("/output.csv")).toString();
      if (command === "ssconvert") assert.equal(output, expected.map(row => row.join(",") + "\n").join(""));
      else if (command === "in2csv") assert.equal(output, [["a", "b", "c"], ...expected.slice(1)].map(row => row.join(",") + "\n").join(""));
      else {
        const table = JSON.parse(output).blocks.find(block => block.t === "Table").c;
        const rows = [...table[3][1], ...table[4].flatMap(body => [...body[2], ...body[3]])];
        assert.deepEqual(rows.map(row => row[1].map(cell => cell[4].flatMap(block => block.c).map(inline => inline.c).join(""))), expected);
      }
      if (runtime === "Rust") { assert.equal(shell._companion, null); assert.equal(shell.forceNative, true); }
    } finally { await shell.dispose(); }
  });
}
}
