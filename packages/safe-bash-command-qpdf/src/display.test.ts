import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosNumber } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli } from "./index.js";
import { displayNodeParts } from "./display.js";

it("matches native qpdf dictionary ordering through both public command paths", async () => {
  const input = readFileSync(new URL("./fixtures/compressed-pages.pdf", import.meta.url));
  const args = ["--show-object=1", "/in.pdf"];
  // Native qpdf 12.4.2 output for the checked-in fixture.
  const expected = "<< /Count 3 /Kids [ 4 0 R 5 0 R 6 0 R ] /Type /Pages >>\n";
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.pdf", input);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(stdout).toString(), expected);
  assert.equal(Buffer.concat(stderr).toString(), "");
  assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(input));
  const buffered = await runQpdfCli(args, new Map([["/in.pdf", input]]));
  assert.equal(buffered.exitCode, 0);
  assert.equal(buffered.stdout, expected);
  assert.equal(buffered.stderr, "");
});

it("sorts nested dictionary keys without changing stored entries", () => {
  const nested = cosDict({ z: cosNumber(1), a: cosNumber(2), Z: cosNumber(3), A: cosNumber(4) });
  const node = cosDict({ Z: nested, A: cosArray([nested]) });
  const original = structuredClone(node);
  assert.equal(Array.from(displayNodeParts(node)).join(""), "<< /A [ << /A 4 /Z 3 /a 2 /z 1 >> ] /Z << /A 4 /Z 3 /a 2 /z 1 >> >>");
  assert.deepEqual(node, original);
});
