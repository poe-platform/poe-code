import { activeModelChildren } from "./model-active-children.js";
import { InputTypeError } from "./archive.js";
import { DocumentPackage } from "./package.js";
import type { ModelRef, ModelStore } from "./model-store.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { UnsupportedEditError } from "./xml-write.js";
import { relativePartTarget } from "./part-uri.js";
import { xmlValue } from "./create-content.js";
import { sectionBoolean } from "./section-properties.js";

/** Live document settings; external resources remain inert. */
export class Settings {
  private readonly ref: ModelRef;
  constructor(private readonly store: ModelStore) {
    const graph = new DocumentPackage(store.snapshot(), store.context.limits, store.context.budget);
    const w = store.xml(store.mainPart).root.namespace;
    const r = documentDialects[dialectForNamespace(w)!].r;
    const edges = graph
      .relationships(store.mainPart)
      .filter((edge) => edge.reltype === r + "/settings");
    if (edges.length > 1 || edges[0]?.is_external)
      throw new UnsupportedEditError("Expected one internal settings part.");
    let part = edges[0]?.target_part.partname;
    if (!part)
      part = store.transaction(() => {
        const created = graph.allocatePartName(
          store.mainPart.slice(0, store.mainPart.lastIndexOf("/") + 1) + "settings",
          ".xml"
        );
        store.setPart(
          created,
          new TextEncoder().encode(`<ds:settings xmlns:ds="${w}"/>`),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"
        );
        const relName =
          store.mainPart.slice(0, store.mainPart.lastIndexOf("/") + 1) +
          "_rels/" +
          store.mainPart.slice(store.mainPart.lastIndexOf("/") + 1) +
          ".rels";
        const edge = `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${graph.allocateRelationshipId(store.mainPart)}" Type="${r}/settings" Target="${xmlValue(relativePartTarget(store.mainPart, created))}"/>`;
        if (store.snapshot().members.some((member) => "/" + member.name === relName))
          store.change(relName, (xml) => xml.insertChildren(xml.root, edge));
        else
          store.setPart(
            relName,
            new TextEncoder().encode(
              `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${edge}</Relationships>`
            )
          );
        return created;
      });
    const root = store.xml(part).root;
    if (root.namespace !== w || root.localName !== "settings")
      throw new UnsupportedEditError("Expected a supported settings root.");
    this.ref = store.ref(part, root);
  }
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part);
  }
  get element() {
    return this.store.element(this.ref);
  }
  equals(other: unknown): boolean {
    this.store.node(this.ref);
    return (
      other instanceof Settings &&
      other.store === this.store &&
      this.store.node(this.ref) === other.store.node(other.ref)
    );
  }
  get odd_and_even_pages_header_footer(): boolean {
    const root = this.store.node(this.ref);
    return sectionBoolean(activeModelChildren(this.store, this.ref.part)(root).find(node => node.namespace === root.namespace && node.localName === "evenAndOddHeaders"));
  }
  set odd_and_even_pages_header_footer(value: boolean) {
    if (typeof value !== "boolean")
      throw new InputTypeError("Expected a page header policy boolean.");
    this.store.change(this.ref.part, (xml) => {
      const root = this.store.node(this.ref);
      const old = activeModelChildren(this.store, this.ref.part)(root).filter(
        (node) => node.namespace === root.namespace && node.localName === "evenAndOddHeaders"
      );
      if (old.length > 1)
        throw new UnsupportedEditError("Duplicate page header policies cannot be edited.");
      const markup = value ? `<ds:evenAndOddHeaders xmlns:ds="${root.namespace}"/>` : "";
      if (old[0]) xml.replaceElement(old[0], markup);
      else if (markup) {
        const preceding = new Set("writeProtection view zoom removePersonalInformation removeDateAndTime doNotDisplayPageBoundaries displayBackgroundShape printPostScriptOverText printFractionalCharacterWidth printFormsData embedTrueTypeFonts embedSystemFonts saveSubsetFonts saveFormsData mirrorMargins alignBordersAndEdges bordersDoNotSurroundHeader bordersDoNotSurroundFooter gutterAtTop hideSpellingErrors hideGrammaticalErrors activeWritingStyle proofState formsDesign attachedTemplate linkStyles stylePaneFormatFilter stylePaneSortMethod documentType mailMerge revisionView trackRevisions doNotTrackMoves doNotTrackFormatting documentProtection autoFormatOverride styleLockTheme styleLockQFSet defaultTabStop autoHyphenation consecutiveHyphenLimit hyphenationZone doNotHyphenateCaps showEnvelope summaryLength clickAndTypeStyle defaultTableStyle".split(" "));
        xml.insertChildren(root, markup, root.children.find(node => node.namespace === root.namespace && !preceding.has(node.localName)));
      }
    });
  }
}
