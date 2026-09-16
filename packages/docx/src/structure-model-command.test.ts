import { expect, it } from "vitest";
import { Volume } from "memfs";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { paragraph, table, textContext, textFixture } from "../tests/fixtures/text.js";
import { extractDocumentText } from "./text.js";
const root = { id: "document", type: "DocumentModel", owner: "document", revision: 0 };
const operations = [
  {
    operation: "model.document.Document.tables.get",
    receiver: root,
    arguments: {},
    resultHandle: "tables"
  },
  {
    operation: "model.table.Table.cell.call",
    receiver: { resultHandle: "tables", index: 0 },
    arguments: { rowIdx: 0, colIdx: 0 },
    resultHandle: "cell"
  },
  {
    operation: "model.table._Cell.text.set",
    receiver: { resultHandle: "cell" },
    arguments: { value: "Verified" }
  },
  { operation: "model.table._Cell.text.get", receiver: { resultHandle: "cell" }, arguments: {} }
];
it("executes typed structure operations through the shared SDK batch engine", async () => {
  const input = await textFixture(table([paragraph("Draft")]));
  const applied = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
  expect(applied.affected).toBe(1);
  expect(applied.results.at(-1)).toMatchObject({ value: "Verified" });
  const volume = Volume.fromJSON({ "/out": "" });
  await applied.save({
    async write(bytes) {
      volume.appendFileSync("/out", bytes);
    }
  });
  expect(
    (await extractDocumentText(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext))
      .text
  ).toBe("Verified");
});
it("shares batch CLI schemas, JSON, dry-run effects and binary publication with the SDK", async () => {
  const input = await textFixture(table([paragraph("Draft")]));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
  const engine = createDocxInspectionCommandEngine({ limits: textContext.limits });
  const execute = (flags: string[]) =>
    engine.execute({
      args: [
        "batch",
        "/input.docx",
        "--ops-json",
        JSON.stringify({ version: 1, operations }),
        ...flags
      ].map((s) => new TextEncoder().encode(s)),
      cwd: "/",
      signal: textContext.signal,
      filesystem: {
        async readFile(path) {
          return new Uint8Array(volume.readFileSync(path) as Buffer);
        }
      },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      },
      stderr: {
        async write(bytes) {
          volume.appendFileSync("/err", bytes);
        }
      }
    });
  expect((await execute(["--dry-run", "--json"])).exitCode).toBe(0);
  expect(JSON.parse(volume.readFileSync("/out", "utf8").toString())).toMatchObject({
    version: 1,
    operation: "batch",
    ok: true,
    affected: 1,
    data: {
      dryRun: true,
      output: [],
      results: expect.arrayContaining([
        { operation: "model.table._Cell.text.get", value: "Verified" }
      ])
    }
  });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  volume.writeFileSync("/out", "");
  expect((await execute(["--output", "-"])).exitCode).toBe(0);
  expect(
    (await extractDocumentText(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext))
      .text
  ).toBe("Verified");
});

it("uses the explicit CLI model timestamp for created comment bodies", async () => {
  const input = await textFixture(paragraph("Signal"));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
  const timestamp = "2026-04-05T06:07:08Z";
  const items = [
    {
      operation: "model.document.Document.comments.get",
      receiver: root,
      arguments: {},
      resultHandle: "comments"
    },
    {
      operation: "model.comments.Comments.add_comment.call",
      receiver: { resultHandle: "comments" },
      arguments: { text: "Check", author: "Mira" }
    }
  ];
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: [
      "batch",
      "/input.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations: items }),
      "--timestamp",
      timestamp,
      "--output",
      "-"
    ].map((s) => new TextEncoder().encode(s)),
    cwd: "/",
    signal: textContext.signal,
    filesystem: {
      async readFile(path) {
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      }
    },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: {
      async write(bytes) {
        volume.appendFileSync("/out", bytes);
      }
    },
    stderr: {
      async write(bytes) {
        volume.appendFileSync("/err", bytes);
      }
    }
  });
  expect(result.exitCode).toBe(0);
  const { inspectDocumentComments } = await import("./comments.js");
  const read = await inspectDocumentComments(
    new Uint8Array(volume.readFileSync("/out") as Buffer),
    { operation: "comments.list", options: {} },
    textContext
  );
  expect(read.items[0]!).toMatchObject({ author: "Mira", timestamp: "2026-04-05T06:07:08.000Z" });
});

it("honors narrower publication ceilings after synchronous model edits", async () => {
  const input = await textFixture(table([paragraph("Draft")]));
  const applied = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
  const volume = Volume.fromJSON({ "/out": "" });
  await expect(
    applied.publish(
      { output: "-" },
      {
        ...textContext,
        encoding: { order: "input", compression: "store" },
        limits: { ...textContext.limits, maxArchiveBytes: 1 },
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/out", bytes);
          }
        }
      }
    )
  ).rejects.toBeDefined();
  expect(volume.readFileSync("/out").length).toBe(0);
});
