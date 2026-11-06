import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { parseHtmlBlocks } from "./html.js";
import { readZipArchiveEntries, runSofficeCli, runSofficeCliSync, runSofficeFileCli } from "./index.js";

test("HTML lists retain nested counters, paragraph content, and optional item closing tags", () => {
  const blocks = parseHtmlBlocks("<ol><li><p>First <b>item</b></p><ul><li>Child<li>Other</ul><li>Second</ol><p>Outside</p><ol><li>Restart</ol>");
  assert.deepEqual(blocks.map(block => block.text), ["1. First item", "• Child", "• Other", "2. Second", "Outside", "1. Restart"]);
});

for (const mode of ["sync", "async", "filesystem"]) {
  for (const target of ["cat", "txt", "pdf"]) test(`HTML list markers survive ${target} (${mode})`, async () => {
    const html = "<html><body><ul><li>Apple</li><li>Berry</li></ul><ol><li>First</li><li>Second</li></ol></body></html>";
    const files = new Map([["/lists.html", new TextEncoder().encode(html)]]);
    const args = target === "cat" ? ["--cat", "/lists.html"] : ["--convert-to", target, "/lists.html"];
    let text: string;
    let bytes: Uint8Array | undefined;
    if (mode === "filesystem") {
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/lists.html", files.get("/lists.html")!);
      text = "";
      const result = await runSofficeFileCli(args, { filesystem,
        stdout: { async write(bytes) { text += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } }
      });
      assert.equal(result.exitCode, 0);
      if (target !== "cat") bytes = await filesystem.readFile(`/lists.${target}`);
    } else {
      const result = mode === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
      assert.equal(result.exitCode, 0, result.stderr);
      text = result.stdout;
      bytes = files.get(`/lists.${target}`);
    }
    if (target !== "cat") text = target === "pdf" ? PdfDocument.load(bytes!).extractText() : new TextDecoder().decode(bytes);
    for (const line of ["• Apple", "• Berry", "1. First", "2. Second"]) assert.ok(text.includes(line), text);
  });
}

for (const mode of ["sync", "async", "filesystem"]) {
  for (const target of ["cat", "txt", "pdf"]) test(`HTML preformatted whitespace survives ${target} (${mode})`, async () => {
    const html = "<html><body><p>Before   text</p><pre>alpha    beta\n  gamma\n\nend</pre><p>After   text</p></body></html>";
    const files = new Map([["/pre.html", new TextEncoder().encode(html)]]);
    const args = target === "cat" ? ["--cat", "/pre.html"] : ["--convert-to", target, "/pre.html"];
    let text: string;
    let bytes: Uint8Array | undefined;
    if (mode === "filesystem") {
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/pre.html", files.get("/pre.html")!);
      text = "";
      const result = await runSofficeFileCli(args, { filesystem,
        stdout: { async write(bytes) { text += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } }
      });
      assert.equal(result.exitCode, 0);
      if (target !== "cat") bytes = await filesystem.readFile(`/pre.${target}`);
    } else {
      const result = mode === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
      assert.equal(result.exitCode, 0, result.stderr);
      text = result.stdout;
      bytes = files.get(`/pre.${target}`);
    }
    if (target !== "cat") text = target === "pdf" ? PdfDocument.load(bytes!).extractText() : new TextDecoder().decode(bytes);
    if (target === "pdf") {
      const lines = PdfDocument.load(bytes!).extractPages({ mode: "raw" }).flatMap(page => page.blocks.flatMap(block => block.lines));
      assert.deepEqual(lines.map(line => line.text), ["Before text", "alpha beta", "gamma", "end", "After text"]);
      const [, first, second, last] = lines;
      const characterWidth = (first!.words[0]!.bbox[2] - first!.words[0]!.bbox[0]) / 5;
      const gap = first!.words[1]!.bbox[0] - first!.words[0]!.bbox[2];
      const indent = second!.words[0]!.bbox[0] - first!.words[0]!.bbox[0];
      assert.ok(Math.abs(gap - 4 * characterWidth) < 0.001, "four spaces between words");
      assert.ok(Math.abs(indent - 2 * characterWidth) < 0.001, "two spaces of indentation");
      assert.equal(second!.baselineY - last!.baselineY, 2 * (first!.baselineY - second!.baselineY), "blank line before end");
    } else {
      assert.equal(text, ["Before text", "alpha    beta\n  gamma\n\nend", "After text"].join("\n") + "\n");
    }
  });
}

for (const mode of ["sync", "async"]) {
  for (const extension of ["html", "htm"]) {
    for (const target of ["txt", "pdf", "docx", "cat"]) test(`${extension} to ${target} parses visible document content (${mode})`, async () => {
      const html = '<!doctype html><title>Hidden title</title><style>.x {color:red}</style><h1>Hello &amp; welcome</h1><div><p>A <span>fine</span> day &#33;</p><ul><li>First</li><li>Second</li></ul><table><tr><th>Name</th><th>Value</th></tr><tr><td>Alice</td><td>42</td></tr></table></div><script>hiddenScript()</script>';
      const files = new Map([[`/doc.${extension}`, new TextEncoder().encode(html)]]);
      const args = target === "cat" ? ["--cat", `/doc.${extension}`] : ["--headless", "--convert-to", target, "--outdir", "/out", `/doc.${extension}`];
      const result = mode === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
      assert.equal(result.exitCode, 0, result.stderr);
      const bytes = files.get(`/out/doc.${target}`)!;
      let text: string;
      if (target === "cat") text = result.stdout;
      else if (target === "docx") {
        assert.ok(readZipArchiveEntries(bytes).has("word/document.xml"));
        text = (await runSofficeCli(["--cat", "/out/doc.docx"], files)).stdout;
      } else text = target === "pdf" ? PdfDocument.load(bytes).extractText() : new TextDecoder().decode(bytes);
      for (const expected of ["Hello & welcome", "A fine day !", "First", "Second", "Name", "Alice", "42"]) assert.ok(text.includes(expected), text);
      for (const hidden of ["<h1>", "<span>", "Hidden title", "hiddenScript", "color:red"]) assert.ok(!text.includes(hidden), text);
      if (target === "txt") assert.equal(text, "Hello & welcome\nA fine day !\n• First\n• Second\nName\tValue\nAlice\t42\n");
    });
  }
}

test("HTML pre preserves inline text, tabs, trailing spaces and HTML5 newline normalization", () => {
  assert.deepEqual(parseHtmlBlocks("<pre>\r\n  <code>A &amp; B</code>\t \r\n<br>end  </pre><p>  normal   text </p><pre>  </pre>"), [
    { kind: "paragraph", text: "  A & B\t \n\nend  ", preformatted: true },
    { kind: "paragraph", text: "normal text" },
    { kind: "paragraph", text: "  ", preformatted: true }
  ]);
});
