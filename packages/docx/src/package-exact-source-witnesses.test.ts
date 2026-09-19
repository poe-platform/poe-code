import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { packageSourceCases, packageSourceImages } from "../tests/fixtures/package-exact-source.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const ref = (resultHandle: string) => ({ resultHandle }), enc = (s: string) => new TextEncoder().encode(s);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const c of packageSourceCases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact package witness R${c.row}; ${kind}; strict=${strict}`, async () => {
  const images = packageSourceImages(c), parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p><!--retained--><?policy keep?>', {}, strict));
  let types = new TextDecoder().decode(parts.get("[Content_Types].xml"));
  for (const image of images.retained) { parts.set(image.name, image.bytes); types = types.replace("</Types>", `<Override PartName="/${image.name}" ContentType="${image.type}"/></Types>`); }
  parts.set("[Content_Types].xml", enc(kind === "dotx" ? types.replace("document.main+xml", "template.main+xml") : types));
  const v = Volume.fromJSON({ "/input": "", "/out": "", ["/media/" + (c.action === "gather" ? "image.png" : c.filename)]: Buffer.from(images.input) });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), context = { ...textContext, binaryResolver: { capability: "command", open(path: string) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(v.readFileSync(path) as Buffer); } }; } } }, sink = { async write(bytes: Uint8Array) { v.appendFileSync("/out", bytes); } };
  const operations: Record<string, unknown>[] = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.package.Package.image_parts.get", receiver: ref("package"), arguments: {}, resultHandle: "images" }
  ];
  if (c.action === "gather") operations.push({ operation: "model.package.Package.after_unmarshal.call", receiver: ref("package"), arguments: {} }, { operation: "model.package.ImageParts.__iter__.call", receiver: ref("images"), arguments: {} });
  else operations.push({ operation: `model.package.${c.action === "package-add" ? "Package" : "ImageParts"}.get_or_add_image_part.call`, receiver: ref(c.action === "package-add" ? "package" : "images"), arguments: { imageDescriptor: { kind: "vfs", path: "/media/" + c.filename, capability: "command" } }, resultHandle: "image" }, { operation: "model.parts.image.ImagePart.partname.get", receiver: ref("image"), arguments: {} }, { operation: "model.package.ImageParts.__contains__.call", receiver: ref("images"), arguments: { value: ref("image") } });
  operations.push({ operation: "model.package.ImageParts.__len__.get", receiver: ref("images"), arguments: {} });
  const observe = (values: unknown[]) => { expect(values.at(-1)).toBe(c.count); if (c.action === "gather") { const entries = values.at(-2) as { type: string }[]; expect(entries).toHaveLength(3); expect(entries.every(i => i.type === "ImagePart")).toBe(true); } else { expect(values.at(-3)).toBe(c.expected); expect(values.at(-2)).toBe(true); } };
  if (route === "model") {
    const doc = await api.Document(input, context), owner = doc.part.package;
    if (c.action === "gather") { owner.after_unmarshal(); expect([...owner.image_parts]).toHaveLength(3); expect([...owner.image_parts].every(i => i instanceof api.ImagePartView)).toBe(true); }
    else { const descriptor = { path: "/media/" + c.filename, capability: "command" }, image = await (c.action === "package-add" ? owner : owner.image_parts).get_or_add_image_part(descriptor); expect(image.partname.toString()).toBe(c.expected); expect(owner.image_parts.has(image)).toBe(true); expect(image.blob).toEqual(images.input); if (c.action === "match") expect(await owner.image_parts.get_or_add_image_part(descriptor)).toBe(image); }
    expect(owner.image_parts.length).toBe(c.count); await doc.save(sink);
  } else if (route === "sdk") { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context); observe(result.results.map(r => r.value)); await result.save(sink); }
  else { const fs = new MemoryFileSystem(); await fs.mkdir("/media"); if (c.action !== "gather") await fs.writeFile("/media/" + c.filename, images.input); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) })); try { const r = await shell.exec("docx batch /input --ops-file /ops --json" + (c.action === "gather" ? "" : " --output /out")); expect(r.exitCode, r.stdout + r.stderr).toBe(0); observe(JSON.parse(r.stdout).data.results.map((i: { data: unknown }) => i.data)); v.writeFileSync("/out", c.action === "gather" ? input : await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  const output = new Uint8Array(v.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  for (const [name, bytes] of parts) if (name !== "[Content_Types].xml" || ["match", "gather"].includes(c.action)) expect(saved.get(name), name).toEqual(bytes);
  if (c.action !== "gather") expect(saved.get(c.expected.slice(1))).toEqual(images.input);
  const reopened = await api.Document(output, context); expect(reopened.part.package.image_parts.length).toBe(c.count); expect(reopened.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊"); expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});
