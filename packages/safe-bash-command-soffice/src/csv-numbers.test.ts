import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, readZipArchiveEntries, runSofficeCli, runSofficeCliSync } from "./index.js";

for (const route of ["command", "async", "sync"]) it(`${route} imports CSV numbers as numeric XLSX cells and preserves text`, async () => {
  const rows = [
    ["Name", "Amount", "Date"], ["Alice", "42", "2026-01-02"], ["Bob", "1.5", "2026-05-06"],
    ["-12", "+3", ".5"], ["1e3", "-2.5E-2", "0"],
    ['"42"', '"1.5"', '"00123"'], ["", " ", "NaN"], ["Infinity", "0x10", "1e999"],
    ["1e", "1.2.3", '"He said ""42"""'],
    ["0".repeat(4095), "0".repeat(4096), '"' + "7".repeat(20000) + '"'], ["7", "8", "9"]
  ];
  const bytes = new TextEncoder().encode(rows.map(row => row.join(",")).join("\n"));
  const args = ["--headless", "--convert-to", "xlsx", "/input.csv"];
  const fs = new MemoryFileSystem(), files = new Map([["/input.csv", bytes]]);
  await fs.writeFile("/input.csv", bytes);
  const result = await (route === "command" ? createSofficeCommand().execute({
    command: "soffice", cwd: "/", env: {}, fs, ...createCommandArguments(args),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} }
  }) : (route === "sync" ? runSofficeCliSync : runSofficeCli)(args, files));
  assert.equal(result.exitCode, 0);
  const output = route === "command" ? await fs.readFile("/input.xlsx") : files.get("/input.xlsx")!;
  const xml = new TextDecoder().decode(readZipArchiveEntries(output).get("xl/worksheets/sheet1.xml")!);
  for (const [cell, value] of Object.entries({ B2: "42", B3: "1.5", A4: "-12", B4: "+3", C4: ".5", A5: "1e3", B5: "-2.5E-2", C5: "0", A10: "0".repeat(4095), A11: "7", B11: "8", C11: "9" })) {
    assert.ok(xml.includes(`<c r="${cell}" t="n"><v>${value}</v></c>`), `${cell} must be numeric: ${xml}`);
  }
  for (const [cell, value] of Object.entries({ A2: "Alice", A6: "42", B6: "1.5", C6: "00123", A7: "", B7: " ", C7: "NaN", A8: "Infinity", B8: "0x10", C8: "1e999", A9: "1e", B9: "1.2.3", C9: 'He said "42"', B10: "0".repeat(4096), C10: "7".repeat(20000) })) {
    assert.ok(xml.includes(`<c r="${cell}" t="inlineStr"><is><t>${value}</t></is></c>`), `${cell} must stay text: ${xml}`);
  }
});
