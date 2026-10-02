import { Volume } from "memfs";
import { expect, it } from "vitest";
import { mainThreadFixture } from "../tests/main-thread.js";
import { DocumentBudget } from "./budget.js";
import { NumberingGraph } from "./numbering.js";
import { DocumentXmlEditor } from "./xml-write.js";

const run = mainThreadFixture(new URL("../tests/fixtures/deep-numbering-graph-main.ts", import.meta.url));

for (const strict of [false, true]) for (const depth of [32, 4096])
for (const host of ["worker", "main"] as const)
for (const placement of ["sibling", "override", "start", "carrier"] as const)
it(`restarts a shallow instance after an inert deep sibling; strict=${strict}; depth=${depth}; host=${host}${placement === "sibling" ? "" : `; placement=${placement}`}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const inert = "<f:opaque>".repeat(depth) + "日本 עברית é 🌊" + "</f:opaque>".repeat(depth);
  const start = placement === "start" ? `<w:startOverride w:val="3">${inert}</w:startOverride>` : '<w:startOverride w:val="3"/>';
  const override = `<w:lvlOverride w:ilvl="0">${placement === "override" ? inert : ""}${start}<!--retained override--><?list keep?></w:lvlOverride>`;
  const carried = placement === "carrier" ? "<f:pass>".repeat(depth) + override + "</f:pass>".repeat(depth) : override;
  const source = `<w:numbering xmlns:w="${w}" xmlns:f="urn:original:numbering-inert-search" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"${placement === "carrier" ? ' mc:ProcessContent="f:pass"' : ""}>${placement === "sibling" ? inert : ""}<w:abstractNum w:abstractNumId="4"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="4"/>${carried}</w:num></w:numbering>`;
  const memory = Volume.fromJSON({ "/numbering.xml": source });
  const input = new Uint8Array(memory.readFileSync("/numbering.xml") as Buffer);
  const check = (bytes: Uint8Array, keptInput: boolean) => {
    const saved = new TextDecoder().decode(bytes);
    expect(saved).toContain(placement === "carrier" ? carried : inert);
    expect(saved).toContain("<!--retained override-->");
    expect(saved).toContain("<?list keep?>");
    expect(keptInput).toBe(true);
    const budget = new DocumentBudget({ xmlDepth: depth + 8, retainedBytes: 2 ** 31, work: 2 ** 31 });
    const editor = new DocumentXmlEditor(bytes, {}, undefined, budget);
    const graph = new NumberingGraph(editor, undefined, budget);
    for (const [id, start] of [[7, "3"], [1, "1"]] as const) {
      const instance = editor.root.children.find(n => n.namespace === w && n.localName === "num" && n.attributes.some(a => a.namespace === w && a.localName === "numId" && a.value === String(id)))!;
      const pending = [...instance.children];
      let override;
      while (pending.length) {
        const node = pending.pop()!;
        if (node.namespace === w && node.localName === "lvlOverride") { override = node; break; }
        pending.push(...node.children);
      }
      expect(override).toBeDefined();
      const storedStart = override!.children.find(n => n.namespace === w && n.localName === "startOverride")!;
      expect(storedStart.attributes.find(a => a.namespace === w && a.localName === "val")?.value).toBe(start);
    }
    expect(graph.resolve(7).starts.get(0)?.attributes.find(a => a.localName === "val")?.value).toBe("3");
    expect(graph.resolve(1).starts.get(0)?.attributes.find(a => a.localName === "val")?.value).toBe("1");
  };
  if (host === "worker") {
    const budget = new DocumentBudget({ xmlDepth: depth + 8, retainedBytes: 2 ** 31, work: 2 ** 31 });
    const editor = new DocumentXmlEditor(input, {}, undefined, budget), graph = new NumberingGraph(editor, undefined, budget);
    expect(graph.restart(graph.resolve(7), 0, 1)).toBe(1);
    check(graph.flush(), Buffer.from(editor.serialize()).equals(Buffer.from(input)));
  } else {
    const result = await run({ kind: "restart", source, depth });
    const response = JSON.parse(result);
    expect(response.ok, response.error).toBe(true);
    expect(response.id).toBe(1);
    check(new Uint8Array(Buffer.from(response.bytes, "base64")), response.keptInput);
  }
  expect((memory.readFileSync("/numbering.xml") as Buffer).equals(input)).toBe(true);
});
