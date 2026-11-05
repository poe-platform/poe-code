import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { PdfDocument } from "@poe-code/pdf-ast";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const valid = readFileSync(new URL("./fixtures/linearized.pdf", import.meta.url));
const malformed = readFileSync(new URL("./fixtures/linearized-malformed.pdf", import.meta.url));
// Native qpdf 12.4.2 accepts linearized.pdf; the malformed fixture is
// safe-bash output that native qpdf rejects with offset and object-count warnings.
function replace(from: string, to: string): Buffer {
  assert.equal(from.length, to.length);
  const bytes = Buffer.from(valid), offset = bytes.indexOf(from); assert.ok(offset >= 0);
  bytes.write(to, offset); return bytes;
}
function corruptHint(offset: number, value: number): Buffer {
  const bytes = Buffer.from(valid), doc = PdfDocument.load(bytes);
  const stream = doc.cos.objects.get(11)!.value; assert.equal(stream.kind, "stream");
  if (stream.kind !== "stream") throw new Error("Missing hint stream");
  const decoded = inflateSync(stream.rawBytes); decoded.writeUInt32BE(value, offset);
  const encoded = deflateSync(decoded); assert.ok(encoded.length <= stream.rawBytes.length);
  const start = bytes.indexOf(stream.rawBytes); assert.ok(start >= 0);
  bytes.fill(0, start, start + stream.rawBytes.length); bytes.set(encoded, start);
  return bytes;
}
const cases = [
  ["valid native output", valid, false], ["malformed hints", malformed, true],
  ["xref offset", replace("/T 1885", "/T 1884"), true],
  ["first page end", replace("/E 1046", "/E 1000"), true],
  ["file length", replace("/L 2183", "/L 2182"), true],
  ["page count", replace("/N 3", "/N 2"), true],
  ["first page object", replace("/O 12", "/O 13"), true],
  ["missing hint stream", replace("/H [ 564", "/H [ 565"), true],
  ["hint object count", corruptHint(0, 0), true],
  ["hint page offset", corruptHint(4, 0), true],
  ["shared object count", corruptHint(48, 0), true],
  ["shared group length", corruptHint(58, 0), true],
] as const;
for (const retained of [false, true]) for (const flag of ["--check", "--check-linearization"]) for (const [name, input, warning] of cases) {
  it(`${flag} validates ${name} (retained=${retained})`, async () => {
    for (const warningExit0 of [false, true]) {
      const args = [flag, "in.pdf", ...(warningExit0 ? ["--warning-exit-0"] : [])];
      const results = [];
      if (retained) {
        const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
        const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
        const guarded = new Proxy(fs, { get(target, key) {
          if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
          stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
        results.push({ ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
        assert.deepEqual(await fs.readdir("/scratch"), []);
      } else results.push(await runQpdfCli(args, new Map([["in.pdf", input]])), runQpdfCliSync(args, new Map([["in.pdf", input]])));
      for (const result of results) {
        assert.equal(result.exitCode, warning && !warningExit0 ? 3 : 0, result.stderr);
        if (warning) { assert.match(result.stderr, /linearization/i); assert.doesNotMatch(result.stdout, /no linearization errors|No syntax or stream encoding errors/); }
        else assert.equal(result.stderr, "");
      }
    }
  });
}
