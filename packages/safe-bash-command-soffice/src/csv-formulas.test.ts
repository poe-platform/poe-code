import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, readZipArchiveEntries, runSofficeCli, runSofficeCliSync } from "./index.js";

for (const route of ["command", "async", "sync"]) it(`${route} preserves CSV formulas and cached results`, async () => {
  const bytes = new TextEncoder().encode('Label,Value\nSum,=1+2\nRef,=B2*2\nForward,=B6+1\nText,ordinary text\nNumber,4\nQuoted,"=B2+1"\nString,"=""a&b"""\nBoolean,=1<2\nError,=1/0\nLiteral,not=a formula\n');
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
  for (const [cell, formula, type, value] of [
    ["B2", "1+2", "n", "3"], ["B3", "B2*2", "n", "6"], ["B4", "B6+1", "n", "5"],
    ["B7", "B2+1", "n", "4"], ["B8", '"a&amp;b"', "str", "a&amp;b"],
    ["B9", "1&lt;2", "b", "1"], ["B10", "1/0", "e", "#DIV/0!"]
  ]) assert.ok(xml.includes(`<c r="${cell}" t="${type}"><f>${formula}</f><v>${value}</v></c>`), xml);
  for (const [cell, value] of [["B5", "ordinary text"], ["B11", "not=a formula"]])
    assert.ok(xml.includes(`<c r="${cell}" t="inlineStr"><is><t>${value}</t></is></c>`), xml);
});

for (const run of [runSofficeCli, runSofficeCliSync]) it(`${run.name} keeps unevaluated formula expressions`, async () => {
  const files = new Map([["/input.csv", new TextEncoder().encode("Value\n=)\n")]]);
  const result = await run(["--convert-to", "xlsx", "/input.csv"], files);
  assert.equal(result.exitCode, 0);
  const xml = new TextDecoder().decode(readZipArchiveEntries(files.get("/input.xlsx")!).get("xl/worksheets/sheet1.xml")!);
  assert.ok(xml.includes('<c r="A2" t="n"><f>)</f></c>'), xml);
});
