import type { PlaywrightPage, PlaywrightElementHandle, SnapshotNode } from './adapter.js';
import { isPlaywrightSnapshotRef } from './targets.js';

/** Use the pinned provider's own accessibility tree; externally issued refs stay
 * scoped to the controller even when native engines reuse short e1-style IDs. */
export async function captureNativePlaywrightSnapshot(page: PlaywrightPage, options: {
  maxBytes: number; maxRefs: number; nextRef(): string; signal?: AbortSignal;
  depth?: number; boxes?: boolean; root?: PlaywrightElementHandle; timeout?: number;
}): Promise<{ text: string; refs: Map<string, string> }> {
  options.signal?.throwIfAborted();
  let source: unknown;
  if (page.ariaSnapshot) source = await page.ariaSnapshot({ mode: 'ai', timeout: options.timeout ?? 5000, ...(options.depth === undefined || options.root ? {} : { depth: options.depth }), ...(options.boxes === undefined ? {} : { boxes: options.boxes }) });
  else {
    const result: unknown = await page._snapshotForAI!({ timeout: options.timeout ?? 5000 });
    if (!result || typeof result !== 'object' || !('full' in result) || typeof result.full !== 'string') throw new Error('Incompatible native snapshot protocol result');
    source = result.full;
  }
  options.signal?.throwIfAborted();
  if (typeof source !== 'string') throw new Error('Invalid native snapshot result');
  let snapshot = source;
  const encoder = new TextEncoder();
  if (source.length > options.maxBytes || encoder.encode(source).length > options.maxBytes) throw new PlaywrightResourceLimitError('Snapshot byte limit exceeded');
  if (options.root) {
    const included: { line: string; indent: number }[] = [];
    const ancestors: { indent: number; included: boolean }[] = [];
    let measured = 0;
    for (const line of snapshot.split('\n')) {
      const indent = line.length - line.trimStart().length;
      while (ancestors.length && ancestors.at(-1)!.indent >= indent) ancestors.pop();
      let selected = ancestors.at(-1)?.included ?? false;
      let quote = false, escape = false, native: string | undefined;
      for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (quote) { if (escape) escape = false; else if (char === '\\') escape = true; else if (char === '"') quote = false; }
        else if (char === '"') quote = true;
        else if (char === ':') break;
        else if (line.startsWith('[ref=', index)) { native = line.slice(index + 5, line.indexOf(']', index)); break; }
      }
      if (native) {
        if (++measured > options.maxRefs) throw new PlaywrightResourceLimitError('Snapshot ref limit exceeded');
        if (!isPlaywrightSnapshotRef(native)) throw new Error('Invalid native snapshot reference');
        const handle = await page.locator(`aria-ref=${native}`).elementHandle?.({ timeout: options.timeout ?? 5000 });
        if (!handle) throw new Error('Snapshot stale while selecting root');
        try {
          selected = await handle.evaluate((node, root) => (root as unknown as { contains(node: SnapshotNode): boolean }).contains(node), options.root);
        } catch (error) {
          // An iframe subtree inherits membership from its enclosing iframe node.
          if (!(error instanceof Error) || !error.message.includes('context they were created')) throw error;
        } finally { await handle.dispose(); }
        options.signal?.throwIfAborted();
      }
      ancestors.push({ indent, included: selected });
      if (selected) included.push({ line, indent });
    }
    const baseIndent = included.reduce((min, entry) => Math.min(min, entry.indent), Infinity);
    snapshot = included.map(entry => entry.line.slice(baseIndent)).join('\n');
  }
  if ((!page.ariaSnapshot || options.root) && options.depth) {
    snapshot = snapshot.split('\n').flatMap(line => {
      const indent = line.length - line.trimStart().length;
      if (indent > options.depth! * 2) return [];
      return [indent === options.depth! * 2 && line.endsWith(':') ? line.slice(0, -1) : line];
    }).join('\n');
  }
  const refs = new Map<string, string>();
  const nativeRefs = new Map<string, string>();
  let text = '', start = 0, quoted = false, escaped = false, inValue = false;
  for (let index = 0; index < snapshot.length; index++) {
    const character = snapshot[index];
    if (character === '\n') { quoted = false; escaped = false; inValue = false; continue; }
    if (inValue) continue;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ':') { inValue = true; continue; }
    if (!snapshot.startsWith('[ref=', index)) continue;
    const end = snapshot.indexOf(']', index + 5);
    if (end < 0) throw new Error('Invalid native snapshot reference');
    const native = snapshot.slice(index + 5, end);
    if (!isPlaywrightSnapshotRef(native)) throw new Error('Invalid native snapshot reference');
    let issued = nativeRefs.get(native);
    if (!issued) {
      if (refs.size >= options.maxRefs) throw new PlaywrightResourceLimitError('Snapshot ref limit exceeded');
      issued = options.nextRef();
      nativeRefs.set(native, issued); refs.set(issued, native);
    }
    text += snapshot.slice(start, index + 5) + issued;
    start = end;
    if (options.boxes && !page.ariaSnapshot) {
      options.signal?.throwIfAborted();
      const handle = await page.locator(`aria-ref=${native}`).elementHandle?.({ timeout: options.timeout ?? 5000 });
      if (!handle) throw new Error('Snapshot stale while reading bounding boxes');
      try {
        if (!handle.boundingBox) throw new Error('Element bounding boxes unsupported');
        const box = await handle.boundingBox();
        options.signal?.throwIfAborted();
        if (box) {
          const values = [box.x, box.y, box.width, box.height];
          if (values.some(value => !Number.isFinite(value))) throw new Error('Invalid element bounding box');
          text += `] [box=${values.map(Math.round).join(',')}`;
        }
      } finally { await handle.dispose(); }
    }
    index = end;
  }
  text += snapshot.slice(start);
  if (text.length > options.maxBytes || encoder.encode(text).length > options.maxBytes) throw new PlaywrightResourceLimitError('Snapshot byte limit exceeded');
  return { text, refs };
}
import { PlaywrightResourceLimitError } from './resource-limit.js';
