import { referenceText } from "./reference.js";

export interface CommandOperation {
  readonly kind: "operation";
  readonly action:
    | "convert"
    | "merge"
    | "clipboard"
    | "list-importers"
    | "list-exporters"
    | "list-image-formats";
  readonly operands: readonly string[];
  /** Owned raw positional bytes; never infer identity from decoded display text. */
  readonly operandBytes?: readonly Uint8Array[];
  readonly scalars: Readonly<Record<string, string>>;
  /** Owned GOption filename values, independent of decoded display strings. */
  readonly scalarBytes?: Readonly<Record<string, Uint8Array>>;
  readonly arrays: Readonly<Record<string, readonly string[]>>;
  readonly flags: readonly string[];
}
export type ParsedCommand =
  | CommandOperation
  | {
      readonly kind: "terminal";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
      readonly stderrBytes?: Uint8Array;
    };
export interface CommandProfile {
  readonly help?: string;
  readonly version?: string;
  /** Initialized virtual identities. -L/-D are parsed but unused in 1.12.61. */
  readonly configurationRoots?: { readonly dataDir: string; readonly libDir: string };
  /** Explicit locale captures, keyed by help-all/help-gtk/help-libspreadsheet. */
  readonly groups?: Readonly<Record<string, string>>;
  readonly libraryVersion?: string;
  /** Default is the captured C/UTC reference's ASCII listing channel. */
  readonly listingEncoding?: "ascii" | "utf8";
  /** GOption STRING values use the captured process locale, unlike positional filenames. */
  readonly argumentEncoding?: "ascii" | "utf8";
}
export type CommandArgument = string | Uint8Array;
const scalarNames: Readonly<Record<string, string>> = {
  L: "lib-dir",
  D: "data-dir",
  "lib-dir": "lib-dir",
  "data-dir": "data-dir",
  display: "display",
  class: "class",
  name: "name",
  "gtk-module": "gtk-module",
  E: "import-encoding",
  I: "import-type",
  M: "merge-to",
  T: "export-type",
  O: "export-options",
  "import-encoding": "import-encoding",
  "import-type": "import-type",
  "merge-to": "merge-to",
  "export-type": "export-type",
  "export-options": "export-options",
  resize: "resize",
  clipboard: "clipboard",
  "export-range": "export-range"
};
const flagNames: Readonly<Record<string, string>> = {
  "g-fatal-warnings": "g-fatal-warnings",
  v: "verbose",
  S: "export-file-per-sheet",
  verbose: "verbose",
  "export-file-per-sheet": "export-file-per-sheet",
  "list-importers": "list-importers",
  "list-exporters": "list-exporters",
  "list-image-formats": "list-image-formats",
  "export-graphs": "export-graphs",
  recalc: "recalc",
  solve: "solve",
  version: "version"
};
// GLib qualifies group entries using any nonempty prefix of the group name.
// Entry names themselves remain exact; help group names are also exact.
const inheritedGroups = [
  { name: "libspreadsheet", entries: {
    version: "library-version", "lib-dir": "lib-dir", "data-dir": "data-dir"
  } },
  { name: "gtk", entries: {
    display: "display", class: "class", name: "name",
    "gtk-module": "gtk-module", "g-fatal-warnings": "g-fatal-warnings"
  } }
] as const;
const arrayNames = new Set(["set", "goal-seek", "tool-test"]);
const terminal = (stderr: string, exitCode = 1, stdout = ""): Extract<ParsedCommand, { kind: "terminal" }> => ({
  kind: "terminal",
  exitCode,
  stdout,
  stderr
});
const parserError = (message: string) =>
  terminal(
    `${message}\nRun 'ssconvert --help' to see a full list of available command line options.\n`
  );

/** Main GOption entries: scalar last-wins, ordered arrays and interspersed options.
 * GLib short options are clusters; their values always occupy the next argv slot. */
export function parseCommand(supplied: readonly CommandArgument[], profile?: CommandProfile): ParsedCommand {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf8", { ignoreBOM: true });
  const byteMode = supplied.some((argument) => typeof argument !== "string");
  const bytes = supplied.map((argument) => typeof argument === "string" ? encoder.encode(argument) : new Uint8Array(argument));
  // One code unit per byte keeps ASCII option matching and short-cluster traversal exact.
  const argv = bytes.map((argument) => Array.from(argument, (byte) => String.fromCharCode(byte)).join(""));
  const operandBytes: Uint8Array[] = [];
  const unknown = (index: number): ParsedCommand => {
    const option = bytes[index]!;
    if (profile?.listingEncoding !== "utf8") {
      let message: string;
      try {
        const text = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(option);
        message = "Unknown option " + Array.from(text, (character) =>
          character.codePointAt(0)! < 128 ? character : "?").join("");
      } catch {
        message = "[Invalid UTF-8] Unknown option " + Array.from(option, (byte) =>
          (byte >= 32 && byte < 127) || byte === 9 || byte === 10
            ? String.fromCharCode(byte)
            : `\\x${byte.toString(16).padStart(2, "0")}`).join("");
      }
      const result = parserError(message);
      return { ...result, stderrBytes: encoder.encode(result.stderr) };
    }
    const prefix = encoder.encode("Unknown option ");
    const suffix = encoder.encode("\nRun 'ssconvert --help' to see a full list of available command line options.\n");
    const raw = new Uint8Array(prefix.length + option.length + suffix.length);
    raw.set(prefix);
    raw.set(option, prefix.length);
    raw.set(suffix, prefix.length + option.length);
    return { kind: "terminal", exitCode: 1, stdout: "", stderr: decoder.decode(raw), stderrBytes: raw };
  };
  const operands: string[] = [],
    scalars: Record<string, string> = {},
    scalarBytes: Record<string, Uint8Array> = {},
    arrays: Record<string, string[]> = {},
    flags = new Set<string>();
  let options = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument.includes("\0")) return parserError("Arguments must not contain NUL");
    if (options && argument === "--") {
      options = false;
      // GOption keeps the separator when an unparsed dash-leading argument
      // follows, preserving the distinction for another option parser.
      if (argv.slice(index + 1).some((remaining) => remaining.startsWith("-"))) {
        operands.push(argument);
        operandBytes.push(bytes[index]!);
      }
      continue;
    }
    if (!options || !argument.startsWith("-") || argument === "-") {
      operands.push(decoder.decode(bytes[index]));
      operandBytes.push(bytes[index]!);
      continue;
    }
    const long = argument.startsWith("--");
    const raw = argument.slice(long ? 2 : 1);
    let consumed = false;
    for (const entry of long ? [raw] : raw) {
      if ((long && ["help", "help-all", "help-libspreadsheet", "help-gtk"].includes(entry)) ||
          (!long && (entry === "?" || entry === "h"))) {
        const group = long ? entry : "help";
        const captured = group === "help" ? profile?.help : profile?.groups?.[group];
        if (captured !== undefined) return terminal("", 0, captured);
        if (group !== "help" && profile?.help !== undefined)
          return terminal(`Unsupported ssconvert feature: --${group} (missing locale help capture; virtual runtime parity blocker)\n`);
        return terminal("", 0, referenceText[group]!);
      }
      const equals = long ? entry.indexOf("=") : -1;
      let name = equals < 0 ? entry : entry.slice(0, equals);
      let inherited: string | undefined;
      if (long && !Object.hasOwn(scalarNames, name) && !Object.hasOwn(flagNames, name) && !arrayNames.has(name)) {
        const dash = name.indexOf("-");
        if (dash > 0) {
          const prefix = name.slice(0, dash), option = name.slice(dash + 1);
          for (const group of inheritedGroups) {
            if (group.name.startsWith(prefix) && Object.hasOwn(group.entries, option)) {
              inherited = (group.entries as Readonly<Record<string, string>>)[option];
              name = option;
              break;
            }
          }
        }
      }
      // Short and long namespaces are distinct: --I and -recalc are not aliases.
      const scalar = (long ? name.length > 1 : name.length === 1) &&
        Object.hasOwn(scalarNames, name) ? scalarNames[name] : undefined;
      const flag = inherited === "library-version" ? inherited : (long ? name.length > 1 : name.length === 1) &&
        Object.hasOwn(flagNames, name) ? flagNames[name] : undefined;
      if (scalar || (long && arrayNames.has(name))) {
        const optionName = `${long ? "--" : "-"}${name}`;
        if (!long && consumed) return parserError(`Error parsing option ${optionName}`);
        const value = equals < 0 ? argv[index + 1] : entry.slice(equals + 1);
        if (value === undefined) return parserError(`Missing argument for ${optionName}`);
        if (value.includes("\0")) return parserError("Arguments must not contain NUL");
        const valueBytes = equals < 0 ? bytes[index + 1]! : bytes[index]!.subarray(2 + equals + 1);
        if (scalar !== "lib-dir" && scalar !== "data-dir" && profile?.argumentEncoding !== "utf8" && valueBytes.some((byte) => byte >= 128))
          return parserError("Invalid byte sequence in conversion input");
        let decoded: string;
        if (scalar === "lib-dir" || scalar === "data-dir") {
          scalarBytes[scalar] = new Uint8Array(valueBytes);
          decoded = decoder.decode(valueBytes);
        } else {
          try {
            decoded = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(valueBytes);
          } catch {
            return parserError("Invalid byte sequence in conversion input");
          }
        }
        if (equals < 0) consumed = true;
        // GTK's callback appends nonempty modules; an empty later occurrence
        // must not erase an earlier module-loading effect.
        if (scalar === "gtk-module") {
          if (decoded !== "") (arrays[scalar] ??= []).push(decoded);
        } else if (scalar) scalars[scalar] = decoded;
        else (arrays[name] ??= []).push(decoded);
      } else if (flag) flags.add(flag);
      else return unknown(index);
    }
    if (consumed) index++;
  }
  // Gnumeric's post-parse hook exits before GTK's module-loading hook.
  if (flags.has("library-version"))
    return terminal("", 0, profile?.libraryVersion ?? (profile?.configurationRoots
      ? `gnumeric version '1.12.61'\ndatadir := '${profile.configurationRoots.dataDir}'\nlibdir := '${profile.configurationRoots.libDir}'\n`
      : referenceText["libspreadsheet-version"]!));
  if (arrays["gtk-module"] !== undefined)
    return terminal("Unsupported ssconvert feature: --gtk-module (virtual runtime parity blocker)\n");
  if (flags.has("version"))
    return terminal("", 0, profile?.version ?? (profile?.configurationRoots
      ? `ssconvert version '1.12.61'\ndatadir := '${profile.configurationRoots.dataDir}'\nlibdir := '${profile.configurationRoots.libDir}'\n`
      : referenceText.version!));
  for (const name of ["display", "class", "name", "g-fatal-warnings"])
    if (scalars[name] !== undefined || flags.has(name))
      return terminal(`Unsupported ssconvert feature: --${name} (virtual runtime parity blocker)\n`);
  if (flags.has("export-file-per-sheet") && scalars["merge-to"] !== undefined)
    return terminal("--export-file-per-sheet and --merge-to are incompatible\n");
  // Upstream derives splitting only after checking the explicit split/merge conflict.
  if (flags.has("export-graphs")) flags.add("export-file-per-sheet");
  const action = flags.has("list-exporters")
    ? "list-exporters"
    : flags.has("list-importers")
      ? "list-importers"
      : flags.has("list-image-formats")
        ? "list-image-formats"
        : scalars.clipboard !== undefined
          ? "clipboard"
          : scalars["merge-to"] !== undefined
            ? "merge"
            : "convert";
  if (
    !action.startsWith("list-") &&
    (action === "merge"
      ? operands.length < 2
      : action === "clipboard"
        ? operands.length !== 2 || scalars["export-range"] === undefined
        : operands.length < 1 || operands.length > 2)
  )
    return terminal("Usage: ssconvert [OPTION...] INFILE [OUTFILE]\n");
  return Object.freeze({
    kind: "operation",
    action,
    operands: Object.freeze(operands),
    ...(byteMode ? { operandBytes: Object.freeze(operandBytes) } : {}),
    scalars: Object.freeze(scalars),
    ...(Object.keys(scalarBytes).length === 0 ? {} : { scalarBytes: Object.freeze(scalarBytes) }),
    arrays: Object.freeze(
      Object.fromEntries(
        Object.entries(arrays).map(([key, values]) => [key, Object.freeze(values)])
      )
    ),
    flags: Object.freeze([...flags])
  });
}
