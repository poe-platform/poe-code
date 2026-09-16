import {
  archiveSettings,
  InputTypeError,
  InvalidValueError,
  type DocumentArchive
} from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { DocxUsageError } from "./argument-json.js";
import { xmlValue } from "./create-content.js";
import { assertOutsideRevisionRanges } from "./revision-markup.js";
import { Image, acquireImageModelInput, type ImageModelContext } from "./image-model.js";
import { characterizeRasterHeader } from "./raster-header.js";
import { openDocumentLocations } from "./locations.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { DocumentPackage } from "./package.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import { relativePartTarget, asciiKey } from "./part-uri.js";
import { assertDocumentEditable, publishDocumentArchive } from "./publication.js";
import { LocationIndex, addressKey } from "./location-index.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import type { PublicationContext, PublicationInput } from "./publication.js";
import type { DocxOperationArguments } from "./operation-types.js";
export interface ImageReplacementRequest {
  readonly operation: "images.replace";
  readonly options: DocxOperationArguments<"images.replace">;
  readonly input?: PublicationInput;
}
export interface ImageReplacementData {
  readonly changed: boolean;
  readonly changes: readonly {
    readonly kind: "replace";
    readonly before: Location<"image">;
    readonly after: Location<"image">;
  }[];
  readonly output: {
    readonly path: string | null;
    readonly bytes: number;
    readonly sha256: string;
  } | null;
  readonly dryRun: boolean;
}
export interface ImageReplacementContext extends PublicationContext {
  readonly binaryResolver?: ImageModelContext["binaryResolver"];
  readonly registerCleanup?: ImageModelContext["registerCleanup"];
  readonly admitPublication?: (planned: ImageReplacementData) => undefined;
}
const attribute = (node: XmlElement, name: string, namespace = "") =>
  node.attributes.find((value) => value.localName === name && value.namespace === namespace)?.value;
function extent(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || !Number.isSafeInteger(rounded) || rounded <= 0)
    throw new InvalidValueError("Image extents must be positive safe EMUs.");
  return rounded;
}

/** Rebinds an admitted physical drawing or an explicitly shared internal resource. */
export async function replaceDocumentImage(
  input: Uint8Array,
  request: ImageReplacementRequest,
  context: ImageReplacementContext
): Promise<ImageReplacementData> {
  if (!request || ![Object.prototype, null].includes(Object.getPrototypeOf(request)))
    throw new InputTypeError("Expected a closed image replacement request.");
  closedRecord(request, ["operation", "options", "input"]);
  if (request.operation !== "images.replace")
    throw new DocxUsageError("Expected image replacement.");
  if (request.input !== undefined) {
    if (!request.input || ![Object.prototype, null].includes(Object.getPrototypeOf(request.input)))
      throw new InputTypeError("Expected a closed input identity.");
    closedRecord(request.input, ["path", "stat"]);
    if (
      !request.input.stat ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(request.input.stat))
    )
      throw new InputTypeError("Expected a closed file stat.");
    closedRecord(request.input.stat, [
      "type",
      "size",
      "allocatedBytes",
      "ioBlockSize",
      "preferredIoBlockSize",
      "mode",
      "mtimeMs",
      "atimeMs",
      "ctimeMs",
      "birthtimeMs",
      "revision",
      "identityScope",
      "ino",
      "dev",
      "rdevMajor",
      "rdevMinor",
      "nlink",
      "uid",
      "gid"
    ]);
    request = { ...request, input: { path: request.input.path, stat: { ...request.input.stat } } };
  }
  const settings = archiveSettings(context),
    invocation = validateDocxInvocation(
      {
        operation: request.operation,
        inputs: [request.input?.path ?? "document"],
        options: request.options
      },
      settings.budget
    ),
    options = invocation.options as DocxOperationArguments<"images.replace">;
  const budget = settings.budget.lower(
      Object.fromEntries((options.limit ?? []).map((item) => [item.name, item.value]))
    ),
    scoped = { ...settings, budget };
  if (options.fallback !== undefined)
    throw new UnsupportedEditError("Fallback-bearing replacement is unsupported.");
  const document = await openDocumentLocations(input, scoped),
    selected = resolveDocxSelection(document, invocation) as readonly Location<"image">[],
    archive = document.snapshot();
  assertDocumentEditable(archive, scoped);
  const main = document.list("story", { scope: "body" })[0]!.value.part,
    dialect = dialectForNamespace(
      parseDocumentXml(
        archive.members.find((member) => "/" + member.name === main)!.bytes,
        {},
        budget
      ).root.namespace
    )!,
    ns = documentDialects[dialect];
  const graph = new DocumentPackage(archive, settings.limits, budget),
    editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const resizeEditors = new Map<string, DocumentXmlEditor>();
  const unusedRelationships: { name: string; id: string }[] = [];
  const admitted: {
    before: Location<"image">;
    node: XmlElement;
    frame: XmlElement;
    target: string;
    id: string;
    owner: string;
  }[] = [];
  for (const before of selected) {
    if (before.kind !== "image" || before.value.range !== null)
      throw new UnsupportedEditError("Replacement requires a whole image drawing.");
    const xml = editor.xml(before.value.part.slice(1));
    let node = xml.root;
    const ancestors = [node];
    for (const index of before.value.path) {
      node = node.children[index]!;
      ancestors.push(node);
    }
    if (
      ancestors.some(
        (value) =>
          value.namespace === ns.w &&
          (["ins", "del", "moveFrom", "moveTo"].includes(value.localName) ||
            value.children.some(
              (child) =>
                child.namespace === ns.w &&
                ["pPr", "tcPr"].includes(child.localName) &&
                child.children.some((property) => property.localName.endsWith("Change"))
            ))
      )
    )
      throw new UnsupportedEditError("Tracked containers require explicit revision operations.");
    assertOutsideRevisionRanges(xml.root, node, budget, xml.compatibility.branches);
    const frame = ancestors.find(
      (value) => value.namespace === ns.wp && ["inline", "anchor"].includes(value.localName)
    );
    const id = attribute(node, "embed", ns.r),
      edge = graph.relationships(before.value.part).find((value) => value.rId === id);
    const descendants: XmlElement[] = [];
    const visit = (value: XmlElement) => {
      budget.charge("work", 1);
      descendants.push(value);
      value.children.forEach(visit);
    };
    visit(node);
    if (
      node.namespace !== ns.a ||
      node.localName !== "blip" ||
      !frame ||
      !id ||
      !edge ||
      edge.is_external ||
      edge.reltype !== ns.r + "/image" ||
      attribute(node, "link", ns.r) !== undefined ||
      descendants.some(
        (value) =>
          value.namespace === "http://schemas.microsoft.com/office/drawing/2016/SVG/main" &&
          value.localName === "svgBlip"
      )
    )
      throw new UnsupportedEditError(
        "Replacement requires an unambiguous embedded raster drawing without alternates or links."
      );
    try {
      const header = characterizeRasterHeader(edge.target_part.bytes, scoped);
      if (header.mime !== edge.target_part.content_type.toLowerCase())
        throw new UnsupportedEditError("Image content type conflicts with its byte signature.");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["limit-exceeded", "cancelled"].includes(String(error.code))
      )
        throw error;
      throw new UnsupportedEditError("Existing image is not an admitted raster resource.");
    }
    if (
      !xml.compatibility.canEdit(
        node.attributes.find((value) => value.namespace === ns.r && value.localName === "embed")!
      )
    )
      throw new UnsupportedEditError(
        "Image carrier contains unsupported preservation-sensitive markup."
      );
    admitted.push({
      before,
      node,
      frame,
      id,
      target: edge.target_part.partname,
      owner: before.value.part
    });
  }
  let media: string | undefined, bytes: Uint8Array | undefined, mime: string | undefined;
  if (admitted.length) {
    const acquired = await acquireImageModelInput(options.file, {
      ...scoped,
      ...(context.binaryResolver ? { binaryResolver: context.binaryResolver } : {}),
      ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {})
    });
    const image = await Image.from_blob(acquired.bytes, scoped);
    bytes = image.blob;
    mime = image.content_type;
    if (acquired.filename !== null) {
      const dot = acquired.filename.lastIndexOf("."),
        suffix = dot < 0 ? "" : asciiKey(acquired.filename.slice(dot + 1)),
        assertion = (
          {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            bmp: "image/bmp",
            tif: "image/tiff",
            tiff: "image/tiff"
          } as Record<string, string>
        )[suffix];
      if (assertion && assertion !== mime)
        throw new InvalidValueError("Image filename suffix conflicts with its byte signature.");
    }
    const suffix = (
      {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/bmp": "bmp",
        "image/tiff": "tiff"
      } as Record<string, string>
    )[mime];
    const taken = new Set(archive.members.map((member) => asciiKey("/" + member.name)));
    let ordinal = 1;
    do {
      budget.charge("work", 1);
      media = main.slice(0, main.lastIndexOf("/")) + `/media/image-${ordinal++}.${suffix}`;
    } while (taken.has(asciiKey(media)));
    const changedTargets = new Set(admitted.map((item) => item.target));
    if (options.shared) {
      for (const owner of [
        "/",
        ...graph.parts
          .filter((part) => !part.content_type.endsWith("relationships+xml"))
          .map((part) => part.partname)
      ])
        for (const edge of graph.relationships(owner)) {
          budget.charge("work", 1);
          if (edge.is_external || !changedTargets.has(edge.target_part.partname)) continue;
          const relname =
              owner === "/"
                ? "_rels/.rels"
                : owner.slice(1, owner.lastIndexOf("/") + 1) +
                  "_rels/" +
                  owner.slice(owner.lastIndexOf("/") + 1) +
                  ".rels",
            xml = editor.xml(relname),
            node = xml.root.children.find((value) => attribute(value, "Id") === edge.rId)!;
          xml.setAttribute(
            node,
            "Target",
            relativePartTarget(owner, media) + (edge.fragment === null ? "" : "#" + edge.fragment)
          );
        }
    } else {
      for (const item of admitted) {
        const relname =
            item.owner.slice(1, item.owner.lastIndexOf("/") + 1) +
            "_rels/" +
            item.owner.slice(item.owner.lastIndexOf("/") + 1) +
            ".rels",
          rels = editor.xml(relname),
          id = graph.allocateRelationshipId(item.owner);
        rels.insertChildren(
          rels.root,
          `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${id}" Type="${ns.r}/image" Target="${xmlValue(relativePartTarget(item.owner, media))}"/>`
        );
        editor
          .xml(item.owner.slice(1))
          .setAttribute(item.node, { namespace: ns.r, localName: "embed" }, id);
        const uses = (node: XmlElement): boolean => {
          budget.charge("work", 1);
          return (
            node.attributes.some((value) => value.namespace === ns.r && value.value === item.id) ||
            node.children.some(uses)
          );
        };
        // Serialized admission includes inactive and opaque branches in the census.
        const root = parseDocumentXml(editor.xml(item.owner.slice(1)).serialize(), {}, budget).root;
        if (!uses(root)) unusedRelationships.push({ name: relname, id: item.id });
      }
    }
    if (options.width !== undefined || options.height !== undefined) {
      const length = (value: typeof options.width) =>
        value === undefined
          ? undefined
          : extent(
              value.value * { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 }[value.unit]
            );
      const width = length(options.width),
        height = length(options.height),
        nx = (image.px_width / image.horz_dpi) * 914400,
        ny = (image.px_height / image.vert_dpi) * 914400;
      let x = width ?? extent((height! * nx) / ny),
        y = height ?? extent((width! * ny) / nx);
      let horizontal = 0,
        vertical = 0;
      if (options.fit === "contain") {
        const scale = Math.min(x / nx, y / ny);
        x = extent(nx * scale);
        y = extent(ny * scale);
      }
      if (options.fit === "cover") {
        const scale = Math.max(x / nx, y / ny);
        horizontal = Math.round((1 - x / (nx * scale)) * 50000);
        vertical = Math.round((1 - y / (ny * scale)) * 50000);
        if (horizontal * 2 >= 100000 || vertical * 2 >= 100000)
          throw new InvalidValueError("Image crop is empty.");
      }
      for (const item of admitted) {
        const name = item.owner.slice(1);
        let xml = resizeEditors.get(name);
        if (!xml) {
          xml = new DocumentXmlEditor(editor.xml(name).serialize(), {}, undefined, budget);
          resizeEditors.set(name, xml);
        }
        let node = xml.root;
        const ancestors = [node];
        for (const index of item.before.value.path) {
          node = node.children[index]!;
          ancestors.push(node);
        }
        const frame = ancestors.find(
          (value) => value.namespace === ns.wp && ["inline", "anchor"].includes(value.localName)
        )!;
        const nodes: XmlElement[] = [];
        const walk = (node: XmlElement) => {
          budget.charge("work", 1);
          nodes.push(node);
          node.children.forEach(walk);
        };
        walk(frame);
        const outer = frame.children.filter(
            (node) => node.namespace === ns.wp && node.localName === "extent"
          ),
          inner = nodes.filter((node) => node.namespace === ns.a && node.localName === "ext");
        if (outer.length !== 1 || inner.length !== 1)
          throw new UnsupportedEditError("Ambiguous drawing extents.");
        for (const node of [...outer, ...inner]) {
          xml.setAttribute(node, "cx", String(x));
          xml.setAttribute(node, "cy", String(y));
        }
        if (options.fit) {
          const nodeCarrier = node;
          const parent = nodes.find((node) => node.children.includes(nodeCarrier))!,
            crop = parent.children.filter(
              (node) => node.namespace === ns.a && node.localName === "srcRect"
            );
          if (crop.length > 1) throw new UnsupportedEditError("Ambiguous drawing crop.");
          const markup = `<a:srcRect xmlns:a="${ns.a}" l="${horizontal}" r="${horizontal}" t="${vertical}" b="${vertical}"/>`;
          if (crop[0]) xml.replaceElement(crop[0], markup);
          else
            xml.insertChildren(
              parent,
              markup,
              parent.children[parent.children.indexOf(nodeCarrier) + 1]
            );
        }
      }
    }
    editor
      .xml("[Content_Types].xml")
      .insertChildren(
        editor.xml("[Content_Types].xml").root,
        `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(media)}" ContentType="${mime}"/>`
      );
  }
  const dirty = new Set(editor.dirtyParts);
  budget.charge(
    "retainedBytes",
    archive.members.reduce((sum, member) => sum + member.bytes.length + 128, 0) +
      (bytes?.length ?? 0)
  );
  budget.charge(
    "work",
    archive.members.reduce((sum, member) => sum + member.bytes.length, 0)
  );
  let candidate: DocumentArchive = {
    comment: new Uint8Array(archive.comment),
    members: [
      ...archive.members.map((member) => ({
        ...member,
        bytes: resizeEditors.has(member.name)
          ? resizeEditors.get(member.name)!.serialize()
          : dirty.has(member.name)
            ? editor.xml(member.name).serialize()
            : new Uint8Array(member.bytes)
      })),
      ...(media && bytes
        ? [
            {
              name: media.slice(1),
              bytes,
              directory: false,
              modified: new Date(archive.members[0]!.modified)
            }
          ]
        : [])
    ]
  };
  for (const name of new Set(unusedRelationships.map((item) => item.name))) {
    const fresh = new DocumentArchiveEditor(candidate, {}, undefined, budget).xml(name);
    for (const item of unusedRelationships.filter((item) => item.name === name)) {
      const old = fresh.root.children.find((node) => attribute(node, "Id") === item.id);
      if (old) fresh.replaceElement(old, "");
    }
    candidate = {
      ...candidate,
      members: candidate.members.map((member) =>
        member.name === name ? { ...member, bytes: fresh.serialize() } : member
      )
    };
  }
  if (admitted.length) {
    const nextGraph = new DocumentPackage(candidate, settings.limits, budget),
      incoming = new Set<string>();
    for (const owner of [
      "/",
      ...nextGraph.parts
        .filter((part) => !part.content_type.endsWith("relationships+xml"))
        .map((part) => part.partname)
    ])
      for (const edge of nextGraph.relationships(owner)) {
        budget.charge("work", 1);
        if (!edge.is_external) incoming.add(edge.target_part.partname);
      }
    const retired = new Set(
        admitted
          .map((item) => item.target)
          .filter(
            (target) =>
              !incoming.has(target) &&
              !candidate.members.some(
                (member) =>
                  member.name ===
                  target.slice(1, target.lastIndexOf("/") + 1) +
                    "_rels/" +
                    target.slice(target.lastIndexOf("/") + 1) +
                    ".rels"
              )
          )
      ),
      types = new DocumentArchiveEditor(candidate, {}, undefined, budget).xml(
        "[Content_Types].xml"
      );
    for (const node of types.root.children)
      if (attribute(node, "PartName") && retired.has(attribute(node, "PartName")!))
        types.replaceElement(node, "");
    candidate = {
      ...candidate,
      members: candidate.members
        .filter((member) => !retired.has("/" + member.name))
        .map((member) =>
          member.name === "[Content_Types].xml" ? { ...member, bytes: types.serialize() } : member
        )
    };
  }
  const index = new LocationIndex(candidate, settings.limits, main.slice(1), dialect, budget);
  const changes = admitted.map(({ before }) => {
    const entry = index.byAddress
      .get(addressKey(before.value))
      ?.find((value) => value.kind === "image");
    if (!entry) throw new UnsupportedEditError("Replaced image location cannot be resolved.");
    const value = { ...before.value, generation: before.value.generation + 1 };
    return {
      kind: "replace" as const,
      before,
      after: {
        kind: "image" as const,
        value,
        token: encodeLocation(value),
        positions: entry.positions
      }
    };
  });
  const planned: ImageReplacementData = {
    changed: changes.length > 0,
    changes,
    dryRun: options.dryRun ?? false,
    output: options.dryRun
      ? null
      : {
          path: options.inPlace
            ? (request.input?.path ?? null)
            : options.output === "-"
              ? null
              : (options.output ?? null),
          bytes: settings.limits.maxArchiveBytes,
          sha256: "0".repeat(64)
        }
  };
  if (options.json) {
    const size =
      measurePackageResourceSerialization(
        {
          version: 1,
          operation: request.operation,
          ok: true,
          data: planned,
          affected: changes.length,
          locations: changes.map((change) => change.after),
          warnings: [],
          errors: []
        },
        budget
      ) + 1;
    budget.check("serializedOutput", size);
    budget.charge("retainedBytes", size * 8);
    budget.charge("work", size * 8);
  }
  if (context.admitPublication) {
    const result = context.admitPublication(planned);
    if (result !== undefined) {
      if (result && typeof (result as Promise<unknown>).then === "function")
        void Promise.resolve(result).catch(() => {});
      throw new InputTypeError("Image admission must be synchronous.");
    }
  }
  const result = await publishDocumentArchive(
    candidate,
    {
      ...(request.input ? { input: request.input } : {}),
      ...(options.output === undefined ? {} : { output: options.output }),
      ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }),
      ...(options.force === undefined ? {} : { force: options.force }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      ...(options.json === undefined ? {} : { json: options.json })
    },
    { ...context, budget }
  );
  return {
    ...planned,
    output: result.published.length
      ? {
          path: result.published[0]!.path,
          bytes: result.published[0]!.bytes,
          sha256: result.archiveSha256!
        }
      : null
  };
}
