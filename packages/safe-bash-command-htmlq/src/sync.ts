import { HtmlBudget, HtmlError, invocationOptions } from "./contracts.js";
import { detachHtmlNode, getInternalHtmlNode, parseHtmlSync, replaceHtmlAttribute } from "./tree.js";
import { rustWhitespaceOnly, serializeHtml } from "./serializer.js";
import { inclusiveHtmlDescendants } from "./traversal.js";
import { selectHtml } from "./selectors.js";
import { parseHtmlqArguments } from "./arguments.js";

let _syncAbortSignal: AbortSignal | undefined;
const syncAbortSignal = (): AbortSignal => (_syncAbortSignal ??= new AbortController().signal);
const syncHtmlDecoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
const syncHtmlEncoder = new TextEncoder();
const syncHtmlLimits = Object.freeze({
  inputBytes: Infinity,
  decodedBytes: Infinity,
  retainedBytes: Infinity,
  nodes: Infinity,
  attributes: Infinity,
  depth: Infinity,
  tokenBytes: Infinity,
  work: Infinity,
  outputBytes: Infinity,
});

export function evalSyncHtmlq(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  if (inBytes && inBytes.byteLength > 16384) return undefined;
  try {
    const invocation = invocationOptions({ signal: syncAbortSignal(), limits: syncHtmlLimits });
    const args = parseHtmlqArguments(opArgs, invocation);
    if (args.help || args.version) return undefined;
    let srcBytes = inBytes;
    if (args.filename !== "-") {
      if (!readFileSync) return undefined;
      const fBytes = readFileSync(args.filename);
      if (!fBytes || fBytes.byteLength > 16384) return undefined;
      srcBytes = fBytes;
    }
    // Missing bytes mean inherited stdin has not been collected by the fast path.
    if (!srcBytes) return undefined;
    const budget = new HtmlBudget(invocation);
    const original = syncHtmlDecoder.decode(srcBytes);
    const document = parseHtmlSync(original, invocation, budget);
    let base: URL | undefined;
    if (args.base) {
      try { base = new URL(args.base); } catch { base = undefined; }
    }
    if (args.detectBase) {
      const first = selectHtml(document, "base", invocation).next().value;
      const href = first?.attributes.find(a => a.name === "href")?.value ?? "";
      if (href) {
        try { base = new URL(href); } catch { /* ignore */ }
      }
    }
    const selected = selectHtml(document, args.selector, invocation);
    let removal = "";
    if (args.removeNodes.length) {
      removal = args.removeNodes.join(",");
      try {
        selectHtml(document, removal, invocation);
      } catch (error) {
        if (!(error instanceof HtmlError) || error.code !== "E_SELECTOR") throw error;
        removal = "";
      }
    }
    let out = "";
    let selectedIndex = 0;
    for (const node of selected) {
      const isFirstNode = selectedIndex++ === 0;
      if (removal) {
        const first = selectHtml(node, removal, invocation).next().value;
        if (first) detachHtmlNode(first, invocation);
      }
      if (base && node.namespace === "html" && ["a", "area", "link"].includes(node.name)) {
        const href = node.attributes.find(a => a.namespace === "none" && a.name === "href")?.value;
        if (href !== undefined) {
          let value: string;
          if (href.startsWith("////")) {
            let i = 0;
            while (href[i] === "/") i++;
            value = href.slice(i);
          } else {
            try { value = new URL(href, base).href; } catch { value = base.href; }
          }
          replaceHtmlAttribute(node, "href", value, invocation);
        }
      }
      if (args.attributes.length) {
        for (const name of args.attributes) {
          const attribute = node.attributes.find(a => a.namespace === "none" && a.name === name);
          if (attribute) out += attribute.value + "\n";
        }
      } else if (args.text) {
        const internal = !args.ignoreWhitespace && !isFirstNode ? getInternalHtmlNode(node) : undefined;
        if (internal && internal.children.length === 1 && internal.children[0]!.kind === "text" && internal.children[0]!.children.length === 0) {
          out += internal.children[0]!.data + "\n";
        } else {
          for (const descendant of inclusiveHtmlDescendants(node, invocation)) {
            if (descendant.kind !== "text") continue;
            if (args.ignoreWhitespace && rustWhitespaceOnly(descendant.data)) continue;
            out += descendant.data;
            if (args.ignoreWhitespace) out += "\n";
          }
          out += "\n";
        }
      } else {
        out += serializeHtml(node, invocation, args.pretty ? "pretty" : "normalized") + "\n";
      }
    }
    if (args.output !== "-") {
      if (!writeFileSync || !writeFileSync(args.output, syncHtmlEncoder.encode(out))) return undefined;
      return "";
    }
    return out;
  } catch {
    return undefined;
  }
}
