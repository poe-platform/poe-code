import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Document } from "../../../../docx/src/index.js";
import { paragraph, textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { rasterPng } from "../../../../docx/tests/fixtures/raster.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

const root = { id: "document", type: "DocumentModel", owner: "document", revision: 0 };
const ref = (resultHandle: string, index?: number) => ({
  resultHandle,
  ...(index === undefined ? {} : { index })
});
const operation = (
  operation: string,
  receiver: object,
  args: object = {},
  resultHandle?: string
) => ({ operation, receiver, arguments: args, ...(resultHandle ? { resultHandle } : {}) });
const admitted = { kind: "vfs", path: "/work/Coast.PNG", capability: "command" };
const add = operation(
  "model.document.Document.add_picture.call",
  root,
  { input: admitted, width: { value: 1, unit: "in" } },
  "picture"
);

async function fixture() {
  const input = await textFixture(paragraph("Coastal observations"));
  const volume = Volume.fromJSON({
    "/input": Buffer.from(input),
    "/image": Buffer.from(rasterPng())
  });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input.docx", new Uint8Array(volume.readFileSync("/input") as Buffer));
  await fs.writeFile("/work/Coast.PNG", new Uint8Array(volume.readFileSync("/image") as Buffer));
  const shell = new Shell({ fs, cwd: "/work" })
    .use(agentCommands())
    .use(
      docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })
    );
  return { input, fs, shell };
}

test("inline picture handles admit VFS bytes and publish typed sizing through a virtual script", async () => {
  const { input, fs, shell } = await fixture();
  try {
    const operations = [
      add,
      operation("model.shape.InlineShape.width.set", ref("picture"), {
        value: { value: 2, unit: "in" }
      }),
      operation("model.shape.InlineShape.height.set", ref("picture"), {
        value: { value: 1, unit: "in" }
      }),
      operation("model.document.Document.inline_shapes.get", root, {}, "pictures"),
      operation("model.shape.InlineShapes.__len__.get", ref("pictures")),
      operation("model.shape.InlineShapes.__getitem__.get", ref("pictures"), { index: -1 }, "last"),
      operation("model.shape.InlineShape.type.get", ref("last")),
      operation("model.shape.InlineShapes.part.get", ref("pictures"), {}, "part"),
      operation("model.opc.part.Part.partname.get", ref("part"))
    ];
    await fs.writeFile(
      "/work/ops.json",
      new TextEncoder().encode(JSON.stringify({ version: 1, operations }))
    );
    const dry = await shell.exec("docx batch input.docx --ops-file ops.json --dry-run --json");
    assert.equal(dry.exitCode, 0, dry.stderr);
    const envelope = JSON.parse(dry.stdout);
    assert.equal(envelope.version, 1);
    assert.equal(envelope.operation, "batch");
    assert.equal(envelope.data.dryRun, true);
    assert.deepEqual(envelope.data.output, []);
    assert.equal(envelope.data.results[0].value.type, "InlineShape");
    assert.equal(envelope.data.results[0].value.owner, "document");
    assert.equal(envelope.data.results[4].value, 1);
    assert.equal(envelope.data.results[6].value.name, "PICTURE");
    assert.equal(envelope.data.results.at(-1).value, "/word/document.xml");
    await fs.writeFile(
      "/work/picture.sh",
      new TextEncoder().encode(
        'cat input.docx | docx batch - --ops-json "$(cat ops.json)" -o - > edited.docx\ndocx images list edited.docx --json\n'
      )
    );
    const published = await shell.exec("sh picture.sh");
    assert.equal(published.exitCode, 0, published.stderr);
    assert.equal(JSON.parse(published.stdout).ok, true);
    const document = await Document(await fs.readFile("/work/edited.docx"), textContext);
    assert.equal(document.inline_shapes.length, 1);
    assert.equal(document.inline_shapes.at(0).width.inches, 2);
    assert.equal(document.inline_shapes.at(0).height.inches, 1);
    assert.equal(document.paragraphs[0]!.text, "Coastal observations");
    const drawing = [...document.paragraphs.at(-1)!.runs[0]!.iter_inner_content()][0];
    assert.equal(typeof drawing, "object");
    assert.ok(drawing && typeof drawing !== "string" && "image" in drawing);
    assert.deepEqual(drawing.image.blob, rasterPng());
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
    assert.deepEqual(await fs.readFile("/work/Coast.PNG"), rasterPng());
  } finally {
    await shell.dispose();
  }
});

test("run picture traversal exposes a closed drawing image metadata handle", async () => {
  const { input, fs, shell } = await fixture();
  try {
    const operations = [
      operation("model.document.Document.paragraphs.get", root, {}, "paragraphs"),
      operation("model.text.paragraph.Paragraph.add_run.call", ref("paragraphs", 0), {}, "run"),
      operation("model.text.run.Run.add_picture.call", ref("run"), { input: admitted }, "picture"),
      operation("model.text.run.Run.iter_inner_content.call", ref("run"), {}, "content"),
      operation("model.drawing.Drawing.has_picture.get", ref("content", 0)),
      operation("model.drawing.Drawing.image.get", ref("content", 0), {}, "image"),
      operation("model.image.image.Image.px_width.get", ref("image")),
      operation("model.image.image.Image.sha1.get", ref("image"))
    ];
    const result = await shell.exec(
      `docx batch - --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json`,
      { stdin: input }
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.data.results[4].value, true);
    assert.equal(envelope.data.results[5].value.type, "Image");
    assert.equal(envelope.data.results[5].value.owner, "batch");
    assert.equal(envelope.data.results[6].value, 1);
    assert.equal(envelope.data.results[7].value.length, 40);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally {
    await shell.dispose();
  }
});

test("invalid picture extents reject before publishing admitted bytes or earlier edits", async () => {
  const { input, fs, shell } = await fixture();
  try {
    const marker = new TextEncoder().encode("existing destination");
    await fs.writeFile("/work/out.docx", marker);
    const operations = [
      add,
      operation("model.shape.InlineShape.width.set", ref("picture"), {
        value: { value: -1, unit: "emu" }
      })
    ];
    const result = await shell.exec(
      `docx batch input.docx --ops-json '${JSON.stringify({ version: 1, operations })}' -o out.docx --force --json`
    );
    assert.equal(result.exitCode, 2, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.errors[0].code, "usage");
    assert.equal(envelope.affected, 0);
    assert.deepEqual(await fs.readFile("/work/out.docx"), marker);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally {
    await shell.dispose();
  }
});

test("inline picture byte descriptors retain numeric EMU sizing through binary publication", async () => {
  const { input, fs, shell } = await fixture();
  try {
    const operations = [
      operation(
        "model.document.Document.add_picture.call",
        root,
        {
          input: { kind: "bytes", base64: Buffer.from(rasterPng()).toString("base64") },
          width: 457200,
          height: 914400
        },
        "picture"
      )
    ];
    const result = await shell.exec(
      `docx batch - --ops-json '${JSON.stringify({ version: 1, operations })}' -o -`,
      { stdin: input }
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const document = await Document(result.stdoutBytes, textContext);
    assert.equal(document.inline_shapes.at(0).width.emu, 457200);
    assert.equal(document.inline_shapes.at(0).height.emu, 914400);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally {
    await shell.dispose();
  }
});
