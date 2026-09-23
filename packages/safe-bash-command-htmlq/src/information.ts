import { HtmlBudget, htmlqBaseline, type HtmlOptions } from "./contracts.js";
import type { HtmlqArguments } from "./arguments.js";

const help = `Like jq, but for HTML.

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

export function htmlqInformation(
  args: HtmlqArguments,
  options: HtmlOptions
): Uint8Array | undefined {
  if (!args.help && !args.version) return undefined;
  const text = args.help
    ? help
    : `htmlq ${htmlqBaseline.version} (safe-bash virtual implementation)\n`;
  const budget = new HtmlBudget(options);
  // These fixed ASCII messages have identical character and UTF-8 byte lengths.
  budget.charge("work", text.length);
  budget.charge("retainedBytes", text.length * 3);
  budget.charge("outputBytes", text.length);
  return new TextEncoder().encode(text);
}
