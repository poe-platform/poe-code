import { sha256 } from "@noble/hashes/sha2.js";
import { readBinary } from "./bytes.js";
import type { BinaryInput, Location, Scope } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { readPackage, type PackageContext } from "./package-reader.js";
import { asciiKey, partName } from "./package-uri.js";
import { readRelationshipGraph, type RelationshipLimits } from "./relationships.js";
import { parseXmlPart, type XmlElement, type XmlLimits } from "./xml.js";
import { interpretCompatibility } from "./compatibility.js";
import { inspectInventory, type PresentationInventory } from "./inventory.js";

export interface SelectionContext extends PackageContext {
  readonly xmlLimits: XmlLimits;
  readonly relationshipLimits: RelationshipLimits;
}
export interface SelectionRecord {
  readonly kind: "slide" | "part" | "object";
  readonly id: string;
  readonly name: string;
  readonly part: string;
  readonly scope: Scope;
  readonly position: number;
  readonly objectType?: string;
  readonly location: Location;
  readonly token: string;
}
export interface SelectionQuery {
  readonly kind?: SelectionRecord["kind"];
  readonly scope?: Scope;
  readonly owner?: string;
  readonly position?: {
    readonly coordinateSystem: "one-based" | "zero-based";
    readonly value: number;
  };
  readonly id?: string;
  readonly name?: string;
  readonly part?: string;
  readonly token?: string;
  readonly all?: boolean;
}
export interface SelectionIndex {
  readonly fingerprint: string;
  readonly inventory: PresentationInventory;
  readonly slides: readonly SelectionRecord[];
  readonly parts: readonly SelectionRecord[];
  readonly objects: readonly SelectionRecord[];
  select(query: SelectionQuery): readonly SelectionRecord[];
}
export class SelectionError extends OfficeError {
  constructor(
    code: "invalid-selection" | "missing-selection" | "ambiguous-selection" | "stale-selection",
    readonly candidates: readonly Location[] = []
  ) {
    super(
      code,
      {
        "invalid-selection": "Invalid selection.",
        "missing-selection": "Selection has no matching location.",
        "ambiguous-selection": "Selection matches multiple locations.",
        "stale-selection": "Selection belongs to stale or invalidated state."
      }[code],
      "select"
    );
  }
}
const scopes: readonly Scope[] = [
  "slides",
  "notes",
  "layouts",
  "masters",
  "notes-master",
  "handout-master",
  "presentation",
  "shared"
];
const presentationNamespaces = [
  "http://schemas.openxmlformats.org/presentationml/2006/main",
  "http://purl.oclc.org/ooxml/presentationml/main"
];
const relationshipNamespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
function attribute(
  element: XmlElement,
  name: string,
  namespaces: readonly string[] = [""]
): string {
  return (
    element.attributes.find(
      (a) => a.name.localName === name && namespaces.includes(a.name.namespace)
    )?.value ?? ""
  );
}
function numericIdentity(value: string, minimum: number, maximum: number): string {
  const text = value.trim();
  const digits = text.startsWith("+") ? text.slice(1) : text;
  const number = Number(text);
  if (
    !digits ||
    [...digits].some((character) => !"0123456789".includes(character)) ||
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > maximum
  )
    throw new OfficeError("invalid-opc", "Invalid numeric identity.", "index");
  return String(number);
}
function isPresentation(element: XmlElement, name: string): boolean {
  return presentationNamespaces.includes(element.name.namespace) && element.name.localName === name;
}
function encodeLocation(location: Location): string {
  return JSON.stringify({
    fingerprint: location.fingerprint,
    scope: location.scope,
    owner: location.owner,
    objectId: location.objectId,
    coordinateSystem: "identity"
  });
}
function validLocation(value: unknown): asserts value is Location {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SelectionError("invalid-selection");
  const location = value as Location;
  if (
    Object.keys(value).length !== 5 ||
    typeof location.fingerprint !== "string" ||
    location.fingerprint.length !== 64 ||
    [...location.fingerprint].some((c) => !"0123456789abcdef".includes(c)) ||
    !scopes.includes(location.scope) ||
    typeof location.owner !== "string" ||
    typeof location.objectId !== "string" ||
    !location.objectId ||
    location.coordinateSystem !== "identity"
  )
    throw new SelectionError("invalid-selection");
  try {
    if (partName(location.owner, false) !== location.owner) throw new Error();
  } catch {
    throw new SelectionError("invalid-selection");
  }
}

export function decodeSelectionToken(token: string): Location {
  if (typeof token !== "string") throw new SelectionError("invalid-selection");
  let location: unknown;
  try {
    location = JSON.parse(token);
  } catch {
    throw new SelectionError("invalid-selection");
  }
  validLocation(location);
  if (encodeLocation(location) !== token) throw new SelectionError("invalid-selection");
  return Object.freeze(location);
}

export async function readSelectionIndex(
  input: BinaryInput,
  context: SelectionContext
): Promise<SelectionIndex> {
  const bytes = await readBinary(input, context, {
    maxBytes: Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  });
  const fingerprint = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
  const reader = await readPackage(bytes, context);
  const graph = readRelationshipGraph(reader, context.relationshipLimits);
  const roots = graph
    .outgoing("/")
    .filter((edge) => relationshipNamespaces.some((ns) => edge.type === `${ns}/officeDocument`));
  if (roots.length !== 1 || !roots[0]!.targetPart || !reader.has(roots[0]!.targetPart))
    throw new OfficeError(
      "invalid-opc",
      "Presentation relationship is missing or ambiguous.",
      "index"
    );
  const presentation = roots[0]!.targetPart;
  const parsed = new Map<string, ReturnType<typeof interpretCompatibility>>();
  const view = (part: string) => {
    let found = parsed.get(part);
    if (!found) {
      found = interpretCompatibility(
        parseXmlPart(reader.get(part), context.xmlLimits),
        [
          ...presentationNamespaces,
          ...relationshipNamespaces,
          "http://schemas.openxmlformats.org/drawingml/2006/main",
          "http://purl.oclc.org/ooxml/drawingml/main"
        ],
        [
          ...presentationNamespaces.map((namespace) => ({ namespace, localName: "ext" })),
          ...[
            "http://schemas.openxmlformats.org/drawingml/2006/main",
            "http://purl.oclc.org/ooxml/drawingml/main"
          ].flatMap((namespace) =>
            ["ext", "graphicData"].map((localName) => ({ namespace, localName }))
          )
        ]
      );
      parsed.set(part, found);
    }
    return found;
  };
  const document = view(presentation);
  if (!isPresentation(document.part.root, "presentation"))
    throw new OfficeError("invalid-opc", "Invalid presentation root.", "index");
  const lists = document
    .children(document.part.root)
    .filter((element) => isPresentation(element, "sldIdLst"));
  if (lists.length > 1) throw new OfficeError("invalid-opc", "Duplicate slide list.", "index");
  const slideElements = lists[0]
    ? document.children(lists[0]).filter((element) => isPresentation(element, "sldId"))
    : [];
  const slides: SelectionRecord[] = [];
  const objects: SelectionRecord[] = [];
  const parts: SelectionRecord[] = [];
  const ownerScopes = new Map<string, Scope>([[presentation, "presentation"]]);
  const record = (
    kind: SelectionRecord["kind"],
    id: string,
    name: string,
    part: string,
    scope: Scope,
    position: number,
    owner: string,
    objectType?: string
  ): SelectionRecord => {
    const location = Object.freeze({
      fingerprint,
      scope,
      owner,
      objectId: id,
      coordinateSystem: "identity" as const
    });
    return Object.freeze({
      kind,
      id,
      name,
      part,
      scope,
      position,
      ...(objectType === undefined ? {} : { objectType }),
      location,
      token: encodeLocation(location)
    });
  };
  for (const element of slideElements) {
    const id = numericIdentity(attribute(element, "id"), 256, 2147483647);
    const rid = attribute(element, "id", relationshipNamespaces);
    const relationship = graph
      .outgoing(presentation)
      .find(
        (edge) =>
          edge.id === rid && relationshipNamespaces.some((ns) => edge.type === `${ns}/slide`)
      );
    const part = relationship?.targetPart;
    if (
      !id ||
      !part ||
      !reader.has(part) ||
      slides.some((slide) => slide.id === id || slide.part === part)
    )
      throw new OfficeError("invalid-opc", "Invalid slide identity or relationship.", "index");
    const slide = view(part);
    if (!isPresentation(slide.part.root, "sld"))
      throw new OfficeError("invalid-opc", "Invalid slide root.", "index");
    const common = slide.children(slide.part.root).find((child) => isPresentation(child, "cSld"));
    slides.push(
      record(
        "slide",
        id,
        common ? attribute(common, "name") : "",
        part,
        "slides",
        slides.length + 1,
        presentation
      )
    );
    ownerScopes.set(part, "slides");
  }
  const scopeTypes: Readonly<Record<string, Scope>> = {
    notesSlide: "notes",
    slideLayout: "layouts",
    slideMaster: "masters",
    notesMaster: "notes-master",
    handoutMaster: "handout-master"
  };
  for (const owner of ["/", ...graph.parts])
    for (const edge of graph.outgoing(owner)) {
      if (!edge.targetPart) continue;
      for (const [type, scope] of Object.entries(scopeTypes))
        if (relationshipNamespaces.some((ns) => edge.type === `${ns}/${type}`)) {
          const previous = ownerScopes.get(edge.targetPart);
          if (previous && previous !== scope)
            throw new OfficeError("invalid-opc", "Conflicting drawing owner scopes.", "index");
          ownerScopes.set(edge.targetPart, scope);
        }
    }
  for (const part of graph.parts) {
    const scope = ownerScopes.get(part) ?? "shared";
    parts.push(
      record(
        "part",
        "@part",
        part,
        part,
        scope,
        parts.filter((item) => item.scope === scope).length + 1,
        part
      )
    );
  }
  const drawingOwners = [
    ...slides.map((slide) => slide.part),
    ...graph.parts.filter(
      (part) =>
        ownerScopes.has(part) && !["slides", "presentation"].includes(ownerScopes.get(part)!)
    )
  ];
  for (const part of drawingOwners) {
    const drawing = view(part);
    const common = drawing
      .children(drawing.part.root)
      .find((child) => isPresentation(child, "cSld"));
    const tree =
      common && drawing.children(common).find((child) => isPresentation(child, "spTree"));
    if (!tree) continue;
    let position = 0;
    const identities = new Set<string>();
    const visit = (parent: XmlElement): void => {
      for (const element of drawing.children(parent)) {
        if (
          !presentationNamespaces.includes(element.name.namespace) ||
          !["sp", "cxnSp", "graphicFrame", "grpSp", "pic"].includes(element.name.localName)
        )
          continue;
        const nonVisual = drawing
          .children(element)
          .find(
            (child) =>
              presentationNamespaces.includes(child.name.namespace) &&
              ["nvSpPr", "nvCxnSpPr", "nvGraphicFramePr", "nvGrpSpPr", "nvPicPr"].includes(
                child.name.localName
              )
          );
        const identity =
          nonVisual && drawing.children(nonVisual).find((child) => isPresentation(child, "cNvPr"));
        if (!identity || !attribute(identity, "id"))
          throw new OfficeError("invalid-opc", "Drawing object has no identity.", "index");
        const objectId = numericIdentity(attribute(identity, "id"), 0, 4294967295);
        if (identities.has(objectId))
          throw new OfficeError(
            "invalid-opc",
            "Invalid or duplicate drawing object identity.",
            "index"
          );
        identities.add(objectId);
        objects.push(
          record(
            "object",
            objectId,
            attribute(identity, "name"),
            part,
            ownerScopes.get(part)!,
            ++position,
            part,
            element.name.localName
          )
        );
        if (isPresentation(element, "grpSp")) visit(element);
      }
    };
    visit(tree);
  }
  const records = [...slides, ...parts, ...objects];
  return Object.freeze({
    fingerprint,
    inventory: inspectInventory(
      reader,
      graph,
      { slides, objects },
      (part) => view(part).part.root,
      context
    ),
    slides: Object.freeze(slides),
    parts: Object.freeze(parts),
    objects: Object.freeze(objects),
    select(query: SelectionQuery): readonly SelectionRecord[] {
      if (
        !query ||
        typeof query !== "object" ||
        Array.isArray(query) ||
        Object.keys(query).some(
          (key) =>
            !["kind", "scope", "owner", "position", "id", "name", "part", "token", "all"].includes(
              key
            )
        ) ||
        (query.kind !== undefined && !["slide", "part", "object"].includes(query.kind))
      )
        throw new SelectionError("invalid-selection");
      let selected = query.kind ? records.filter((item) => item.kind === query.kind) : records;
      if (query.token !== undefined) {
        if (
          typeof query.token !== "string" ||
          Object.keys(query).some((key) => !["kind", "token"].includes(key))
        )
          throw new SelectionError("invalid-selection");
        const location = decodeSelectionToken(query.token);
        if (location.fingerprint !== fingerprint) throw new SelectionError("stale-selection");
        selected = selected.filter((item) => item.token === query.token);
      } else {
        if (
          !query.kind ||
          (query.scope !== undefined && !scopes.includes(query.scope)) ||
          (query.all !== undefined && typeof query.all !== "boolean")
        )
          throw new SelectionError("invalid-selection");
        for (const key of ["owner", "id", "name", "part"] as const)
          if (
            query[key] !== undefined &&
            (typeof query[key] !== "string" || (key !== "name" && !query[key]))
          )
            throw new SelectionError("invalid-selection");
        if (
          [query.position, query.id, query.name, query.part].filter((value) => value !== undefined)
            .length > 1
        )
          throw new SelectionError("invalid-selection");
        if (query.kind === "slide" && query.scope !== undefined && query.scope !== "slides")
          throw new SelectionError("invalid-selection");
        if (query.kind === "object" && !query.owner) throw new SelectionError("invalid-selection");
        if (query.kind !== "part" && query.part !== undefined)
          throw new SelectionError("invalid-selection");
        selected = selected.filter((item) => item.scope === (query.scope ?? "slides"));
        if (query.owner !== undefined) {
          let owner: string;
          try {
            owner = asciiKey(partName(query.owner, false));
          } catch {
            throw new SelectionError("invalid-selection");
          }
          selected = selected.filter((item) => asciiKey(item.location.owner) === owner);
        }
        if (query.id !== undefined) selected = selected.filter((item) => item.id === query.id);
        if (query.name !== undefined)
          selected = selected.filter((item) => item.name === query.name);
        if (query.part !== undefined) {
          let part: string;
          try {
            part = asciiKey(partName(query.part, false));
          } catch {
            throw new SelectionError("invalid-selection");
          }
          selected = selected.filter((item) => asciiKey(item.part) === part);
        }
        if (query.position !== undefined) {
          const position = query.position;
          if (
            !position ||
            typeof position !== "object" ||
            Object.keys(position).length !== 2 ||
            !["one-based", "zero-based"].includes(position.coordinateSystem) ||
            !Number.isSafeInteger(position.value) ||
            position.value < (position.coordinateSystem === "one-based" ? 1 : 0)
          )
            throw new SelectionError("invalid-selection");
          selected = selected.filter(
            (item) =>
              item.position ===
              position.value + (position.coordinateSystem === "zero-based" ? 1 : 0)
          );
        }
      }
      if (!selected.length) throw new SelectionError("missing-selection");
      if (selected.length > 1 && !query.all)
        throw new SelectionError(
          "ambiguous-selection",
          Object.freeze(selected.slice(0, 20).map((item) => item.location))
        );
      return Object.freeze(selected);
    }
  });
}

export function createBatchHandles(fingerprint: string): {
  register(name: string, location: Location): void;
  resolve(name: string, owner: string): Location;
  invalidate(name: string): void;
} {
  if (
    typeof fingerprint !== "string" ||
    fingerprint.length !== 64 ||
    [...fingerprint].some((character) => !"0123456789abcdef".includes(character))
  )
    throw new SelectionError("invalid-selection");
  const handles = new Map<string, Location | null>();
  return Object.freeze({
    register(name: string, location: Location) {
      if (typeof name !== "string" || !name || handles.has(name))
        throw new SelectionError("invalid-selection");
      validLocation(location);
      if (location.fingerprint !== fingerprint) throw new SelectionError("stale-selection");
      handles.set(name, Object.freeze({ ...location }));
    },
    resolve(name: string, owner: string) {
      const location = handles.get(name);
      if (location === undefined) throw new SelectionError("missing-selection");
      if (location === null) throw new SelectionError("stale-selection");
      if (location.owner !== owner) throw new SelectionError("invalid-selection");
      return location;
    },
    invalidate(name: string) {
      if (!handles.has(name)) throw new SelectionError("missing-selection");
      handles.set(name, null);
    }
  });
}
