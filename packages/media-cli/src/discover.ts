// Source-informed control flow: FFmpeg 9.0.1 fftools/cmdutils.c. See NOTICE.
import { byteText } from "./bytes.js";
import { avCodecChildOptionNames, avCodecOptionNames, avOptionNames, grammarRevision, optionMetadata, pathOptionMetadata } from "./options.generated.js";
import { filterResources, resource } from "./resources.js";
import { teeResources } from './tee.js';
import type { Deferred, Dependency, Discovery, Group, Option, ResourceRole, Tool } from "./types.js";

interface Definition {
  arity: number;
  boolean: boolean;
  exit: boolean;
  perFile: boolean;
  perStream?: boolean;
  scopes: readonly string[];
}
const privateOptions = new Set(avOptionNames);
const codecOptions = new Set(avCodecOptionNames);
const codecChildOptions = new Set(avCodecChildOptionNames);
const pathOptions: Readonly<Record<string, { role: ResourceRole; access: Dependency['access']; syntax: 'literal' | 'avio' | 'stdio' | 'generated' }>> = pathOptionMetadata;
export const filterOptions: readonly string[] = Object.freeze(["vf", "af", "filter", "filter_complex", "lavfi"]);
const presets = new Set(["pre", "apre", "vpre", "spre"]);

/** Predictions never perform I/O, validate native syntax, or authorize access. */
export function discover(tool: Tool, args: readonly Uint8Array[], entrypoint: 'command' | 'preset' = 'command'): Discovery {
  // Presets call parse_option with FFmpeg definitions, not split_commandline.
  const sequential = tool === 'ffprobe' || entrypoint === 'preset';
  // Interpret the indexed native arguments, never caller-supplied array methods
  // that can replace URL or request option bytes with a snapshot operand.
  const argv = Array.from({ length: args.length }, (_, index) => new Uint8Array(args[index]));
  const globals: Option[] = [];
  const groups: Group[] = [];
  const dependencies: Dependency[] = [];
  const deferred: Deferred[] = [{ index: -1, reason: "native-access" }];
  const definitions: Readonly<Record<string, Definition>> = optionMetadata[tool];
  let pending: Option[] = [];
  let protectedIndex = -1;
  let handleOptions = true;
  // ffprobe.c retains the first filename, even an empty one. Its -i wrapper
  // discards duplicate callback errors; positional inputs and -o propagate them.
  let probeInput = false;
  let probeOutput = false;

  function dependenciesFor(option: Option, stage: Dependency["stage"]): void {
    const { value, index, name } = option;
    // Indirection changes where the value comes from, not the selected
    // option's need for stream metadata. Never probe to resolve that hint.
    // opt_default stores codec AVOptions in a dictionary; filter_codec_opts
    // matches that dictionary against actual streams even without a suffix.
    const codecDictionary = !Object.hasOwn(definitions, name) &&
      (codecChildOptions.has(name) || !option.specifier && 'vas'.includes(name[0]) && codecOptions.has(name.slice(1)));
    if (Object.hasOwn(definitions, name) && definitions[name].perStream || codecDictionary ||
      name === "map" || name === "map_metadata" || name === "map_chapters" || option.specifier ||
      name === 'dump_attachment' && value !== undefined && (option.fromFile || value.length === 0)) {
      deferred.push({ index, reason: "stream-metadata" });
    }
    // Operand-free per-stream booleans still select streams at runtime.
    if (value === undefined) return;
    if (option.fromFile) {
      dependencies.push({ ...resource(index, value, "option-file", "read", stage), optionReader: { tool, name, specifier: option.specifier,
        ...(option.discardValue ? { discardValue: true as const } : {}) } });
      deferred.push({ index, reason: "option-file-content" });
      return;
    }
    if (option.discardValue) return;
    if (presets.has(name)) deferred.push({ index, reason: "preset-search" });
    if (filterOptions.includes(name) || (tool === "ffmpeg" && name === "f" && byteText(value) === "lavfi")) {
      if (filterOptions.includes(name)) {
        const parsed = filterResources(value);
        for (const file of parsed.resources) {
          dependencies.push({ ...resource(index, file.value, "filter-resource", file.access ?? "read", "runtime", file.literal), literal: file.literal, ...(file.filterReader ? { filterReader: file.filterReader } : {}), ...(file.kind ? { kind: file.kind } : {}) });
        }
        if (!parsed.complete) deferred.push({ index, reason: 'filter-syntax' });
      }
      deferred.push({ index, reason: "filter-runtime" });
    }
    const role = Object.hasOwn(pathOptions, name) ? pathOptions[name] : undefined;
    if (role) {
      // opt_preset chooses an explicit path from the handler's first byte,
      // not the matched OptionDef. Sequential "nofpre" therefore searches.
      const presetLookup = role.role === 'preset' && sequential && byteText(argv[index])[1] !== 'f';
      if (presetLookup) deferred.push({ index, reason: 'preset-search' });
      // Empty attachment names come from stream metadata, not the empty path.
      if (name !== "dump_attachment" || value.length > 0) {
        const dependency = { ...resource(index, value, role.role, role.access, stage, !presetLookup && (role.syntax === 'literal' || role.syntax === 'generated'), role.syntax === 'stdio' ? 'stdio' : 'avio'),
          optionReader: { tool, name, specifier: option.specifier } };
        dependencies.push(role.syntax === 'generated' || presetLookup ? { ...dependency, kind: 'resource-lookup' } : dependency);
      }
      if (name === "dump_attachment" || name === "passlogfile") deferred.push({ index, reason: "generated-name" });
      if (role.role === "filter-script" || role.role === "preset") deferred.push({ index, reason: "option-file-content" });
    }
  }
  function group(kind: Group["kind"], index: number, target?: Uint8Array): void {
    if (tool === 'ffmpeg' && kind === 'output') {
      // ffmpeg_opt.c's vf/af handlers always append filter:v/filter:a.
      // opt_match_per_stream selects the last matching value. Equal selector
      // bytes are sufficient here; other overlaps require native metadata.
      const selector = (option: Option) => option.name === 'vf' ? 'v'
        : option.name === 'af' ? 'a'
        : option.name === 'filter' ? byteText(option.specifier ?? new Uint8Array()) : undefined;
      const last = new Map<string, number>();
      for (const option of pending) {
        const key = selector(option);
        if (key !== undefined) last.set(key, option.index);
      }
      pending = pending.map(option => {
        const key = selector(option);
        return key !== undefined && last.get(key) !== option.index ? { ...option, discardValue: true as const } : option;
      });
    }
    groups.push({ kind, index, target, options: pending });
    const stage = kind === "input" ? "input" : "output";
    for (const option of pending) dependenciesFor(option, stage);
    if (target !== undefined && (kind === "input" || kind === "output")) {
      const format = [...pending].reverse().find(option => option.name === "f");
      if (kind === "input" && format?.value && !format.fromFile && byteText(format.value) === "lavfi") {
        const parsed = filterResources(target);
        for (const file of parsed.resources) dependencies.push({ ...resource(index, file.value, "filter-resource", file.access ?? "read", "runtime", file.literal), literal: file.literal, ...(file.filterReader ? { filterReader: file.filterReader } : {}), ...(file.kind ? { kind: file.kind } : {}) });
        if (!parsed.complete) deferred.push({ index, reason: 'filter-syntax' });
        deferred.push({ index, reason: "filter-runtime" });
      } else if (kind === 'output' && format?.value && !format.fromFile && byteText(format.value) === 'tee') {
        for (const slave of teeResources(target)) {
          for (const [name, value] of slave.options) {
            const role = Object.hasOwn(pathOptions, name) ? pathOptions[name] : undefined;
            if (role) dependencies.push({ ...resource(index, value, role.role, role.access, 'runtime', role.syntax === 'literal', role.syntax === 'stdio' ? 'stdio' : 'avio'),
              optionReader: { tool, name } });
          }
          // tee.c opens slave filenames through ff_format_output_open/AVIO;
          // it does not apply fftools' top-level '-' to pipe:1 rewriting.
          dependencies.push(resource(index, slave.target, 'output', 'write', 'runtime', false, 'avio'));
        }
        deferred.push({ index, reason: 'stream-metadata' }, { index, reason: 'generated-name' });
      } else dependencies.push(resource(index, target, kind, kind === "input" ? "read" : "write", stage));
    }
    pending = [];
  }

  for (let i = 0; i < argv.length; i++) {
    const raw = byteText(argv[i]);
    if (handleOptions && raw === "--") {
      if (tool === "ffmpeg") protectedIndex = i + 1;
      else handleOptions = false;
      continue;
    }
    if (!handleOptions || i === protectedIndex || raw === "-" || !raw.startsWith("-")) {
      if (tool === 'ffprobe') {
        if (probeInput) { deferred.push({ index: i, reason: 'native-access' }); break; }
        probeInput = true;
      }
      group(tool === "ffmpeg" ? "output" : "input", i, argv[i]);
      continue;
    }
    const index = i;
    let key = raw.slice(1);
    const fromFile = key.startsWith("/");
    if (fromFile) key = key.slice(1);
    const colon = key.indexOf(":");
    let name = colon < 0 ? key : key.slice(0, colon);
    const specifier = colon < 0 ? undefined : argv[i].slice(raw.indexOf(":") + 1);
    if (!sequential && !fromFile && (key === "i" || key === "dec")) {
      if (argv[i + 1] === undefined) { deferred.push({ index, reason: "missing-value" }); break; }
      group(key === "i" ? "input" : "decoder", ++i, argv[i]);
      continue;
    }
    let definition = Object.hasOwn(definitions, name) ? definitions[name] : undefined;
    let unknownIndirect = false;
    // parse_option retains a found no-prefixed non-boolean definition too,
    // including in presets; split_commandline only accepts boolean negation.
    if (!definition && !fromFile && name.startsWith("no")) {
      // Both parsers call find_option again after 'no'. That
      // lookup strips one slash, but write_option still receives the original
      // no-prefixed spelling, so this is not argument-file indirection.
      const negated = name[2] === '/' ? name.slice(3) : name.slice(2);
      if (Object.hasOwn(definitions, negated) && (sequential || definitions[negated].boolean)) {
        name = negated;
        definition = definitions[name];
      }
    }
    if (!definition) {
      // An inventory hit is only an arity hint, never build availability or validity.
      const legacyCodec = !fromFile && colon < 0 && "vas".includes(name[0]) && codecOptions.has(name.slice(1));
      const avOption = codecChildOptions.has(name) || privateOptions.has(key) || legacyCodec;
      // Sequential parse_option loads slash passthrough values before looking
      // up an AVOption. The split parser passes the slash verbatim to opt_default.
      if (sequential && fromFile || !fromFile && avOption) {
        unknownIndirect = sequential && fromFile && !avOption;
        definition = { arity: 1, boolean: false, exit: false, perFile: true, scopes: [] };
      }
      else { deferred.push({ index, reason: "unknown-option" }); break; }
    }
    if (sequential && fromFile && definition.arity === 0) {
      // write_option fails before any following positional operands are read.
      // This is an advisory stop; the one native invocation owns the error.
      deferred.push({ index, reason: 'native-access' });
      break;
    }
    const consumes = definition.arity > 0 || (!sequential && definition.exit);
    const value = consumes ? argv[++i] : undefined;
    if (consumes && value === undefined && !definition.exit) { deferred.push({ index, reason: "missing-value" }); break; }
    const option: Option = { index, name, specifier, value, fromFile, scopes: definition.scopes,
      ...(tool === 'ffprobe' && fromFile && (name === 'i' && probeInput || name === 'o' && probeOutput)
        ? { discardValue: true as const } : {}) };
    if (tool === "ffprobe" && (name === "i" || name === "o") && value !== undefined) {
      // write_option reads slash values before invoking the filename callback,
      // including duplicate names. A successful read retains the first input
      // regardless of its contents; prediction never opens that value file.
      if (fromFile) { globals.push(option); dependenciesFor(option, 'global'); }
      if (name === 'i') {
        if (probeInput) { deferred.push({ index, reason: 'native-access' }); continue; }
        probeInput = true;
      } else {
        if (probeOutput) { deferred.push({ index, reason: 'native-access' }); break; }
        probeOutput = true;
      }
      if (!fromFile) group(name === "i" ? "input" : "output", i, value);
    } else if (tool === "ffprobe" || !definition.perFile) {
      globals.push(option);
      dependenciesFor(option, "global");
    } else pending.push(option);
    if (unknownIndirect) {
      // write_option reads the slash file before opt_default applies its value.
      // Keep that read, but do not predict past an unknown application boundary.
      // A native-valid inventory miss still reaches complete late access.
      if (pending.length) {
        for (const item of pending) dependenciesFor(item, 'runtime');
        groups.push({ kind: 'trailing', index: argv.length, options: pending });
        pending = [];
      }
      deferred.push({ index, reason: 'unknown-option' });
      break;
    }
    if (sequential && definition.exit) break;
  }
  if (pending.length) groups.push({ kind: "trailing", index: argv.length, options: pending });
  const probeFormat = tool === "ffprobe" ? [...globals].reverse().find(option => option.name === "f") : undefined;
  if (probeFormat?.value && !probeFormat.fromFile && byteText(probeFormat.value) === "lavfi") {
    for (let i = dependencies.length - 1; i >= 0; i--) {
      const dependency = dependencies[i];
      if (dependency.role !== "input") continue;
      dependencies.splice(i, 1);
      const parsed = filterResources(dependency.value);
      for (const file of parsed.resources) dependencies.push({ ...resource(dependency.index, file.value, "filter-resource", file.access ?? "read", "runtime", file.literal), literal: file.literal, ...(file.filterReader ? { filterReader: file.filterReader } : {}), ...(file.kind ? { kind: file.kind } : {}) });
      if (!parsed.complete) deferred.push({ index: dependency.index, reason: 'filter-syntax' });
      deferred.push({ index: dependency.index, reason: "filter-runtime" });
    }
  }
  // Discovery ordering is argv ordering, not an assertion about native open order.
  dependencies.sort((a, b) => a.index - b.index);
  return { tool, grammarRevision, argv, globals, groups, dependencies, deferred };
}
