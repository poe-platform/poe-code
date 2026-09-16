import { createFormatRegistry } from "./formats.js";
import { PandocError } from "./errors.js";
import type { ConversionContext } from "./types.js";

/** Information modes are validated without acquiring conversion inputs. */
export function inspectCommand(args: readonly string[], context: ConversionContext = {}): string | undefined {
  // Information modes must stand alone. Inspect their leading flag only: later
  // tokens may be literal option values or operands belonging to conversion.
  if (args[0] === "--help" || args[0] === "-h") {
    if (!args.every(arg => arg === "--help" || arg === "-h")) throw new PandocError("E_OPTION", "convert", "Use help flags alone");
    return "Usage: pandoc -f FORMAT -t FORMAT [OPTIONS] [FILE|- ...]\n" +
      "--from/-f --to/-t --output/-o PATH (use - for stdout) --yes --standalone/-s --wrap=none\n" +
      "--metadata/-M KEY=VALUE --metadata-file FILE.json --lossy --fail-if-warnings\n" +
      "--resource-path DIR[:DIR] --extract-media DIR --raw-content=reject|escape|retain\n" +
      "--pdf-page-size a4|letter --pdf-orientation portrait|landscape --pdf-margin POINTS\n" +
      "--pdf-font FAMILY|PATH --pdf-font-size POINTS --pdf-line-height MULTIPLIER\n" +
      "PDF families: mono bundled; serif/sans unavailable (E_CAPABILITY). Font paths use only the admitted VFS.\n" +
      "--epub-title TEXT --epub-language TEXT --epub-identifier TEXT --epub-chapter-level 1..6\n" +
      "--list-input-formats --list-output-formats --list-extensions FORMAT --help/-h --version\n" +
      "Use -- before literal filenames. No external PDF engines, ambient fonts, filters or network fetching.\n" +
      "Capabilities (available directions):\n" + inspectFormats(["--list-input-formats", "--list-output-formats"], context);
  }
  if (args[0] === "--version") {
    if (args.length !== 1) throw new PandocError("E_OPTION", "convert", "Use --version alone");
    return "pandoc TypeScript converter 0.0.1 (original bounded implementation)\n";
  }
  if (args[0]?.startsWith("--list-")) return inspectFormats(args, context);
  return undefined;
}

/** SDK counterpart of the three format inspection flags. No input/output I/O. */
export function inspectFormats(args: readonly string[], context: ConversionContext = {}): string {
  const registry = createFormatRegistry(undefined, context);
  const error = (): never => {
    throw new PandocError(
      "E_OPTION",
      "convert",
      "Use format listing flags alone, or --list-extensions FORMAT"
    );
  };
  if (args[0] === "--list-extensions" && args.length === 2)
    return registry
      .listExtensions(args[1]!)
      .map((name) => `${name}\n`)
      .join("");
  if (args.length === 1 && args[0]!.startsWith("--list-extensions="))
    return registry
      .listExtensions(args[0]!.slice("--list-extensions=".length))
      .map((name) => `${name}\n`)
      .join("");
  const directions = new Set<"read" | "write">();
  const flags = new Map([
    ["--list-input-formats", "read"],
    ["--list-output-formats", "write"]
  ] as const);
  for (const arg of args) {
    const direction = flags.get(arg as "--list-input-formats" | "--list-output-formats");
    if (!direction) return error();
    directions.add(direction);
  }
  if (!directions.size) return error();
  return (["read", "write"] as const)
    .filter((direction) => directions.has(direction))
    .map(
      (direction) =>
        (directions.size === 2 ? `${direction === "read" ? "Input" : "Output"} formats:\n` : "") +
        registry
          .list(direction)
          .map((name) => `${name}\n`)
          .join("")
    )
    .join("");
}
