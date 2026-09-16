import type { Location } from "./contracts.js";
import { OfficeError, ValueError } from "./errors.js";
import { Length } from "./length.js";
import { attr, child, required } from "./masters.js";
import { readShape, type ShapeLength } from "./shapes.js";
import { projectShapePoint } from "./shape-transforms.js";
import { parseXmlPart, type XmlElement, type XmlPart, type XmlMerge } from "./xml.js";
const connectorValues = { STRAIGHT: 1, ELBOW: 2, CURVE: 3, MIXED: -2 } as const;
export type MSO_CONNECTOR_TYPE = (typeof connectorValues)[keyof typeof connectorValues];
const connectorEntries = [
  { name: "STRAIGHT", value: 1, xml_value: "line" },
  { name: "ELBOW", value: 2, xml_value: "bentConnector3" },
  { name: "CURVE", value: 3, xml_value: "curvedConnector3" },
  { name: "MIXED", value: -2, xml_value: null }
] as const;
function invalidConnectorEnum(message: string): never {
  throw new ValueError(message);
}
export const MSO_CONNECTOR_TYPE = Object.freeze(
  Object.assign(connectorValues, {
    metadata(value: MSO_CONNECTOR_TYPE) {
      const entry = connectorEntries.find((e) => e.value === value);
      return entry ? Object.freeze({ ...entry }) : invalidConnectorEnum("Unknown connector type.");
    },
    from_xml(value: string): MSO_CONNECTOR_TYPE {
      return value === "straightConnector1"
        ? 1
        : (connectorEntries.find((e) => e.xml_value !== null && e.xml_value === value)?.value ??
            invalidConnectorEnum("Unknown connector geometry."));
    },
    to_xml(value: MSO_CONNECTOR_TYPE): string {
      return (
        connectorEntries.find((e) => e.value === value)?.xml_value ??
        invalidConnectorEnum("Connector type cannot be written.")
      );
    },
    validate(value: MSO_CONNECTOR_TYPE): void {
      if (!connectorEntries.some((e) => e.value === value && e.xml_value !== null))
        invalidConnectorEnum("Connector type cannot be written.");
    }
  })
);
export const MSO_CONNECTOR = MSO_CONNECTOR_TYPE;
export type ConnectorKind = MSO_CONNECTOR_TYPE | "STRAIGHT" | "ELBOW" | "CURVE";
export interface ConnectorUpdate {
  readonly kind?: ConnectorKind;
  readonly name?: string;
  readonly lineWidth?: ShapeLength | null;
  readonly beginX?: ShapeLength;
  readonly beginY?: ShapeLength;
  readonly endX?: ShapeLength;
  readonly endY?: ShapeLength;
  readonly beginTarget?: Location | null;
  readonly endTarget?: Location | null;
  readonly site?: number;
  readonly detachPolicy?: "detach" | "remove";
  readonly lineColor?: string | null;
}
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function drawing(node: XmlElement) {
  return node.name.namespace === "http://purl.oclc.org/ooxml/presentationml/main"
    ? "http://purl.oclc.org/ooxml/drawingml/main"
    : "http://schemas.openxmlformats.org/drawingml/2006/main";
}
const presets = ["", "line", "bentConnector3", "curvedConnector3"];
function kindNumber(value: ConnectorKind): number {
  const n = typeof value === "string" ? MSO_CONNECTOR_TYPE[value] : value;
  if (![1, 2, 3].includes(n)) invalid("Unsupported connector kind.");
  return n;
}
function emu(value: ShapeLength): number {
  if (!value || typeof value !== "object")
    invalid("Connector coordinates require explicit lengths.");
  for (const key of Reflect.ownKeys(value))
    if (
      typeof key !== "string" ||
      !(value instanceof Length ? ["emu"] : ["value", "unit"]).includes(key) ||
      !("value" in Object.getOwnPropertyDescriptor(value, key)!)
    )
      invalid("Lengths require stored data.");
  if (
    !(value instanceof Length) &&
    (typeof value.value !== "number" ||
      !Number.isFinite(value.value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
  )
    invalid("Lengths require numeric data.");
  const n =
    value instanceof Length
      ? value.emu
      : new Length(
          value.value *
            ({ emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 }[value.unit] ?? NaN)
        ).emu;
  if (!Number.isSafeInteger(n) || Math.abs(n) > 27273042316900)
    invalid("Connector coordinates exceed DrawingML bounds.");
  return n;
}
export function validateConnectorUpdate(update: ConnectorUpdate, adding = false): void {
  if (
    !update ||
    typeof update !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(update)) ||
    Reflect.ownKeys(update).some(
      (k) =>
        typeof k !== "string" ||
        ![
          "kind",
          "name",
          "lineWidth",
          "beginX",
          "beginY",
          "endX",
          "endY",
          "beginTarget",
          "endTarget",
          "site",
          "detachPolicy",
          "lineColor"
        ].includes(k) ||
        !("value" in Object.getOwnPropertyDescriptor(update, k)!)
    )
  )
    invalid("Invalid connector options.");
  if (update.kind !== undefined) kindNumber(update.kind);
  if (update.name !== undefined && typeof update.name !== "string")
    invalid("Connector names require strings.");
  if (update.lineWidth !== undefined && update.lineWidth !== null && emu(update.lineWidth) < 0)
    invalid("Line width must be nonnegative.");
  for (const key of ["beginX", "beginY", "endX", "endY"] as const) {
    if (update[key] !== undefined) emu(update[key]);
    else if (adding) invalid("Connector creation requires all four coordinates.");
  }
  if (adding && update.kind === undefined) invalid("Connector creation requires a kind.");
  if (update.site !== undefined && (!Number.isSafeInteger(update.site) || update.site < 0))
    invalid("Connection sites are zero-based integers.");
  if (update.detachPolicy !== undefined && !["detach", "remove"].includes(update.detachPolicy))
    invalid("Invalid detach policy.");
  if (adding && update.detachPolicy !== undefined)
    invalid("Creation does not accept a detach policy.");
  const color = update.lineColor;
  if (
    color !== undefined &&
    color !== null &&
    color !== "solid" &&
    (typeof color !== "string" ||
      color.length !== 6 ||
      [...color].some((c) => !"0123456789abcdefABCDEF".includes(c)))
  )
    invalid("Line color requires six hexadecimal digits.");
}
export function readConnector(node: XmlElement) {
  if (node.name.localName !== "cxnSp") invalid("Expected a connector.");
  const shape = readShape(node),
    a = drawing(node),
    pr = required(node, "spPr"),
    geom = child(pr, "prstGeom", a),
    raw = geom && attr(geom, "prst"),
    index = raw === "straightConnector1" ? 1 : raw ? presets.indexOf(raw) : -1;
  const nv = required(required(node, "nvCxnSpPr"), "cNvCxnSpPr");
  const endpoint = (name: string) => {
    const n = child(nv, name, a);
    if (!n) return null;
    const objectId = Number(attr(n, "id")),
      site = Number(attr(n, "idx"));
    if (
      !Number.isInteger(objectId) ||
      objectId < 0 ||
      objectId > 4294967295 ||
      !Number.isInteger(site) ||
      site < 0 ||
      site > 4294967295 ||
      attr(n, "idx") === undefined
    )
      unsupported("Connector attachment data is invalid.");
    return { objectId, site };
  };
  if (
    shape.left === null ||
    shape.top === null ||
    shape.width === null ||
    shape.height === null ||
    shape.width < 0 ||
    shape.height < 0
  )
    unsupported("Connector endpoints require explicit valid geometry.");
  const x = shape.left,
    y = shape.top,
    w = shape.width,
    h = shape.height;
  return {
    ...shape,
    kind: index > 0 ? (index as MSO_CONNECTOR_TYPE) : null,
    geometryPreset: raw ?? null,
    beginX: x + (shape.flipHorizontal ? w : 0),
    beginY: y + (shape.flipVertical ? h : 0),
    endX: x + (shape.flipHorizontal ? 0 : w),
    endY: y + (shape.flipVertical ? 0 : h),
    beginTarget: endpoint("stCxn"),
    endTarget: endpoint("endCxn")
  };
}
function parent(root: XmlElement, node: XmlElement): XmlElement | undefined {
  for (const n of root.children) {
    if (n === node) return root;
    const p = parent(n, node);
    if (p) return p;
  }
  return undefined;
}
function nodes(root: XmlElement): XmlElement[] {
  return [root, ...root.children.flatMap(nodes)];
}
function validateIds(root: XmlElement) {
  const used = new Set<number>();
  for (const n of nodes(root))
    if (n.name.namespace === root.name.namespace && n.name.localName === "cNvPr") {
      const id = Number(attr(n, "id"));
      if (!Number.isInteger(id) || id < 0 || id > 4294967295 || used.has(id))
        invalid("Drawing object identities must be unique positive unsigned integers.");
      used.add(id);
    }
  return used;
}
function sitePoint(root: XmlElement, connector: XmlElement, target: XmlElement, site: number) {
  if (
    !nodes(root).includes(target) ||
    target === connector ||
    !["sp", "pic"].includes(target.name.localName)
  )
    unsupported("Connection targets must be shapes or pictures in this drawing.");
  const a = drawing(target),
    pr = required(target, "spPr"),
    geom = child(pr, "prstGeom", a),
    preset = geom && attr(geom, "prst");
  if (!["rect", "ellipse", "roundRect"].includes(preset ?? ""))
    unsupported("Connection sites for this geometry are preserve-only.");
  if (site > 3) invalid("Connection site does not exist.");
  const container = parent(root, connector)!;
  if (container.name.localName === "grpSp" && parent(root, target) !== container)
    unsupported("Cross-group attachment into grouped connectors is unsupported.");
  const record = readShape(target);
  if (
    record.left === null ||
    record.top === null ||
    record.width === null ||
    record.height === null
  )
    unsupported("Connection targets require explicit geometry.");
  const fractions = [
      [0.5, 0],
      [0, 0.5],
      [0.5, 1],
      [1, 0.5]
    ],
    fraction = fractions[site]!;
  const point = projectShapePoint(
    container.name.localName === "grpSp" ? target : root,
    target,
    record.left + record.width * fraction[0]!,
    record.top + record.height * fraction[1]!
  );
  if (!point) unsupported("Connection targets require explicit geometry.");
  return point;
}
export function applyConnectorUpdate(
  document: XmlPart,
  node: XmlElement,
  update: ConnectorUpdate,
  targets: { begin?: XmlElement; end?: XmlElement } = {}
): XmlPart {
  validateConnectorUpdate(update);
  validateIds(document.root);
  for (const end of ["begin", "end"] as const)
    if (update[`${end}Target`] && !targets[end])
      invalid("Attachment locations must be resolved in their drawing context.");
  const current = readConnector(node),
    p = node.name.namespace,
    a = drawing(node);
  if (
    (targets.begin ||
      targets.end ||
      ["beginX", "beginY", "endX", "endY"].some((k) => Object.hasOwn(update, k))) &&
    current.rotation !== 0
  )
    unsupported("Rotated connector endpoint geometry is preserve-only.");
  const geom = child(required(node, "spPr"), "prstGeom", a),
    adjustments = geom && child(geom, "avLst", a);
  if (
    update.kind !== undefined &&
    (current.kind === null || (adjustments?.children.length ?? 0) > 0)
  )
    unsupported("Unsupported connector geometry cannot be replaced.");
  if (update.detachPolicy === "remove")
    invalid("Remove policy requires a connector removal operation.");
  const coordinates = {
    beginX: current.beginX,
    beginY: current.beginY,
    endX: current.endX,
    endY: current.endY
  };
  for (const key of ["beginX", "beginY", "endX", "endY"] as const)
    if (update[key] !== undefined) coordinates[key] = emu(update[key]);
  const connectionEdits: { name: { namespace: string; localName: string }; merge: XmlMerge }[] = [];
  const removals: { namespace: string; localName: string }[] = [];
  for (const end of ["begin", "end"] as const) {
    const target = targets[end],
      localName = end === "begin" ? "stCxn" : "endCxn";
    if (target) {
      if (update.site === undefined) invalid("Attaching an endpoint requires an explicit site.");
      const point = sitePoint(document.root, node, target, update.site);
      coordinates[`${end}X`] = point.x;
      coordinates[`${end}Y`] = point.y;
      connectionEdits.push({
        name: { namespace: a, localName },
        merge: {
          attributes: [
            { namespace: "", localName: "id", value: String(readShape(target).shapeId) },
            { namespace: "", localName: "idx", value: String(update.site) }
          ]
        }
      });
    } else if (update[`${end}Target`] === null || update.detachPolicy === "detach")
      removals.push({ namespace: a, localName });
    else if (
      current[`${end}Target`] &&
      (update[`${end}X`] !== undefined || update[`${end}Y`] !== undefined)
    )
      invalid("Detach an attached endpoint before assigning free coordinates.");
  }
  if (update.site !== undefined && !targets.begin && !targets.end)
    invalid("A site requires an explicitly attached target.");
  const upsert: { name: { namespace: string; localName: string }; merge: XmlMerge }[] = [];
  const u = (namespace: string, localName: string, merge: XmlMerge) => ({
    name: { namespace, localName },
    merge
  });
  const at = (localName: string, value: string) => ({ namespace: "", localName, value });
  if (connectionEdits.length || removals.length)
    upsert.push(
      u(p, "nvCxnSpPr", {
        children: {
          sequence: ["cNvPr", "cNvCxnSpPr", "nvPr"].map((localName) => ({
            namespace: p,
            localName
          })),
          upsert: [
            u(p, "cNvCxnSpPr", {
              children: {
                sequence: ["cxnSpLocks", "stCxn", "endCxn", "extLst"].map((localName) => ({
                  namespace: a,
                  localName
                })),
                upsert: connectionEdits,
                remove: removals
              }
            })
          ]
        }
      })
    );
  const props: typeof upsert = [];
  if (
    ["beginX", "beginY", "endX", "endY"].some((k) => Object.hasOwn(update, k)) ||
    targets.begin ||
    targets.end
  ) {
    const { beginX: bx, beginY: by, endX: ex, endY: ey } = coordinates;
    if (Math.abs(ex - bx) > 27273042316900 || Math.abs(ey - by) > 27273042316900)
      invalid("Connector extent exceeds DrawingML bounds.");
    props.push(
      u(a, "xfrm", {
        attributes: [at("flipH", bx > ex ? "1" : "0"), at("flipV", by > ey ? "1" : "0")],
        children: {
          sequence: ["off", "ext"].map((localName) => ({ namespace: a, localName })),
          upsert: [
            u(a, "off", {
              attributes: [at("x", String(Math.min(bx, ex))), at("y", String(Math.min(by, ey)))]
            }),
            u(a, "ext", {
              attributes: [at("cx", String(Math.abs(ex - bx))), at("cy", String(Math.abs(ey - by)))]
            })
          ]
        }
      })
    );
  }
  if (update.kind !== undefined)
    props.push(u(a, "prstGeom", { attributes: [at("prst", presets[kindNumber(update.kind)]!)] }));
  if (update.lineColor !== undefined)
    props.push(
      u(a, "ln", {
        children: {
          sequence: [
            "noFill",
            "solidFill",
            "gradFill",
            "pattFill",
            "prstDash",
            "custDash",
            "round",
            "bevel",
            "miter",
            "headEnd",
            "tailEnd",
            "extLst"
          ].map((localName) => ({ namespace: a, localName })),
          remove: ["solidFill", "noFill", "gradFill", "pattFill"]
            .filter((name) => name !== (update.lineColor === null ? "noFill" : "solidFill"))
            .map((localName) => ({ namespace: a, localName })),
          upsert: [
            u(
              a,
              update.lineColor === null ? "noFill" : "solidFill",
              update.lineColor === null || update.lineColor === "solid"
                ? {}
                : {
                    children: {
                      sequence: [
                        "srgbClr",
                        "schemeClr",
                        "scrgbClr",
                        "hslClr",
                        "sysClr",
                        "prstClr"
                      ].map((localName) => ({ namespace: a, localName })),
                      remove: ["schemeClr", "scrgbClr", "hslClr", "sysClr", "prstClr"].map(
                        (localName) => ({ namespace: a, localName })
                      ),
                      upsert: [
                        u(a, "srgbClr", { attributes: [at("val", update.lineColor.toUpperCase())] })
                      ]
                    }
                  }
            )
          ]
        }
      })
    );
  if (update.lineWidth !== undefined) {
    const index = props.findIndex((item) => item.name.localName === "ln");
    const existing = index < 0 ? {} : props[index]!.merge;
    const edit = u(a, "ln", {
      ...existing,
      attributes: [
        {
          namespace: "",
          localName: "w",
          value: update.lineWidth === null ? null : String(emu(update.lineWidth))
        }
      ]
    });
    if (index < 0) props.push(edit);
    else props[index] = edit;
  }
  if (update.name !== undefined) {
    const index = upsert.findIndex((item) => item.name.localName === "nvCxnSpPr");
    const existing = index < 0 ? undefined : upsert[index]!.merge.children;
    const edit = u(p, "nvCxnSpPr", {
      children: {
        sequence: ["cNvPr", "cNvCxnSpPr", "nvPr"].map((localName) => ({ namespace: p, localName })),
        upsert: [
          ...(existing?.upsert ?? []),
          u(p, "cNvPr", { attributes: [at("name", update.name)] })
        ]
      }
    });
    if (index < 0) upsert.push(edit);
    else upsert[index] = edit;
  }
  if (props.length)
    upsert.push(
      u(p, "spPr", {
        children: {
          sequence: ["xfrm", "prstGeom", "custGeom", "ln", "effectLst", "extLst"].map(
            (localName) => ({ namespace: a, localName })
          ),
          upsert: props
        }
      })
    );
  return document.merge(node, {
    children: {
      sequence: ["nvCxnSpPr", "spPr", "style", "extLst"].map((localName) => ({
        namespace: p,
        localName
      })),
      upsert
    }
  });
}
export function createConnectorXml(
  id: number,
  update: ConnectorUpdate,
  p = "http://schemas.openxmlformats.org/presentationml/2006/main"
): string {
  validateConnectorUpdate(update, true);
  if (!Number.isInteger(id) || id < 1 || id > 4294967295)
    invalid("New connector identities require positive unsigned integers.");
  if (
    ![
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "http://purl.oclc.org/ooxml/presentationml/main"
    ].includes(p)
  )
    invalid("Unsupported drawing namespace.");
  if (update.beginTarget || update.endTarget || update.site !== undefined)
    invalid("Attached creation requires a drawing context.");
  const a =
    p === "http://purl.oclc.org/ooxml/presentationml/main"
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const doc = parseXmlPart(
    new TextEncoder().encode(
      `<p:cxnSp xmlns:p="${p}" xmlns:a="${a}"><p:nvCxnSpPr><p:cNvPr id="${id}" name="Connector ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="${presets[kindNumber(update.kind!)]}"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>`
    ),
    { maxBytes: 100000, maxNodes: 1000, maxDepth: 30 }
  );
  const local = Object.fromEntries(
    Object.entries(update).filter(([key]) => !["site", "beginTarget", "endTarget"].includes(key))
  ) as ConnectorUpdate;
  const result = applyConnectorUpdate(doc, doc.root, local);
  return result.markup(result.root, true);
}
export function removeDrawingObjects(
  document: XmlPart,
  ids: readonly string[],
  policy?: "detach" | "remove"
): XmlPart {
  validateIds(document.root);
  if (policy !== undefined && !["detach", "remove"].includes(policy))
    invalid("Invalid detach policy.");
  const all = nodes(document.root),
    selected = all.filter(
      (n) =>
        ["sp", "pic", "cxnSp", "grpSp", "graphicFrame"].includes(n.name.localName) &&
        n.name.namespace === document.root.name.namespace &&
        ids.some((id) => Number(id) === readShape(n).shapeId)
    );
  const deleting = new Set(
    selected.flatMap((n) =>
      nodes(n)
        .filter((c) => c.name.namespace === n.name.namespace && c.name.localName === "cNvPr")
        .map((c) => Number(attr(c, "id")))
    )
  );
  if (selected.length !== ids.length)
    invalid("Deletion targets must be distinct existing objects.");
  if (policy === "remove") {
    let previousSize = -1;
    while (previousSize !== deleting.size) {
      previousSize = deleting.size;
      for (const n of all.filter(
        (n) => n.name.namespace === document.root.name.namespace && n.name.localName === "cxnSp"
      )) {
        const r = readConnector(n);
        if (
          (r.beginTarget && deleting.has(r.beginTarget.objectId)) ||
          (r.endTarget && deleting.has(r.endTarget.objectId))
        )
          deleting.add(r.shapeId);
      }
    }
  }
  if (
    all.some((n) =>
      n.attributes.some((at) => at.name.localName === "spid" && deleting.has(Number(at.value)))
    )
  )
    unsupported("Timing references prevent target deletion.");
  const remove = new Set([
    ...selected,
    ...all.filter(
      (n) =>
        n.name.localName === "cxnSp" &&
        n.name.namespace === document.root.name.namespace &&
        deleting.has(readShape(n).shapeId)
    )
  ]);
  if (
    [...remove].some((n) =>
      nodes(n).some((c) => c.attributes.some((at) => at.name.namespace.includes("relationships")))
    )
  )
    unsupported("Relationship-bearing object deletion is unsupported.");
  let result = document;
  for (const n of all.filter(
    (n) => n.name.namespace === document.root.name.namespace && n.name.localName === "cxnSp"
  )) {
    const record = readConnector(n);
    if (deleting.has(record.shapeId)) continue;
    const begin = record.beginTarget && deleting.has(record.beginTarget.objectId),
      end = record.endTarget && deleting.has(record.endTarget.objectId);
    if (!begin && !end) continue;
    if (!policy) unsupported("Referenced targets require explicit detach or remove policy.");
    if (policy === "remove") remove.add(n);
    else {
      const current = nodes(result.root).find(
        (x) => x.name.localName === "cxnSp" && readShape(x).shapeId === record.shapeId
      )!;
      result = applyConnectorUpdate(result, current, {
        ...(begin ? { beginTarget: null } : {}),
        ...(end ? { endTarget: null } : {})
      });
    }
  }
  for (const n of [...remove].filter(
    (n) => ![...remove].some((other) => other !== n && nodes(other).includes(n))
  )) {
    const id = readShape(n).shapeId,
      current = nodes(result.root).find(
        (x) =>
          ["sp", "pic", "cxnSp", "grpSp", "graphicFrame"].includes(x.name.localName) &&
          x.name.namespace === result.root.name.namespace &&
          readShape(x).shapeId === id
      )!;
    const owner = parent(result.root, current)!;
    result = result.spliceChildren(owner, owner.children.indexOf(current), 1, []);
  }
  return result;
}
