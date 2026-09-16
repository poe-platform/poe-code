import assert from "node:assert/strict";
import test from "node:test";
import { extractDocumentObjects, inspectDocumentObjects } from "../../../../docx/src/objects.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { chartFixture, chartContext, sheetMime } from "../../../../docx/tests/fixtures/charts.js";
import { publication } from "../../../../docx/tests/fixtures/object-publication.js";
import { r } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { Shell } from "../../../src/shell/index.js";

const workbook = Uint8Array.of(80, 75, 0, 255, 17, 0, 29);
async function input(linked = false) {
  return chartFixture({
    definitions: [],
    body: '<w:p><w:r><w:t>Coast object area</w:t></w:r><w:r><w:object xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml"><v:shape id="previewShape"><v:imagedata r:id="preview"/></v:shape><o:OLEObject ShapeID="previewShape" r:id="book"/></w:object></w:r></w:p>',
    resources: [
      { name: "word/embeddings/coast.bin", type: sheetMime, bytes: workbook },
      { name: "word/media/coast.png", type: "image/png", bytes: Uint8Array.of(137, 80, 78, 71) }
    ],
    relationships: [
      {
        owner: "/word/document.xml",
        id: "book",
        type: r + "/package",
        target: linked
          ? "https://user:credential@coast.invalid/book?token=private-value"
          : "embeddings/coast.bin",
        ...(linked ? { external: true } : {})
      },
      { owner: "/word/document.xml", id: "preview", type: r + "/image", target: "media/coast.png" }
    ]
  });
}
function setup(bytes: Uint8Array) {
  const { fs, volume } = publication(bytes);
  const filesystem = {
    ...fs,
    async lstat(path: string) {
      try {
        const value = await fs.lstat(path);
        return volume.lstatSync(path).isSymbolicLink()
          ? { ...value, type: "symlink" as const }
          : value;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
          throw new FsError("ENOENT", { path });
        throw error;
      }
    },
    async readlink(path: string) {
      return String(volume.readlinkSync(path));
    },
    readStream(path: string) {
      return {
        async *[Symbol.asyncIterator]() {
          yield await fs.readFile(path);
        }
      };
    }
  } as FileSystem;
  return {
    volume,
    shell: new Shell({ fs: filesystem, cwd: "/" }).use(
      docxCommands({ engine: createDocxInspectionCommandEngine({ limits: chartContext.limits }) })
    )
  };
}

test("docx objects list matches SDK snapshots and keeps preview payloads inert", async () => {
  const bytes = await input(),
    { shell, volume } = setup(bytes);
  try {
    const result = await shell.exec("docx objects list input.docx --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout),
      sdk = await inspectDocumentObjects(bytes, { json: true }, chartContext);
    assert.deepEqual(report.data, { items: sdk.items, document: sdk.document });
    assert.deepEqual(report.warnings, sdk.warnings);
    assert.equal(report.affected, 0);
    assert.equal(report.operation, "objects.list");
    assert.equal(report.data.items[0].details.resource.bytes, workbook.length);
    assert.equal(report.data.items[0].details.previews[0].resource.part, "/word/media/coast.png");
    assert.ok(result.stderr.includes("opaque-object-content"));
    assert.deepEqual(volume.readFileSync("/input.docx"), Buffer.from(bytes));
    assert.deepEqual(volume.readdirSync("/out"), []);
  } finally {
    await shell.dispose();
  }
});

test("docx objects extract publishes exact workbook bytes and a JSON receipt to VFS", async () => {
  const bytes = await input(),
    { shell, volume } = setup(bytes);
  try {
    const result = await shell.exec(
      "docx objects extract input.docx --output-dir /out --allow-partial-output --json"
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const sdkFilesystem = publication(bytes).fs;
    const sdk = await extractDocumentObjects(
      bytes,
      { outputDir: "/out", allowPartialOutput: true, json: true },
      {
        ...chartContext,
        encoding: { compression: "store", order: "input" },
        filesystem: sdkFilesystem
      }
    );
    const { warnings, ...data } = sdk;
    assert.deepEqual(report.data, data);
    assert.deepEqual(report.warnings, warnings);
    assert.equal(report.operation, "objects.extract");
    assert.equal(report.affected, 0);
    assert.equal(report.data.complete, true);
    assert.equal(report.data.manifest.published, true);
    assert.equal(report.data.entries.length, 1);
    assert.equal(report.data.entries[0].published, true);
    assert.deepEqual(volume.readFileSync(report.data.entries[0].path), Buffer.from(workbook));
    const manifest = JSON.parse(String(volume.readFileSync(report.data.manifest.path)));
    assert.equal(manifest.kind, "objects");
    assert.equal(manifest.entries[0].path, "object-1.bin");
    assert.equal(manifest.entries[0].sha256, report.data.entries[0].sha256);
    assert.deepEqual(volume.readdirSync("/out").sort(), ["manifest.json", "object-1.bin"]);
    assert.ok(result.stderr.includes("opaque-object-content"));
    assert.deepEqual(volume.readFileSync("/input.docx"), Buffer.from(bytes));
  } finally {
    await shell.dispose();
  }
});

test("docx objects extraction refuses symlink destinations without publishing", async () => {
  const bytes = await input(),
    { shell, volume } = setup(bytes);
  volume.mkdirSync("/elsewhere");
  volume.symlinkSync("/elsewhere", "/out/alias");
  try {
    const result = await shell.exec(
      "docx objects extract input.docx --output-dir /out/alias --allow-partial-output --json"
    );
    assert.notEqual(result.exitCode, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.affected, 0);
    assert.equal(report.errors[0].code, "unsupported-publication");
    assert.deepEqual(volume.readdirSync("/elsewhere"), []);
    assert.deepEqual(volume.readFileSync("/input.docx"), Buffer.from(bytes));
  } finally {
    await shell.dispose();
  }
});

test("docx objects list redacts linked target credentials from stdout and diagnostics", async () => {
  const bytes = await input(true),
    { shell, volume } = setup(bytes);
  try {
    const result = await shell.exec("docx objects list input.docx --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout),
      linked = report.data.items.find(
        (item: { details: { status: string } }) => item.details.status === "external"
      );
    assert.ok(linked);
    assert.equal(linked.details.resource, null);
    assert.ok(
      linked.references.some(
        (reference: { external: boolean; target: string }) =>
          reference.external && reference.target === "[redacted external target]"
      )
    );
    for (const secret of ["credential", "private-value", "coast.invalid"])
      assert.equal((result.stdout + result.stderr).includes(secret), false);
    assert.ok(result.stderr.includes("unresolved-object-binding"));
    assert.deepEqual(volume.readdirSync("/out"), []);
    assert.deepEqual(volume.readFileSync("/input.docx"), Buffer.from(bytes));
  } finally {
    await shell.dispose();
  }
});
