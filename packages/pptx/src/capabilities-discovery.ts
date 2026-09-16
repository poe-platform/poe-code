import type { BinaryInput } from "./contracts.js";
import { parseContentTypes } from "./content-types.js";
import { OfficeError } from "./errors.js";
import { readRelationshipGraph } from "./relationships.js";
import { readPackage } from "./package-reader.js";
import type { SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlElement } from "./xml.js";

export interface FeatureCapability {
  readonly level?: string;
  readonly supported?: boolean;
  readonly semanticEditing?: boolean;
  readonly automaticLayout?: boolean;
  readonly selectors?: readonly string[];
  readonly operation?: string;
  readonly operations?: readonly string[];
  readonly subset?: string;
  readonly description?: string;
  readonly reason?: string;
}
const featureOperations: Readonly<Record<string, readonly string[]>> = {
  textReplace: ["text.replace"],
  text: ["text.get"],
  layouts: [
    "layouts.list",
    "layouts.get",
    "layouts.add",
    "layouts.set",
    "layouts.remove",
    "layouts.apply"
  ],
  masters: ["masters.list", "masters.get", "masters.add", "masters.set"],
  themes: ["themes.list", "themes.get", "themes.set"],
  backgrounds: ["backgrounds.get", "backgrounds.set"],
  settings: ["settings.list", "settings.get", "settings.set"],
  creation: ["create"],
  selectors: ["inspect"],
  inventory: ["inspect"],
  slides: ["slides.add", "slides.move", "slides.set", "slides.remove", "slides.duplicate"],
  sections: ["sections.list", "sections.get", "sections.add", "sections.set", "sections.remove"],
  shows: ["shows.list", "shows.get", "shows.add", "shows.set", "shows.remove"],
  slideImport: ["slides.import"],
  slideAssembly: ["slides.merge", "slides.split"],
  editing: ["inspect"],
  customPaths: ["shapes.paths.get", "shapes.paths.set"],
  shapes: ["shapes.list", "shapes.get", "shapes.add", "shapes.set"],
  xml: ["xml.get", "xml.set"]
};

export function declaredFeatureCapabilities(
  features: Readonly<Record<string, FeatureCapability>>,
  operations: Readonly<Record<string, unknown>>
) {
  return Object.fromEntries(
    Object.entries(features).map(([name, feature]) => {
      const paths =
        feature.operations ?? (feature.operation ? [feature.operation] : featureOperations[name]);
      if (!paths?.length || paths.some((path) => !Object.hasOwn(operations, path))) {
        throw new OfficeError(
          "invalid-value",
          "Capability references an undeclared operation.",
          "usage"
        );
      }
      return [
        name,
        {
          ...feature,
          level: feature.level ?? (name === "textRuns" ? "edit" : "reject"),
          operations: [...paths],
          subset:
            feature.subset ??
            feature.description ??
            feature.reason ??
            (name === "textRuns"
              ? "Local run formatting with explicit selection; inherited values remain distinct."
              : "No additional semantic support is declared.")
        }
      ];
    })
  );
}

const coreNamespaces = new Set([
  "http://schemas.openxmlformats.org/presentationml/2006/main",
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/presentationml/main",
  "http://purl.oclc.org/ooxml/drawingml/main",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
  "http://schemas.openxmlformats.org/package/2006/content-types",
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://schemas.openxmlformats.org/markup-compatibility/2006",
  "http://www.w3.org/XML/1998/namespace"
]);

export async function assessCapabilities(input: BinaryInput, context: SelectionContext) {
  const reader = await readPackage(input, context);
  const types = reader.has("/[Content_Types].xml")
    ? parseContentTypes(reader.get("/[Content_Types].xml"), {
        maxBytes: context.xmlLimits.maxBytes,
        maxEntries: context.archiveLimits.maxMembers
      })
    : undefined;
  const namespaces = new Map<string, Set<string>>();
  const unsupported: { part: string; reason: string }[] = [];
  const affectedUnsupportedOperations = new Set<string>();
  let nodes = 0;
  let xmlBytes = 0;
  const parts: { part: string; contentType: string | null }[] = [];
  for (const part of reader.names) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    context.signal?.throwIfAborted();
    let contentType: string | null = null;
    if (types && part !== "/[Content_Types].xml") {
      try {
        contentType = types.get(part);
      } catch (error) {
        if (!(error instanceof OfficeError) || error.code !== "missing-binding") throw error;
      }
    }
    const type = contentType?.split(";", 1)[0]!.trim().toLowerCase();
    if (
      type?.includes("digital-signature") ||
      type?.includes("macroenabled") ||
      type?.includes("vbaproject") ||
      part.toLowerCase().startsWith("/_xmlsignatures/")
    ) {
      affectedUnsupportedOperations.add("xml.set");
      unsupported.push({
        part,
        reason:
          "Signature or macro marker prevents xml.set; other operation restrictions are not exhaustively assessed."
      });
    }
    if (
      part.toLowerCase().endsWith(".xml") ||
      part.toLowerCase().endsWith(".rels") ||
      type?.endsWith("+xml") ||
      type === "application/xml" ||
      type === "text/xml"
    ) {
      const data = reader.get(part);
      xmlBytes += data.length;
      if (xmlBytes > context.xmlLimits.maxBytes || nodes >= context.xmlLimits.maxNodes)
        throw new OfficeError(
          "resource-limit",
          "Capability XML inspection limit exceeded.",
          "index"
        );
      const xml = parseXmlPart(data, {
        ...context.xmlLimits,
        maxNodes: context.xmlLimits.maxNodes - nodes
      });
      nodes += xml.nodeCount;
      if (nodes > context.xmlLimits.maxNodes)
        throw new OfficeError("resource-limit", "Capability XML node limit exceeded.", "index");
      const pending: XmlElement[] = [xml.root];
      let visited = 0;
      while (pending.length) {
        if (++visited % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        context.signal?.throwIfAborted();
        const node = pending.pop()!;
        if (
          [
            "http://schemas.openxmlformats.org/presentationml/2006/main",
            "http://purl.oclc.org/ooxml/presentationml/main"
          ].includes(node.name.namespace) &&
          node.name.localName === "modifyVerifier"
        ) {
          affectedUnsupportedOperations.add("xml.set");
          unsupported.push({
            part,
            reason:
              "Presentation protection prevents xml.set; other operation restrictions are not exhaustively assessed."
          });
        }
        const names = [
          node.name.namespace,
          ...node.attributes.flatMap((attribute) =>
            attribute.name.namespace === "http://www.w3.org/2000/xmlns/"
              ? [attribute.value]
              : [attribute.name.namespace]
          )
        ];
        for (const namespace of names) {
          if (!namespace) continue;
          const owners = namespaces.get(namespace) ?? new Set<string>();
          owners.add(part);
          namespaces.set(namespace, owners);
        }
        for (const child of node.children) pending.push(child);
      }
    } else
      unsupported.push({
        part,
        reason: "Opaque bytes are inventoried without decoding or execution."
      });
    parts.push({ part, contentType });
  }
  const graph = readRelationshipGraph(reader, context.relationshipLimits);
  for (const owner of ["/", ...graph.parts]) {
    context.signal?.throwIfAborted();
    if (
      graph
        .outgoing(owner)
        .some(
          (edge) => edge.type.includes("/digital-signature/") || edge.type.endsWith("/vbaProject")
        )
    ) {
      affectedUnsupportedOperations.add("xml.set");
      unsupported.push({
        part: owner,
        reason:
          "Signature or macro relationship prevents xml.set; other operation restrictions are not exhaustively assessed."
      });
    }
  }
  const detectedNamespaces = [...namespaces]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([namespace, owners]) => ({
      namespace,
      parts: [...owners].sort(),
      level: coreNamespaces.has(namespace) ? "read" : "preserve",
      reason: coreNamespaces.has(namespace)
        ? "Namespace inventory only; recognition does not verify every element or authorize editing."
        : "Namespace semantics are unverified; preserve opaque content and do not infer editing support."
    }));
  for (const namespace of detectedNamespaces.filter((item) => item.level === "preserve")) {
    for (const part of namespace.parts)
      unsupported.push({ part, reason: `Unverified namespace: ${namespace.namespace}` });
  }
  return {
    complete: false,
    parts,
    namespaces: detectedNamespaces,
    unsupported,
    affectedUnsupportedOperations: [...affectedUnsupportedOperations].sort()
  };
}

const strings = { type: "array", items: { type: "string" } };
const featureSchema = {
  type: "object",
  additionalProperties: false,
  required: ["level", "operations", "subset"],
  properties: {
    level: { enum: ["edit", "read", "preserve", "reject"] },
    operations: { ...strings, minItems: 1 },
    operation: { type: "string" },
    subset: { type: "string" },
    description: { type: "string" },
    reason: { type: "string" },
    supported: { type: "boolean" },
    semanticEditing: { type: "boolean" },
    automaticLayout: { type: "boolean" },
    selectors: strings
  }
};
const assessmentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["complete", "parts", "namespaces", "unsupported", "affectedUnsupportedOperations"],
  properties: {
    complete: { const: false },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["part", "contentType"],
        properties: { part: { type: "string" }, contentType: { type: ["string", "null"] } }
      }
    },
    namespaces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["namespace", "parts", "level", "reason"],
        properties: {
          namespace: { type: "string" },
          parts: strings,
          level: { enum: ["read", "preserve"] },
          reason: { type: "string" }
        }
      }
    },
    unsupported: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["part", "reason"],
        properties: { part: { type: "string" }, reason: { type: "string" } }
      }
    },
    affectedUnsupportedOperations: strings
  }
};
export const capabilitiesSchema = {
  description:
    "Declared operation support and optional bounded input namespace assessment; complete: false. Unknown namespaces remain explicit and recognition never proves full editing.",
  input: {
    type: "string",
    minLength: 1,
    description: "Optional explicit VFS path or stdin marker; omitted input performs no reads."
  },
  options: {
    type: "object",
    additionalProperties: false,
    properties: {
      json: { type: "boolean" },
      limit: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          ["maxBytes", "maxNodes", "maxDepth", "maxOutputBytes"].map((name) => [
            name,
            { type: "integer", minimum: name === "maxOutputBytes" ? 512 : 1 }
          ])
        )
      }
    }
  },
  result: {
    type: "object",
    additionalProperties: false,
    required: ["version", "operation", "ok", "data", "warnings", "errors", "affected", "locations"],
    properties: {
      version: { const: 1 },
      operation: { const: "capabilities" },
      ok: { type: "boolean" },
      data: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["features", "io"],
        properties: {
          features: { type: "object", additionalProperties: featureSchema },
          io: {
            type: "object",
            additionalProperties: false,
            required: ["input", "network", "nativeRuntime"],
            properties: {
              input: { const: "explicit-vfs-or-stdin" },
              network: { const: false },
              nativeRuntime: { const: false }
            }
          },
          assessment: assessmentSchema
        }
      },
      warnings: { type: "array" },
      errors: { type: "array" },
      affected: { type: "integer", minimum: 0 },
      locations: { type: "array" }
    }
  }
};
export const capabilitiesUsage =
  `Usage: pptx capabilities [INPUT] [${Object.keys(capabilitiesSchema.options.properties)
    .map((name) => `--${name}${name === "limit" ? " NAME=VALUE" : ""}`)
    .join("] [")}]\n` +
  `${capabilitiesSchema.description}\n` +
  "Scopes: whole package; selectors are unavailable. Limits may only lower host ceilings.\n" +
  "Limit names: maxBytes, maxNodes, maxDepth, maxOutputBytes (minimum 512).\n" +
  "Output: read-only support report; no output files or publication. Input is read through explicit capabilities only.\n" +
  "Levels: edit = documented mutation subset; read = inspection; preserve = opaque retention; reject = unavailable behavior.\n" +
  "Input assessment inventories XML namespaces and opaque parts; it does not certify document validity or editing readiness.\n" +
  "Affected unsupported operations list proven xml.set signature/macro/protection restrictions only; an empty list is not editing approval.\n";
