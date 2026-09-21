import { archiveSettings, documentSession, InputTypeError, type ArchiveContext } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { validateDocxInvocation } from "./command.js";
import { documentDialects } from "./dialect.js";
import { embeddedFontContentTypes, fontResourceRole } from "./font-resources.js";
import { openDocumentLocations } from "./locations.js";
import { encodeGeneratedLocation, SelectionError, type Location, type LocationKind } from "./location-token.js";
import type { InspectionPart, InspectionReference } from "./inspection.js";
import { parseMediaType } from "./media-type.js";
import { parseDocumentXml } from "./package-xml.js";
import { compareInventoryNames } from "./pack-inventory.js";
import { revisionInfo } from "./revision-markup.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";

export interface FontInventoryRecord {
  readonly kind: "fonts";
  readonly name: string;
  readonly location: Location<"part">;
  readonly properties: readonly [];
  readonly references: readonly InspectionReference[];
  readonly support: "read" | "preserve";
  readonly details: { readonly kind: "fonts"; readonly parts: readonly InspectionPart[] };
}
export interface FontInventoryData { readonly items: readonly FontInventoryRecord[] }

/** Inventories inert font storage; names, paths and references do not imply installed fonts. */
export async function inspectDocumentFonts(input: Uint8Array, options: DocxOperationArguments<"fonts.list">, context: ArchiveContext): Promise<FontInventoryData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "fonts.list", inputs: ["document"], options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"fonts.list">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(limit => [limit.name, limit.value])));
  const bounded = { ...settings, budget };
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes.");
  budget.check("compressedInput", input.length); budget.charge("retainedBytes", input.length); budget.charge("work", input.length);
  const owned = new Uint8Array(input);
  const archive = await readDocumentArchive(owned, bounded), graph = archive.package;
  const namespaces = Object.values(documentDialects).map(dialect => dialect.r);
  const fontRelationship = (type: string) => namespaces.some(namespace => type === namespace + "/font" || type === namespace + "/fontTable");
  const parts = new Map(graph.parts.filter(part => parseMediaType(part.content_type) !== "application/vnd.openxmlformats-package.relationships+xml").map(part => [part.partname, part]));
  const incomingReferences = new Map<string, InspectionReference[]>();
  const outgoingReferences = new Map<string, InspectionReference[]>();
  const targets = new Map<string, string[]>();
  for (const owner of ["/", ...parts.keys()]) for (const edge of graph.relationships(owner)) {
    budget.charge("work", 1);
    budget.charge("retainedBytes", 192 + (owner.length + edge.rId.length + edge.reltype.length + edge.target_ref.length) * 2);
    const reference = { owner, id: edge.rId, type: edge.reltype, target: edge.target_ref, external: edge.is_external };
    const outgoing = outgoingReferences.get(owner) ?? [];
    outgoing.push(reference); outgoingReferences.set(owner, outgoing);
    if (!edge.is_external) {
      const incoming = incomingReferences.get(edge.target_part.partname) ?? [];
      incoming.push(reference); incomingReferences.set(edge.target_part.partname, incoming);
    }
    if (fontRelationship(edge.reltype) && !edge.is_external) {
      const names = targets.get(owner) ?? [];
      names.push(edge.target_part.partname);
      targets.set(owner, names);
    }
  }
  const candidates = new Set([...parts.values()].filter(part => {
    const type = parseMediaType(part.content_type);
    return type === "application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml" || embeddedFontContentTypes.includes(type);
  }).map(part => part.partname));
  for (const names of targets.values()) for (const name of names) candidates.add(name);
  const closure = (initial: readonly string[]) => {
    const pending = [...initial], result = new Set<string>();
    budget.charge("retainedBytes", pending.length * 8);
    while (pending.length) {
      budget.charge("work", 1);
      const name = pending.pop()!;
      if (result.has(name)) continue;
      result.add(name); budget.charge("retainedBytes", 32);
      for (const target of targets.get(name) ?? []) { budget.charge("retainedBytes", 8); pending.push(target); }
    }
    return result;
  };
  const selectorNames = Object.keys(opts).filter(name => !["json", "limit"].includes(name));
  let admitted = candidates;
  if (selectorNames.length) {
    const document = await openDocumentLocations(owned, bounded, "inventory");
    let selected: Location | undefined;
    if (opts.select !== undefined) selected = document.resolve(opts.select);
    else {
      const section = opts.section === undefined ? undefined : document.at("section", opts.section);
      for (const name of ["comment", "note"] as const) if (opts[name] !== undefined) {
        const stories = document.list("story", { scope: "all-stories" }).filter(story => story.positions[name] === opts[name]);
        if (!stories.length) throw new SelectionError("missing-selection");
        if (stories.length !== 1) throw new SelectionError("ambiguous-selection", stories.map(story => story.token));
        selected = stories[0];
      }
      for (const name of ["table", "cell", "paragraph", "run", "image", "link", "control", "revision", "shape", "field", "bookmark"] as const) if (opts[name] !== undefined) {
        if (name === "cell") selected = document.cell(selected!.token, opts.cell!);
        else if (name === "revision") {
          const root = parseDocumentXml(graph.getPart(selected?.value.part ?? "/" + archive.mainPart).bytes, {}, budget).root;
          const revisions = document.list("annotation", selected ? { owner: selected.token } : opts.section === undefined ? {} : { section: opts.section }).filter(location => {
            budget.charge("work", location.value.path.length + 1);
            let node = root;
            for (const index of location.value.path) node = node.children[index]!;
            return revisionInfo(node) !== undefined;
          });
          selected = revisions[opts.revision! - 1];
          if (!selected) throw new SelectionError("missing-selection");
        } else selected = document.at(name as LocationKind, opts[name] as number, selected ? { owner: selected.token } : opts.section === undefined ? {} : { section: opts.section });
      }
      selected ??= section;
    }
    if (!selected) throw new SelectionError("missing-selection");
    admitted = closure(candidates.has(selected.value.part) ? [selected.value.part] : targets.get(graph.getPart("/" + archive.mainPart).partname) ?? []);
  }
  budget.charge("work", owned.length); budget.charge("retainedBytes", owned.length + 96);
  const sourceSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", owned))].map(value => value.toString(16).padStart(2, "0")).join("");
  const metadata = new Map<string, InspectionPart>();
  const items: FontInventoryRecord[] = [];
  for (const name of [...candidates].filter(name => admitted.has(name)).sort(compareInventoryNames)) {
    budget.charge("matches", 1); budget.charge("retainedBytes", 256);
    const inventory: InspectionPart[] = [];
    for (const target of [...closure([name])].sort(compareInventoryNames)) {
      let record = metadata.get(target);
      if (!record) {
        const part = parts.get(target)!;
        budget.charge("work", part.bytes.length); budget.charge("retainedBytes", part.bytes.length + 192);
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(part.bytes)))].map(value => value.toString(16).padStart(2, "0")).join("");
        record = { name: target, contentType: part.content_type, bytes: part.bytes.length, sha256: hash }; metadata.set(target, record);
      }
      inventory.push(record);
    }
    const part = parts.get(name)!;
    const native = parseMediaType(part.content_type) === "application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml" && fontResourceRole(part.content_type, parseDocumentXml(part.bytes, {}, budget).root) === "fontTable";
    const references = new Map<string, InspectionReference>();
    for (const reference of incomingReferences.get(name) ?? []) references.set(reference.owner + "#" + reference.id, reference);
    for (const part of inventory) for (const reference of outgoingReferences.get(part.name) ?? []) references.set(reference.owner + "#" + reference.id, reference);
    budget.charge("work", references.size); budget.charge("retainedBytes", references.size * 64);
    const sortedReferences = [...references.values()].sort((left, right) => compareInventoryNames(left.owner, right.owner) || compareInventoryNames(left.id, right.id));
    const value = { version: 1 as const, sourceSha256, generation: settings[documentSession]?.generation ?? 0, part: name, story: name, path: [], range: null };
    const token = encodeGeneratedLocation(value); budget.charge("retainedBytes", token.length * 4); budget.charge("work", token.length);
    const location: Location<"part"> = { kind: "part", token, value, positions: {} };
    items.push({ kind: "fonts", name, location, properties: [], references: sortedReferences, support: native ? "read" : "preserve", details: { kind: "fonts", parts: inventory } });
  }
  const data = { items };
  measurePackageResourceSerialization({ version: 1, operation: "fonts.list", ok: true, data, warnings: [], errors: [], affected: 0, locations: items.map(item => item.location) }, budget);
  return data;
}
