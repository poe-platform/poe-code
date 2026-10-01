import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { Shell } from "../../safe-bash/src/shell/index.js";
import { diffPatchCommands } from "../../safe-bash/src/commands/diff-patch/index.js";
import { createDocxCommand, createDocxCommands, docxCommands } from "../../safe-bash/src/commands/docx/index.js";
import { createPptxCommand, createPptxCommands, pptxCommands } from "../../safe-bash/src/commands/pptx/index.js";

for (const overlay of [false, true]) test(`patch publishes root files (overlay=${overlay})`, async () => {
  const lower = new MemoryFileSystem();
  await lower.writeFile("/in.md", new TextEncoder().encode("old\n"));
  await lower.writeFile("/change.patch", new TextEncoder().encode("--- /in.md\n+++ /in.md\n@@ -1 +1 @@\n-old\n+new\n"));
  const fs = overlay ? new OverlayFileSystem({ lower, upper: new MemoryFileSystem() }) : lower;
  const shell = new Shell({ fs }).use(diffPatchCommands());
  try {
    const result = await shell.exec("patch /in.md /change.patch");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/in.md")), "new\n");
  } finally { await shell.dispose(); }
});

test("document factories supply usable default engines", async () => {
  assert.equal(createDocxCommand().name, "docx");
  assert.equal(createDocxCommands().length, 1);
  assert.equal(createPptxCommand().name, "pptx");
  assert.equal(createPptxCommands().length, 1);
  const shell = new Shell({ fs: new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: new MemoryFileSystem() }) })
    .use(docxCommands()).use(pptxCommands());
  try {
    for (const name of ["docx", "pptx"]) {
      const result = await shell.exec(`${name} --help`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes(name));
    }
  } finally { await shell.dispose(); }
});

import { archiveCommands } from "../../safe-bash/src/commands/archive/index.js";
import { csplitCommands } from "../../safe-bash/src/commands/csplit/index.js";
import { applyPatchCommands } from "../../safe-bash/src/commands/apply-patch/index.js";
import { mmdcCommands } from "../../safe-bash/src/commands/mmdc/index.js";
import { wkhtmltopdfCommands } from "../../safe-bash/src/commands/wkhtmltopdf/index.js";
import { htmlqCommands } from "../../safe-bash/src/commands/htmlq/index.js";
import { pandocCommands } from "../../safe-bash/src/commands/pandoc/index.js";

test("overlay supports command output publication and archive extraction", async () => {
  const lower = new MemoryFileSystem();
  for (const [path, text] of Object.entries({
    "/in.md": "# Hello\nworld\nline3\n",
    "/page.html": '<html><body><h1 class="title">Hi</h1></body></html>\n',
    "/diag.mmd": "graph TD\nA-->B\n",
  })) await lower.writeFile(path, new TextEncoder().encode(text));
  await lower.mkdir("/nested");
  await lower.writeFile("/nested/file", new TextEncoder().encode("nested bytes"));
  const fs = new OverlayFileSystem({ lower, upper: new MemoryFileSystem() });
  await fs.mkdir("/out");
  const shell = new Shell({ fs }).use(archiveCommands()).use(csplitCommands()).use(applyPatchCommands())
    .use(mmdcCommands()).use(wkhtmltopdfCommands()).use(htmlqCommands()).use(pandocCommands())
    .use(docxCommands()).use(pptxCommands());
  try {
    for (const [command, output] of [
      ["mmdc -i /diag.mmd -o /diag.svg", "/diag.svg"],
      ["wkhtmltopdf /page.html /page.pdf", "/page.pdf"],
      ["htmlq -f /page.html -o /out.html .title", "/out.html"],
      ["pandoc /in.md -o /converted.html", "/converted.html"],
      ["csplit /in.md 2", "/xx00"],
      ["zip /arch.zip /in.md", "/arch.zip"],
      ["tar -cf /arch.tar /in.md /nested", "/arch.tar"],
      ["tar -xf /arch.tar -C /out", "/out/in.md"],
      ["docx create --output /document.docx", "/document.docx"],
      ["docx extract /document.docx --output-dir /extracted --allow-partial-output", "/extracted/manifest.json"],
      ["pptx create --output /deck.pptx", "/deck.pptx"],
    ]) {
      const result = await shell.exec(command!);
      assert.equal(result.exitCode, 0, `${command}: ${result.stderr} ${result.stdout}`);
      assert.ok((await fs.readFile(output!)).length > 0, output);
    }
    assert.equal(new TextDecoder().decode(await fs.readFile("/out/nested/file")), "nested bytes");
    const result = await shell.exec("apply_patch", { stdin: "*** Begin Patch\n*** Update File: /in.md\n@@\n-# Hello\n+# Updated\n*** End Patch\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/in.md")), "# Updated\nworld\nline3\n");
    assert.equal(new TextDecoder().decode(await lower.readFile("/in.md")), "# Hello\nworld\nline3\n");
  } finally { await shell.dispose(); }
});
