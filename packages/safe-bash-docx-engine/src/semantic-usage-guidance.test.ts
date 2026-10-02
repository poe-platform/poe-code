import { expect, it } from "vitest";
import { Volume } from "memfs";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";

it.each([
  [
    "properties set",
    ["properties", "set", "-", "--name", "PrivateReview", "--value", "false", "--dry-run", "--json"]
  ],
  [
    "template apply",
    [
      "template",
      "apply",
      "-",
      "--data-json",
      '{"values":[{"binding":"PrivateMissing","value":"PrivateText"}]}',
      "--dry-run",
      "--json"
    ]
  ]
])("gives semantic usage failures the %s help route without leaking data", async (path, args) => {
  const input = await textFixture(
    '<w:sdt><w:sdtPr><w:id w:val="20"/><w:tag w:val="heading"/><w:text/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>PrivateBody</w:t></w:r></w:p></w:sdtContent></w:sdt>'
  );
  const fs = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map((value) => new TextEncoder().encode(value)),
    cwd: "/",
    signal: textContext.signal,
    filesystem: {
      async readFile() {
        throw new Error("Unexpected filesystem read");
      }
    },
    stdin: {
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array(fs.readFileSync("/input") as Buffer);
      }
    },
    stdout: {
      async write(bytes) {
        fs.appendFileSync("/out", bytes);
      }
    },
    stderr: {
      async write(bytes) {
        fs.appendFileSync("/err", bytes);
      }
    }
  });
  const envelope = JSON.parse(String(fs.readFileSync("/out")));
  const human = String(fs.readFileSync("/err"));
  expect(result.exitCode).toBe(2);
  expect(envelope).toMatchObject({
    operation: path.split(" ").join("."),
    ok: false,
    data: null,
    affected: 0,
    errors: [{ code: "usage" }]
  });
  expect(new Uint8Array(fs.readFileSync("/input") as Buffer)).toEqual(input);
  expect(envelope.errors[0].message).toContain(`docx help ${path}`);
  expect(human).toContain(`docx help ${path}`);
  expect(human).not.toContain("Private");
  expect(envelope.errors[0].message).not.toContain("Private");
});
