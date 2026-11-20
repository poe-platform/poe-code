import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {Shell, agentCommands, createMemoryFileSystem} from "../../safe-bash/dist/index.js";
import {createRustWasmBash} from "./index.js";

const paragraphs = Array.from({length: 40}, (_, index) =>
  `Paragraph ${index + 1}. ` + "Several words wrap onto another line and keep the same spacing across command runtimes. ".repeat(3));
const sources = {
  markdown: "---\ntitle: ORIGINAL\nauthor: ORIGINAL\n---\n\n" + paragraphs.join("\n\n"),
  json: JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {
    title: {t: "MetaString", c: "ORIGINAL"}, author: {t: "MetaString", c: "ORIGINAL"},
  }, blocks: paragraphs.map(text => ({t: "Para", c: [{t: "Str", c: text}]}))}),
  html: '<html><head><title>ORIGINAL</title><meta name="author" content="ORIGINAL"></head><body>' +
    paragraphs.map(text => `<p>${text}</p>`).join("") + "</body></html>",
};
const withoutMetadata = {
  markdown: paragraphs.join("\n\n"),
  json: JSON.stringify({...JSON.parse(sources.json), meta: {}}),
  html: paragraphs.map(text => `<p>${text}</p>`).join(""),
};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function geometry(bytes) {
  const source = new TextDecoder().decode(bytes);
  return {
    pages: [...source.matchAll(/\/Type \/Page\b/g)].length,
    boxes: [...source.matchAll(/\/MediaBox \[[^\]]+\]/g)].map(match => match[0]),
  };
}

for (const [from, source] of Object.entries(sources)) {
  test(`native and JavaScript Pandoc PDF defaults and metadata match for ${from}`, async () => {
    const native = await createRustWasmBash({forceNative: true, cwd: "/"});
    const fs = createMemoryFileSystem();
    const javascript = new Shell({fs, cwd: "/"}).use(agentCommands()).createSession();
    try {
      assert.equal(Boolean(native._companion), false);
      const original = [];
      for (const [input, flags, title, author] of [
        [withoutMetadata[from], "", undefined, undefined],
        [source, "", "ORIGINAL", "ORIGINAL"],
        [source, "-M title=OVERRIDE -M author=TESTER", "OVERRIDE", "TESTER"],
      ]) {
        const outputs = [];
        for (const route of [{fs: native.fs, exec: command => native.exec(command)}, {fs, exec: command => javascript.exec(command)}]) {
          await route.fs.writeFile("/input", new TextEncoder().encode(input));
          const result = await route.exec(`pandoc -f ${from} -t pdf ${flags} /input -o /output.pdf`);
          assert.equal(result.exitCode, 0, result.stderr);
          outputs.push(await route.fs.readFile("/output.pdf"));
        }
        const expected = geometry(outputs[1]);
        assert(expected.pages > 1, "fixture must exercise pagination");
        assert.deepEqual(geometry(outputs[0]), expected, `${from} ${flags}: PDF geometry`);
        assert.equal(hash(outputs[0]), hash(outputs[1]), `${from} ${flags}: PDF bytes`);
        const info = await native.exec("pdfinfo /output.pdf");
        assert.equal(info.exitCode, 0, info.stderr);
        assert.equal(info.stdout.match(/^Title:\s+(.+)$/m)?.[1], title);
        assert.equal(info.stdout.match(/^Author:\s+(.+)$/m)?.[1], author);
        original.push(hash(outputs[0]));
      }
      assert.equal(new Set(original).size, 3, "reader and CLI metadata must both affect output");
      assert.equal(Boolean(native._companion), false);
    } finally {
      await native.dispose();
      await javascript.dispose?.();
    }
  });
}
