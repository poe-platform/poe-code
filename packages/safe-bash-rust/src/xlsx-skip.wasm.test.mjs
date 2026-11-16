import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// XlsxWriter 3.0.3 workbook, read back with openpyxl 3.0.10.
const bytes = readFileSync(new URL("../tests/fixtures/skip-rows.xlsx", import.meta.url));
const cases = [];
for (const skip of [0, 1, 3, 999]) for (const noHeader of [false, true]) for (const noInference of [false, true]) {
  const options = `--skip-lines ${skip}${noHeader ? " --no-header-row" : ""}${noInference ? " --no-inference" : ""}`;
  const expected = skip >= 3 ? "a,b\n" : skip === 1 ? `${noHeader ? "a,b\nA,B" : "A,B"}\nC,D\n`
    : `${noHeader ? "a,b\n" : ""}Left,Right\nA,B\nC,D\n`;
  cases.push([options, expected]);
}
cases.push(["--sheet Values --skip-lines 999 --linenumbers --add-bom", "\ufeffline_number,a,b\n"]);
cases.push(["--sheet Empty --skip-lines 999", "\n"]);
cases.push(["--sheet Empty --skip-lines 0 --no-header-row", "\n"]);
for (const runtime of ["TypeScript", "Rust"]) for (const [options, stdout] of cases) {
  test(`${runtime} XLSX skipped rows ${options}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      await fs.writeFile("/input.xlsx", bytes);
      const result = await shell.exec(`in2csv ${options} /input.xlsx`);
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
      assert.deepEqual(Buffer.from(await fs.readFile("/input.xlsx")), bytes);
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });
}
