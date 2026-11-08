import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource, Scope } from './contracts.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedSelectionRecords } from './retained-selection.js';
import { openRetainedPackageInventory } from './retained-package-inventory.js';
import { openRetainedSlideInventory } from './retained-slide-inventory.js';
import { openRetainedTextStyles, type RetainedTextStyleContext, type RetainedStyleInput } from './retained-text-styles.js';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import { openRetainedXmlDocument } from './retained-xml-document.js';
import { openRetainedCompatibility } from './retained-compatibility.js';
import { equationOpaqueElements } from './equations-compatibility.js';
import { RetainedValues, equal, folded, literal } from './retained-values.js';
import { dialects } from './validation-schema.js';
import { resourceContext } from './resource-limits.js';
import { streamJson as json, rawJson, boundedOutput, stageRetainedOutput, type StagedOutput } from './retained-output.js';

export interface RetainedInspectionSelection {
  readonly token?: string;
  readonly slide?: number;
  readonly shape?: string;
  readonly part?: string;
  readonly scope?: Scope;
  readonly all?: boolean;
}
export type StagedInspection = StagedOutput;
async function* strings(source: AsyncIterable<ByteSource>) { for await (const value of source) yield () => value; }

/** Complete immutable presentation admission shared by retained consumers.
 * The archive is borrowed; close the index to retire all owned state. */
export async function openRetainedPresentationIndex(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  settings: RetainedPackageContext
) {
  const context = resourceContext(settings), working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit inspection storage and a valid cache budget are required.', 'usage');
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  const stagedPages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Inspection output is closed.', 'index'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index'); };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Inspection storage operation failed.', 'index');
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled([retire(), pages.close(), stagedPages.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  const values = new RetainedValues(pages, check, signal), stagedValues = new RetainedValues(stagedPages, check, signal), resources: { close(): Promise<void> }[] = [pages];
  async function retire() { const outcomes = await Promise.allSettled(resources.splice(0).map(value => value.close())); for (const outcome of outcomes) if (outcome.status === 'rejected') await Promise.reject(outcome.reason); }
  try {
    const records = await openRetainedSelectionRecords(archive, fingerprint, { ...context, workingStorage: working }); resources.push(records);
    const slides = await openRetainedSlideInventory(archive, records, { ...context, workingStorage: working }); resources.push(slides);
    const graph = await openRetainedRelationshipGraph(archive, { ...context, workingStorage: working, xmlLimits: { maxBytes: context.relationshipLimits.maxBytes, maxNodes: Infinity, maxDepth: Infinity } }); resources.push(graph);
    for await (const name of archive.parts()) { const key = await values.store(folded(literal(name))), original = await values.store(literal(name)); await values.insert('present', key, original); }
    async function override(owner: string | null): Promise<string | undefined> {
      if (!owner) return undefined; let count = 0, target;
      for await (const edge of graph.outgoing(owner)) for (const dialect of dialects) if (await equal(edge.type(), literal(`${dialect.r}/themeOverride`))) {
        if (++count > 1) throw new OfficeError('invalid-opc', 'Ambiguous presentation inheritance relationship.', 'index');
        target = edge.targetPart ? await values.find('present', () => folded(edge.targetPart!())) : undefined;
      }
      if (!target) return undefined;
      // Present names originate in bounded ZIP headers; target scalars do not.
      const decoder = new TextDecoder(); let name = ''; for await (const bytes of values.read(target)) name += decoder.decode(bytes, { stream: true }); return name + decoder.decode();
    }
    async function source(part: string | null | undefined): Promise<RetainedStyleInput | undefined> {
      if (!part) return undefined;
      if (!await values.find('compatible', () => literal(part))) {
        const document = await openRetainedXmlDocument(archive.read(part), { ...context, workingStorage: working }); let view, failed = false;
        try { view = await openRetainedCompatibility(document, dialects.flatMap(d => [d.p, d.a, d.r]), { ...context, workingStorage: working }, [
          ...equationOpaqueElements, ...dialects.flatMap(d => [{ namespace: d.p, localName: 'ext' }, { namespace: d.a, localName: 'ext' }, { namespace: d.a, localName: 'graphicData' }])
        ]); } catch (error) { failed = true; throw error; }
        finally { const outcomes = await Promise.allSettled([view?.close(), document.close()]); if (!failed) for (const outcome of outcomes) if (outcome.status === 'rejected') await Promise.reject(outcome.reason); }
        const key = await values.store(literal(part)); await values.insert('compatible', key, key);
      }
      return { part, source: () => archive.read(part) };
    }
    async function* textStyles() {
      for await (const slide of slides.slides()) {
        const styleContext = { slide: (await source(slide.part))! } as RetainedTextStyleContext;
        for (const [key, name] of Object.entries({ layout: slide.layout, master: slide.master, theme: slide.theme })) {
          const value = await source(name); if (value) Object.assign(styleContext, { [key]: value });
        }
        for (const [key, owner] of Object.entries({ slideTheme: slide.part, layoutTheme: slide.layout, masterTheme: slide.master })) {
          const value = await source(await override(owner)); if (value) Object.assign(styleContext, { [key]: value });
        }
        const presentation = await source(records.main); if (presentation) Object.assign(styleContext, { presentation });
        const styles = await openRetainedTextStyles(styleContext, { ...context, workingStorage: working }); let failed = false;
        try { yield* styles.records(); } catch (error) { failed = true; throw error; }
        finally { try { await styles.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
      }
    }
    // Match eager style admission even for human output and before selection.
    const styleRows = await stagedValues.store(boundedOutput(json(textStyles()), signal));
    const metadata = await openRetainedPackageInventory(archive, { ...context, workingStorage: working }); resources.push(metadata);
    async function* parts(media: boolean) { for await (const part of media ? metadata.media() : metadata.parts()) yield { part: part.part, contentType: part.contentType, bytes: part.bytes, sha256: part.sha256 }; }
    async function* diagrams() { for await (const diagram of metadata.diagrams()) yield { part: diagram.part, kind: diagram.kind, owners: strings(diagram.owners()), dependencies: strings(diagram.dependencies()), missing: strings(diagram.missing()), semanticEditing: false }; }
    async function* relationships() { for await (const edge of metadata.relationships()) yield { id: edge.id, type: edge.type, target: edge.target, external: edge.external, owner: edge.owner, targetPart: edge.targetPart }; }
    const inventory = {
      slides: slides.slides(), diagrams: diagrams(), textStyles: { [rawJson]: (): ByteSource => stagedValues.read(styleRows) },
      masters: strings(metadata.targets('slideMaster')), handoutMasters: slides.handoutMasters(), layouts: strings(metadata.targets('slideLayout')), themes: strings(metadata.targets('theme')),
      parts: parts(false), media: parts(true), relationships: relationships(), unsupported: metadata.unsupported(),
      features: { structure: true, slideVisibility: true, effectiveFormatting: false, mediaMetadata: false, editing: false },
      counts: { slides: slides.counts.slides, masters: metadata.counts.masters, layouts: metadata.counts.layouts, themes: metadata.counts.themes, slideShapes: slides.counts.slideShapes, parts: metadata.counts.parts, media: metadata.counts.media }
    };
    check(); return Object.freeze({ records, graph, inventory, close });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}

/** Stages the complete result before exposing output. */
export async function stageRetainedInspection(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  selection: RetainedInspectionSelection,
  settings: RetainedPackageContext,
  output: { readonly json: boolean; readonly maxOutputBytes: number }
): Promise<StagedInspection> {
  const options = { ...selection }, format = { ...output };
  if (!(format.maxOutputBytes > 0 && (format.maxOutputBytes === Infinity || Number.isSafeInteger(format.maxOutputBytes)))) throw new OfficeError('invalid-value', 'Invalid output byte limit.', 'usage');
  const index = await openRetainedPresentationIndex(archive, fingerprint, settings);
  let staged: StagedOutput | undefined;
  try {
    const { records, inventory } = index;
    async function* selected() {
      if (options.token) { yield* records.select({ token: options.token }); return; }
      const scope = options.scope ?? 'slides', all = options.all ?? false;
      if (options.slide !== undefined) {
        for await (const slide of records.select({ kind: 'slide', position: { coordinateSystem: 'one-based', value: options.slide } })) {
          if (options.shape) yield* records.select({ kind: 'object', owner: slide.part, name: options.shape, scope, all }); else yield slide;
        }
      } else if (options.part) yield* records.select(options.shape ? { kind: 'object', owner: options.part, name: options.shape, scope, all } : { kind: 'part', part: options.part, scope, all });
      else if (scope === 'slides') yield* records.records('slide');
      else for await (const record of records.records('part')) if (record.location.scope === scope) yield record;
    }
    async function* locations() { for await (const record of selected()) yield record.location; }
    async function* render(): ByteSource {
      if (format.json) {
        yield* json({ version: 1, operation: 'inspect', ok: true, data: { fingerprint, records: selected(), inventory }, warnings: [], errors: [], affected: 0, locations: locations() }); yield* literal('\n');
      } else for await (const record of selected()) { yield* literal(`${record.kind} ${record.position} `); yield* json(record.name); yield* literal(` id=${JSON.stringify(record.id)} owner=${JSON.stringify(record.part)}\n`); }
    }
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes);
    await index.close(); return staged;
  } catch (error) { await Promise.allSettled([index.close(), staged?.close()]); throw error; }
}
