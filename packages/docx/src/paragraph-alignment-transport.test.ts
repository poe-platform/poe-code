import { expect, it, vi } from "vitest";
import {
  Document,
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  editDocumentParagraphs,
  type PublicationOptions
} from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { publication } from "../tests/fixtures/object-publication.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const setter = "model.text.paragraph.Paragraph.alignment.set";
const source = "/out/input.docx";
const destination = "/out/result.docx";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function batch(value: unknown = null) {
  return {
    version: 1,
    operations: [
      {
        operation: "model.document.Document.paragraphs.get",
        receiver: { resultHandle: "document" },
        arguments: {},
        resultHandle: "paragraphs"
      },
      {
        operation: setter,
        receiver: { resultHandle: "paragraphs", index: 0 },
        arguments: { value }
      }
    ]
  };
}
function fixture(strict = false, direct = true) {
  return textFixture(
    `<w:p><w:pPr><w:pStyle w:val="Survey"/><w:keepNext w:val="0"/>${direct ? '<w:jc w:val="center"/>' : ""}</w:pPr><w:r><w:t>Coastal notes</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Unselected</w:t></w:r></w:p>`,
    {
      styles: {
        kind: "styles",
        xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Survey"><w:name w:val="Survey"/><w:pPr><w:jc w:val="${strict ? "end" : "right"}"/></w:pPr></w:style></w:styles>`
      }
    },
    strict
  );
}
function environment(input: Uint8Array) {
  const env = publication(input);
  env.volume.renameSync("/input.docx", source);
  env.volume.writeFileSync(destination, "Prior output must survive failure");
  env.fs.compareEntry = async (left, other, right) =>
    other !== env.fs
      ? "unknown"
      : env.volume.statSync(left).ino === env.volume.statSync(right).ino
        ? "same"
        : "distinct";
  const publish = vi.spyOn(env.fs, "publishStagedFile");
  return { ...env, publish };
}
async function command(
  env: ReturnType<typeof environment>,
  words: string[],
  stdin = new Uint8Array()
) {
  env.volume.writeFileSync("/stdout", "");
  env.volume.writeFileSync("/stderr", "");
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: words.map((word) => encoder.encode(word)),
    cwd: "/",
    signal: textContext.signal,
    filesystem: env.fs,
    stdin: {
      async *[Symbol.asyncIterator]() {
        yield stdin;
      }
    },
    stdout: {
      async write(bytes) {
        env.volume.appendFileSync("/stdout", bytes);
      }
    },
    stderr: {
      async write(bytes) {
        env.volume.appendFileSync("/stderr", bytes);
      }
    }
  });
  return {
    ...result,
    stdout: new Uint8Array(env.volume.readFileSync("/stdout") as Uint8Array),
    stderr: env.volume.readFileSync("/stderr", "utf8") as string
  };
}
async function assertReset(bytes: Uint8Array, strict = false) {
  const actual = readPackage(bytes),
    expected = readPackage(await fixture(strict, false));
  expect([...actual.keys()]).toEqual([...expected.keys()]);
  for (const [name, payload] of expected) {
    if (name === "word/document.xml")
      expect(xmlStructure(actual.get(name)!)).toEqual(xmlStructure(payload));
    else expect(actual.get(name), name).toEqual(payload);
  }
  const document = await Document(bytes, textContext);
  expect(document.paragraphs[0]!.alignment).toBeNull();
  expect(document.paragraphs[0]!.style!.paragraph_format.alignment?.name).toBe("RIGHT");
  expect(document.paragraphs[0]!.paragraph_format.keep_with_next).toBe(false);
  expect(document.paragraphs[1]!.alignment?.name).toBe("CENTER");
}

for (const strict of [false, true]) {
  it.each(["inline", "bom-file", "ops-stdin", "doc-stdin", "direct-stdin"])(
    `resets alignment through %s input; strict=${strict}`,
    async (route) => {
      const input = await fixture(strict),
        env = environment(input),
        json = JSON.stringify(batch());
      env.volume.writeFileSync("/ops.json", "\uFEFF" + json);
      const words =
        route === "direct-stdin"
          ? ["paragraphs", "set", "-", "--paragraph=1", "--alignment=null"]
          : [
              "batch",
              route === "doc-stdin" ? "-" : source,
              ...(route === "bom-file"
                ? ["--ops-file", "/ops.json"]
                : route === "ops-stdin"
                  ? ["--ops-file", "-"]
                  : ["--ops-json", json])
            ];
      const result = await command(
        env,
        [...words, "--output", "-"],
        route === "ops-stdin" ? encoder.encode(json) : input
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      await assertReset(result.stdout, strict);
      expect(env.volume.readFileSync(source)).toEqual(Buffer.from(input));
      expect(env.volume.readFileSync(destination, "utf8")).toBe(
        "Prior output must survive failure"
      );
      expect(env.publish).not.toHaveBeenCalled();
    }
  );
}

it.each(
  (["sdk", "cli-batch", "cli-direct"] as const).flatMap((route) =>
    (["new", "force", "in-place", "conflict", "dry-run", "dry-run-stdout"] as const).map(
      (mode) => ({ route, mode })
    )
  )
)("honors $mode publication through $route", async ({ route, mode }) => {
  const input = await fixture(),
    env = environment(input);
  if (mode === "new") env.volume.unlinkSync(destination);
  const options: PublicationOptions =
    mode === "in-place"
      ? { inPlace: true }
      : mode === "dry-run-stdout"
        ? { output: "-", dryRun: true, json: true }
        : {
            output: destination,
            ...(mode === "force" || mode === "dry-run" ? { force: true } : {}),
            ...(mode === "dry-run" ? { dryRun: true } : {})
          };
  if (route === "sdk") {
    const edited = await applyStyleModelBatch(input, batch(), textContext);
    const write = vi.fn();
    const pending = edited.publish(
      { ...options, input: { path: source, stat: await env.fs.lstat(source) } },
      {
        ...textContext,
        filesystem: env.fs,
        encoding: { order: "input", compression: "store" },
        stdout: { write }
      }
    );
    if (mode === "conflict") await expect(pending).rejects.toMatchObject({ code: "conflict" });
    else await pending;
    expect(write).not.toHaveBeenCalled();
  } else {
    const words =
      route === "cli-batch"
        ? ["batch", source, "--ops-json", JSON.stringify(batch())]
        : ["paragraphs", "set", source, "--paragraph", "1", "--alignment", "null"];
    const flags = [
      "--json",
      ...(options.inPlace ? ["--in-place"] : ["--output", options.output!]),
      ...(options.force ? ["--force"] : []),
      ...(options.dryRun ? ["--dry-run"] : [])
    ];
    const result = await command(env, [...words, ...flags]);
    expect(result.exitCode, result.stderr).toBe(mode === "conflict" ? 1 : 0);
    const envelope = JSON.parse(decoder.decode(result.stdout));
    expect(envelope.ok).toBe(mode !== "conflict");
    if (options.dryRun) expect((route === "cli-batch" ? envelope.data.publication : envelope.data).dryRun).toBe(true);
    if (mode === "conflict")
      expect(envelope).toMatchObject({ affected: 0, data: null, errors: [{ code: "conflict" }] });
  }
  const publishes = ["new", "force", "in-place"].includes(mode);
  expect(env.publish).toHaveBeenCalledTimes(publishes ? 1 : 0);
  if (publishes)
    await assertReset(
      new Uint8Array(
        env.volume.readFileSync(mode === "in-place" ? source : destination) as Uint8Array
      )
    );
  if (mode !== "in-place") expect(env.volume.readFileSync(source)).toEqual(Buffer.from(input));
  if (!["new", "force"].includes(mode))
    expect(env.volume.readFileSync(destination, "utf8")).toBe("Prior output must survive failure");
  expect(env.volume.readdirSync("/out").sort()).toEqual(["input.docx", "result.docx"]);
});

const invalidTokens = [
  "NULL",
  "undefined",
  "false",
  "0",
  "",
  "center",
  " CENTER",
  "CENTER ",
  "MIDDLE",
  "WD_TAB_ALIGNMENT.CENTER"
];
const invalidObjects = [
  "null",
  [],
  {},
  { enum: "WD_PARAGRAPH_ALIGNMENT", name: null },
  { enum: "WD_PARAGRAPH_ALIGNMENT", name: "center" },
  { enum: "WD_ALIGN_PARAGRAPH", name: "CENTER" }
];
it.each([
  ...invalidTokens.map((value) => ({ route: "direct", value })),
  ...invalidObjects.map((value) => ({ route: "batch", value }))
])("rejects malformed $route input $value without replacing any file", async ({ route, value }) => {
  const input = await fixture(),
    env = environment(input);
  const operations = batch(value);
  operations.operations.splice(1, 0, batch().operations[1]!);
  const words =
    route === "direct"
      ? ["paragraphs", "set", source, "--paragraph", "1", "--alignment", String(value)]
      : ["batch", source, "--ops-json", JSON.stringify(operations)];
  for (const flags of [["--output", destination, "--force"], ["--in-place"]]) {
    const result = await command(env, [...words, ...flags, "--json"]);
    expect(result.exitCode, result.stderr).toBe(2);
    expect(JSON.parse(decoder.decode(result.stdout))).toMatchObject({
      ok: false,
      affected: 0,
      data: null,
      errors: [{ code: "usage" }]
    });
    expect(env.publish).not.toHaveBeenCalled();
    expect(env.volume.readFileSync(source)).toEqual(Buffer.from(input));
    expect(env.volume.readFileSync(destination, "utf8")).toBe("Prior output must survive failure");
    expect(env.volume.readdirSync("/out").sort()).toEqual(["input.docx", "result.docx"]);
  }
});

it("rejects null for a nonnullable setter after a valid reset without publication", async () => {
  const input = await fixture(),
    env = environment(input);
  const operations = {
    version: 1,
    operations: [
      ...batch().operations,
      {
        operation: "model.document.Document.core_properties.get",
        receiver: { resultHandle: "document" },
        arguments: {},
        resultHandle: "properties"
      },
      {
        operation: "model.opc.coreprops.CoreProperties.revision.set",
        receiver: { resultHandle: "properties" },
        arguments: { value: null }
      }
    ]
  };
  const result = await command(env, [
    "batch",
    source,
    "--ops-json",
    JSON.stringify(operations),
    "--output",
    destination,
    "--force",
    "--json"
  ]);
  expect(result.exitCode, result.stderr).toBe(2);
  expect(JSON.parse(decoder.decode(result.stdout))).toMatchObject({
    ok: false,
    affected: 0,
    errors: [{ code: "usage" }]
  });
  expect(env.publish).not.toHaveBeenCalled();
  expect(env.volume.readFileSync(source)).toEqual(Buffer.from(input));
  expect(env.volume.readFileSync(destination, "utf8")).toBe("Prior output must survive failure");
});

it.each([undefined, null])(
  "keeps optional alignment %s distinct from false formatting",
  async (alignment) => {
    const input = await fixture(),
      env = environment(input);
    env.volume.writeFileSync("/saved.docx", "");
    await editDocumentParagraphs(
      input,
      {
        operation: "paragraphs.set",
        options: { paragraph: 1, alignment, keepWithNext: false, output: "-" }
      },
      {
        ...textContext,
        encoding: { order: "input", compression: "store" },
        stdout: {
          async write(bytes) {
            env.volume.appendFileSync("/saved.docx", bytes);
          }
        }
      }
    );
    const bytes = new Uint8Array(env.volume.readFileSync("/saved.docx") as Uint8Array);
    const document = await Document(bytes, textContext);
    expect(document.paragraphs[0]!.alignment).toEqual(
      alignment === null ? null : { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" }
    );
    expect(document.paragraphs[0]!.paragraph_format.keep_with_next).toBe(false);
    if (alignment === null) await assertReset(bytes);
    else expect(readPackage(bytes)).toEqual(readPackage(input));
  }
);

it.each(["sdk", "cli"])(
  "discards a valid reset before a failing receiver through %s",
  async (route) => {
    const input = await fixture(),
      env = environment(input),
      operations = batch();
    operations.operations.push({
      operation: setter,
      receiver: { resultHandle: "paragraphs", index: 999 },
      arguments: { value: null }
    });
    if (route === "sdk") {
      const sink = vi.fn();
      await expect(
        (async () => {
          const edited = await applyStyleModelBatch(input, operations, textContext);
          await edited.save({ write: sink });
        })()
      ).rejects.toThrow();
      expect(sink).not.toHaveBeenCalled();
    } else {
      const result = await command(env, [
        "batch",
        source,
        "--ops-json",
        JSON.stringify(operations),
        "--output",
        destination,
        "--force",
        "--json"
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(decoder.decode(result.stdout))).toMatchObject({
        ok: false,
        affected: 0,
        data: null
      });
    }
    expect(env.publish).not.toHaveBeenCalled();
    expect(env.volume.readFileSync(source)).toEqual(Buffer.from(input));
    expect(env.volume.readFileSync(destination, "utf8")).toBe("Prior output must survive failure");
  }
);
