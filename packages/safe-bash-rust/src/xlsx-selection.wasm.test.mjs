import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RustWasmBash } from "./index.js";

// Independently authored with XlsxWriter; openpyxl confirms Next steps is active.
const workbook = readFileSync(new URL("../tests/fixtures/selected-sheets.xlsx", import.meta.url));
const plan = "Item,Owner\nPrototype,Ada\n", next = "Step,Due\nShip,Friday\n";
const cases = [
  ["default active view", "", next],
  ["Unicode case folding", "-O sheet=STRASSE", "Unicode\n"],
  ["named sheet", "-O 'sheet=Plan'", plan],
  ["quoted case-insensitive name", `-O 'sheet="next STEPS"'`, next],
  ["active sheet ignores option value", "-O 'active-sheet=ignored'", next],
  ["missing sheet", "-O 'sheet=Missing'", null, 'ssconvert: Unknown sheet "Missing"\n'],
  ["multiple CSV sheets", "-O 'sheet=Plan sheet=Plan'", null, "Selected exporter (Gnumeric_stf:stf_csv) can only export one sheet at a time.\n"],
  ["invalid selection syntax", "-O 'sheet'", null, "ssconvert: Syntax error\n"],
  ["assistant preserves order and duplicates", "-T Gnumeric_stf:stf_assistant -O 'sheet=Plan active-sheet=ignored sheet=Plan'", plan + next + plan],
];
for (const runtime of ["TypeScript", "Rust"]) {
  for (const [name, options, expected, error] of cases) {
    test(`${runtime} ssconvert ${name}`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
      const fs = memory ?? shell.fs;
      try {
        await fs.writeFile("/input.xlsx", workbook);
        await fs.writeFile("/output.csv", new TextEncoder().encode("keep existing export"));
        const result = await shell.exec(`ssconvert ${options} /input.xlsx /output.csv`);
        assert.equal(result.exitCode, expected === null ? 1 : 0, result.stderr);
        assert.equal(result.stderr, error ?? "");
        assert.equal(Buffer.from(await fs.readFile("/output.csv")).toString(), expected ?? "keep existing export");
        if (runtime === "Rust") { assert.equal(shell._companion, null); assert.equal(shell.forceNative, true); }
      } finally { await shell.dispose(); }
    });
  }
  test(`${runtime} ssconvert validates every split selection before writing`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      await fs.writeFile("/input.xlsx", workbook);
      await fs.writeFile("/out-0.csv", new TextEncoder().encode("keep existing export"));
      const invalid = await shell.exec(`ssconvert -S -O 'sheet=Plan sheet=Missing' /input.xlsx /out-%n.csv`);
      assert.equal(invalid.exitCode, 1, invalid.stderr);
      assert.equal(Buffer.from(await fs.readFile("/out-0.csv")).toString(), "keep existing export");
      const valid = await shell.exec(`ssconvert -S -O 'sheet="Next steps" sheet=Plan sheet=Plan' /input.xlsx /out-%n.csv`);
      assert.equal(valid.exitCode, 0, valid.stderr);
      for (const [i, expected] of [next, plan, plan].entries()) assert.equal(Buffer.from(await fs.readFile(`/out-${i}.csv`)).toString(), expected);
      if (runtime === "Rust") { assert.equal(shell._companion, null); assert.equal(shell.forceNative, true); }
    } finally { await shell.dispose(); }
  });
  for (const extension of ["csv", "txt"]) {
    test(`${runtime} ssconvert merge respects ${extension} sheet scope`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
      const fs = memory ?? shell.fs;
      try {
        await fs.writeFile("/input.xlsx", workbook);
        const output = `/merged.${extension}`;
        const result = await shell.exec(`ssconvert --merge-to=${output} /input.xlsx /input.xlsx`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(Buffer.from(await fs.readFile(output)).toString(), extension === "csv" ? plan : (plan + next + "Unicode\n").repeat(2));
        const failed = await shell.exec(`ssconvert --merge-to=${output} -O sheet=Plan /input.xlsx /input.xlsx`);
        assert.equal(failed.exitCode, 1);
        assert.equal(failed.stderr, 'ssconvert: Unknown sheet "Plan"\n');
        assert.equal(Buffer.from(await fs.readFile(output)).toString(), extension === "csv" ? plan : (plan + next + "Unicode\n").repeat(2));
        if (runtime === "Rust") { assert.equal(shell._companion, null); assert.equal(shell.forceNative, true); }
      } finally { await shell.dispose(); }
    });
  }

}
