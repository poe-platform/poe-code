import { readBinary } from "./bytes.js";
import type { BinaryInput, ByteSource } from "./contracts.js";
import { parseContentTypes } from "./content-types.js";
import { OfficeError } from "./errors.js";
import { readPackage, type PackageReader, type AdmittedPackageReader } from "./package-reader.js";
import { asciiKey } from "./package-uri.js";
import { readRelationshipGraph, type RelationshipGraph } from "./relationships.js";
import type { SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlPart, type XmlMerge } from "./xml.js";

export class SlideTransferBudget {
  private bytes = 0;
  private reads = 0;
  private expanded = 0;
  private members = 0;
  private nodes = 0;
  private parts = 0;
  private relationships = 0;
  private written = 0;

  readonly context: SelectionContext;
  constructor(context: SelectionContext) {
    this.context = {
      ...context,
      limits: { ...context.limits },
      archiveLimits: { ...context.archiveLimits },
      xmlLimits: { ...context.xmlLimits },
      relationshipLimits: { ...context.relationshipLimits }
    };
  }

  private charge(
    key:
      | "bytes"
      | "reads"
      | "expanded"
      | "members"
      | "nodes"
      | "parts"
      | "relationships"
      | "written",
    amount: number,
    maximum: number
  ): void {
    if (this.context.signal?.aborted)
      throw new OfficeError("cancelled", "Operation cancelled.", "admit");
    this[key] += amount;
    if (!Number.isSafeInteger(this[key]) || this[key] > maximum)
      throw new OfficeError(
        "resource-limit",
        "Combined slide transfer work exceeds its limit.",
        "admit"
      );
  }

  async read(input: BinaryInput): Promise<Uint8Array> {
    const remaining = this.context.limits.maxBytes - this.bytes;
    if (remaining < 1) this.charge("bytes", 1, this.context.limits.maxBytes);
    let admitted: BinaryInput = input;
    let exhausted = false;
    const wrap = (source: ByteSource): ByteSource => ({
      read: async (maxBytes, signal) => {
        if (this.reads >= this.context.limits.maxReads) {
          exhausted = true;
          throw new OfficeError(
            "resource-limit",
            "Combined byte reads exceed their limit.",
            "admit"
          );
        }
        this.reads++;
        return source.read(maxBytes, signal);
      }
    });
    if (!(input instanceof Uint8Array) && input && typeof input === "object") {
      if ("path" in input) {
        if (input.capability && typeof input.capability.openRead === "function")
          admitted = {
            path: input.path,
            capability: {
              openRead: async (path, signal) => {
                const source = await input.capability.openRead(path, signal);
                return source && typeof source.read === "function" ? wrap(source) : source;
              }
            }
          };
      } else if (typeof input.read === "function") admitted = wrap(input);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBinary(admitted, this.context, { maxBytes: Math.max(1, remaining) });
    } catch (error) {
      if (this.context.signal?.aborted)
        throw new OfficeError("cancelled", "Operation cancelled.", "admit");
      if (exhausted)
        throw new OfficeError("resource-limit", "Combined byte reads exceed their limit.", "admit");
      throw error;
    }
    this.charge("bytes", bytes.length, this.context.limits.maxBytes);
    return bytes;
  }

  async open(bytes: Uint8Array): Promise<AdmittedPackageReader> {
    this.charge("bytes", bytes.length, this.context.limits.maxBytes);
    const remainingBytes = this.context.archiveLimits.maxTotalBytes - this.expanded;
    const remainingMembers = this.context.archiveLimits.maxMembers - this.members;
    if (remainingBytes < 1 || remainingMembers < 1)
      throw new OfficeError(
        "resource-limit",
        "Combined package admission exceeds its limit.",
        "admit"
      );
    const reader = await readPackage(bytes, {
      ...this.context,
      archiveLimits: {
        ...this.context.archiveLimits,
        maxTotalBytes: remainingBytes,
        maxMembers: remainingMembers
      }
    });
    this.charge("members", reader.entryCount, this.context.archiveLimits.maxMembers);
    this.charge(
      "expanded",
      reader.byteLength("/[Content_Types].xml"),
      this.context.archiveLimits.maxTotalBytes
    );
    const manifest = reader.get("/[Content_Types].xml");
    const manifestNodes = this.xml(manifest).nodeCount;
    this.charge("nodes", manifestNodes, this.context.xmlLimits.maxNodes);
    const types = parseContentTypes(manifest, {
      maxBytes: this.context.xmlLimits.maxBytes,
      maxEntries: this.context.archiveLimits.maxMembers
    });
    const xmlNodes = new Map<string, number>();
    const relationshipCounts = new Map<string, number>();
    let processed = 0;
    for (const name of reader.names) {
      if (++processed % 64 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.charge(
        "expanded",
        reader.byteLength(name) * 2,
        this.context.archiveLimits.maxTotalBytes
      );
      const data = reader.get(name);
      const xml =
        name === "/[Content_Types].xml" ||
        name.endsWith(".rels") ||
        types.get(name).endsWith("+xml") ||
        ["application/xml", "text/xml"].includes(types.get(name));
      if (xml) {
        const parsed = this.xml(data);
        xmlNodes.set(asciiKey(name), parsed.nodeCount);
        if (name.endsWith(".rels")) {
          relationshipCounts.set(asciiKey(name), parsed.root.children.length);
          this.charge(
            "relationships",
            parsed.root.children.length,
            this.context.relationshipLimits.maxRelationships
          );
        }
      }
      if (name !== "/[Content_Types].xml" && !name.endsWith(".rels"))
        this.charge("parts", 1, this.context.relationshipLimits.maxParts);
    }
    const get = (name: string) => {
      this.charge("expanded", reader.byteLength(name), this.context.archiveLimits.maxTotalBytes);
      this.charge("nodes", xmlNodes.get(asciiKey(name)) ?? 0, this.context.xmlLimits.maxNodes);
      this.charge(
        "relationships",
        relationshipCounts.get(asciiKey(name)) ?? 0,
        this.context.relationshipLimits.maxRelationships
      );
      return reader.get(name);
    };
    return {
      names: reader.names,
      entryCount: reader.entryCount,
      byteLength: (name) => reader.byteLength(name),
      has: (name) => reader.has(name),
      get,
      relsXmlFor: (name) => {
        const slash = name.lastIndexOf("/");
        const rel =
          name === "/"
            ? "/_rels/.rels"
            : `${name.slice(0, slash)}/_rels/${name.slice(slash + 1)}.rels`;
        return reader.has(rel) ? get(rel) : null;
      }
    };
  }

  xml(bytes: Uint8Array): XmlPart {
    const remaining = this.context.xmlLimits.maxNodes - this.nodes;
    if (remaining < 1)
      throw new OfficeError("resource-limit", "Combined XML work exceeds its limit.", "parse");
    const parsed = parseXmlPart(bytes, { ...this.context.xmlLimits, maxNodes: remaining });
    this.charge("nodes", parsed.nodeCount, this.context.xmlLimits.maxNodes);
    return this.trackXml(parsed);
  }

  private trackXml(parsed: XmlPart): XmlPart {
    const reserveEdit = (addedNodes: number) =>
      this.charge("nodes", parsed.nodeCount + addedNodes, this.context.xmlLimits.maxNodes);
    return {
      ...parsed,
      bytes: () => this.copy(parsed.bytes()),
      markup: (element) => {
        this.charge("nodes", parsed.nodeCount, this.context.xmlLimits.maxNodes);
        return parsed.markup(element);
      },
      merge: (element, update) => {
        const pending: XmlMerge[] = [update];
        let added = 0;
        while (pending.length) {
          const current = pending.pop()!;
          for (const child of current.children?.upsert ?? []) {
            added++;
            pending.push(child.merge);
          }
        }
        reserveEdit(added);
        return this.trackXml(parsed.merge(element, update));
      },
      spliceChildren: (element, index, count, children) => {
        reserveEdit(children.reduce((sum, fragment) => sum + fragment.length, 0));
        return this.trackXml(parsed.spliceChildren(element, index, count, children));
      },
      reorderChildren: (element, children) => {
        reserveEdit(0);
        return this.trackXml(parsed.reorderChildren(element, children));
      }
    };
  }

  graph(reader: PackageReader): RelationshipGraph {
    const graph = readRelationshipGraph(reader, this.context.relationshipLimits);
    const visit = (edges: ReturnType<RelationshipGraph["outgoing"]>) => {
      this.charge("parts", 1, this.context.relationshipLimits.maxParts);
      this.charge("relationships", edges.length, this.context.relationshipLimits.maxRelationships);
      return edges;
    };
    return {
      parts: graph.parts,
      dangling: graph.dangling,
      outgoing: (owner) => visit(graph.outgoing(owner)),
      incoming: (target) => visit(graph.incoming(target)),
      closure: (roots) => {
        const closure = graph.closure(roots);
        this.charge("parts", closure.length, this.context.relationshipLimits.maxParts);
        for (const part of closure) visit(graph.outgoing(part));
        return closure;
      }
    };
  }

  copy(bytes: Uint8Array): Uint8Array {
    this.charge("expanded", bytes.length, this.context.archiveLimits.maxTotalBytes);
    return bytes;
  }

  outputContext(): SelectionContext {
    const remaining =
      Math.min(this.context.limits.maxBytes, this.context.archiveLimits.maxArchiveBytes) -
      this.written;
    if (remaining < 1)
      throw new OfficeError("resource-limit", "Combined output exceeds its limit.", "serialize");
    return {
      ...this.context,
      limits: { ...this.context.limits, maxBytes: remaining },
      archiveLimits: { ...this.context.archiveLimits, maxArchiveBytes: remaining }
    };
  }

  output(bytes: Uint8Array): void {
    this.charge(
      "written",
      bytes.length,
      Math.min(this.context.limits.maxBytes, this.context.archiveLimits.maxArchiveBytes)
    );
  }
}
