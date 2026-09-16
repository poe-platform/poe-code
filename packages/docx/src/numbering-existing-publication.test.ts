import { expect, it } from "vitest";
import {
  Document,
  NumberingPart,
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  type DocxBatchOperation,
  type PackageView
} from "./index.js";
import { textFixture, paragraph, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, xmlStructure } from "../tests/assertions.js";
import { publication } from "../tests/fixtures/object-publication.js";

const operations: readonly DocxBatchOperation[] = [
  {
    operation: "model.document.Document.part.get",
    receiver: { resultHandle: "document" },
    arguments: {},
    resultHandle: "main"
  },
  {
    operation: "model.parts.document.DocumentPart.package.get",
    receiver: { resultHandle: "main" },
    arguments: {},
    resultHandle: "package"
  },
  {
    operation: "model.parts.numbering.NumberingPart.new.call",
    arguments: { ownerPackage: { resultHandle: "package" } },
    resultHandle: "numbering"
  }
];
const snapshot = (owner: PackageView) =>
  owner.parts.map((part) => [part.partname.toString(), part.blob]);
function preserved(
  before: ReadonlyMap<string, Uint8Array>,
  after: ReadonlyMap<string, Uint8Array>,
  changed: readonly string[]
) {
  for (const [name, bytes] of before)
    if (!changed.includes(name)) expect(after.get(name), name).toEqual(bytes);
  assertPackageLinks(after);
  const root = xmlStructure(after.get("word/numbering.xml")!).children.find(
    (child) => typeof child !== "string"
  )!;
  if (typeof root === "string") throw new Error("Expected a numbering element");
  const namespace = root.name.slice(0, root.name.indexOf("}") + 1);
  type Node = typeof root;
  const children = (node: Node, local: string) =>
    node.children.filter(
      (child): child is Node => typeof child !== "string" && child.name === namespace + local
    );
  const id = (node: Node, local: string) => {
    const raw = node.attributes[namespace + local];
    expect(raw).toBeDefined();
    const value = Number(raw);
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    return value;
  };
  const abstracts = children(root, "abstractNum").map((node) => id(node, "abstractNumId"));
  expect(new Set(abstracts).size).toBe(abstracts.length);
  const nums = children(root, "num");
  expect(new Set(nums.map((node) => id(node, "numId"))).size).toBe(nums.length);
  for (const num of nums) {
    const references = children(num, "abstractNumId");
    expect(references).toHaveLength(1);
    expect(abstracts).toContain(id(references[0]!, "val"));
    for (const override of children(num, "lvlOverride")) {
      expect(id(override, "ilvl")).toBeLessThanOrEqual(8);
      for (const level of children(override, "lvl"))
        expect(id(level, "ilvl")).toBe(id(override, "ilvl"));
    }
  }
}
async function command(
  input: Uint8Array,
  items: readonly DocxBatchOperation[],
  flags: string[],
  env = publication(input)
) {
  env.volume.writeFileSync("/stdout", "");
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: [
      "batch",
      "/input.docx",
      "--ops-json",
      JSON.stringify({ version: 1, operations: items }),
      ...flags
    ].map((arg) => new TextEncoder().encode(arg)),
    cwd: "/",
    signal: textContext.signal,
    filesystem: env.fs,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: {
      async write(bytes) {
        env.volume.appendFileSync("/stdout", bytes);
      }
    },
    stderr: { async write() {} }
  });
  expect(env.volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  return { result, stdout: new Uint8Array(env.volume.readFileSync("/stdout") as Buffer), ...env };
}

it.each(["sdk", "cli"])(
  "publishes an existing numbering part to the requested file: %s",
  async (route) => {
    const input = await textFixture(paragraph("Existing empty numbering"), {
      numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"/>` }
    });
    const env = publication(input);
    if (route === "sdk") {
      const model = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
      expect(model.affected).toBe(0);
      const result = await model.publish(
        {
          output: "/out/copied.docx",
          input: { path: "/input.docx", stat: await env.fs.lstat("/input.docx") }
        },
        {
          ...textContext,
          filesystem: env.fs,
          encoding: { order: "input", compression: "store" }
        }
      );
      expect(result.published).toHaveLength(1);
    } else {
      const result = await command(
        input,
        operations,
        ["--output", "/out/copied.docx", "--json"],
        env
      );
      expect(result.result.exitCode).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(result.stdout))).toMatchObject({
        ok: true,
        affected: 0,
        data: { output: [{ path: "/out/copied.docx" }] }
      });
    }
    preserved(
      readPackage(input),
      readPackage(new Uint8Array(env.volume.readFileSync("/out/copied.docx") as Buffer)),
      []
    );
    expect(env.volume.readdirSync("/out")).toEqual(["copied.docx"]);
  }
);

it.each(["conflict", "failure", "dry-run", "force"])(
  "honors publication rules when numbering already exists: %s",
  async (mode) => {
    const input = await textFixture(paragraph("Keep source"), {
      numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"/>` }
    });
    const env = publication(input);
    env.volume.writeFileSync("/out/copied.docx", "Keep destination");
    env.fs.compareEntry = async (left, other, right) => {
      if (other !== env.fs) return "unknown";
      return env.volume.statSync(left).ino === env.volume.statSync(right).ino ? "same" : "distinct";
    };
    let published = 0;
    const publish = env.fs.publishStagedFile!.bind(env.fs);
    env.fs.publishStagedFile = async (...args) => {
      published++;
      if (mode === "failure") throw new Error("Original publication failure");
      await publish(...args);
    };
    const flags = [
      "--output",
      "/out/copied.docx",
      "--json",
      ...(mode === "conflict" ? [] : ["--force"]),
      ...(mode === "dry-run" ? ["--dry-run"] : [])
    ];
    const result = await command(input, operations, flags, env);
    expect(result.result.exitCode).toBe(mode === "conflict" ? 1 : mode === "failure" ? 3 : 0);
    expect(published).toBe(mode === "force" || mode === "failure" ? 1 : 0);
    expect(env.volume.readdirSync("/out")).toEqual(["copied.docx"]);
    if (mode === "force")
      preserved(
        readPackage(input),
        readPackage(new Uint8Array(env.volume.readFileSync("/out/copied.docx") as Buffer)),
        []
      );
    else expect(env.volume.readFileSync("/out/copied.docx", "utf8")).toBe("Keep destination");
  }
);

for (const strict of [false, true]) {
  it.each(["empty", "start", "level", "both"])(
    `preserves optional override children and all canonical levels; strict=${strict}: %s`,
    async (kind) => {
      const levels = Array.from({ length: 9 }, (_, index) => index);
      const xml = `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="+0">${levels.map((index) => `<w:lvl w:ilvl="${index}"/>`).join("")}</w:abstractNum><w:num w:numId="0001"><w:abstractNumId w:val="00"/>${levels.map((index) => `<w:lvlOverride w:ilvl="0${index}">${kind === "start" || kind === "both" ? '<w:startOverride w:val="0"/>' : ""}${kind === "level" || kind === "both" ? `<w:lvl w:ilvl="+${index}"/>` : ""}</w:lvlOverride>`).join("")}</w:num></w:numbering>`;
      const input = await textFixture(
        paragraph("Nine levels"),
        {
          numbering: { kind: "numbering", xml }
        },
        strict
      );
      const model = await Document(input, textContext);
      const before = snapshot(model.part.package);
      const part = NumberingPart.new(model.part.package);
      expect(part.numbering_definitions.length).toBe(1);
      expect(snapshot(model.part.package)).toEqual(before);
      const batch = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
      expect(batch.affected).toBe(0);
      const output = await command(input, operations, ["--output", "-"]);
      expect(output.result.exitCode).toBe(0);
      preserved(readPackage(input), readPackage(output.stdout), []);
      const reopened = await Document(output.stdout, textContext);
      expect(reopened.part.numbering_part.blob).toEqual(part.blob);
    }
  );
}
