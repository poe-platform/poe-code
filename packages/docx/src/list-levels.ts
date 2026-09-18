import { DocumentPackage } from "./package.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { DocumentXmlEditor, replaceListPropertyXml, UnsupportedEditError } from "./xml-write.js";
import { parseDocumentXml } from "./package-xml.js";
import { NumberingGraph } from "./numbering.js";
import { listProperties } from "./lists.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { assertFormattingHistoryEditable } from "./revision-markup.js";
import { type Paragraph } from "./block-model.js";
import type { DocxOperationArguments } from "./operation-types.js";

/** Execute the declared advanced setter with one atomic package-domain transaction. */
export function setParagraphListLevels(owner: Paragraph, options: DocxOperationArguments<"lists.levels.set">): void {
  const { store } = owner, { budget } = store.context;
  store.transaction(() => {
    const archive = store.snapshot(), packageGraph = new DocumentPackage(archive, store.context.limits, budget);
    const documentOwner = store.documentOwnerForStory(owner.ref.part), dialect = dialectForNamespace(store.xml(documentOwner).root.namespace)!;
    const r = documentDialects[dialect].r, edges = packageGraph.relationships(documentOwner);
    const related = (kind: string) => {
      const found = edges.filter(edge => edge.reltype === `${r}/${kind}`);
      if (found.length > 1 || found[0]?.is_external) throw new UnsupportedEditError("Numbering and style ownership must be unambiguous and internal.");
      return found[0]?.target_part;
    };
    const numbering = related("numbering"), styles = related("styles");
    if (!numbering) throw new UnsupportedEditError("Advanced list levels require an existing numbering definition.");
    const editor = new DocumentXmlEditor(numbering.bytes, {}, undefined, budget), graph = new NumberingGraph(editor, styles ? parseDocumentXml(styles.bytes, {}, budget).root : undefined, budget);
    for (const member of archive.members) if (member.name.endsWith(".xml")) graph.reserve(parseDocumentXml(member.bytes, {}, budget).root);
    graph.project(store.xml(owner.ref.part).root);
    const node = store.node(owner.ref), binding = graph.paragraph(node);
    if (!binding) throw new UnsupportedEditError("Advanced list levels require an existing list paragraph.");
    const resolved = graph.resolve(binding.id);
    if (!resolved.levels.has(binding.level)) throw new UnsupportedEditError("The selected numbering level has no definition.");
    const id = graph.setLevels(resolved, options);
    if (id === binding.id) return;
    store.change(owner.ref.part, xml => {
      const current = store.node(owner.ref), children = activeXmlChildren(xml, budget); graph.project(xml.root);
      assertFormattingHistoryEditable(xml.root, current, children, budget);
      const props = graph.child(current, "pPr"), markup = listProperties(xml, props, id, binding.level, current.namespace, graph);
      if (props) xml[replaceListPropertyXml](props, markup); else xml.insertChildren(current, markup, current.children[0]);
    });
    store.setPart(numbering.partname, graph.flush());
  });
}
