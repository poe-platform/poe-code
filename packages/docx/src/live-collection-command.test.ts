import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it("executes live occurrence and shared-resource collection lengths through the public CLI", async () => {
  const input = await textFixture(paragraph("Station images"));
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/stdout": "", "/stderr": "" });
  const ref = (resultHandle: string) => ({ resultHandle });
  const image = { kind: "bytes", base64: btoa(String.fromCharCode(...rasterPng())) };
  const operations = [
    { operation: "model.document.Document.add_picture.call", receiver: ref("document"), arguments: { input: image } },
    { operation: "model.document.Document.add_picture.call", receiver: ref("document"), arguments: { input: image } },
    { operation: "model.document.Document.inline_shapes.get", receiver: ref("document"), arguments: {}, resultHandle: "shapes" },
    { operation: "model.shape.InlineShapes.__len__.get", receiver: ref("shapes"), arguments: {} },
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package" },
    { operation: "model.package.Package.image_parts.get", receiver: ref("package"), arguments: {}, resultHandle: "images" },
    { operation: "model.package.ImageParts.__len__.get", receiver: ref("images"), arguments: {} }
  ];
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input", "--ops-json", JSON.stringify({ version: 1, operations }), "--dry-run", "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode).toBe(0);
  const envelope = JSON.parse(volume.readFileSync("/stdout", "utf8") as string);
  expect(envelope).toMatchObject({ version: 1, operation: "batch", ok: true, affected: 2, errors: [] });
  expect(envelope.data.results[3].value).toBe(2);
  expect(envelope.data.results[7].value).toBe(1);
  expect(volume.readFileSync("/stderr", "utf8")).toBe("");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
