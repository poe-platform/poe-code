import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { Shell } from "../../../src/core.js";
import { pythonCommands } from "../../../src/commands/python/index.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";

test("default pythonCommands() supports --version and renders DOCX/PPTX via render_docx.py and render_slides.py", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  const shell = new Shell({ fs, cwd: "/work" })
    .use(pythonCommands())
    .use(docxCommands({ replace: true }))
    .use(pptxCommands({ replace: true }));

  const ver = await shell.exec("python3 --version");
  assert.equal(ver.exitCode, 0);
  assert.equal(ver.stdout, "Python 3.12.0\n");

  const createDocx = await shell.exec("docx create -o report.docx");
  assert.equal(createDocx.exitCode, 0, createDocx.stderr);

  const renderDocx = await shell.exec("python3 /skills/documents/render_docx.py report.docx --output_dir .qa/docx");
  assert.equal(renderDocx.exitCode, 0, renderDocx.stderr);
  assert.equal(renderDocx.stdout, "Pages rendered to /work/.qa/docx\n");
  const docxPng = await fs.readFile("/work/.qa/docx/page-1.png");
  assert.ok(docxPng.byteLength > 100);

  const createPptx = await shell.exec("pptx create -o deck.pptx --slides-json '[{\"name\":\"Slide 1\"}]'");
  assert.equal(createPptx.exitCode, 0, createPptx.stderr);

  const renderSlides = await shell.exec("python3 /skills/presentations/render_slides.py deck.pptx --output_dir .qa/slides");
  assert.equal(renderSlides.exitCode, 0, renderSlides.stderr);
  assert.equal(renderSlides.stdout, "Slides rendered to /work/.qa/slides\n");
  const slidePng = await fs.readFile("/work/.qa/slides/slide-1.png");
  assert.ok(slidePng.byteLength > 100);
});
