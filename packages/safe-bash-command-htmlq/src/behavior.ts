import { HtmlBudget, HtmlError, htmlqBaseline, invocationOptions, type HtmlOptions } from "./contracts.js";
import { parseHtml, detachHtmlNode, replaceHtmlAttribute } from "./tree.js";
import { selectHtml } from "./selectors.js";
import { inclusiveHtmlDescendants } from "./traversal.js";
import { serializeHtmlBytes, rustWhitespaceOnly } from "./serializer.js";
import { parseHtmlqArguments, type HtmlqArguments } from "./arguments.js";
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
  if (!args.help && !args.version && (args.filename !== "-" || args.output !== "-"))
    throw new HtmlError("E_ARGUMENT", "VFS paths require htmlq CommandContext");
  yield* projectHtmlq(source, args, invocation);
}
export async function* projectHtmlq(
  source: AsyncIterable<Uint8Array>,
  args: HtmlqArguments,
  invocation: HtmlOptions
): AsyncGenerator<Uint8Array> {
  const budget = new HtmlBudget(invocation);
  if (args.help || args.version) {
    const text = args.help ? htmlqHelp : `htmlq ${htmlqBaseline.version} (safe-bash virtual implementation)\n`;
    budget.charge("work", text.length);
    budget.charge("retainedBytes", text.length * 3);
    const bytes = new TextEncoder().encode(text);
    budget.charge("outputBytes", bytes.length);
    yield bytes;
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
  for (const node of selected) {
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
      for (const descendant of inclusiveHtmlDescendants(node, invocation)) {
        if (descendant.kind !== "text") continue;
        budget.charge("work", descendant.data.length);
        if (args.ignoreWhitespace && rustWhitespaceOnly(descendant.data)) continue;
        yield* outputText(descendant.data);
        if (args.ignoreWhitespace) yield* outputText("\n");
      }
      yield* outputText("\n");
    } else {
      yield* serializeHtmlBytes(node, invocation, args.pretty ? "pretty" : "normalized");
      yield* outputText("\n");
    }
  }
}

const htmlqHelp = `Like jq, but for HTML.

Usage: htmlq [OPTIONS] [SELECTOR]

Arguments:
  [SELECTOR]  What CSS selector to filter with [default: html]

Options:
  -f, --filename <INPUT_PATH>        Where to read HTML input from [default: -]
  -o, --output <OUTPUT_PATH>         Where to write the filtered HTML to [default: -]
  -b, --base <BASE>                  What URL to prepend to links without an origin, i.e. starting with a slash (/)
  -B, --detect-base                  Look for the \`<base>\` tag in input for the base
  -t, --text                         Output only the contained text of the filtered nodes, not the entire HTML
  -i, --ignore-whitespace            Skip over text nodes whose text that is solely whitespace
  -p, --pretty                       If to reformat the HTML to be more nicely user-readable
  -r, --remove-nodes <REMOVE_NODES>  Do not output the nodes matching any of these selectors
  -a, --attributes <ATTRIBUTES>      Output only the contents of the given attributes
  -h, --help                         Print help
  -V, --version                      Print version
`;
