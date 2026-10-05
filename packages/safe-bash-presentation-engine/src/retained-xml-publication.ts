import { sha256 } from '@noble/hashes/sha2.js';
import type { ByteSource } from './contracts.js';
import { openPackageArchive } from './retained-package.js';
import { stageRetainedArchive, type RetainedMutationSource } from './retained-archive-staging.js';
import { openRetainedXmlReplacement } from './retained-xml-replacement.js';
import { selectRetainedXmlPart, type RetainedXmlPartContext } from './retained-xml-parts.js';
import type { RetainedInspectionSelection } from './retained-inspection.js';
import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';

/** Stage an admitted XML replacement and its response before publishing anything. Input sources are borrowed. */
export async function stageRetainedXmlReplacement(input: RetainedMutationSource, replacement: ByteSource,
  selection: RetainedInspectionSelection, settings: RetainedXmlPartContext,
  output: { readonly json: boolean; readonly dryRun: boolean; readonly destination?: string; readonly maxOutputBytes: number }) {
  const signal = settings.signal ?? new AbortController().signal, hash = sha256.create();
  for await (const bytes of input.stream()) { signal.throwIfAborted(); hash.update(bytes); }
  const before = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  const archive = await openPackageArchive(input, settings);
  let mutation: Awaited<ReturnType<typeof openRetainedXmlReplacement>> | undefined;
  let staged: Awaited<ReturnType<typeof stageRetainedArchive>> | undefined, response: StagedOutput | undefined, closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    const results = await Promise.allSettled([response?.close(), staged?.close(), mutation?.close(), archive.close()]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  })();
  try {
    const { part, location } = await selectRetainedXmlPart(archive, before, selection, settings, false);
    mutation = await openRetainedXmlReplacement(archive, part, replacement, settings);
    staged = await stageRetainedArchive(input, before, archive, mutation, settings);
    const { bytes, size, fingerprint } = staged, { dryRun } = output;
    async function* content(): ByteSource {
      if (output.destination === '-' && !dryRun) { yield* bytes(); return; }
      if (output.json) {
        yield* streamJson({ version: 1, operation: 'xml.set', ok: true, data: { part, dryRun }, warnings: [], errors: [], affected: 1, locations: [location] });
        yield new TextEncoder().encode('\n');
      } else yield new TextEncoder().encode(`${dryRun ? 'Validated' : 'Replaced'} XML part ${part}\n`);
    }
    response = await stageRetainedOutput(content(), settings, output.maxOutputBytes);
    return Object.freeze({ bytes, size, fingerprint, output: response, close });
  } catch (error) { await close().catch(() => {}); throw error; }
}
