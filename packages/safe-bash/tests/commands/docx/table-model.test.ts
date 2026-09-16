import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Document } from "../../../../docx/src/index.js";
import { paragraph, textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

const root = { id: "document", type: "DocumentModel", owner: "document", revision: 0 };
const named = (resultHandle: string) => ({ resultHandle });
const action = (operation: string, receiver: object, args: object = {}, resultHandle?: string) => ({
  operation,
  receiver,
  arguments: args,
  ...(resultHandle ? { resultHandle } : {})
});
const select = [action("model.document.Document.tables.get", root, {}, "tables")];
const first = { resultHandle: "tables", index: 0 };
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const cell = (text: string, props = "") =>
  `<w:tc><w:tcPr>${props}</w:tcPr>${paragraph(text)}</w:tc>`;
const grid = (rows: string, cols = 2) =>
  `<w:tbl><w:tblGrid>${'<w:gridCol w:w="1440"/>'.repeat(cols)}</w:tblGrid>${rows}</w:tbl>`;
const original = grid(
  `<w:tr>${cell("North")}${cell("East")}</w:tr><w:tr>${cell("South")}${cell("West")}</w:tr>`
);

async function fixture(body = original) {
  const input = await textFixture(body);
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input) });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile(
    "/work/input.docx",
    new Uint8Array(volume.readFileSync("/input.docx") as Buffer)
  );
  const shell = new Shell({ fs, cwd: "/work" })
    .use(agentCommands())
    .use(
      docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })
    );
  const batch = async (operations: object[], flags = "--json") => {
    await fs.writeFile(
      "/work/ops.json",
      new TextEncoder().encode(JSON.stringify({ version: 1, operations }))
    );
    return shell.exec(`docx batch input.docx --ops-file ops.json ${flags}`);
  };
  return { input, fs, shell, batch };
}

test("table model growth and formatting publish through a virtual script and binary pipe", async () => {
  const { fs, shell, input } = await fixture();
  try {
    const operations = [
      ...select,
      action("model.table.Table.add_row.call", first, {}, "row"),
      action(
        "model.table.Table.add_column.call",
        first,
        { width: { value: 1, unit: "in" } },
        "column"
      ),
      action("model.table.Table.autofit.set", first, { value: false }),
      action("model.table._Row.height.set", named("row"), { value: { value: 12, unit: "pt" } }),
      action("model.table.Table.cell.call", first, { rowIdx: 2, colIdx: 2 }, "cell"),
      action("model.table._Cell.text.set", named("cell"), { value: "  0007 海  " })
    ];
    await fs.writeFile(
      "/work/ops.json",
      new TextEncoder().encode(JSON.stringify({ version: 1, operations }))
    );
    await fs.writeFile(
      "/work/table.sh",
      new TextEncoder().encode(
        'cat input.docx | docx batch - --ops-json "$(cat ops.json)" -o - > edited.docx\ndocx tables get edited.docx --table 1 --json\n'
      )
    );
    const result = await shell.exec("sh table.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.version, 1);
    assert.equal(envelope.operation, "tables.get");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.item.details.rows, 3);
    assert.equal(envelope.data.item.details.columns, 3);
    const document = await Document(await fs.readFile("/work/edited.docx"), textContext);
    const table = document.tables[0]!;
    assert.equal(table.autofit, false);
    assert.equal(table.rows.at(2).height?.pt, 12);
    assert.equal(table.columns.at(2).width?.inches, 1);
    assert.equal(table.cell(2, 2).text, "  0007 海  ");
    assert.equal(table.cell(0, 0).text, "North");
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally {
    await shell.dispose();
  }
});

test("table model rectangle merges preserve ordered content and dry runs publish no bytes", async () => {
  const { input, fs, shell, batch } = await fixture();
  try {
    const operations = [
      ...select,
      action("model.table.Table.cell.call", first, { rowIdx: 0, colIdx: 0 }, "start"),
      action("model.table.Table.cell.call", first, { rowIdx: 1, colIdx: 1 }, "end"),
      action("model.table._Cell.merge.call", named("start"), { otherCell: named("end") }, "merged"),
      action("model.table._Cell.text.get", named("merged"))
    ];
    const dry = await batch(operations, "--dry-run --json");
    assert.equal(dry.exitCode, 0, dry.stderr);
    const envelope = JSON.parse(dry.stdout);
    assert.equal(envelope.data.dryRun, true);
    assert.deepEqual(envelope.data.output, []);
    assert.equal(envelope.data.results.at(-1).value, "North\nEast\nSouth\nWest");
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
    const published = await batch(operations, "-o -");
    assert.equal(published.exitCode, 0, published.stderr);
    const doc = await Document(published.stdoutBytes, textContext);
    const table = doc.tables[0]!;
    assert.equal(table.cell(0, 0).text, "North\nEast\nSouth\nWest");
    assert.equal(table.cell(0, 0), table.cell(1, 1));
    assert.equal(table.cell(0, 0).grid_span, 2);
  } finally {
    await shell.dispose();
  }
});

test("table model slices use checked zero based bounds through binary stdin", async () => {
  const { input, fs, shell } = await fixture();
  try {
    const operations = [
      ...select,
      action("model.table.Table.rows.get", first, {}, "rows"),
      action("model.table._Rows.__getitem__.slice", named("rows"), { start: -1 }, "last"),
      action("model.table._Row.cells.get", { resultHandle: "last", index: 0 }, {}, "cells"),
      action("model.table._Cell.text.get", { resultHandle: "cells", index: 0 })
    ];
    const result = await shell.exec(
      `docx batch - --ops-json '${JSON.stringify({ version: 1, operations })}' --json`,
      { stdin: input }
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).data.results.at(-1).value, "South");
    assert.equal(JSON.parse(result.stdout).affected, 0);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally {
    await shell.dispose();
  }
});

test("invalid table model bounds fail before publication and retain existing destinations", async () => {
  for (const index of [-3, 2]) {
    const { input, fs, shell, batch } = await fixture();
    try {
      const marker = new TextEncoder().encode("existing destination");
      await fs.writeFile("/work/out.docx", marker);
      const result = await batch(
        [
          ...select,
          action("model.table.Table.autofit.set", first, { value: false }),
          action("model.table.Table.rows.get", first, {}, "rows"),
          action("model.table._Rows.__getitem__.get", named("rows"), { index })
        ],
        "-o out.docx --force --json"
      );
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(JSON.parse(result.stdout).ok, false);
      assert.equal(JSON.parse(result.stdout).affected, 0);
      assert.deepEqual(await fs.readFile("/work/out.docx"), marker);
      assert.deepEqual(await fs.readFile("/work/input.docx"), input);
    } finally {
      await shell.dispose();
    }
  }
});

test("partial overlap table model merges reject without publishing earlier edits", async () => {
  const body = grid(
    `<w:tr>${cell("Wide", '<w:gridSpan w:val="2"/>')}${cell("Edge")}</w:tr><w:tr>${cell("Left")}${cell("Middle")}${cell("Right")}</w:tr>`,
    3
  );
  const { input, fs, shell, batch } = await fixture(body);
  try {
    const result = await batch(
      [
        ...select,
        action("model.table.Table.autofit.set", first, { value: false }),
        action("model.table.Table.cell.call", first, { rowIdx: 1, colIdx: 1 }, "start"),
        action("model.table.Table.cell.call", first, { rowIdx: 0, colIdx: 2 }, "end"),
        action("model.table._Cell.merge.call", named("start"), { otherCell: named("end") })
      ],
      "-o -"
    );
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdoutBytes.length, 0);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally {
    await shell.dispose();
  }
});
