import { archiveSettings, InputTypeError, type ArchiveContext } from "./archive.js";
import { admittedXml, readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { validateDocxInvocation } from "./command.js";
import { DocumentBudget } from "./budget.js";
import { LocationIndex, type DocumentScope, type LocationEntry } from "./location-index.js";
import { encodeLocation, type Location } from "./location-token.js";
import type { XmlContent, XmlElement } from "./package-xml.js";
import { readTextSegments } from "./text-traversal.js";
import type { DocxOperationArguments } from "./operation-types.js";

export type DocumentDiffScope = "package" | DocumentScope;
export type DocumentDiffOptions = DocxOperationArguments<"diff">;
export interface DocumentDiffData {
  readonly equal: boolean;
  readonly mode: "parts" | "xml" | "text" | "structure";
  readonly differences: readonly { readonly kind: "add" | "remove" | "change"; readonly left: Location | null; readonly right: Location | null; readonly part: string }[];
}
interface ComparisonPart { value: Uint8Array | string; location: Location }
const mce = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const xmlns = "http://www.w3.org/2000/xmlns/";

function semanticXml(root: XmlElement, budget: DocumentBudget, wordNamespace?: string, storyRoots: ReadonlySet<XmlElement> = new Set()): string {
  const tokens: string[] = [];
  let text: string[] = [];
  const token = (value: unknown) => {
    const size = (item: unknown): number => typeof item === "string" ? item.length + 2
      : Array.isArray(item) ? item.reduce((n, child) => n + size(child) + 1, 2)
      : item && typeof item === "object" ? Object.entries(item).reduce((n, [key, child]) => n + key.length + size(child) + 4, 2) : 16;
    const capacity = size(value);
    budget.charge("retainedBytes", capacity * 24 + 32);
    budget.charge("work", capacity * 6);
    const encoded = JSON.stringify(value);
    tokens.push(encoded);
  };
  const flush = () => {
    if (!text.length) return;
    budget.charge("retainedBytes", text.reduce((n, item) => n + item.length * 2, 0));
    token(["text", text.join("")]); text = [];
  };
  const content = (nodes: readonly XmlContent[]) => {
    for (const node of nodes) {
      budget.charge("work", 1);
      if (node.kind === "element") visit(node);
      else if (node.kind === "text" || node.kind === "cdata") {
        budget.charge("retainedBytes", node.text.length * 2);
        text.push(node.text);
      } else { flush(); token(node); }
    }
  };
  const visit = (node: XmlElement) => {
    if (node !== root && storyRoots.has(node)) return;
    const logical = wordNamespace === node.namespace;
    if (logical && ["r", "t"].includes(node.localName) && node.attributes.every(a => a.namespace === xmlns || a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "space")) {
      content(node.content); return;
    }
    flush();
    const attributes = node.attributes.filter(a => a.namespace !== xmlns).map(a => {
      budget.charge("work", a.value.length + a.namespace.length + a.localName.length + 1);
      budget.charge("retainedBytes", a.value.length * 4 + 128);
      let value: unknown = a.value;
      if (a.namespace === mce && ["Ignorable", "MustUnderstand", "Requires", "ProcessContent", "PreserveElements", "PreserveAttributes"].includes(a.localName) || !a.namespace && node.namespace === mce && a.localName === "Requires") {
        const words: string[] = [];
        let word = "";
        for (const c of a.value + " ") { if (" \t\r\n".includes(c)) { if (word) words.push(word); word = ""; } else word += c; }
        value = words.map(word => { const colon = word.indexOf(":"); return colon < 0 ? [node.namespaces.get(word) ?? word] : [node.namespaces.get(word.slice(0, colon)) ?? word.slice(0, colon), word.slice(colon + 1)]; });
      }
      if (a.namespace === "http://www.w3.org/2001/XMLSchema-instance" && a.localName === "type") {
        const qname = a.value.trim();
        const colon = qname.indexOf(":");
        value = colon < 0 ? [node.namespaces.get("") ?? "", qname] : [node.namespaces.get(qname.slice(0, colon)) ?? qname.slice(0, colon), qname.slice(colon + 1)];
      }
      return [a.namespace, a.localName, value];
    }).sort((a, b) => JSON.stringify(a.slice(0, 2)) < JSON.stringify(b.slice(0, 2)) ? -1 : 1);
    token(["start", node.namespace, node.localName, attributes]);
    content(node.content); flush(); token(["end"]);
  };
  content(root.prolog ?? []); visit(root); content(root.epilog ?? []); flush();
  return tokens.join("\n");
}

async function comparisonParts(input: Uint8Array, context: ArchiveContext, mode: DocumentDiffData["mode"], scope: DocumentDiffScope): Promise<Map<string, ComparisonPart>> {
  const settings = archiveSettings(context), { budget } = settings;
  budget.charge("retainedBytes", input.length);
  input = new Uint8Array(input);
  const archive: AdmittedDocumentArchive = await readDocumentArchive(input, { ...settings, budget: budget.document() });
  budget.charge("work", input.length);
  budget.charge("retainedBytes", input.length + 1024);
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(input));
  const sourceSha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const locate = (entry: Pick<LocationEntry, "kind" | "part" | "story" | "path" | "positions">): Location => {
    const value = { version: 1 as const, sourceSha256, generation: 0, part: entry.part, story: entry.story, path: entry.path, range: null };
    const token = encodeLocation(value);
    budget.charge("retainedBytes", token.length * 4 + 256);
    return { kind: entry.kind, token, value, positions: entry.positions };
  };
  const result = new Map<string, ComparisonPart>();
  if (scope === "package") {
    for (const member of archive.members) {
      if (member.directory) continue;
      const part = "/" + member.name;
      const root = archive[admittedXml]?.get(member.bytes);
      result.set(part, { value: mode === "xml" && root ? semanticXml(root, budget) : member.bytes, location: locate({ kind: "part", part, story: "package", path: [], positions: {} }) });
    }
  } else {
    const index = new LocationIndex(archive, settings.limits, archive.mainPart, archive.dialect, budget);
    const storyRoots = new Set(index.entries.filter(entry => entry.kind === "story").map(entry => entry.node!));
    budget.charge("retainedBytes", storyRoots.size * 64);
    const storyParts = new Map<string, { values: string[]; location: Location }>();
    const stories = index.entries.filter(entry => entry.kind === "story" && (scope === "all-stories" || entry.scope === scope));
    for (const story of stories) {
      const location = locate(story);
      const value = mode === "text" ? readTextSegments(index, [location], "final", locate, budget).text : semanticXml(story.node!, budget, story.wordNamespace ?? story.node!.namespace, storyRoots);
      const previous = storyParts.get(story.part);
      budget.charge("retainedBytes", value.length * 4 + 256);
      if (previous) previous.values.push(value);
      else storyParts.set(story.part, { values: [value], location });
      if (mode === "structure") {
        const stack = [story.node!];
        while (stack.length) {
          const node = stack.pop()!;
          if (node !== story.node && storyRoots.has(node)) continue;
          budget.charge("work", 1);
          const target = index.imageTargets.get(node);
          if (target) {
            const media = archive.package.getPart(target);
            result.set(target, { value: media.bytes, location: locate({ kind: "part", part: target, story: story.story, path: [], positions: {} }) });
          }
          for (const child of node.children) stack.push(child);
        }
      }
    }
    for (const [part, item] of storyParts) {
      const size = item.values.reduce((n, value) => n + value.length, 0);
      budget.charge("retainedBytes", size * 12 + item.values.length * 64);
      budget.charge("work", size);
      result.set(part, { value: JSON.stringify(item.values), location: item.location });
    }
  }
  return result;
}

/** Compare admitted packages with shared cumulative budgets and explicit scope. */
export async function compareDocument(left: Uint8Array, right: Uint8Array, context: ArchiveContext, options: DocumentDiffOptions): Promise<DocumentDiffData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "diff", inputs: ["left", "right"], options }, settings.budget);
  const mode = (invocation.options.mode ?? "parts") as DocumentDiffData["mode"];
  const scope = invocation.options.scope as DocumentDiffScope;
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) throw new InputTypeError("Expected two document byte inputs.");
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const a = await comparisonParts(left, { ...settings, budget }, mode, scope);
  const b = await comparisonParts(right, { ...settings, budget }, mode, scope);
  const differences: DocumentDiffData["differences"][number][] = [];
  const count = a.size + b.size;
  budget.charge("retainedBytes", count * 128);
  budget.charge("work", count * Math.max(1, Math.ceil(Math.log2(count + 1))) * settings.limits.maxPathBytes);
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  for (const part of names) {
    const before = a.get(part), after = b.get(part);
    await budget.checkpoint((before?.value.length ?? 0) + (after?.value.length ?? 0) + 1);
    const equal = before && after && (typeof before.value === "string" ? before.value === after.value : after.value instanceof Uint8Array && before.value.length === after.value.length && before.value.every((byte, i) => byte === (after.value as Uint8Array)[i]));
    if (!equal) {
      budget.charge("matches", 1);
      budget.charge("retainedBytes", 256 + part.length * 4);
      differences.push({ kind: !before ? "add" : !after ? "remove" : "change", left: before?.location ?? null, right: after?.location ?? null, part });
    }
  }
  return { equal: differences.length === 0, mode, differences };
}
