import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine, type DocxOperationArguments, type DocxBatchItem } from "./index.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";

it.each(["", '<w:jc w:val="center"/>'])(
  "resets paragraph alignment through SDK and CLI from %s",
  async (alignment) => {
    const input = await textFixture(
      `<w:p><w:pPr>${alignment}<w:keepNext w:val="0"/></w:pPr><w:r><w:t>海岸 🌊</w:t></w:r></w:p>`
    );
    const volume = Volume.fromJSON({
      "/input": Buffer.from(input),
      "/sdk": "",
      "/cli": "",
      "/err": ""
    });
    const resetArguments = { value: null } satisfies DocxOperationArguments<"model.text.paragraph.Paragraph.alignment.set">;
    const reset = {
      operation: "model.text.paragraph.Paragraph.alignment.set",
      receiver: { resultHandle: "paragraphs", index: 0 },
      arguments: resetArguments
    } satisfies DocxBatchItem;
    const operations = [
      {
        operation: "model.document.Document.paragraphs.get",
        receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 },
        arguments: {},
        resultHandle: "paragraphs"
      },
      reset,
      {
        operation: "model.text.paragraph.Paragraph.alignment.get",
        receiver: { resultHandle: "paragraphs", index: 0 },
        arguments: {}
      }
    ];
    const direct = await Document(input, textContext);
    direct.paragraphs[0]!.alignment = null;
    expect(direct.paragraphs[0]!.alignment).toBeNull();
    const applied = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(applied.results.at(-1)?.value).toBeNull();
    await applied.save({
      async write(bytes) {
        volume.appendFileSync("/sdk", bytes);
      }
    });
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: [
        "batch",
        "/input",
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
          volume.appendFileSync("/cli", bytes);
        }
      },
      stderr: {
        async write(bytes) {
          volume.appendFileSync("/err", bytes);
        }
      }
    });
    expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    for (const path of ["/sdk", "/cli"]) {
      const reopened = await Document(
        new Uint8Array(volume.readFileSync(path) as Buffer),
        textContext
      );
      const paragraph = reopened.paragraphs[0]!;
      expect(paragraph.alignment).toBeNull();
      expect(paragraph.paragraph_format.keep_with_next).toBe(false);
      expect(new TextDecoder().decode(paragraph.element.serialize())).toBe(
        `<w:p xmlns:w="${w}" xmlns:r="${r}"><w:pPr${alignment ? ` xmlns:w="${w}" xmlns:r="${r}"` : ""}><w:keepNext w:val="0"/></w:pPr><w:r><w:t>海岸 🌊</w:t></w:r></w:p>`
      );
    }
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);
