import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createExiftoolCommand } from "./index.js";

const decoder = new TextDecoder();

async function invoke(args: string[], fs = createMemoryFileSystem()) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const res = await createExiftoolCommand().execute({ command: "exiftool",
    args,
    cwd: "/",
    env: {},
    fs,
    signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(b: Uint8Array) { stdout.push(new Uint8Array(b)); } },
    stderr: { async write(b: Uint8Array) { stderr.push(new Uint8Array(b)); } },
  });
  const join = (arr: Uint8Array[]) => {
    const len = arr.reduce((s, c) => s + c.byteLength, 0);
    const out = new Uint8Array(len);
    let p = 0;
    for (const c of arr) { out.set(c, p); p += c.byteLength; }
    return decoder.decode(out);
  };
  return { exitCode: res.exitCode, stdout: join(stdout), stderr: join(stderr), fs };
}

test("PDF Creator prefers embedded PostScript metadata", async () => {
  const fixture = await readFile(new URL("../../pdf-ast/src/fixtures/pdfjs-cmykjpeg.pdf", import.meta.url));
  const fs = createMemoryFileSystem();
  await fs.writeFile("/illustrator.pdf", fixture);
  const result = await invoke(["-j", "-s", "-n", "-Creator", "illustrator.pdf"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { SourceFile: "illustrator.pdf", Creator: "Adobe Illustrator(R) 15.0" },
  ]);
  for (const write of [false, true]) {
    if (write) {
      const updated = await invoke(["-overwrite_original", "-Title=Updated", "illustrator.pdf"], fs);
      assert.equal(updated.exitCode, 0, updated.stderr);
    }
    const grouped = await invoke(["-a", "-G1", "-s", "-Creator", "illustrator.pdf"], fs);
    assert.equal(grouped.exitCode, 0, grouped.stderr);
    const lines = grouped.stdout.split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.ok(lines.some(line => line.startsWith("[PDF]") && line.endsWith("Adobe Illustrator CS5.1")));
    assert.ok(lines.some(line => line.startsWith("[PostScript]") && line.endsWith("Adobe Illustrator(R) 15.0")));
  }
});

for (const stream of ["", "%%Creator: Unrelated text\n", "%!PS-Adobe-3.0\n%%Title: No creator\n"]) {
  test(`PDF Creator remains unchanged without PostScript Creator: ${stream}`, async () => {
    const fs = createMemoryFileSystem();
    const pdf = `%PDF-1.7
1 0 obj
<< /Creator (PDF creator) >>
endobj
2 0 obj
<< /Length ${stream.length} >>
stream
${stream}endstream
endobj
trailer
<< /Info 1 0 R >>
%%EOF`;
    await fs.writeFile("/plain.pdf", new TextEncoder().encode(pdf));
    const result = await invoke(["-j", "-s", "-n", "-Creator", "plain.pdf"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [{ SourceFile: "plain.pdf", Creator: "PDF creator" }]);
  });
}
