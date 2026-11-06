import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosStream, cosName, dictSet } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const flag of ["--json", "--json=2"]) it(`emits default version 2 document sections with ${flag} in both paths`, async () => {
  const doc = PdfDocument.create();
  for (let index = 0; index < 10; index++) doc.addPage();
  const input = doc.save(), args = [flag, "in.pdf"];
  const keys = ["pages", "pagelabels", "acroform", "attachments", "encrypt", "outlines", "qpdf"];
  const selected = await runQpdfCli([...args, ...keys.map(key => `--json-key=${key}`)], new Map([["in.pdf", input]]));
  assert.equal(selected.exitCode, 0);
  const buffered = await runQpdfCli(args, new Map([["in.pdf", input]]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const stdout: Uint8Array[] = [];
  const retained = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write() {} } });
  assert.equal(buffered.exitCode, 0); assert.equal(retained.exitCode, 0);
  for (const output of [buffered.stdout, Buffer.concat(stdout).toString()]) {
    const value = JSON.parse(output);
    assert.deepEqual(Object.keys(value).sort(), ["version", "parameters", ...keys].sort());
    assert.deepEqual(value, JSON.parse(selected.stdout));
    assert.equal(value.pages.length, 10);
    assert.deepEqual(value.pages.map((page: { pageposfrom1: number }) => page.pageposfrom1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(value.qpdf[0].jsonversion, 2);
    assert.equal(value.qpdf[0].pages, undefined);
  }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const version of [1, 2]) for (const keys of [["pages"], ["attachments"], ["outlines"], ["pagelabels"], ["acroform"], ["encrypt"], ["pages", "attachments", "pages"], ...(version === 1 ? [["objects"], ["objectinfo"]] : [["qpdf"]])]) {
  it(`selects JSON ${version} sections ${keys.join(",")} in both paths`, async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const stream = doc.cos.allocateObject(cosStream(new Uint8Array([1, 2, 3]), { compress: false }));
    const input = doc.save(), args = ["in.pdf", `--json=${version}`, ...keys.map(key => `--json-key=${key}`), "--json-stream-data=file", "--json-stream-prefix=stream-"];
    const files = new Map([["in.pdf", input]]), buffered = await runQpdfCli(args, files);
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const stdout: Uint8Array[] = [];
    const retained = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write() {} } });
    assert.equal(buffered.exitCode, 0); assert.equal(retained.exitCode, 0);
    for (const output of [buffered.stdout, Buffer.concat(stdout).toString()]) {
      const value = JSON.parse(output);
      assert.deepEqual(Object.keys(value).sort(), [...new Set(["version", "parameters", ...keys])].sort());
      assert.deepEqual(value.parameters, { decodelevel: "generalized" });
      if (keys.includes("pages")) { assert.equal(value.pages.length, 1); assert.equal(value.pages[0].pageposfrom1, 1); }
      if (keys.includes("objectinfo")) assert.deepEqual(value.objectinfo[`${stream.objectNumber} 0 R`], { stream: { filter: null, is: true, length: 3 } });
      if (keys.includes("qpdf")) assert.equal(value.qpdf[0].pdfversion, doc.cos.version);
    }
    assert.equal(Buffer.concat(stdout).toString(), buffered.stdout);
    if (!keys.includes("objects") && !keys.includes("qpdf")) {
      assert.equal(files.size, 1);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["in.pdf", "scratch"]);
    }
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}

for (const version of [1, 2]) it(`does not decode omitted JSON ${version} objects`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const stream = cosStream(new Uint8Array([1, 2, 3]), { compress: false });
  dictSet(stream.dict, "Filter", cosName("UnsupportedJsonFilter")); doc.cos.allocateObject(stream);
  const input = doc.save(), args = ["in.pdf", `--json=${version}`, "--json-key=pages", "--json-stream-data=inline"];
  const buffered = await runQpdfCli(args, new Map([["in.pdf", input]]));
  assert.equal(buffered.exitCode, 0);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const stdout: Uint8Array[] = [];
  const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write() {} } });
  assert.equal(result.exitCode, 0); assert.equal(Buffer.concat(stdout).toString(), buffered.stdout);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

// Native qpdf 2 JSON status for each selected section, including empty summaries.
for (const [key, calledgetallpages] of [["", false], ["pages", true], ["pagelabels", true], ["acroform", true], ["outlines", true], ["attachments", false], ["encrypt", false]] as const) {
  it(`matches native qpdf status flags with qpdf and ${key || "no other section"}`, async () => {
    const input = await readFile(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url));
    const args = ["--json=2", "--json-key=qpdf", ...(key ? [`--json-key=${key}`] : []), "in.pdf"];
    const buffered = await runQpdfCli(args, new Map([["in.pdf", input]]));
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const stdout: Uint8Array[] = [];
    const retained = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write() {} } });
    assert.equal(buffered.exitCode, 0); assert.equal(retained.exitCode, 0);
    for (const output of [buffered.stdout, Buffer.concat(stdout).toString()]) {
      assert.deepEqual(JSON.parse(output).qpdf[0], {
        jsonversion: 2, pdfversion: "1.3", pushedinheritedpageresources: false, calledgetallpages, maxobjectid: 54
      });
    }
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
