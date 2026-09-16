import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, Inches, createDocxInspectionCommandEngine } from "./index.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

it("describes live inline image routes only after SDK and CLI save/reload succeed", async () => {
  const input = await textFixture(paragraph("Estuary measurements"));
  const bytes = rasterPng();
  const document = await Document(input, textContext);
  const pending = document.add_picture(bytes, Inches(2));
  expect(pending).toBeInstanceOf(Promise);
  const picture = await pending;
  picture.width = Inches(3);
  const files = Volume.fromJSON({
    "/input.docx": Buffer.from(input),
    "/sdk.docx": "",
    "/stdout": "",
    "/stderr": ""
  });
  await document.save({
    async write(chunk) {
      files.appendFileSync("/sdk.docx", chunk);
    }
  });
  const operations = [
    {
      operation: "model.document.Document.add_picture.call",
      receiver: { resultHandle: "document" },
      arguments: {
        input: { kind: "bytes", base64: Buffer.from(bytes).toString("base64") },
        width: { value: 2, unit: "in" }
      },
      resultHandle: "picture"
    },
    {
      operation: "model.shape.InlineShape.width.set",
      receiver: { resultHandle: "picture" },
      arguments: { value: { value: 3, unit: "in" } }
    }
  ];
  const engine = createDocxInspectionCommandEngine({ limits: textContext.limits });
  async function execute(words: string[]) {
    files.writeFileSync("/stdout", "");
    files.writeFileSync("/stderr", "");
    const result = await engine.execute({
      args: words.map((word) => new TextEncoder().encode(word)),
      cwd: "/",
      signal: textContext.signal,
      filesystem: {
        async readFile(path) {
          return new Uint8Array(files.readFileSync(path) as Buffer);
        }
      },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: {
        async write(chunk) {
          files.appendFileSync("/stdout", chunk);
        }
      },
      stderr: {
        async write(chunk) {
          files.appendFileSync("/stderr", chunk);
        }
      }
    });
    expect(result.exitCode, files.readFileSync("/stderr", "utf8") as string).toBe(0);
    expect(files.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    return new Uint8Array(files.readFileSync("/stdout") as Buffer);
  }
  const cli = await execute([
    "batch",
    "/input.docx",
    "--ops-json",
    JSON.stringify({ version: 1, operations }),
    "--output",
    "-"
  ]);
  for (const output of [cli, new Uint8Array(files.readFileSync("/sdk.docx") as Buffer)]) {
    const reopened = await Document(output, textContext);
    expect(reopened.paragraphs.at(0)!.text).toBe("Estuary measurements");
    expect(reopened.inline_shapes.length).toBe(1);
    expect(reopened.inline_shapes.at(0).width.inches).toBe(3);
    expect(reopened.inline_shapes.at(0).height.inches).toBe(2);
    const imageParts = [...reopened.part.package.image_parts];
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0]!.blob).toEqual(bytes);
  }
  for (const action of ["add", "set", "replace"]) {
    const help = new TextDecoder().decode(await execute(["help", "images", action]));
    expect(help).toContain(
      "Live inline picture sizing and collection lookup are available through declared typed model routes."
    );
    expect(help).not.toContain("live drawing/collection models remain unsupported");
    expect(help).not.toContain("live image-part, drawing and collection models remain pending");
  }
  const capabilities = JSON.parse(
    new TextDecoder().decode(await execute(["capabilities", "--json"]))
  );
  const reasons = capabilities.data.features.flatMap((feature: { subsets: { reason: string }[] }) =>
    feature.subsets.map((subset) => subset.reason)
  ) as string[];
  expect(
    reasons.some((reason) =>
      reason.includes("Live inline picture sizing and collection lookup are available")
    )
  ).toBe(true);
  for (const reason of reasons) {
    expect(reason).not.toContain("drawing occurrence models remain unsupported");
    expect(reason).not.toContain("live drawing/collection models remain unsupported");
    expect(reason).not.toContain("live image-part/drawing/collection models remain unsupported");
  }
});
