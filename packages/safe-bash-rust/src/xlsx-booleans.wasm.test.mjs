import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RustWasmBash } from "./index.js";

const expected = [["Boolean", "Literal"], ["TRUE", "True"], ["FALSE", "False"], ["TRUE", "true"], ["FALSE", "false"]];
const header = "Boolean,Mixed,Nullable,CustomNull,Blank,Case,EmptyText\n";
// XlsxWriter 3.0.3 fixture, independently read back with openpyxl 3.0.10.
for (const runtime of ["TypeScript", "Rust"]) for (const [options, rows, heading = header] of [
  ["", "True,true,True,true,True,True,True\nFalse,ordinary,,MISSING,,False,\nTrue,false,False,false,False,True,False\nFalse,TRUE,,true,True,False,True\n"],
  ["--no-inference", "True,true,true,true,true, TRUE ,true\nFalse,ordinary,,MISSING,,false,\nTrue,false,false,false,false,yes,false\nFalse,TRUE,,true,true,no,true\n"],
  ["--blanks", "True,true,true,true,True,True,true\nFalse,ordinary,null,MISSING,,False,\nTrue,false,false,false,False,True,false\nFalse,TRUE,NA,true,True,False,true\n"],
  ["--null-value MISSING", "True,true,True,True,True,True,True\nFalse,ordinary,,,,False,\nTrue,false,False,False,False,True,False\nFalse,TRUE,,True,True,False,True\n"],
  ["--no-inference --blanks", "True,true,true,true,true, TRUE ,true\nFalse,ordinary,null,MISSING,,false,\nTrue,false,false,false,false,yes,false\nFalse,TRUE,NA,true,true,no,true\n"],
  ["--skip-lines 1 --no-header-row --blanks", "True,true,true,true,True,True,true\nFalse,ordinary,null,MISSING,,False,\nTrue,false,false,false,False,True,false\nFalse,TRUE,NA,true,True,False,true\n", "a,b,c,d,e,f,g\n"],
]) test(`${runtime} in2csv XLSX column inference ${options}`, {skip: !WebAssembly.Suspending}, async () => {
  const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
  const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
  try {
    const fs = memory ?? shell.fs;
    await fs.writeFile("/input.xlsx", readFileSync(new URL("../tests/fixtures/boolean-inference.xlsx", import.meta.url)));
    const result = await shell.exec(`in2csv ${options} -- /input.xlsx`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, heading + rows);
    if (runtime === "Rust") {assert.equal(shell._companion, null); assert.equal(shell.forceNative, true);}
  } finally {await shell.dispose();}
});
for (const runtime of ["TypeScript", "Rust"]) {
  for (const command of ["ssconvert", "pandoc", "in2csv"]) {
    test(`${runtime} ${command} formats XLSX booleans without changing literal strings`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
      const fs = memory ?? shell.fs;
      try {
        await fs.writeFile("/input.xlsx", readFileSync(new URL("../tests/fixtures/typed-booleans.xlsx", import.meta.url)));
        const result = await shell.exec(command === "ssconvert" ? "ssconvert /input.xlsx /output.csv" : command === "in2csv" ? "in2csv --no-inference /input.xlsx > /output.csv" : "pandoc -f xlsx -t json /input.xlsx -o /output.csv");
        assert.equal(result.exitCode, 0, result.stderr);
        const output = Buffer.from(await fs.readFile("/output.csv")).toString();
        if (command === "ssconvert") assert.equal(output, expected.map(row => row.join(",") + "\n").join(""));
        else if (command === "in2csv") assert.equal(output, expected.map((row, i) => (i ? [row[0][0] + row[0].slice(1).toLowerCase(), row[1]] : row).join(",") + "\n").join(""));
        else {
          const table = JSON.parse(output).blocks.find(block => block.t === "Table").c;
          const rows = [...table[3][1], ...table[4].flatMap(body => [...body[2], ...body[3]])];
          assert.deepEqual(rows.map(row => row[1].map(cell => cell[4].flatMap(block => block.c).map(inline => inline.c).join(""))), expected.map((row, i) => i ? [row[0].toLowerCase(), row[1]] : row));
        }
        if (runtime === "Rust") { assert.equal(shell._companion, null); assert.equal(shell.forceNative, true); }
      } finally { await shell.dispose(); }
    });
  }
}
