import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  Document,
  StaleHandleError
} from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

const receiver = { id: "document", type: "DocumentModel", owner: "document", revision: 0 };
const paragraphs = {
  operation: "model.document.Document.paragraphs.get",
  receiver,
  arguments: {},
  resultHandle: "paragraphs"
};

it("rejects a saved run handle after identical paragraph replacement through typed batch", async () => {
  const input = await textFixture(paragraph("Coastal survey"));
  await expect(
    applyStyleModelBatch(
      input,
      {
        version: 1,
        operations: [
          paragraphs,
          {
            operation: "model.text.paragraph.Paragraph.runs.get",
            receiver: { resultHandle: "paragraphs", index: 0 },
            arguments: {},
            resultHandle: "runs"
          },
          {
            operation: "model.text.paragraph.Paragraph.text.set",
            receiver: { resultHandle: "paragraphs", index: 0 },
            arguments: { value: "Coastal survey" }
          },
          {
            operation: "model.text.run.Run.text.get",
            receiver: { resultHandle: "runs", index: 0 },
            arguments: {}
          }
        ]
      },
      textContext
    )
  ).rejects.toThrow(StaleHandleError);
});

it("clears nullable paragraph text through the SDK-backed CLI and preserves its sibling", async () => {
  const input = await textFixture(paragraph("Clear") + paragraph("Retain"));
  const operations = [
    paragraphs,
    {
      operation: "model.text.paragraph.Paragraph.text.set",
      receiver: { resultHandle: "paragraphs", index: 0 },
      arguments: { value: null }
    }
  ];
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: [
      "batch",
      "/input.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations }),
      "--output",
      "-"
    ].map((value) => new TextEncoder().encode(value)),
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
  expect(result.exitCode, volume.readFileSync("/err", "utf8").toString()).toBe(0);
  const reopened = await Document(
    new Uint8Array(volume.readFileSync("/out") as Buffer),
    textContext
  );
  expect(reopened.paragraphs.map((value) => value.text)).toEqual(["", "Retain"]);
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});

it("uses noncreating CLI reads for a document with no auxiliary definitions", async () => {
  const input = await textFixture(paragraph("Inspect"));
  for (const args of [
    ["inspect"],
    ["comments", "list"],
    ["properties", "list"],
    ["styles", "list"]
  ]) {
    const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: [...args, "/input.docx", "--json"].map((value) => new TextEncoder().encode(value)),
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
    expect(result.exitCode, volume.readFileSync("/err", "utf8").toString()).toBe(0);
    expect(JSON.parse(volume.readFileSync("/out", "utf8").toString())).toMatchObject({
      ok: true,
      affected: 0
    });
    expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  }
});
