import { Volume } from "memfs";
import { DocumentBudget } from "../../src/budget.js";
import { NumberingGraph } from "../../src/numbering.js";
import { DocumentXmlEditor } from "../../src/xml-write.js";

export function run(request: { kind: "style"; files: Record<string, string | null> } | { kind: "restart"; source: string; depth: number }) {
  const memory = Volume.fromJSON(request.kind === "style" ? request.files : { "/numbering.xml": request.source });
  const budget = new DocumentBudget({ xmlDepth: request.kind === "style" ? 8192 : request.depth + 8,
    retainedBytes: 2 ** 31, work: 2 ** 31 });
  const source = new Uint8Array(memory.readFileSync(request.kind === "style" ? "/numbering" : "/numbering.xml") as Buffer);
  const numbering = new DocumentXmlEditor(source, {}, undefined, budget);
  if (request.kind === "style") {
    const styles = new DocumentXmlEditor(new Uint8Array(memory.readFileSync("/styles") as Buffer), {}, undefined, budget);
    const result = new NumberingGraph(numbering, styles.root, budget).resolve(1);
    return { ok: true, definition: result.definition.attributes.find(a => a.localName === "abstractNumId")!.value,
      format: result.levels.get(0)!.children.find(c => c.localName === "numFmt")!.attributes.find(a => a.localName === "val")!.value,
      start: result.starts.get(0)!.attributes.find(a => a.localName === "val")!.value,
      unchanged: Buffer.from(numbering.serialize()).equals(source) && Buffer.from(styles.serialize()).equals(memory.readFileSync("/styles") as Buffer) };
  }
  const graph = new NumberingGraph(numbering, undefined, budget);
  const id = graph.restart(graph.resolve(7), 0, 1), output = graph.flush();
  return { ok: true, id, bytes: Buffer.from(output).toString("base64"), keptInput: Buffer.from(numbering.serialize()).equals(source) };
}
