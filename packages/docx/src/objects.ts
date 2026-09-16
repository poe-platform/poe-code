import { resolvePath } from "@poe-code/safe-fs/core";
import { archiveSettings, CancellationError, type ArchiveContext } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { DocxUsageError } from "./argument-json.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { DocumentBudget } from "./budget.js";
import { documentDialects } from "./dialect.js";
import {
  closedRecord,
  decodeLocation,
  encodeLocation,
  SelectionError,
  type Location
} from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import { DocumentPackage, type PackagePart, type PackageRelationship } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import type { InspectionReference, InspectionWarning } from "./inspection.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { resolveDocxSelection } from "./simple-selection.js";
import {
  publishDocumentFiles,
  PublicationError,
  type PublicationContext,
  type PublicationInput,
  type PublishedFile
} from "./publication.js";

export interface ObjectResource {
  readonly part: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
}
export type ObjectBindingStatus =
  | "internal"
  | "external"
  | "missing-id"
  | "missing-relationship"
  | "wrong-relationship-type"
  | "ambiguous";
export interface ObjectPreview {
  readonly relationshipId: string | null;
  readonly status: ObjectBindingStatus;
  readonly resource: ObjectResource | null;
}
export interface ObjectDetails {
  readonly kind: "objects";
  readonly role: "ole" | "package" | "unknown";
  readonly status: ObjectBindingStatus;
  readonly resource: ObjectResource | null;
  readonly previews: readonly ObjectPreview[];
  readonly owners: readonly Location[];
  readonly graphParts: readonly ObjectResource[];
  readonly security: {
    readonly macro: "declared" | "unknown";
    readonly protected: "unknown";
    readonly content: "opaque";
  };
}
export interface ObjectRecord {
  readonly kind: "objects";
  readonly location: Location<"part">;
  readonly name?: string;
  readonly properties: readonly [];
  readonly references: readonly InspectionReference[];
  readonly support: "preserve";
  readonly details: ObjectDetails;
}
export interface ObjectInspectionData {
  readonly items: readonly ObjectRecord[];
  readonly warnings: readonly InspectionWarning[];
  readonly document: { readonly protected: boolean };
}
export interface ObjectExtractionManifestV1 {
  readonly version: 1;
  readonly kind: "objects";
  readonly entries: readonly {
    readonly path: string;
    readonly part: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly locations: readonly Location[];
  }[];
}
export interface ObjectExtractionData {
  readonly complete: boolean;
  readonly inventory: null;
  readonly manifest: {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly published: boolean;
  };
  readonly entries: readonly {
    readonly path: string;
    readonly part: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly locations: readonly Location[];
    readonly published: boolean;
  }[];
  readonly warnings: readonly InspectionWarning[];
}
export interface ObjectExtractionContext extends PublicationContext {
  readonly admitPublication?: (planned: ObjectExtractionData) => undefined;
}
export class ObjectExtractionPublicationError extends PublicationError {
  constructor(
    error: PublicationError,
    readonly data: ObjectExtractionData
  ) {
    super(error.code, error.message, error.published, error.stdoutMayBePartial, { cause: error });
  }
}
export class ObjectExtractionCancellationError extends CancellationError {
  constructor(
    error: CancellationError,
    readonly data: ObjectExtractionData,
    readonly published: readonly PublishedFile[]
  ) {
    super(error.message, { cause: error });
  }
}
const office = "urn:schemas-microsoft-com:office:office",
  vml = "urn:schemas-microsoft-com:vml";
const attribute = (node: XmlElement, name: string, namespace = "") =>
  node.attributes.find((a) => a.localName === name && a.namespace === namespace)?.value;
const role = (type: string): ObjectDetails["role"] => {
  for (const dialect of Object.values(documentDialects)) {
    if (type === dialect.r + "/oleObject") return "ole";
    if (type === dialect.r + "/package") return "package";
  }
  return "unknown";
};
async function hash(bytes: Uint8Array, budget: DocumentBudget): Promise<string> {
  budget.charge("retainedBytes", bytes.length + 128);
  budget.charge("work", bytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  budget.check("work", 0);
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const contains = (owner: readonly number[], path: readonly number[]) =>
  owner.length <= path.length && owner.every((n, i) => path[i] === n);

async function inventory(
  input: Uint8Array,
  operation: "objects.list" | "objects.extract",
  options: DocxOperationArguments<"objects.list"> | DocxOperationArguments<"objects.extract">,
  context: ArchiveContext
) {
  const settings = archiveSettings(context),
    invocation = validateDocxInvocation(
      { operation, inputs: ["document"], options },
      settings.budget
    );
  const opts = invocation.options as typeof options;
  const budget = settings.budget.lower(
    Object.fromEntries((opts.limit ?? []).map((limit) => [limit.name, limit.value]))
  );
  const document = await openDocumentLocations(input, { ...settings, budget }, "inventory"),
    graph = new DocumentPackage(document.snapshot(), settings.limits, budget);
  const sourceSha256 = document.list("part")[0]!.value.sourceSha256;
  const warnings: InspectionWarning[] = [],
    descriptors = new Map<string, ObjectResource>(),
    items: ObjectRecord[] = [];
  const warning = (code: string, message: string) => {
    if (warnings.some((w) => w.code === code)) return;
    budget.charge("diagnosticBytes", code.length + message.length + 16);
    budget.charge("retainedBytes", (code.length + message.length) * 4);
    warnings.push({ code, message });
  };
  const resource = async (part: PackagePart): Promise<ObjectResource> => {
    let result = descriptors.get(part.partname);
    if (result) return result;
    budget.check("embeddedMediaBytes", part.bytes.length);
    budget.charge("retainedBytes", 256 + (part.partname.length + part.content_type.length) * 4);
    result = {
      part: part.partname,
      contentType: part.content_type,
      bytes: part.bytes.length,
      sha256: await hash(part.bytes, budget)
    };
    descriptors.set(part.partname, result);
    return result;
  };
  const reference = (owner: string, edge: PackageRelationship): InspectionReference => ({
    owner,
    id: edge.rId,
    type: edge.reltype,
    target: edge.is_external ? "[redacted external target]" : edge.target_ref,
    external: edge.is_external
  });
  const allEdges: { owner: string; edge: PackageRelationship }[] = [];
  for (const owner of [
    "/",
    ...graph.parts
      .filter((p) => !p.content_type.toLowerCase().endsWith("relationships+xml"))
      .map((p) => p.partname)
  ]) {
    for (const edge of graph.relationships(owner)) {
      budget.charge("work", 1);
      budget.charge("retainedBytes", 64);
      allEdges.push({ owner, edge });
    }
  }
  const consumed = new Set<PackageRelationship>(),
    inventoried = new Set<string>();
  const binding = async (owner: string, id: string | undefined, preview = false) => {
    budget.charge("work", allEdges.length);
    const edge = allEdges.find((value) => value.owner === owner && value.edge.rId === id)?.edge;
    const status: ObjectBindingStatus =
      id === undefined
        ? "missing-id"
        : !edge
          ? "missing-relationship"
          : (
                preview
                  ? !Object.values(documentDialects).some((d) => edge.reltype === d.r + "/image")
                  : role(edge.reltype) === "unknown"
              )
            ? "wrong-relationship-type"
            : edge.is_external
              ? "external"
              : "internal";
    if (status !== "internal")
      warning(
        "unresolved-object-binding",
        "Object or preview bindings are external, unresolved or ambiguous; no resource is fetched or fabricated."
      );
    return {
      edge,
      status,
      resource: status === "internal" ? await resource(edge!.target_part) : null
    };
  };
  const add = async (
    owner: string,
    path: readonly number[],
    edge: PackageRelationship | undefined,
    status: ObjectBindingStatus,
    target: ObjectResource | null,
    previews: readonly ObjectPreview[]
  ) => {
    budget.charge("matches", 1);
    budget.charge("retainedBytes", 1024 + path.length * 16);
    if (edge) consumed.add(edge);
    if (target) inventoried.add(target.part);
    const value = {
      version: 1 as const,
      sourceSha256,
      generation: 0,
      part: owner,
      story: owner,
      path,
      range: null
    };
    const location: Location<"part"> = {
      kind: "part",
      value,
      token: encodeLocation(value),
      positions: {}
    };
    const visited = new Set<string>(),
      pending = [
        ...(target ? [target.part] : []),
        ...previews.flatMap((preview) => (preview.resource ? [preview.resource.part] : []))
      ],
      graphParts: ObjectResource[] = [],
      references: InspectionReference[] = [];
    while (pending.length) {
      await budget.checkpoint(1);
      const name = pending.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      budget.charge("retainedBytes", 128);
      graphParts.push(await resource(graph.getPart(name)));
      for (const child of graph.relationships(name)) {
        budget.charge("work", 1);
        if (!child.is_external && !visited.has(child.target_part.partname)) {
          budget.charge("retainedBytes", 16);
          pending.push(child.target_part.partname);
        }
      }
    }
    for (const record of allEdges) {
      budget.charge("work", 1);
      if (
        record.edge === edge ||
        (record.owner === owner &&
          previews.some((preview) => preview.relationshipId === record.edge.rId)) ||
        visited.has(record.owner) ||
        (!record.edge.is_external &&
          (record.edge.target_part.partname === target?.part ||
            previews.some(
              (preview) => preview.resource?.part === record.edge.target_part.partname
            )))
      ) {
        budget.charge(
          "retainedBytes",
          128 +
            (record.owner.length +
              record.edge.rId.length +
              record.edge.reltype.length +
              (record.edge.is_external ? 32 : record.edge.target_ref.length)) *
              4
        );
        references.push(reference(record.owner, record.edge));
      }
    }
    graphParts.sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
    const details: ObjectDetails = {
      kind: "objects",
      role: edge
        ? role(edge.reltype)
        : target?.contentType.toLowerCase().includes("oleobject")
          ? "ole"
          : "unknown",
      status,
      resource: target,
      previews,
      owners: [],
      graphParts,
      security: {
        macro: target?.contentType.toLowerCase().includes("macroenabled") ? "declared" : "unknown",
        protected: "unknown",
        content: "opaque"
      }
    };
    items.push({
      kind: "objects",
      location,
      ...(target ? { name: target.part } : {}),
      properties: [],
      references,
      support: "preserve",
      details
    });
  };
  let protectedDocument = false;
  const matchedObjects = new WeakSet<XmlElement>();
  for (const part of graph.parts) {
    const mime = part.content_type.toLowerCase();
    if (
      !(mime.endsWith("+xml") || mime === "application/xml" || mime === "text/xml") ||
      mime.endsWith("relationships+xml")
    )
      continue;
    await budget.checkpoint(1);
    const root = parseDocumentXml(part.bytes, {}, budget).root;
    const visit = async (
      node: XmlElement,
      path: readonly number[],
      object?: XmlElement
    ): Promise<void> => {
      await budget.checkpoint(1);
      const word = Object.values(documentDialects).some((d) => node.namespace === d.w);
      if (
        word &&
        node.localName === "documentProtection" &&
        !["0", "false", "off"].includes(attribute(node, "enforcement", node.namespace) ?? "")
      )
        protectedDocument = true;
      if (word && node.localName === "object") object = node;
      if (node.namespace === office && node.localName === "OLEObject") {
        if (object) matchedObjects.add(object);
        const id = Object.values(documentDialects)
            .map((d) => attribute(node, "id", d.r))
            .find((id) => id !== undefined),
          resolved = await binding(part.partname, id);
        const previews: ObjectPreview[] = [],
          shapes: XmlElement[] = [];
        const collect = (current: XmlElement) => {
          budget.charge("work", 1);
          if (current.namespace === vml && current.localName === "shape") shapes.push(current);
          for (const child of current.children) collect(child);
        };
        if (object) collect(object);
        const shapeId = attribute(node, "ShapeID"),
          matching = shapeId ? shapes.filter((shape) => attribute(shape, "id") === shapeId) : [];
        if (matching.length === 1) {
          const scan = async (current: XmlElement): Promise<void> => {
            await budget.checkpoint(1);
            if (current.namespace === vml && current.localName === "imagedata") {
              const previewId = Object.values(documentDialects)
                  .map((d) => attribute(current, "id", d.r))
                  .find((id) => id !== undefined),
                image = await binding(part.partname, previewId, true);
              previews.push({
                relationshipId: previewId ?? null,
                status: image.status,
                resource: image.resource
              });
              budget.charge("retainedBytes", 128);
            }
            for (const child of current.children) await scan(child);
          };
          await scan(matching[0]!);
        } else if (shapes.length) {
          previews.push({ relationshipId: null, status: "ambiguous", resource: null });
          warning(
            "ambiguous-object-preview",
            "Preview shape ownership cannot be verified; no association is invented."
          );
        }
        await add(part.partname, path, resolved.edge, resolved.status, resolved.resource, previews);
      }
      for (let i = 0; i < node.children.length; i++)
        await visit(node.children[i]!, [...path, i], object);
      if (word && node.localName === "object" && !matchedObjects.has(node)) {
        warning(
          "unknown-object-carrier",
          "Unrecognized object content remains opaque; stored content is not exposed or activated."
        );
        await add(part.partname, path, undefined, "missing-id", null, []);
      }
    };
    await visit(root, []);
  }
  for (const record of allEdges)
    if (role(record.edge.reltype) !== "unknown" && !consumed.has(record.edge)) {
      const resolved = await binding(record.owner, record.edge.rId);
      await add(
        record.owner === "/"
          ? record.edge.is_external
            ? "/[Content_Types].xml"
            : record.edge.target_part.partname
          : record.owner,
        [],
        record.edge,
        resolved.status,
        resolved.resource,
        []
      );
    }
  for (const part of graph.parts)
    if (
      !inventoried.has(part.partname) &&
      !part.content_type.toLowerCase().endsWith("relationships+xml") &&
      (part.content_type.toLowerCase().includes("oleobject") ||
        part.partname.toLowerCase().startsWith("/word/embeddings/"))
    )
      await add(part.partname, [], undefined, "internal", await resource(part), []);
  const ownerGroups = new Map<string, Location[]>();
  for (const item of items)
    if (item.details.resource) {
      const group = ownerGroups.get(item.details.resource.part) ?? [];
      group.push(item.location);
      ownerGroups.set(item.details.resource.part, group);
      budget.charge("retainedBytes", 32);
    }
  let finalized = items.map((item) => ({
    ...item,
    details: {
      ...item.details,
      owners: item.details.resource ? ownerGroups.get(item.details.resource.part)! : [item.location]
    }
  }));
  if (opts.select !== undefined) {
    const selected = decodeLocation(opts.select);
    if (selected.sourceSha256 !== sourceSha256 || selected.generation !== 0)
      throw new SelectionError("stale-selection");
    if (selected.range !== null)
      throw new DocxUsageError("Object inventory requires whole resource or owner tokens.");
    const own = items.some((item) => item.location.token === opts.select);
    if (!own) document.resolve(opts.select);
    finalized = finalized.filter(
      (item) =>
        item.location.value.part === selected.part &&
        contains(selected.path, item.location.value.path)
    );
  } else if (
    Object.keys(opts).some(
      (key) => !["json", "limit", "outputDir", "force", "allowPartialOutput"].includes(key)
    )
  ) {
    const selection = Object.fromEntries(
      Object.entries(opts).filter(
        ([key]) => !["json", "limit", "outputDir", "force", "allowPartialOutput"].includes(key)
      )
    );
    const owners = resolveDocxSelection(document, {
      operation: "text.get",
      inputs: ["document"],
      options: selection
    });
    finalized = finalized.filter((item) =>
      owners.some(
        (owner) =>
          owner.value.part === item.location.value.part &&
          contains(owner.value.path, item.location.value.path)
      )
    );
  }
  warning(
    "opaque-object-content",
    "Embedded content remains opaque and inert; macro and protection state is unknown unless explicitly declared. No object is activated or decoded."
  );
  if (protectedDocument)
    warning(
      "protected-document",
      "Stored document protection is present; no protection values are exposed or bypassed."
    );
  const data: ObjectInspectionData = {
    items: finalized,
    warnings: items.length || protectedDocument ? warnings : [],
    document: { protected: protectedDocument }
  };
  if (operation === "objects.list" && opts.json) measurePackageResourceSerialization(data, budget);
  return { data, graph, budget };
}

/** Read-only snapshots of inert embedding relationships and preview ownership. */
export async function inspectDocumentObjects(
  input: Uint8Array,
  options: DocxOperationArguments<"objects.list">,
  context: ArchiveContext
): Promise<ObjectInspectionData> {
  return (await inventory(input, "objects.list", options, context)).data;
}

/** Exact object payload extraction; previews remain package resources and are never activated. */
export async function extractDocumentObjects(
  input: Uint8Array,
  options: DocxOperationArguments<"objects.extract"> & { readonly input?: PublicationInput },
  context: ObjectExtractionContext
): Promise<ObjectExtractionData> {
  const declaration = docxOperationSchemas["objects.extract"]!;
  closedRecord(options, [
    "input",
    ...Object.keys(declaration.fields),
    ...declaration.commonOptions
  ]);
  const { input: identity, ...selection } = options;
  if (identity !== undefined) {
    closedRecord(identity, ["path", "stat"]);
    if (typeof identity.path !== "string" || !identity.path || !identity.stat)
      throw new DocxUsageError("Object input identity requires a path and stat.");
  }
  const directory = selection.outputDir;
  if (
    !directory ||
    !directory.startsWith("/") ||
    directory.includes("\0") ||
    resolvePath("/", directory) !== directory
  )
    throw new DocxUsageError(
      "Object extraction requires a canonical absolute VFS output directory."
    );
  if (!context.filesystem)
    throw new PublicationError(
      "unsupported-publication",
      "Object extraction requires an explicitly supplied publication filesystem."
    );
  const result = await inventory(input, "objects.extract", selection, context),
    entries: ObjectExtractionData["entries"][number][] = [],
    files: { path: string; bytes: Uint8Array }[] = [];
  for (const item of result.data.items) {
    const resource = item.details.resource;
    if (!resource) continue;
    result.budget.charge("retainedBytes", resource.bytes);
    result.budget.charge("work", resource.bytes);
    const path = resolvePath(directory, `object-${entries.length + 1}.bin`);
    entries.push({
      path,
      part: resource.part,
      bytes: resource.bytes,
      sha256: resource.sha256,
      locations: [item.location],
      published: false
    });
    files.push({ path, bytes: new Uint8Array(result.graph.getPart(resource.part).bytes) });
  }
  const manifestValue: ObjectExtractionManifestV1 = {
    version: 1,
    kind: "objects",
    entries: entries.map(({ path, part, bytes, sha256, locations }) => ({
      path: path.slice(directory === "/" ? 1 : directory.length + 1),
      part,
      bytes,
      sha256,
      locations
    }))
  };
  const size = measurePackageResourceSerialization(manifestValue, result.budget);
  result.budget.charge("retainedBytes", size * 6);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifestValue)),
    manifest = {
      path: resolvePath(directory, "manifest.json"),
      bytes: manifestBytes.length,
      sha256: await hash(manifestBytes, result.budget),
      published: false
    };
  files.push({ path: manifest.path, bytes: manifestBytes });
  const data: ObjectExtractionData = {
    complete: result.data.items.every((item) => item.details.resource !== null),
    inventory: null,
    manifest,
    entries,
    warnings: result.data.warnings
  };
  if (selection.json) measurePackageResourceSerialization(data, result.budget);
  if (context.admitPublication) {
    result.budget.charge("retainedBytes", entries.length * 128 + 128);
    const planned = Object.freeze({
      ...data,
      manifest: Object.freeze({ ...manifest }),
      entries: Object.freeze(
        entries.map((entry) =>
          Object.freeze({ ...entry, locations: Object.freeze([...entry.locations]) })
        )
      ),
      warnings: Object.freeze([...data.warnings])
    });
    const admitted = (context.admitPublication as (data: ObjectExtractionData) => unknown)(planned);
    if (admitted !== undefined) {
      void Promise.resolve(admitted).catch(() => {});
      throw new DocxUsageError(
        "Object publication admission must be synchronous and return undefined."
      );
    }
  }
  const receipt = (published: readonly PublishedFile[]): ObjectExtractionData => {
    const paths = new Set(published.map((file) => file.path));
    return {
      ...data,
      manifest: { ...manifest, published: paths.has(manifest.path) },
      entries: entries.map((entry) => ({ ...entry, published: paths.has(entry.path) }))
    };
  };
  try {
    const published = await publishDocumentFiles(
      files,
      {
        ...(identity ? { input: identity } : {}),
        ...(selection.force === undefined ? {} : { force: selection.force }),
        ...(selection.allowPartialOutput === undefined
          ? {}
          : { allowPartialOutput: selection.allowPartialOutput })
      },
      { ...context, filesystem: context.filesystem, budget: result.budget }
    );
    return receipt(published.published);
  } catch (error) {
    if (!(error instanceof PublicationError) && !(error instanceof CancellationError)) throw error;
    const published =
        "published" in error && Array.isArray(error.published)
          ? (error.published as readonly PublishedFile[])
          : [],
      partial = { ...receipt(published), complete: false };
    if (error instanceof CancellationError)
      throw new ObjectExtractionCancellationError(error, partial, published);
    throw new ObjectExtractionPublicationError(error, partial);
  }
}
