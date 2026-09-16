import type {
  ConversionContext,
  Limits,
  Operation,
  ReaderCapability,
  WriterCapability
} from "./types.js";
import { PandocError } from "./errors.js";
import { coreFormats } from "./formats/index.js";
export { coreFormats } from "./formats/index.js";
export type Direction = "read" | "write";
export interface FormatDescriptor {
  /** Defaults to one operand. Explicit document mode merges ASTs in order. */
  readonly operands?: "join" | "documents";
  readonly name: string;
  readonly aliases?: Partial<Record<Direction, readonly string[]>>;
  readonly read: boolean;
  readonly write: boolean;
  readonly media: "text" | "binary";
  readonly inputEncoding: "utf8" | "bytes";
  readonly inputBudget?: keyof Limits;
  readonly suffixes: readonly string[];
  readonly extensions: Readonly<Record<string, boolean>>;
  readonly options: Readonly<Record<Direction, readonly string[]>>;
  readonly reader?: ReaderCapability;
  readonly writer?: WriterCapability;
}
export interface FormatCapability extends Omit<
  FormatDescriptor,
  "read" | "write" | "reader" | "writer"
> {
  readonly read: { readonly allowed: boolean; readonly available: boolean };
  readonly write: { readonly allowed: boolean; readonly available: boolean };
}
export interface FormatSelection {
  readonly descriptor: FormatDescriptor;
  readonly extensions: Readonly<Record<string, boolean>>;
}
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
function validName(name: string): boolean {
  if (!name) return false;
  for (const char of name)
    if (!(char >= "a" && char <= "z") && !(char >= "0" && char <= "9") && char !== "_")
      return false;
  return true;
}
export function createFormatRegistry(
  descriptors: readonly FormatDescriptor[] = coreFormats,
  context: ConversionContext = {},
  operation: Operation = "convert"
) {
  const fail = (
    code: "E_FORMAT" | "E_EXTENSION" | "E_CAPABILITY" | "E_OPTION" | "E_FORMAT_REQUIRED",
    message: string
  ): never => {
    throw new PandocError(code, operation, message);
  };
  const names = new Set<string>();
  const maps = {
    read: new Map<string, FormatDescriptor>(),
    write: new Map<string, FormatDescriptor>()
  };
  const formats = descriptors
    .map((item) =>
      Object.freeze({
        ...item,
        suffixes: Object.freeze([...item.suffixes]),
        extensions: Object.freeze({ ...item.extensions }),
        options: Object.freeze({
          read: Object.freeze([...item.options.read]),
          write: Object.freeze([...item.options.write])
        })
      })
    )
    .sort((a, b) => compare(a.name, b.name));
  for (const descriptor of formats) {
    if (!validName(descriptor.name) || names.has(descriptor.name))
      fail("E_FORMAT", `Invalid or duplicate format: ${descriptor.name}`);
    names.add(descriptor.name);
    if (
      (descriptor.reader && (!descriptor.read || descriptor.reader.format !== descriptor.name)) ||
      (descriptor.writer && (!descriptor.write || descriptor.writer.format !== descriptor.name))
    )
      fail("E_CAPABILITY", `Invalid binding: ${descriptor.name}`);
    for (const extension of Object.keys(descriptor.extensions))
      if (!validName(extension)) fail("E_EXTENSION", `Invalid extension: ${extension}`);
    for (const direction of ["read", "write"] as const) {
      const aliases = descriptor.aliases?.[direction] ?? [];
      if (aliases.length && !descriptor[direction])
        fail("E_FORMAT", "Alias for rejected direction");
      if (!descriptor[direction]) continue;
      for (const name of [descriptor.name, ...aliases]) {
        if (!validName(name) || maps[direction].has(name))
          fail("E_FORMAT", `Format collision: ${name}`);
        maps[direction].set(name, descriptor);
      }
    }
  }
  const reader = (descriptor: FormatDescriptor) =>
    context.reader?.format === descriptor.name ? context.reader : descriptor.reader;
  const writer = (descriptor: FormatDescriptor) =>
    context.writer?.format === descriptor.name ? context.writer : descriptor.writer;
  function parse(source: string, direction?: Direction): FormatSelection {
    if (typeof source !== "string" || !source)
      fail("E_FORMAT_REQUIRED", "Select an explicit format");
    let cursor = 0;
    while (cursor < source.length && source[cursor] !== "+" && source[cursor] !== "-") cursor++;
    const name = source.slice(0, cursor);
    const selectedDirection = direction ?? (maps.read.has(name) ? "read" : "write");
    const descriptor = maps[selectedDirection].get(name);
    if (!descriptor) return fail("E_FORMAT", `Unsupported ${selectedDirection} format: ${name}`);
    const extensions = Object.fromEntries(
      Object.entries(descriptor.extensions).sort(([a], [b]) => compare(a, b))
    );
    while (cursor < source.length) {
      const enabled = source[cursor++] === "+";
      const start = cursor;
      while (cursor < source.length && source[cursor] !== "+" && source[cursor] !== "-") cursor++;
      const extension = source.slice(start, cursor);
      if (!validName(extension) || !Object.hasOwn(extensions, extension))
        fail("E_EXTENSION", `Unsupported extension: ${extension}`);
      extensions[extension] = enabled;
    }
    return { descriptor, extensions: Object.freeze(extensions) };
  }
  return {
    parse,
    resolve(source: string, direction: Direction) {
      const selection = parse(source, direction);
      const selectedReader = reader(selection.descriptor);
      const selectedWriter = writer(selection.descriptor);
      if (!(direction === "read" ? selectedReader : selectedWriter))
        fail("E_CAPABILITY", `No ${direction} capability for ${selection.descriptor.name}`);
      return { ...selection, reader: selectedReader, writer: selectedWriter };
    },
    list(direction: Direction): readonly string[] {
      return [...maps[direction]]
        .filter(([, descriptor]) =>
          direction === "read" ? reader(descriptor) : writer(descriptor)
        )
        .map(([name]) => name)
        .sort(compare);
    },
    listExtensions(source: string, direction?: Direction): readonly string[] {
      return Object.entries(parse(source, direction).extensions).map(
        ([name, enabled]) => `${enabled ? "+" : "-"}${name}`
      );
    },
    infer(path: string, direction: Direction): string {
      const dot = path.lastIndexOf(".");
      if (dot <= path.lastIndexOf("/") || dot < 0) return fail("E_FORMAT", `No suffix: ${path}`);
      const suffix = path.slice(dot + 1);
      const matches = formats.filter(
        (descriptor) => descriptor[direction] && descriptor.suffixes.includes(suffix)
      );
      if (matches.length !== 1) return fail("E_FORMAT", `Unknown or ambiguous suffix: ${path}`);
      return matches[0]!.name;
    },
    validateOptions(source: string, direction: Direction, options: readonly string[]): void {
      const { descriptor } = parse(source, direction);
      for (const option of options)
        if (!descriptor.options[direction].includes(option))
          fail("E_OPTION", `Inapplicable option: ${option}`);
    },
    capabilities: Object.freeze(
      formats.map((descriptor) => {
        const input = maps.read.get(descriptor.name);
        const output = maps.write.get(descriptor.name);
        return Object.freeze({
          ...descriptor,
          read: Object.freeze({ allowed: !!input, available: !!input && !!reader(input) }),
          write: Object.freeze({ allowed: !!output, available: !!output && !!writer(output) })
        });
      })
    )
  };
}
export const formatCapabilities: readonly FormatCapability[] = createFormatRegistry().capabilities;
