import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url));

for (const path of ["sync", "buffered", "streaming"]) it(`emits native version 1 default sections (${path})`, async () => {
  const args = ["--json=1", "in.pdf"];
  let stdout: string;
  if (path === "streaming") {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const chunks: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} } });
    assert.equal(result.exitCode, 0);
    stdout = Buffer.concat(chunks).toString();
    assert.deepEqual(await fs.readdir("/scratch"), []);
  } else {
    const files = new Map([["in.pdf", input]]);
    const result = path === "sync" ? runQpdfCliSync(args, files) : await runQpdfCli(args, files);
    assert.equal(result.exitCode, 0); stdout = result.stdout;
  }
  const value = JSON.parse(stdout);
  assert.deepEqual(Object.keys(value).sort(), ["version", "parameters", "pages", "pagelabels", "acroform", "attachments", "encrypt", "outlines", "objects", "objectinfo"].sort());
  assert.equal(value.version, 1);
  assert.deepEqual(value.parameters, { decodelevel: "generalized" });
  // Native qpdf 12.4.2 page records for the shared-images fixture.
  const images = [1, 10, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({
    bitspercomponent: 8, colorspace: "/DeviceGray", decodeparms: [null], filter: [null], filterable: true,
    height: 50, name: `/Im${n}`, object: `${13 + 4 * n} 0 R`, width: 50
  }));
  assert.deepEqual(value.pages, [13, 19, 23, 27, 31, 35, 39, 43, 47, 51].map((content, index) => ({
    contents: [`${content} 0 R`], images, label: null, object: `${3 + index} 0 R`, outlines: [], pageposfrom1: index + 1
  })));
  assert.equal(Object.keys(value.objects).length, 55);
  assert.equal(Object.keys(value.objectinfo).length, 54);
  assert.deepEqual(value.objectinfo["1 0 R"], { stream: { filter: null, is: false, length: null } });
  assert.deepEqual(value.objectinfo["17 0 R"], { stream: { filter: null, is: true, length: 2500 } });
  assert.deepEqual(value.encrypt, {
    capabilities: { accessibility: true, extract: true, moddifyannotations: true, modify: true, modifyassembly: true, modifyforms: true, modifyother: true, printhigh: true, printlow: true },
    encrypted: false, ownerpasswordmatched: false,
    parameters: { P: 0, R: 0, V: 0, bits: 0, filemethod: "none", key: null, method: "none", streammethod: "none", stringmethod: "none" },
    recovereduserpassword: null, userpasswordmatched: false
  });
});

it("preserves explicit version 1 keys and object selectors", async () => {
  const result = await runQpdfCli(["--json=1", "--json-key=objectinfo", "--json-object=17", "in.pdf"], new Map([["in.pdf", input]]));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1, parameters: { decodelevel: "generalized" },
    objectinfo: { "17 0 R": { stream: { filter: null, is: true, length: 2500 } } }
  });
});
