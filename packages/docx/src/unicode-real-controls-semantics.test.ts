import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

// Original scalar identities: these are real controls, not backslash-u text.
const examples = [
  { name: "directional isolates", points: [0x41, 0x20, 0x2067, 0x65e5, 0x672c, 0x20, 0x05d0, 0x05d1, 0x2069, 0x20, 0x5a] },
  { name: "embedding and direction marks", points: [0x202b, 0x05d0, 0x05d1, 0x202c, 0x20, 0x200f, 0x0631, 0x200e] },
  { name: "combining order and compatibility", points: [0x65, 0x301, 0x323, 0x20, 0x212b, 0xfb01, 0xdf] },
  { name: "joining controls", points: [0x0627, 0x200c, 0x0644, 0x200d, 0x064a] },
  { name: "supplementary CJK and variation", points: [0x20000, 0xe0100, 0x20, 0x4e00, 0xfe00, 0x20, 0x1f469, 0x200d, 0x1f4bb] },
  { name: "interior BOM and word joiner", points: [0xfeff, 0x41, 0x2060, 0x42, 0xfeff] },
] as const;
const replacementPoints = [0x2067, 0x5cb8, 0x05d0, 0x2069, 0x200c, 0x65, 0x323, 0x301, 0x20000];
const replacement = String.fromCodePoint(...replacementPoints);
const routes = {
  read: ["model", "sdk", "sdk-batch", "cli", "cli-batch"],
  replace: ["sdk", "sdk-batch", "cli", "cli-batch"],
  create: ["model", "sdk", "cli"],
} as const;

for (const strict of [false, true]) for (const example of examples)
  for (const mode of ["read", "replace", "create"] as const) for (const route of routes[mode]) {
    it(`preserves real ${example.name} scalars ${strict}/${mode}/${route}`, async () => {
      const text = String.fromCodePoint(...example.points), cut = Math.floor(example.points.length / 2);
      const left = String.fromCodePoint(...example.points.slice(0, cut)), right = String.fromCodePoint(...example.points.slice(cut));
      const body = `<w:p><w:pPr><w:bidi/><w:keepNext/></w:pPr><w:r><w:rPr><w:i/><w:rtl/><w:rFonts w:eastAsia="日本 Serif" w:cs="RTL Serif"/><w:lang w:val="he-IL" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr><w:t>Before ${left}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>${right} After</w:t></w:r></w:p><!--retained--><?audit keep?>`;
      const input = await textFixture(body, {}, strict), before = input.slice(), parts = readPackage(input);
      const volume = Volume.fromJSON({ "/sink": "" });
      const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/sink", bytes); } };
      const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", before); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
      const shell = route.startsWith("cli") ? new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})) : null;
      let output: Uint8Array | undefined, actual: string | undefined;
      try {
        if (mode === "read") {
          const batch = {version: 1 as const, operations: [{operation: "text.get" as const, arguments: {}}]};
          if (route === "model") actual = (await api.Document(input, textContext)).paragraphs[0]!.text;
          else if (route === "sdk") actual = (await api.extractDocumentText(input, textContext)).text;
          else if (route === "sdk-batch") actual = (await api.executeDocumentBatch(input, batch, {}, context)).results[0]!.data as string;
          else {
            const r = await shell!.exec(route === "cli" ? "docx text get /input --json" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --json`);
            expect(r.exitCode, r.stdout + r.stderr).toBe(0);
            const e = JSON.parse(r.stdout); expect(e.affected).toBe(0); expect(e.errors).toEqual([]);
            actual = route === "cli" ? e.data.text : e.data.results[0].data.text;
            if (route === "cli-batch") expect(e.data.publication).toBeNull();
          }
          // Batch SDK returns the same closed extraction result, not CLI data.
          if (typeof actual === "object" && actual !== null) actual = (actual as {text: string}).text;
          expect(actual).toBe(`Before ${text} After`);
          expect(Array.from(actual!, c => c.codePointAt(0))).toEqual([0x42, 0x65, 0x66, 0x6f, 0x72, 0x65, 0x20, ...example.points, 0x20, 0x41, 0x66, 0x74, 0x65, 0x72]);
        } else if (mode === "replace") {
          const args = {find: text, with: replacement, all: true}, batch = {version: 1 as const, operations: [{operation: "text.replace" as const, arguments: args}]};
          if (route === "sdk") await api.replaceDocumentText(input, {...args, output: "-"}, context);
          else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, {output: "-"}, context);
          else {
            const r = await shell!.exec((route === "cli" ? `docx text replace /input --find '${text}' --with '${replacement}' --all` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`) + " --output /destination --force --json");
            expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).affected).toBe(1);
            output = await fs.readFile("/destination");
          }
          output ??= new Uint8Array(volume.readFileSync("/sink") as Buffer);
          const saved = readPackage(output), d = await api.Document(output, textContext), p = d.paragraphs[0]!;
          expect(p.text).toBe(`Before ${replacement} After`);
          expect(Array.from(p.text, c => c.codePointAt(0))).toEqual([0x42, 0x65, 0x66, 0x6f, 0x72, 0x65, 0x20, ...replacementPoints, 0x20, 0x41, 0x66, 0x74, 0x65, 0x72]);
          expect(p.runs[0]!.italic).toBe(true); expect(p.runs[0]!.font.rtl).toBe(true); expect(p.runs.at(-1)!.bold).toBe(true);
          expect(p.paragraph_format.keep_with_next).toBe(true);
          const xml = new TextDecoder().decode(saved.get("word/document.xml"));
          expect(xml).toContain('<w:pPr><w:bidi/><w:keepNext/></w:pPr>'); expect(xml).toContain('w:eastAsia="日本 Serif"');
          expect(xml).toContain('w:eastAsia="ja-JP"'); expect(xml).toContain('<!--retained--><?audit keep?>');
          for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
        } else {
          if (route === "model") {
            const template = await textFixture("<w:p/>", {}, strict);
            const d = await api.Document(null, {...textContext, template, timestamp: new Date("2026-01-02T03:04:05Z")});
            d.add_paragraph(text); await d.save(sink);
          } else if (route === "sdk") await api.createDocument({kind: "docx", dialect: strict ? "strict" : "transitional", content: {version: 1, blocks: [{kind: "paragraph", text}]}}, {output: "-"}, context);
          else {
            const r = await shell!.exec(`docx create --dialect ${strict ? "strict" : "transitional"} --content-json '${JSON.stringify({version: 1, blocks: [{kind: "paragraph", text}]})}' --output /destination --force --json`);
            expect(r.exitCode, r.stdout + r.stderr).toBe(0); output = await fs.readFile("/destination");
          }
          output ??= new Uint8Array(volume.readFileSync("/sink") as Buffer);
          const d = await api.Document(output, textContext);
          expect(d.paragraphs.at(-1)!.text).toBe(text);
          expect(Array.from(d.paragraphs.at(-1)!.text, c => c.codePointAt(0))).toEqual(example.points);
        }
        expect(input).toEqual(before); expect(await fs.readFile("/input")).toEqual(before);
        if (mode === "read") {
          expect(readPackage(input)).toEqual(parts); expect(volume.readFileSync("/sink").length).toBe(0);
          expect(await fs.readFile("/destination")).toEqual(new TextEncoder().encode("Retain destination"));
        }
      } finally { if (shell) await shell.dispose(); }
    });
  }
