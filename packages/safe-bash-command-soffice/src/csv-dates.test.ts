import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, readZipArchiveEntries, runSofficeCli, runSofficeCliSync } from "./index.js";

const source = "Name,Amount,Date\nAlice,42,2026-01-02\nBob,1.5,2026-05-06\nLeap,0,2024-02-29\nInvalid,0,2026-02-29\nAmbiguous,0,01/02/2026\nEarly,0,1900-01-01\nMarch,0,1900-03-01\nFake,0,1900-02-29\nText,0,2026-01-02suffix\n";
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const mode of ["command", "buffered", "async"]) test(`CSV dates become styled numeric XLSX cells (${mode})`, async () => {
  const files = new Map<string, Uint8Array>([["/input.csv", encode(source)]]);
  if (mode === "command") {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.csv", encode(source));
    const result = await createSofficeCommand().execute({
      command: "soffice", cwd: "/", env: {}, fs,
      ...createCommandArguments(["--headless", "--convert-to", "xlsx", "/input.csv"]),
      signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write() {} }, stderr: { async write() {} }
    });
    assert.equal(result.exitCode, 0);
    files.set("/input.xlsx", await fs.readFile("/input.xlsx"));
  } else {
    const result = await (mode === "buffered" ? runSofficeCliSync : runSofficeCli)(["--convert-to", "xlsx", "/input.csv"], files);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  const entries = readZipArchiveEntries(files.get("/input.xlsx")!);
  const sheet = decode(entries.get("xl/worksheets/sheet1.xml")!);
  for (const [row, value] of [[2, 46024], [3, 46148], [4, 45351], [7, 1], [8, 61]]) {
    assert.ok(sheet.includes(`<c r="C${row}" s="1" t="n"><v>${value}</v></c>`), sheet);
  }
  for (const [row, value] of [[5, "2026-02-29"], [6, "01/02/2026"], [9, "1900-02-29"], [10, "2026-01-02suffix"]]) {
    assert.ok(sheet.includes(`<c r="C${row}" t="inlineStr"><is><t>${value}</t></is></c>`));
  }
  const styles = decode(entries.get("xl/styles.xml")!);
  assert.ok(styles.includes('formatCode="yyyy-mm-dd"'));
  assert.ok(styles.includes('<xf numFmtId="164"'));
  assert.ok(decode(entries.get("xl/_rels/workbook.xml.rels")!).includes('Target="styles.xml"'));
  assert.ok(decode(entries.get("[Content_Types].xml")!).includes('PartName="/xl/styles.xml"'));
  const restored = await runSofficeCli(["--convert-to", "csv", "/input.xlsx"], files);
  assert.equal(restored.exitCode, 0, restored.stderr);
  assert.equal(decode(files.get("/input.csv")!), source);
});
