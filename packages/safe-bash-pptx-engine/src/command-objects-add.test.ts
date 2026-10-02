import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { readObjects, extractObject } from "./opaque-objects.js";
import { opaqueContext as context } from "../tests/fixtures/opaque-deck.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

const icon = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1, 0,
  0, 2, 2, 68, 1, 0, 59
]);
const payload = new Uint8Array([0, 255, 17, 0, 42]);
const engine = createPptxCommandEngine({ context, maxArgumentBytes: 8192, maxOutputBytes: 131072 });
async function fixture() {
  const volume = Volume.fromJSON({
    "/deck.pptx": Buffer.from(await createPresentation({ slides: [{}] }, context)),
    "/payload.bin": Buffer.from(payload),
    "/icon.gif": Buffer.from(icon)
  });
  const publications: PptxPublicationRequest[] = [];
  return {
    volume,
    publications,
    async run(args: string[]) {
      const result = await engine.execute({
        args: args.map((x) => new TextEncoder().encode(x)),
        signal: new AbortController().signal,
        async readInput(path) {
          return new Uint8Array(volume.readFileSync(path) as Buffer);
        },
        async publishOutput(item) {
          publications.push(item);
          if (!item.dryRun) volume.writeFileSync(item.outputPath, item.bytes);
        }
      });
      return { ...result, text: new TextDecoder().decode(result.stdout) };
    }
  };
}
const command = [
  "objects",
  "add",
  "/deck.pptx",
  "--slide",
  "1",
  "--file",
  "/payload.bin",
  "--icon",
  "/icon.gif",
  "--program-id",
  "Example.Archive",
  "--left",
  "1in",
  "--top",
  "2cm",
  "--width",
  "3in",
  "--height",
  "2in"
];
it("inserts inert object bytes through SDK-backed plural commands and validates discovery", async () => {
  const f = await fixture();
  const result = await f.run([...command, "--output", "/out.pptx", "--json"]);
  expect(result.exitCode, result.text).toBe(0);
  const envelope = JSON.parse(result.text);
  expect(envelope).toMatchObject({
    operation: "objects.add",
    affected: 1,
    ok: true,
    data: { activationPerformed: false, affectedSlides: [1] }
  });
  const bytes = new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer);
  const inventory = await readObjects(bytes, context);
  const embedded = inventory.objects.find((x) => x.part.startsWith("/ppt/embeddings/"))!;
  expect((await extractObject(bytes, { part: embedded.part }, context)).bytes).toEqual(payload);
  expect(f.publications[0]!.protectedInputPaths).toEqual(["/payload.bin", "/icon.gif"]);
  const schema = JSON.parse((await f.run(["schema", "objects", "add", "--json"])).text).data
    .operations["objects.add"];
  expect(compileJsonSchema(schema.result).validate(envelope).ok).toBe(true);
  const validOptions = {
    slide: 1,
    file: "/payload.bin",
    icon: "/icon.gif",
    programId: "Example.Archive",
    dryRun: true
  };
  const validate = compileJsonSchema(schema.options);
  expect(validate.validate(validOptions).ok).toBe(true);
  for (const invalid of [
    { width: { value: 0, unit: "in" } },
    { height: { value: -1, unit: "emu" } },
    { iconWidth: { value: 0, unit: "pt" } },
    { iconContentType: "text/plain" },
    { programId: "x".repeat(256) },
    { force: true },
    { inPlace: true, output: "/out.pptx" },
    { output: "-", json: true, dryRun: false },
    { dryRun: false }
  ])
    expect(validate.validate({ ...validOptions, ...invalid }).ok).toBe(false);
  const capabilities = JSON.parse((await f.run(["capabilities", "--json"])).text).data;
  expect(JSON.stringify(capabilities)).toContain('"objects.add"');
});
it("validates dry runs without publication and emits binary stdout without JSON", async () => {
  const f = await fixture();
  const result = await f.run([...command, "--dry-run", "--json"]);
  expect(result.exitCode, result.text).toBe(0);
  expect(f.publications).toHaveLength(0);
  const binary = await f.run([...command, "-o", "-"]);
  expect(binary.exitCode).toBe(0);
  expect(binary.stdout.slice(0, 2)).toEqual(new Uint8Array([80, 75]));
});
it.each([
  ["--output", "/deck.pptx"],
  ["-o", "-"],
  ["--dry-run", "--slide", "2"],
  ["--dry-run", "--select", "invalid"],
  ["--dry-run", "--scope", "shared"],
  ["--dry-run", "--all"],
  ["--dry-run", "--force"]
])("rejects conflicting or inapplicable flags before publication: %j", async (...flags) => {
  const f = await fixture();
  const result = await f.run([...command, ...flags, "--json"]);
  expect(result.exitCode).toBe(2);
  expect(f.publications).toHaveLength(0);
});

it("maps registered program enums through explicit command options", async () => {
  const f = await fixture();
  const args = command.filter(
    (_, index) =>
      index !== command.indexOf("--program-id") && index !== command.indexOf("--program-id") + 1
  );
  const result = await f.run([...args, "--program", "XLSX", "-o", "/out.pptx", "--json"]);
  expect(result.exitCode, result.text).toBe(0);
  const inventory = await readObjects(
    new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
    context
  );
  expect(
    inventory.objects.some(
      (item) =>
        item.part.endsWith(".xlsx") &&
        item.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
  ).toBe(true);
  expect((await f.run([...command, "--program", "XLSX", "--dry-run", "--json"])).exitCode).toBe(2);
});
