import { byteText, textBytes } from "./bytes.js";
import { concatFiles } from './concat.js';
import { discover } from "./discover.js";
import { filterResources, resource } from "./resources.js";
import { presetAssignments } from './preset.js';
import type { Deferred, Dependency, Option, Tool } from "./types.js";

interface ObservedRead {
  /** Effective resource location after redirects, supplied by the actual read. */
  readonly location: Uint8Array;
  readonly content: Uint8Array;
}
export type ContentRead = ObservedRead & (
  { readonly kind: "filter-script" | "concat-list" | "preset" }
  | { readonly kind: "option-file"; readonly tool: Tool; readonly option: Option }
);
/** Optional hints from bytes already read by native. Never opens, caches or probes
 * a resource, resolves symlinks, validates directives, or replaces native parsing. */
export function discoverContent(read: ContentRead): { dependencies: Dependency[]; deferred: true } {
  const dependencies: Dependency[] = [];
  if (read.kind === "option-file") {
    // write_option still reads a slash value discarded by a filename callback
    // or a later matching simple filter. Its contents select no runtime reader.
    if (read.option.discardValue) return { dependencies, deferred: true };
    // cmdutils.c write_option/read_file_to_string passes the entire loaded
    // buffer to a C-string reader. Whitespace is data; the first NUL ends it.
    // The option file's directory does not change cwd for the selected reader.
    const end = read.content.indexOf(0);
    const value = read.content.slice(0, end < 0 ? read.content.length : end);
    const key = read.option.name + (read.option.specifier === undefined ? '' : ':' + byteText(read.option.specifier));
    const plan = discover(read.tool, [textBytes('-' + key), value, textBytes('__observed_option_group__')]);
    // Operand groups (ffprobe -i/-o) are indexed at the value, while ordinary
    // option dependencies are indexed at the key. Exclude the synthetic group.
    for (const dependency of plan.dependencies) if (dependency.index < 2) {
      dependencies.push({ ...dependency, index: read.option.index, stage: 'runtime' });
    }
  } else if (read.kind === "filter-script") {
    for (const file of filterResources(read.content).resources) dependencies.push({ ...resource(-1, file.value, "filter-resource", file.access ?? "read", "runtime", file.literal), literal: file.literal, ...(file.filterReader ? { filterReader: file.filterReader } : {}), ...(file.kind ? { kind: file.kind } : {}) });
  } else if (read.kind === 'preset') {
    try {
      for (const { key, value, index } of presetAssignments(read.content)) {
        dependencies.push(...presetDependencies(key, value, index).dependencies);
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  } else {
    try {
      for (const { index, value } of concatFiles(read.content)) {
        dependencies.push({ ...resource(index, value, "input", "read", "runtime"), base: { resource: new Uint8Array(read.location) } });
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return { dependencies, deferred: true };
}

/** Preset parse_option uses the same name/specifier and slash-loading lookup as
 * command options. A synthetic file group only flushes advisory per-file hints;
 * it is never executed or exposed as a dependency. */
export function presetDependencies(key: string, value: Uint8Array, index: number): { dependencies: Dependency[]; deferred: Deferred[] } {
  const plan = discover('ffmpeg', [textBytes('-' + key), value, textBytes('__preset_group__')], 'preset');
  const dependencies = plan.dependencies
    .filter(dependency => dependency.index === 0)
    .map(dependency => ({ ...dependency, index, stage: 'runtime' as const }));
  return { dependencies, deferred: plan.deferred.map(item => ({ ...item, index })) };
}
