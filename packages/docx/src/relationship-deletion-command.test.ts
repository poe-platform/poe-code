import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  UnsupportedEditError
} from "./index.js";
import { textFixture, paragraph, textContext } from "../tests/fixtures/text.js";

const ref = (resultHandle: string) => ({ resultHandle });
const bootstrap = [
  {
    operation: "model.document.Document.styles.get",
    receiver: ref("document"),
    arguments: {},
    resultHandle: "styles"
  },
  {
    operation: "model.styles.styles.Styles.part.get",
    receiver: ref("styles"),
    arguments: {},
    resultHandle: "part"
  },
  {
    operation: "model.opc.part.XmlPart.package.get",
    receiver: ref("part"),
    arguments: {},
    resultHandle: "package"
  }
];
it.each([false, true])(
  "keeps SDK and CLI relationship deletion safe with referenced=%s",
  async (referenced) => {
    const xml = referenced
      ? '<leaf xmlns:q="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><seed q:id="rId42"/></leaf>'
      : "<leaf/>";
    const batch = {
      version: 1,
      operations: [
        ...bootstrap,
        {
          operation: "model.opc.part.XmlPart.load.call",
          arguments: {
            partname: "/records/leaf.xml",
            contentType: "application/xml",
            blob: { kind: "bytes", base64: btoa(xml) },
            ownerPackage: ref("package")
          },
          resultHandle: "loaded"
        },
        {
          operation: "model.opc.part.XmlPart.load_rel.call",
          receiver: ref("loaded"),
          arguments: { reltype: "urn:original:notes", target: ref("part"), rId: "rId42" }
        },
        {
          operation: "model.opc.part.XmlPart.drop_rel.call",
          receiver: ref("loaded"),
          arguments: { rId: "rId42" }
        }
      ]
    };
    const input = await textFixture(paragraph("Original branch"));
    if (referenced)
      await expect(applyStyleModelBatch(input, batch, textContext)).rejects.toThrow(
        UnsupportedEditError
      );
    else
      expect(
        (await applyStyleModelBatch(input, batch, textContext)).results.at(-1)!.operation
      ).toBe("model.opc.part.XmlPart.drop_rel.call");
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
    expect(result.exitCode, JSON.stringify(envelope)).toBe(referenced ? 1 : 0);
    if (referenced) {
      expect(envelope.errors[0].code).toBe("unsupported-edit");
      expect(envelope.affected).toBe(0);
    }
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
    expect(volume.readdirSync("/").sort()).toEqual(["input", "stderr", "stdout"]);
  }
);
