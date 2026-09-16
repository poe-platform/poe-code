import { createFormatRegistry } from "./formats.js";
import { PandocError } from "./errors.js";
import type { ConversionContext } from "./types.js";

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
