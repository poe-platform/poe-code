import { SsconvertError, type CapabilityContext, type RangeSource } from "../contracts.js";
import type { Codec, Direction, FormatProvider, ServiceDescriptor, SourceService } from "./types.js";
import { bufferRangeInput, ownedRangeSource } from "../range-input.js";
import { compareServiceIds } from "./ordering.js";

function descriptor(service: Codec): ServiceDescriptor {
  return Object.freeze({
    id: service.id, description: service.description,
    extensions: Object.freeze([...service.extensions]),
    filenameSuffixes: Object.freeze([...(service.filenameSuffixes ?? [])]),
    mimeTypes: Object.freeze([...(service.mimeTypes ?? [])]),
    formatLevel: service.formatLevel ?? "write_only",
    overwriteFiles: service.overwriteFiles ?? true,
    defaultSaverPriority: service.defaultSaverPriority ?? -1,
    probePriority: service.probePriority ?? 50,
    encodingDependent: service.encodingDependent ?? false,
    saveScope: service.saveScope ?? "workbook",
    sheetSelection: service.sheetSelection ?? false,
    honorsExportRange: service.honorsExportRange ?? false,
    ...(service.selectionSource === undefined ? {} : { selectionSource: service.selectionSource }),
    interactiveOnly: service.interactiveOnly ?? false,
    contentProbe: service.contentProbe ?? false,
    exporterOptionKeys: Object.freeze([...new Set([...(service.exporterOptionKeys ?? Object.keys(service.exportOptionRules ?? {})), "sheet", "active-sheet"])])
  });
}

/** libgsf 1.14.53 gsf_extension_pointer: final dot in the basename, preserving case. */
function extension(filename: string): string {
  const basename = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  return dot < 0 ? "" : basename.slice(dot + 1);
}

const scopes = { workbook: 0, sheet: 1, range: 2 } as const;

function supports(codec: Codec, direction: Direction): boolean {
  return direction === "read" ? codec.read !== undefined || codec.readSource !== undefined : codec.write !== undefined || codec.writeStream !== undefined;
}

export function createRegistry(codecs: readonly Codec[] = [], formats: readonly FormatProvider[] = []) {
  const definitions = formats.flatMap(provider =>
    provider.services.map(service => ({ ...service, id: `${provider.id}:${service.id}`, source: service.source ?? provider.source })));
  // Registration order is explicit host configuration, not filesystem enumeration.
  const entries: { codec: Codec; direction: Direction; order: number }[] = [];
  const ids = new Set<string>();
  const installed = definitions.filter((service) => supports(service, service.direction) &&
    !codecs.some(codec => codec.id === service.id && supports(codec, service.direction)));
  for (const [order, supplied] of [...installed, ...codecs].entries()) {
    for (const direction of ["read", "write"] as const) {
      if (!supports(supplied, direction)) continue;
      const key = `${direction}:${supplied.id}`;
      if (!supplied.id || ids.has(key)) throw new TypeError(`Duplicate or empty codec ID: ${supplied.id}`);
      ids.add(key);
      const source = definitions.find((service) => service.id === supplied.id && service.direction === direction);
      const metadata = descriptor(source ?? supplied);
      const rules = source?.exportOptionRules ?? supplied.exportOptionRules;
      const codec: Codec = Object.freeze({
        ...supplied, ...metadata,
        ...(rules === undefined ? {} : { exportOptionRules: Object.freeze(Object.fromEntries(
          Object.entries(rules).map(([key, rule]) => [key, Object.freeze({ ...rule,
            ...(rule.kind === "enum" ? { values: Object.freeze([...rule.values]) } : {}) })])
        )) }),
        ...(supplied.probeName || !source || (!source.extensions.length && !source.filenameSuffixes?.length) ? {} : {
          probeName: (filename: string) => metadata.extensions.includes(extension(filename).toLowerCase()) ||
            metadata.filenameSuffixes!.some((suffix) => filename.toLowerCase().endsWith(`.${suffix}`))
        })
      });
      entries.push({ codec, direction, order });
    }
  }
  const openers = entries.filter((entry) => entry.direction === "read")
    .sort((a, b) => (b.codec.probePriority ?? 50) - (a.codec.probePriority ?? 50) || a.order - b.order);
  const savers = entries.filter((entry) => entry.direction === "write").reverse();
  const defaults = savers.filter(({ codec }) => codec.defaultSaverPriority! >= 0)
    .sort((a, b) => b.codec.defaultSaverPriority! - a.codec.defaultSaverPriority!);

  function select(direction: Direction, id?: string, filename?: string): Codec | undefined {
    if (id !== undefined) return entries.find((entry) => entry.direction === direction && entry.codec.id === id)?.codec;
    if (direction === "read" || filename === undefined) return undefined;
    const suffix = extension(filename);
    const matches = ({ codec }: { codec: Codec }) => codec.extensions.includes(suffix);
    const preferred = defaults.find(matches);
    if (preferred) return preferred.codec;
    let best: Codec | undefined;
    for (const { codec } of savers.filter(matches)) {
      if (!best || scopes[codec.saveScope!] < scopes[best.saveScope!]) best = codec;
    }
    return best;
  }

  async function probeUsing(filename: string | undefined, supplied: CapabilityContext,
    hasContent: (codec: Codec) => boolean, content: (codec: Codec, context: CapabilityContext) => Promise<boolean>): Promise<Codec | undefined> {
    const context = { ...supplied, ...(filename === undefined ? {} : { inputFilename: filename }) };
    // Native probes may run again in the content pass; do not cache observations.
    for (const { codec } of openers) {
      context.signal.throwIfAborted();
      if (codec.interactiveOnly) continue;
      if (filename === undefined || !codec.probeName) continue;
      const nameMatch = await codec.probeName(filename, context);
      context.signal.throwIfAborted();
      if (!nameMatch) continue;
      if (codec.contentProbe && !hasContent(codec)) continue;
      if (!hasContent(codec)) return codec;
      const contentMatch = await content(codec, context);
      context.signal.throwIfAborted();
      if (contentMatch) return codec;
    }
    for (const { codec } of openers) {
      context.signal.throwIfAborted();
      if (codec.interactiveOnly || !hasContent(codec)) continue;
      const match = await content(codec, context);
      context.signal.throwIfAborted();
      if (match) return codec;
    }
    return undefined;
  }

  return {
    list(direction: Direction): readonly ServiceDescriptor[] {
      return Object.freeze(entries.filter((entry) => entry.direction === direction && !entry.codec.interactiveOnly)
        .map(({ codec }) => descriptor(codec))
        .sort(compareServiceIds));
    },
    coverage(): readonly (SourceService & { readonly installed: boolean })[] {
      return Object.freeze(definitions.map((service) => Object.freeze({
        ...descriptor(service), direction: service.direction, source: service.source, installed: ids.has(`${service.direction}:${service.id}`)
      })));
    },
    select,
    hasRangeReaders: openers.some(({ codec }) => codec.readSource !== undefined),
    async probe(bytes: Uint8Array, filename: string | undefined, context: CapabilityContext): Promise<Codec | undefined> {
      context.signal.throwIfAborted();
      if ((context.limits.inputBytes !== Infinity && !Number.isSafeInteger(context.limits.inputBytes)) || context.limits.inputBytes < 0 || bytes.byteLength > context.limits.inputBytes)
        throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
      const owned = new Uint8Array(bytes);
      return probeUsing(filename, context, codec => codec.probeContent !== undefined,
        async (codec, supplied) => codec.probeContent!(new Uint8Array(owned), supplied));
    },
    async probeSource(source: RangeSource, filename: string | undefined, context: CapabilityContext): Promise<Codec | undefined> {
      context.signal.throwIfAborted();
      source = ownedRangeSource(source, context.signal, () => context.signal.throwIfAborted(), context.own);
      if (source.size > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
      let buffered: Uint8Array | undefined;
      return probeUsing(filename, context, codec => codec.probeSource !== undefined || codec.probeContent !== undefined,
        async (codec, supplied) => {
          if (codec.probeSource) return codec.probeSource(source, supplied);
          buffered ??= await bufferRangeInput(source, supplied.signal);
          return codec.probeContent!(new Uint8Array(buffered), supplied);
        });
    }
  };
}
