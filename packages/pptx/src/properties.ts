import { SaxesParser } from "saxes";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, escape, invalid, loadShared, nextRel, type SharedEditResult } from "./masters.js";
import type { SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const dc = "http://purl.org/dc/elements/1.1/";
const terms = "http://purl.org/dc/terms/";
const custom = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
const vt = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
const strictCustom = "http://purl.oclc.org/ooxml/officeDocument/customProperties";
const strictVt = "http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes";
const relationships = "http://schemas.openxmlformats.org/package/2006/relationships";
export type PropertyType = "string" | "number" | "boolean" | "date";
export interface PropertyRecord {
  readonly name: string;
  readonly kind: "core" | "custom" | "unknown";
  readonly type: PropertyType | "unknown";
  readonly value: string | number | boolean | null;
  readonly part: string;
  readonly namespace: string;
}
export interface MutatePropertyOptions {
  readonly name: string;
  readonly value?: string | number | boolean;
  readonly type?: PropertyType;
}
const core: Readonly<Record<string, readonly [string, string, PropertyType]>> = Object.freeze({
  author: [dc, "creator", "string"],
  category: [cp, "category", "string"],
  comments: [dc, "description", "string"],
  content_status: [cp, "contentStatus", "string"],
  created: [terms, "created", "date"],
  identifier: [dc, "identifier", "string"],
  keywords: [cp, "keywords", "string"],
  language: [dc, "language", "string"],
  last_modified_by: [cp, "lastModifiedBy", "string"],
  last_printed: [cp, "lastPrinted", "date"],
  modified: [terms, "modified", "date"],
  revision: [cp, "revision", "number"],
  subject: [dc, "subject", "string"],
  title: [dc, "title", "string"],
  version: [cp, "version", "string"]
});
export function coreDefinition(name: string) {
  return Object.hasOwn(core, name) ? core[name] : undefined;
}
function text(doc: XmlPart, node: XmlElement) {
  let value = "";
  const parser = new SaxesParser({ xmlns: true });
  parser.on("text", (s) => (value += s));
  parser.on("cdata", (s) => (value += s));
  parser.write(doc.markup(node, true)).close();
  return value;
}
export function validatePropertyValue(name: string, type: PropertyType, value: unknown): void {
  const known = coreDefinition(name);
  for (const input of [name, ...(typeof value === "string" ? [value] : [])])
    for (const c of input) {
      const p = c.codePointAt(0)!;
      if (
        (p < 32 && p !== 9 && p !== 10 && p !== 13) ||
        (p >= 0xd800 && p <= 0xdfff) ||
        p === 0xfffe ||
        p === 0xffff
      )
        invalid("Invalid XML property text.");
    }
  if (
    !name ||
    !["string", "number", "boolean", "date"].includes(type) ||
    (known && known[2] !== type)
  )
    invalid("Invalid property name or type.");
  if (type === "string" && (typeof value !== "string" || (known && [...value].length > 255)))
    invalid("Core strings allow at most 255 Unicode code points.");
  if (
    type === "number" &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      (name === "revision" && (!Number.isSafeInteger(value) || value < 0)))
  )
    invalid("Invalid numeric property.");
  if (type === "boolean" && typeof value !== "boolean") invalid("Expected a boolean property.");
  if (type === "date") {
    if (
      typeof value !== "string" ||
      value.length !== 20 ||
      value.startsWith("0000") ||
      !value.endsWith("Z")
    )
      invalid("Expected UTC date in whole seconds.");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.slice(0, -1) + ".000Z")
      invalid("Invalid UTC date.");
  }
}
function decode(type: PropertyType | "unknown", value: string): string | number | boolean | null {
  if (type === "number")
    return value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === "boolean")
    return value === "true" || value === "1"
      ? true
      : value === "false" || value === "0"
        ? false
        : null;
  if (type === "date") {
    const segments = value.split("T");
    if (segments.length > 2) return null;
    const calendar = segments[0]!.split("-");
    if (
      calendar.length > 3 ||
      calendar[0]?.length !== 4 ||
      calendar.some(
        (v, i) => v.length !== (i === 0 ? 4 : 2) || [...v].some((c) => c < "0" || c > "9")
      )
    )
      return null;
    const year = Number(calendar[0]),
      month = Number(calendar[1] ?? 1),
      day = Number(calendar[2] ?? 1);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (
      year < 1 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
    )
      return null;
    if (
      segments.length === 2 &&
      (calendar.length !== 3 ||
        !(value.endsWith("Z") || value.slice(19).includes("+") || value.slice(19).includes("-")))
    )
      return null;
    const date = new Date(
      segments.length === 1
        ? `${calendar[0]}-${calendar[1] ?? "01"}-${calendar[2] ?? "01"}T00:00:00Z`
        : value
    );
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19) + "Z" : null;
  }
  return value;
}
type State = Awaited<ReturnType<typeof loadShared>>;
function parts(s: State) {
  return s.index.inventory.relationships
    .filter(
      (e) =>
        e.owner === "/" &&
        !e.external &&
        (e.type === `${relationships}/metadata/core-properties` ||
          e.type === `${s.r}/custom-properties`)
    )
    .map((e) => ({
      part: e.targetPart!,
      kind:
        e.type === `${relationships}/metadata/core-properties`
          ? ("core" as const)
          : ("custom" as const)
    }));
}
function records(s: State) {
  return parts(s).flatMap(({ part, kind }) => {
    const doc = s.doc(part);
    if (
      (kind === "core"
        ? doc.root.name.namespace !== cp
        : ![custom, strictCustom].includes(doc.root.name.namespace)) ||
      doc.root.name.localName !== (kind === "core" ? "coreProperties" : "Properties")
    )
      throw new OfficeError("invalid-opc", "Invalid metadata root.", "index");
    return doc.root.children.map((node) => {
      const definition =
        kind === "core"
          ? Object.entries(core).find(
              ([, d]) => d[0] === node.name.namespace && d[1] === node.name.localName
            )
          : undefined;
      const customNode =
        kind === "custom" &&
        node.name.namespace === doc.root.name.namespace &&
        node.name.localName === "property";
      const valueNode = customNode && node.children.length === 1 ? node.children[0] : undefined;
      const types: Record<string, PropertyType> = {
        lpwstr: "string",
        lpstr: "string",
        bstr: "string",
        i4: "number",
        int: "number",
        r8: "number",
        bool: "boolean",
        filetime: "date"
      };
      const type = unknownDeclaredType(doc, node)
        ? "unknown"
        : (definition?.[1][2] ??
          (valueNode &&
          [vt, strictVt].includes(valueNode.name.namespace) &&
          Object.hasOwn(types, valueNode.name.localName)
            ? types[valueNode.name.localName]
            : undefined) ??
          "unknown");
      const name =
        definition?.[0] ?? (customNode ? attr(node, "name") : undefined) ?? node.name.localName;
      return {
        doc,
        node,
        record: {
          name,
          kind: definition ? "core" : customNode ? "custom" : "unknown",
          type,
          value: decode(type, text(doc, valueNode ?? node)),
          part,
          namespace: node.name.namespace
        } as PropertyRecord
      };
    });
  });
}
function options(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    invalid("Invalid property options.");
}
export async function readProperties(
  input: BinaryInput,
  query: { readonly name?: string },
  context: SelectionContext
): Promise<readonly PropertyRecord[]> {
  options(query, ["name"]);
  if (query.name !== undefined && (typeof query.name !== "string" || !query.name))
    invalid("Expected property name.");
  return records(await loadShared(input, context, false))
    .map((x) => x.record)
    .filter((x) => query.name === undefined || x.name === query.name);
}
function createPart(s: State, kind: "core" | "custom", context: SelectionContext) {
  let part = `/docProps/${kind}.xml`;
  let suffix = 1;
  while (s.reader.has(part)) part = `/docProps/${kind}${suffix++}.xml`;
  const doc = parseXmlPart(
    new TextEncoder().encode(
      `<${kind === "core" ? "coreProperties" : "Properties"} xmlns="${kind === "core" ? cp : s.r.startsWith("http://purl.oclc.org/") ? strictCustom : custom}"/>`
    ),
    context.xmlLimits
  );
  s.save(part, doc);
  const rel = s.doc("/_rels/.rels");
  s.save(
    "/_rels/.rels",
    rel.spliceChildren(rel.root, rel.root.children.length, 0, [
      `<Relationship xmlns="${relationships}" Id="${nextRel(rel)}" Type="${kind === "core" ? `${relationships}/metadata/core-properties` : `${s.r}/custom-properties`}" Target="${part.slice(1)}"/>`
    ])
  );
  const types = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    types.spliceChildren(types.root, types.root.children.length, 0, [
      `<Override xmlns="${types.root.name.namespace}" PartName="${part}" ContentType="application/vnd.openxmlformats-${kind === "core" ? "package.core-properties" : "officedocument.custom-properties"}+xml"/>`
    ])
  );
  return part;
}
export async function mutateProperty(
  input: BinaryInput,
  action: "set" | "remove",
  query: MutatePropertyOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  options(query, action === "set" ? ["name", "value", "type"] : ["name"]);
  if (typeof query.name !== "string" || !query.name || !["set", "remove"].includes(action))
    invalid("Invalid property operation.");
  const s = await loadShared(input, context);
  const matches = records(s).filter((x) => x.record.name === query.name);
  if (matches.length > 1)
    throw new OfficeError("ambiguous-selection", "Property name is ambiguous.", "select");
  const found = matches[0];
  if (action === "remove") {
    if (!found) throw new OfficeError("missing-selection", "Property is absent.", "select");
    if (found.record.type === "unknown" || !safeRemoval(found.node, found.record.kind))
      throw new OfficeError(
        "unsupported-edit",
        "Unknown property is preserved.",
        "validate-intent"
      );
    s.save(
      found.record.part,
      found.doc.spliceChildren(found.doc.root, found.doc.root.children.indexOf(found.node), 1, [])
    );
    return s.finish(found.record.part, []);
  }
  const type = query.type ?? found?.record.type ?? coreDefinition(query.name)?.[2];
  if (found?.record.type === "unknown")
    throw new OfficeError("unsupported-edit", "Unknown property is preserved.", "validate-intent");
  if (!type || type === "unknown") invalid("New properties require an explicit supported type.");
  if (found && found.record.type !== type) invalid("Property type cannot be coerced.");
  validatePropertyValue(query.name, type, query.value);
  if (
    found?.record.kind === "custom" &&
    ["i4", "int"].includes(found.node.children[0]?.name.localName ?? "") &&
    (!Number.isInteger(query.value) ||
      (query.value as number) < -2147483648 ||
      (query.value as number) > 2147483647)
  )
    invalid("Integer property exceeds signed 32-bit bounds.");
  const definition = coreDefinition(query.name);
  if (found && definition && found.record.kind !== "core")
    invalid("Custom names cannot collide with core names.");
  const kind = definition ? "core" : "custom";
  const candidates = parts(s).filter((p) => p.kind === kind);
  if (candidates.length > 1)
    throw new OfficeError("ambiguous-selection", "Multiple property parts.", "select");
  const part = found?.record.part ?? candidates[0]?.part ?? createPart(s, kind, context);
  let doc = s.doc(part);
  if (found && kind === "core")
    doc = setCoreText(
      doc,
      doc.root.children[found.doc.root.children.indexOf(found.node)]!,
      String(query.value)
    );
  else if (found) {
    const node = doc.root.children[found.doc.root.children.indexOf(found.node)]!;
    doc = doc.setText(node.children[0]!, String(query.value));
  } else {
    let markup: string;
    if (definition) {
      const [ns, local] = definition;
      markup = `<m:${local} xmlns="" xmlns:m="${ns}"${type === "date" && ns === terms ? ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dcterms="${terms}" xsi:type="dcterms:W3CDTF"` : ""}>${escape(String(query.value))}</m:${local}>`;
    } else {
      let pid = 2;
      const ids = new Set(doc.root.children.map((n) => attr(n, "pid")));
      while (ids.has(String(pid))) pid++;
      const tag = { string: "lpwstr", number: "r8", boolean: "bool", date: "filetime" }[type];
      markup = `<property xmlns="${doc.root.name.namespace}" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid}" name="${escape(query.name)}"><vt:${tag} xmlns:vt="${doc.root.name.namespace === strictCustom ? strictVt : vt}">${escape(String(query.value))}</vt:${tag}></property>`;
    }
    doc = doc.spliceChildren(doc.root, doc.root.children.length, 0, [markup]);
  }
  s.save(part, doc);
  return s.finish(part, []);
}
function unknownDeclaredType(doc: XmlPart, node: XmlElement): boolean {
  const annotation = node.attributes.find(
    (a) =>
      a.name.namespace === "http://www.w3.org/2001/XMLSchema-instance" &&
      a.name.localName === "type"
  );
  if (!annotation) return false;
  const names = annotation.value.split(":");
  const prefix = names.length === 2 ? names[0]! : "";
  const local = names.at(-1);
  return (
    node.name.namespace !== terms ||
    names.length > 2 ||
    local !== "W3CDTF" ||
    doc.resolveNamespace(node, prefix) !== terms
  );
}
function setCoreText(doc: XmlPart, node: XmlElement, value: string): XmlPart {
  if (unknownDeclaredType(doc, node))
    throw new OfficeError(
      "unsupported-edit",
      "Unknown declared property type is preserved.",
      "validate-intent"
    );
  const index = doc.root.children.indexOf(node);
  let updated = doc.setText(node, value);
  if (node.name.namespace !== terms) return updated;
  let qname = "";
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (!qname) qname = tag.name;
  });
  parser.write(doc.markup(node, true)).close();
  const colon = qname.indexOf(":");
  const prefix = colon < 0 ? "" : qname.slice(0, colon) + ":";
  updated = updated.merge(updated.root.children[index]!, {
    attributes: [
      {
        namespace: "http://www.w3.org/2001/XMLSchema-instance",
        localName: "type",
        value: prefix + "W3CDTF"
      }
    ]
  });
  return updated;
}
function safeRemoval(node: XmlElement, kind: PropertyRecord["kind"]) {
  return kind === "core"
    ? node.children.length === 0 &&
        node.attributes.every(
          (a) =>
            a.name.namespace === "http://www.w3.org/2001/XMLSchema-instance" &&
            a.name.localName === "type"
        )
    : node.children.length === 1 &&
        node.children[0]!.children.length === 0 &&
        node.children[0]!.attributes.length === 0 &&
        node.attributes.every(
          (a) => a.name.namespace === "" && ["name", "pid", "fmtid"].includes(a.name.localName)
        );
}
export async function sanitizeProperties(
  input: BinaryInput,
  context: SelectionContext
): Promise<SharedEditResult> {
  const s = await loadShared(input, context);
  const known = records(s).filter(
    (x) => x.record.type !== "unknown" && safeRemoval(x.node, x.record.kind)
  );
  for (const part of new Set(known.map((x) => x.record.part))) {
    let doc = s.doc(part);
    const indices = known
      .filter((x) => x.record.part === part)
      .map((x) => x.doc.root.children.indexOf(x.node))
      .sort((a, b) => b - a);
    for (const index of indices) doc = doc.spliceChildren(doc.root, index, 1, []);
    s.save(part, doc);
  }
  return s.finish(s.main, []);
}

export class CoreProperties {
  declare author: string;
  declare category: string;
  declare comments: string;
  declare content_status: string;
  declare identifier: string;
  declare keywords: string;
  declare language: string;
  declare last_modified_by: string;
  declare subject: string;
  declare title: string;
  declare version: string;
  declare revision: number;
  declare created: Date | null;
  declare modified: Date | null;
  declare last_printed: Date | null;
  readonly #read: () => XmlPart;
  constructor(read: () => XmlPart, write: (doc: XmlPart) => void) {
    this.#read = read;
    for (const [name, [namespace, localName, type]] of Object.entries(core))
      Object.defineProperty(this, name, {
        enumerable: true,
        get: () => {
          const doc = read();
          const matches = doc.root.children.filter(
            (n) => n.name.namespace === namespace && n.name.localName === localName
          );
          if (matches.length > 1)
            throw new OfficeError("ambiguous-selection", "Duplicate core property.", "select");
          const raw = matches[0] ? text(doc, matches[0]) : "";
          if (type === "string") return raw;
          if (type === "number") {
            const value = Number(raw);
            const digits = raw.trim();
            const unsigned = digits.startsWith("+") ? digits.slice(1) : digits;
            return unsigned &&
              [...unsigned].every((c) => c >= "0" && c <= "9") &&
              Number.isSafeInteger(value) &&
              value >= 0
              ? value
              : 0;
          }
          const value = decode("date", raw);
          return value === null ? null : new Date(value as string);
        },
        set: (value: unknown) => {
          const serialized =
            type === "date"
              ? value instanceof Date && Number.isFinite(value.getTime())
                ? value.toISOString().slice(0, 19) + "Z"
                : invalid("Expected valid UTC Date.")
              : value;
          validatePropertyValue(name, type, serialized);
          let doc = read();
          const matches = doc.root.children.filter(
            (n) => n.name.namespace === namespace && n.name.localName === localName
          );
          if (matches.length > 1)
            throw new OfficeError("ambiguous-selection", "Duplicate core property.", "select");
          if (matches[0]) doc = setCoreText(doc, matches[0], String(serialized));
          else
            doc = doc.spliceChildren(doc.root, doc.root.children.length, 0, [
              `<m:${localName} xmlns="" xmlns:m="${namespace}"${type === "date" && namespace === terms ? ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dcterms="${terms}" xsi:type="dcterms:W3CDTF"` : ""}>${escape(String(serialized))}</m:${localName}>`
            ]);
          write(doc);
        }
      });
  }
  get part(): XmlPart {
    return this.#read();
  }
}
export async function openPropertySession(
  input: BinaryInput,
  context: SelectionContext
): Promise<{ readonly core_properties: CoreProperties; save(): Promise<Uint8Array> }> {
  const s = await loadShared(input, context);
  const candidates = parts(s).filter((p) => p.kind === "core");
  if (candidates.length > 1)
    throw new OfficeError("ambiguous-selection", "Multiple core property parts.", "select");
  let part = candidates[0]?.part;
  let model: CoreProperties | undefined;
  return {
    get core_properties() {
      part ??= createPart(s, "core", context);
      return (model ??= new CoreProperties(
        () => s.doc(part!),
        (doc) => s.save(part!, doc)
      ));
    },
    async save() {
      return (await s.finish(s.main, [])).bytes;
    }
  };
}
