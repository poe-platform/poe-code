import { byteText, textBytes, token } from "./bytes.js";
import { classify } from "./resolution-path.js";
import { filterInputMetadata, filterOutputMetadata, filterResourceAliases, filterResourceDefaults } from './options.generated.js';
import type { Dependency, ResourceRole } from "./types.js";

export function resource(index: number, value: Uint8Array, role: ResourceRole, access: Dependency["access"], stage: Dependency["stage"], literal = role === 'preset', syntax: 'avio' | 'stdio' = role === 'option-file' ? 'avio' : 'stdio'): Dependency {
  if (!(value instanceof Uint8Array)) throw new TypeError('Resource classification requires original bytes');
  // Classify the same owned bytes that discovery returns. Producer metadata
  // must not disguise a native URL as a filesystem dependency.
  value = new Uint8Array(value);
  const name = byteText(value);
  // AVIO opens '-' in the file namespace; only specific callers rewrite it.
  literal ||= syntax === 'avio' && name === '-';
  const classification = classify(value);
  const kind = literal ? 'path' : classification === "descriptor" ? "descriptor"
    : classification === "url" ? "url"
    : classification === 'file-protocol' ? 'file-protocol'
    : name.includes("%") || name.includes("*") ? "pattern" : "path";
  return { index, value, role, access, stage, kind, base: "cwd",
    ...(literal ? { literal: true } : {}) };
}

// Positional fields and aliases come from the individual registered filter tables.
const filterFiles: Readonly<Record<string, readonly string[]>> = {
  movie: ["filename"], amovie: ["filename"],
  lut1d: ["file"], lut3d: ["file"], haldclut: [], drawtext: ["fontfile", "text", "textfile"],
  sendcmd: [], asendcmd: [], convolution: [], afir: [],
};
const filterKeys: Readonly<Record<string, readonly string[]>> = {
  movie: ["filename"], amovie: ["filename"],
  lut1d: ["file"], lut3d: ["file"], drawtext: ["fontfile", "textfile", "font"],
  sendcmd: ["filename", "f"], asendcmd: ["filename", "f"],
};

interface FilterResource { value: Uint8Array; literal: boolean; kind?: 'resource-lookup'; access?: Dependency['access']; filterReader?: Dependency['filterReader'] }
interface FilterOutput {
  keys: readonly string[];
  positional: readonly string[];
  literal: boolean;
  stdout: boolean;
  generated: boolean;
}

/** Apply a selected AVOption value directly. Loaded buffers are not graph syntax. */
export function filterValueResource(filter: string, field: string, value: Uint8Array): FilterResource | undefined {
  const output = Object.hasOwn(filterOutputMetadata, filter) ? (filterOutputMetadata as Readonly<Record<string, FilterOutput>>)[filter] : undefined;
  const input = Object.hasOwn(filterInputMetadata, filter) ? (filterInputMetadata as Readonly<Record<string, { keys: Readonly<Record<string, boolean>>; lookups?: readonly string[] }>>)[filter] : undefined;
  if (field.startsWith('/')) return { value, literal: byteText(value) === '-', filterReader: { filter, name: field.slice(1) } };
  // Child DNN options select backend-specific readers: TensorFlow uses AVIO,
  // other libraries own filename reads and can load companion model files.
  // Keep this obligation unresolved rather than guessing a transfer namespace.
  if (input?.lookups?.includes(field)) return { value, literal: false, kind: 'resource-lookup' };
  if (output?.keys.includes(field)) {
    if (output.generated && value.length === 0) return;
    return { value, access: 'write', literal: output.literal && (!output.stdout || byteText(value) !== '-'),
      ...(output.generated ? { kind: 'resource-lookup' as const } : {}) };
  }
  if (input && Object.hasOwn(input.keys, field)) return { value, literal: input.keys[field] || byteText(value) === '-' };
  if (Object.hasOwn(filterKeys, filter) && filterKeys[filter].includes(field)) return { value, ...(filter === 'drawtext' && field === 'font' ? { kind: 'resource-lookup' as const } : {}), literal: field !== 'font' && (byteText(value) === '-' || field !== 'filename' || !['movie', 'amovie', 'subtitles'].includes(filter)) };
}

export function filterResources(value: Uint8Array): { resources: FilterResource[]; complete: boolean } {
  // Native filter graph and AVOption parsers read C strings, even when the
  // observed script/option-file buffer contains additional bytes after NUL.
  const end = value.indexOf(0);
  const graph = byteText(end < 0 ? value : value.subarray(0, end));
  const found: FilterResource[] = [];
  // fftools/ffmpeg_filter.c graph_opts_apply loads slash values for every
  // filter before graphparser.c segment_init initializes any resource reader.
  // Keep those evaluation phases separate, retaining order within each phase.
  const loaded: FilterResource[] = [];
  let i = 0;
  const labels = (): boolean => {
    while (graph[i] === "[") {
      // graphparser.c parse_link_name uses av_get_token, including its own
      // quoting layer. A protected ']' is label data, not the closing delimiter.
      const label = token(graph, i + 1, "]");
      if (!label.value || graph[label.end] !== "]") return false;
      i = label.end + 1;
      while (" \t\r\n".includes(graph[i] ?? '\0')) i++;
    }
    return true;
  };
  while (" \t\r\n".includes(graph[i] ?? '\0')) i++;
  // parse_sws_flags consumes the raw first semicolon before graph tokens.
  // Quotes and backslashes do not protect a delimiter in this prefix.
  if (graph.startsWith('sws_flags=', i)) {
    const separator = graph.indexOf(';', i);
    if (separator < 0) return { resources: [], complete: false };
    i = separator + 1;
    while (" \t\r\n".includes(graph[i] ?? '\0')) i++;
  }
  // graphparser.c rejects descriptions containing no filters. The C-string
  // boundary above can also make a nonempty observed buffer an empty graph.
  // Keep this advisory: discovery neither initializes filters nor raises the
  // native execution error before the reader reaches this stage.
  if (i === graph.length) return { resources: [], complete: false };
  while (i < graph.length) {
    if (!labels()) return { resources: [...loaded, ...found], complete: false };
    const name = token(graph, i, "=,;[");
    i = name.end;
    const filter = name.value.split("@")[0];
    // graphparser.c separates the instance suffix before filter lookup. An
    // empty name cannot create a filter, even when it has an instance name.
    // Keep preceding predictions; later initialization readers are unreachable.
    if (!filter) return { resources: [...loaded, ...found], complete: false };
    const output = Object.hasOwn(filterOutputMetadata, filter) ? (filterOutputMetadata as Readonly<Record<string, FilterOutput>>)[filter] : undefined;
    const input = Object.hasOwn(filterInputMetadata, filter) ? (filterInputMetadata as Readonly<Record<string, { keys: Readonly<Record<string, boolean>>; positional: readonly string[] }>>)[filter] : undefined;
    const assigned = new Set<string>();
    if (graph[i] === "=") {
      const args = token(graph, i + 1, "[],;");
      i = args.end;
      let j = 0;
      let position = 0;
      let shorthand = true;
      let complete = true;
      const assignments: { field: string; file: FilterResource | undefined }[] = [];
      const last = new Map<string, number>();
      const aliases = Object.hasOwn(filterResourceAliases, filter)
        ? (filterResourceAliases as Readonly<Record<string, Readonly<Record<string, string>>>>)[filter] : undefined;
      while (j < args.value.length) {
        const key = token(args.value, j, "=:");
        let field = shorthand ? (output?.positional ?? input?.positional ?? (Object.hasOwn(filterFiles, filter) ? filterFiles[filter] : undefined))?.[position++] : undefined;
        let val = key;
        if (args.value[key.end] === "=") {
          // ff_filter_opt_parse disables all later positional keys here.
          shorthand = false;
          field = key.value;
          val = token(args.value, key.end + 1, ":");
        } else if (!shorthand) { complete = false; break; }
        const file = field && filterValueResource(filter, field, textBytes(val.value));
        if (field) {
          const name = field.startsWith('/') ? field.slice(1) : field;
          const canonical = aliases && Object.hasOwn(aliases, name) ? aliases[name] : name;
          assigned.add(canonical);
          last.set(canonical, assignments.length);
          assignments.push({ field: canonical, file: file || undefined });
        }
        j = val.end + 1;
      }
      // MULTIKEY retains every setter in order, but initialization reads only
      // the final filename. Every slash setter still loads its own value file.
      for (let index = 0; index < assignments.length; index++) {
        const { field, file } = assignments[index];
        if (!file) continue;
        const replaced = last.get(field) !== index;
        if (file.filterReader) loaded.push(replaced
          ? { ...file, filterReader: { ...file.filterReader, discardValue: true } } : file);
        else if (!replaced) found.push(file);
      }
      if (!complete) return { resources: [...loaded, ...found], complete: false };
    }
    const defaults = Object.hasOwn(filterResourceDefaults, filter)
      ? (filterResourceDefaults as Readonly<Record<string, Readonly<Record<string, string>>>>)[filter] : undefined;
    for (const [field, value] of Object.entries(defaults ?? {})) {
      // Explicit empty and slash-loaded values replace the default too. The
      // selected resource remains a runtime prediction, never a preflight read.
      if (assigned.has(field)) continue;
      const file = filterValueResource(filter, field, textBytes(value));
      if (file) found.push(file);
    }
    // graphparser.c filter_parse consumes output labels, then chain_parse
    // requires a comma, semicolon or end. Input labels for another filter
    // cannot make a missing separator valid. Retain only the advisory prefix.
    if (!labels()) return { resources: [...loaded, ...found], complete: false };
    while (" \t\r\n".includes(graph[i] ?? '\0')) i++;
    if (i < graph.length && graph[i] !== ',' && graph[i] !== ';') return { resources: [...loaded, ...found], complete: false };
    if (i < graph.length) i++;
    while (" \t\r\n".includes(graph[i] ?? '\0')) i++;
  }
  return { resources: [...loaded, ...found], complete: true };
}
