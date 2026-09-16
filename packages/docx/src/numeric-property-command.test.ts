import { expect, it } from "vitest";
import { Volume } from "memfs";
import { applyStyleModelBatch, createDocxInspectionCommandEngine } from "./index.js";
import { textFixture, paragraph, textContext, w } from "../tests/fixtures/text.js";

const ref = (resultHandle: string) => ({ resultHandle });
it.each([0, null, 24, 0.5, -4])("checks SDK and CLI priority assignment %s", async (value) => {
  const operations = [
    {
      operation: "model.document.Document.styles.get",
      receiver: ref("document"),
      arguments: {},
      resultHandle: "styles"
    },
    {
      operation: "model.styles.styles.Styles.__getitem__.call",
      receiver: ref("styles"),
      arguments: { key: "Normal" },
      resultHandle: "style"
    },
    {
      operation: "model.styles.style.ParagraphStyle.priority.set",
      receiver: ref("style"),
      arguments: { value }
    },
    {
      operation: "model.styles.style.ParagraphStyle.priority.get",
      receiver: ref("style"),
      arguments: {}
    }
  ];
  const valid = value === null || (Number.isInteger(value) && value >= 0);
  const batch = { version: 1, operations };
  const input = await textFixture(paragraph("Original canopy"), {
    styles: {
      kind: "styles",
      xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`
    }
  });
  if (valid)
    expect((await applyStyleModelBatch(input, batch, textContext)).results.at(-1)!.value).toBe(
      value
    );
  else await expect(applyStyleModelBatch(input, batch, textContext)).rejects.toThrow();
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/stdout": "", "/stderr": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input", "--ops-json", JSON.stringify(batch), "--dry-run", "--json"].map(
      (arg) => new TextEncoder().encode(arg)
    ),
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
        volume.appendFileSync("/stdout", bytes);
      }
    },
    stderr: {
      async write(bytes) {
        volume.appendFileSync("/stderr", bytes);
      }
    }
  });
  const envelope = JSON.parse(volume.readFileSync("/stdout", "utf8") as string);
  expect(result.exitCode, JSON.stringify(envelope)).toBe(valid ? 0 : 2);
  if (valid) expect(envelope.data.results.at(-1).value).toBe(value);
  else {
    expect(envelope.errors[0].code).toBe("usage");
    expect(envelope.affected).toBe(0);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
