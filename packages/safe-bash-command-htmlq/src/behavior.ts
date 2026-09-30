import { yieldTurn } from "safe-bash-contracts/yield";
import { HtmlBudget, HtmlError, invocationOptions, type HtmlOptions } from "./contracts.js";
import { parseHtml, detachHtmlNode, replaceHtmlAttribute, getInternalHtmlNode } from "./tree.js";
import { selectHtml } from "./selectors.js";
import { inclusiveHtmlDescendants } from "./traversal.js";
import { serializeHtmlBytes, rustWhitespaceOnly } from "./serializer.js";
import { parseHtmlqArguments, type HtmlqArguments } from "./arguments.js";
import { htmlqInformation } from "./information.js";
function baseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
/** Source-only SDK: filenames require the command's explicit VFS capabilities. */
export async function* htmlqBytes(
  source: AsyncIterable<Uint8Array>,
  argv: readonly string[],
  options: HtmlOptions
): AsyncGenerator<Uint8Array> {
  const invocation = invocationOptions(options);
  const args = parseHtmlqArguments(argv, invocation);
  const information = htmlqInformation(args, invocation);
  if (information !== undefined) {
    yield information;
    return;
  }
  if (args.filename !== "-" || args.output !== "-")
    throw new HtmlError("E_ARGUMENT", "VFS paths require htmlq CommandContext");
  yield* projectHtmlq(source, args, invocation);
}
export async function* projectHtmlq(
  source: AsyncIterable<Uint8Array>,
  args: HtmlqArguments,
  invocation: HtmlOptions
): AsyncGenerator<Uint8Array> {
  const budget = new HtmlBudget(invocation);
  const information = htmlqInformation(args, invocation);
  if (information !== undefined) {
    yield information;
    budget.check();
    return;
  }
  const document = await parseHtml(source, invocation);
  let base = baseUrl(args.base);
  if (args.detectBase) {
    const first = selectHtml(document, "base", invocation).next().value;
    base = baseUrl(first?.attributes.find((a) => a.name === "href")?.value ?? "") ?? base;
  }
  // Main selector compilation precedes any mutation or output.
  const selected = selectHtml(document, args.selector, invocation);
  let removal = "";
  if (args.removeNodes.length) {
    removal = args.removeNodes.join(",");
    budget.charge("retainedBytes", removal.length * 2);
    try {
      selectHtml(document, removal, invocation);
    } catch (error) {
      if (!(error instanceof HtmlError) || error.code !== "E_SELECTOR") throw error;
      removal = "";
    }
  }
  const encoder = new TextEncoder();
  async function* outputText(text: string): AsyncGenerator<Uint8Array> {
    if (text.length > 0 && text.length <= 2048) {
      let cpCount = text.length;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
          const low = text.charCodeAt(i + 1);
          if (low >= 0xdc00 && low <= 0xdfff) { cpCount--; i++; }
        }
      }
      if (budget.remaining("work") >= cpCount && budget.remaining("retainedBytes") >= text.length * 5) {
        budget.charge("work", cpCount);
        budget.charge("retainedBytes", text.length * 5);
        const bytes = encoder.encode(text);
        budget.charge("outputBytes", bytes.length);
        yield bytes;
        budget.check();
        return;
      }
    }
    let pending = "";
    for (const c of text) {
      budget.charge("work", 1);
      if (pending.length + c.length > 2048) {
        budget.charge("retainedBytes", pending.length * 3);
        const bytes = encoder.encode(pending);
        budget.charge("outputBytes", bytes.length);
        yield bytes;
        pending = "";
        budget.check();
      }
      budget.charge("retainedBytes", c.length * 2);
      pending += c;
    }
    if (pending) {
      budget.charge("retainedBytes", pending.length * 3);
      const bytes = encoder.encode(pending);
      budget.charge("outputBytes", bytes.length);
      yield bytes;
      budget.check();
    }
  }
  let selectedIndex = 0;
  for (const node of selected) {
    if (selectedIndex % 64 === 0) {
      await yieldTurn(invocation.signal);
      invocation.signal.throwIfAborted();
    }
    const isFirstNode = selectedIndex++ === 0;
    if (removal) {
      const first = selectHtml(node, removal, invocation).next().value;
      if (first) detachHtmlNode(first, invocation);
    }
    if (base && node.namespace === "html" && ["a", "area", "link"].includes(node.name)) {
      const href = node.attributes.find((a) => a.namespace === "none" && a.name === "href")?.value;
      if (href !== undefined) {
        budget.charge("work", href.length + base.href.length);
        let value: string;
        if (href.startsWith("////")) {
          let i = 0;
          while (href[i] === "/") i++;
          value = href.slice(i);
        } else {
          try {
            value = new URL(href, base).href;
          } catch {
            value = base.href;
          }
        }
        replaceHtmlAttribute(node, "href", value, invocation);
      }
    }
    if (args.attributes.length) {
      for (const name of args.attributes) {
        budget.charge("work", node.attributes.length + name.length);
        const attribute = node.attributes.find((a) => a.namespace === "none" && a.name === name);
        if (attribute) {
          yield* outputText(attribute.value);
          yield* outputText("\n");
        }
      }
    } else if (args.text) {
      const internal = !args.ignoreWhitespace && !isFirstNode && budget.limits.outputBytes === Infinity ? getInternalHtmlNode(node) : undefined;
      if (internal && internal.children.length === 1 && internal.children[0]!.kind === "text" && internal.children[0]!.children.length === 0) {
        const textData = internal.children[0]!.data;
        budget.charge("work", 2);
        budget.bound("depth", 1);
        budget.charge("work", textData.length);
        yield* outputText(textData + "\n");
      } else {
        for (const descendant of inclusiveHtmlDescendants(node, invocation)) {
          if (descendant.kind !== "text") continue;
          budget.charge("work", descendant.data.length);
          if (args.ignoreWhitespace && rustWhitespaceOnly(descendant.data)) continue;
          yield* outputText(descendant.data);
          if (args.ignoreWhitespace) yield* outputText("\n");
        }
        yield* outputText("\n");
      }
    } else {
      yield* serializeHtmlBytes(node, invocation, args.pretty ? "pretty" : "normalized");
      yield* outputText("\n");
    }
  }
}
