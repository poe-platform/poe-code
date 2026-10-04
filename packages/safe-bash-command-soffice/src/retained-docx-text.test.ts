import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createStoredZipArchive, runSofficeCli, runSofficeFileCli } from "./index.js";

for (const format of ["cat", "txt", "md", "csv"]) for (const xml of [
  "", '<w:document><w:p><w:r><w:t> café &amp; &#32; </w:t><w:t>&am</w:t><w:t>p;</w:t></w:r></w:p></w:document>',
  '<w:p><w:t>before</w:t><w:tab/><w:t>after</w:t><w:br/><w:t>end</w:t><w:cr/></w:p><w:p><w:t>&#32;</w:t></w:p><w:p><w:t>last</w:t></w:p>',
  '<w:p><w:t>Intro</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t> A </w:t></w:p><w:p><w:t>B </w:t></w:p></w:tc><w:tc><w:p><w:t>&#9; C</w:t></w:p></w:tc></w:tr><w:tr><w:tc></w:tc></w:tr></w:tbl>',
  '<x:p><x:t>caption</x:t><x:drawing><a:blip r:embed="pic"/></x:drawing><x:pict><a:blip r:embed="missing"/></x:pict></x:p><x:p><x:drawing><a:blip r:embed="pic"/></x:drawing></x:p>',
  '<w:p><w:t>' + 'a'.repeat(16381) + '&amp; café</w:t></w:p>',
  '<w:p><w:t>' + ' '.repeat(20000) + '</w:t><w:t>tail</w:t></w:p>',
  '<w:p><w:t>A<b>raw</b></w:t></w:p><w:p><w:t/></w:p>'
]) it(`retains DOCX ${format} text (${xml.length}, ${xml.slice(0, 25)})`, async () => {
  const fs = new MemoryFileSystem(), bytes = createStoredZipArchive({
    'word/document.xml': new TextEncoder().encode(xml),
    'word/_rels/document.xml.rels': new TextEncoder().encode('<Relationships><Relationship Id="pic" Target="media/pic.png"/><Relationship Id="missing" Target="media/absent.png"/></Relationships>'),
    'word/media/pic.png': Uint8Array.of(1, 2, 3)
  });
  await fs.writeFile('/input.docx', bytes);
  const files = new Map([['/input.docx', bytes]]), args = format === 'cat' ? ['--cat', '/input.docx'] : ['--convert-to', format, '/input.docx'];
  const expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === 'readFile' || key === 'writeFile') return () => { throw new Error('Whole-file I/O forbidden'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  let stdout = '', stderr = '';
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  if (format !== 'cat' && !result.exitCode) assert.deepEqual(await fs.readFile('/input.' + format), files.get('/input.' + format));
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), format === 'cat' ? ['input.docx'] : ['input.docx', 'input.' + format].sort());
});

for (const target of ["media/pic.png", "word/media/pic.png", "/word/media/pic.png", "../word/media/pic.png"]) it(`retains DOCX relationship keys and normalization (${target})`, async () => {
  const fs = new MemoryFileSystem(), id = "r".repeat(70000), encode = (text: string) => new TextEncoder().encode(text);
  const bytes = createStoredZipArchive({
    "word/document.xml": encode('<w:p><w:t>caption</w:t><w:drawing><a:blip r:embed="' + id + '"/></w:drawing><w:drawing><a:blip r:embed="costarring"/></w:drawing><w:drawing><a:blip r:embed="liquid"/></w:drawing><w:drawing><a:blip r:embed="duplicate"/></w:drawing></w:p>'),
    "word/_rels/document.xml.rels": encode('<Relationships><Relationship Id="' + id + '" Target="' + target + '"/><Relationship Id="costarring" Target="media/pic.png"/><Relationship Id="liquid" Target="media/missing.png"/><Relationship Id="duplicate" Target="media/pic.png"/><Relationship Id="duplicate" Target="media/missing.png"/></Relationships>'),
    "word/media/pic.png": Uint8Array.of(1)
  });
  await fs.writeFile("/input.docx", bytes);
  const expected = await runSofficeCli(["--cat", "/input.docx"], new Map([["/input.docx", bytes]]));
  let stdout = "";
  const actual = await runSofficeFileCli(["--cat", "/input.docx"], { filesystem: fs, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(stdout, expected.stdout);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.docx"]);
});

for (const mode of ["cancel", "sink", "malformed", "truncated"]) it(`cleans DOCX caller storage on ${mode}`, async () => {
  const fs = new MemoryFileSystem(), archive = createStoredZipArchive({
    "word/document.xml": new TextEncoder().encode('<w:p><w:t>' + 'x'.repeat(1100000) + '</w:t></w:p>')
  });
  await fs.writeFile("/input.docx", mode === "malformed" ? Uint8Array.of(1, 2) : mode === "truncated" ? archive.subarray(0, archive.length - 8) : archive);
  const controller = new AbortController(), reason = new Error(mode); let writes = 0;
  const operation = runSofficeFileCli(["--cat", "/input.docx"], { filesystem: fs, signal: controller.signal,
    stdout: { async write() { writes++; if (mode === "cancel") controller.abort(reason); else throw reason; } }, stderr: { async write() {} } });
  if (mode === "malformed" || mode === "truncated") { assert.equal((await operation).exitCode, 1); assert.equal(writes, 0); }
  else await assert.rejects(operation, error => error === reason);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.docx"]);
});

it("retains DOCX indexes across many small paragraphs", async () => {
  const fs = new MemoryFileSystem(), body = '<w:p><w:t>A</w:t><w:t>&amp;</w:t></w:p>'.repeat(180);
  await fs.writeFile('/input.docx', createStoredZipArchive({ 'word/document.xml': new TextEncoder().encode(body) }));
  let output = '';
  const result = await runSofficeFileCli(['--cat', '/input.docx'], { filesystem: fs,
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } } });
  assert.equal(result.exitCode, 0); assert.equal(output, 'A&\n'.repeat(180));
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input.docx']);
});
