import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, getDocxDiscovery, parseDocxArguments } from "./index.js";
import { textContext as context, textFixture, paragraph } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

async function run(args: string[], template?: Uint8Array) {
  const volume = Volume.fromJSON({ "/content": JSON.stringify({ version: 1, blocks: [{ kind: "paragraph", text: "港湾 🌊" }] }), "/stdout": "", "/stderr": "", "/existing": "keep" });
  if (template) volume.writeFileSync("/template", template);
  let reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: context.limits }).execute({
    args: args.map(arg => new TextEncoder().encode(arg)), cwd: "/", signal: context.signal,
    filesystem: { async readFile(path) { reads++; return new Uint8Array(volume.readFileSync(path) as Buffer); }, async lstat(path) {
      const value = volume.lstatSync(path);
      return { type: "file", size: value.size, mode: value.mode, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, ino: value.ino, dev: value.dev, nlink: value.nlink, identityScope: volume };
    } },
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync("/content") as Buffer); } },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  return { result, volume, reads };
}
it("creates binary stdout from inline, file and stdin content", async () => {
  for (const flags of [["--content-json", '{"version":1,"blocks":[{"kind":"paragraph","text":"港湾 🌊"}]}'], ["--content-file", "/content"], ["--content-file", "-"]]) {
    const { result, volume } = await run(["create", "--kind", "dotx", "--dialect", "strict", ...flags, "-o", "-"]);
    expect(result.exitCode).toBe(0);
    const parts = readPackage(new Uint8Array(volume.readFileSync("/stdout") as Buffer));
    assertPackageLinks(parts);
    expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("港湾 🌊");
    expect(volume.readFileSync("/stderr", "utf8")).toBe("");
  }
});
it("creates JSON dry-runs and preserves templates on kind conflicts", async () => {
  const result = await run(["create", "--content-file", "/content", "--dry-run", "--json"]);
  expect(result.result.exitCode).toBe(0);
  expect(JSON.parse(String(result.volume.readFileSync("/stdout", "utf8")))).toMatchObject({ operation: "create", ok: true, affected: 1, data: { changed: true, dryRun: true, output: null } });
  const template = await textFixture(paragraph("Template coast"));
  const conflict = await run(["create", "--template", "/template", "--kind", "dotx", "--output", "/existing", "--force", "--json"], template);
  expect(conflict.result.exitCode).toBe(1);
  expect(conflict.volume.readFileSync("/existing", "utf8")).toBe("keep");
  expect(new Uint8Array(conflict.volume.readFileSync("/template") as Buffer)).toEqual(template);
});
it("discovers creation while retaining pending operations", () => {
  const discover = (...args: string[]) => getDocxDiscovery(parseDocxArguments(args.map(arg => new TextEncoder().encode(arg))))!;
  expect(discover("schema", "create").data).toMatchObject({ operations: [{ id: "create", support: "edit" }] });
  expect(discover("schema", "template", "apply").data).toMatchObject({ operations: [{ support: "reject" }] });
  expect(discover("help", "create").human).toContain("append");
});
