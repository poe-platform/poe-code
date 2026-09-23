import type { PlaywrightElementHandle, PlaywrightPage, PlaywrightSnapshotJSONCapture, PlaywrightSnapshotJSONNode, SnapshotNode } from './adapter.js';
import { PlaywrightSnapshotLimitError } from './resource-limit.js';
import { isPlaywrightSnapshotRef } from './targets.js';

/** Serialize the native accessibility tree, keeping controller-issued refs. */
export async function captureNativePlaywrightJSON(page: PlaywrightPage, options: {
  maxBytes: number; maxRefs: number; nextRef(native?: string): string; signal?: AbortSignal;
  prepareNextRef?: () => Promise<(native?: string) => string>;
  depth?: number; boxes?: boolean; root?: PlaywrightElementHandle; timeout?: number; captureJSON?: PlaywrightSnapshotJSONCapture;
}): Promise<{ tree: readonly PlaywrightSnapshotJSONNode[]; refs: Map<string, string> }> {
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  if (!page.ariaSnapshotJSON && !options.captureJSON) throw new Error('Native JSON accessibility snapshots unsupported by this browser');
  const tree = page.ariaSnapshotJSON
    ? await page.ariaSnapshotJSON({ mode: 'ai', timeout: options.timeout ?? 5000, ...(options.boxes === undefined ? {} : { boxes: options.boxes }) })
    : await options.captureJSON!(page, { signal, timeoutMs: options.timeout ?? 5000, maxBytes: options.maxBytes, ...(options.boxes === undefined ? {} : { boxes: options.boxes }) });
  signal.throwIfAborted();
  const encoded = JSON.stringify(tree);
  if (typeof encoded !== 'string') throw new Error('Invalid native JSON snapshot');
  if (new TextEncoder().encode(encoded).byteLength > options.maxBytes) throw new PlaywrightSnapshotLimitError('Snapshot byte limit exceeded');
  if (!Array.isArray(tree) || tree.some(node => typeof node === 'string')) throw new Error('Invalid native JSON snapshot');
  const fields = new Set(['role', 'name', 'text', 'children', 'checked', 'disabled', 'expanded', 'active', 'invalid', 'level', 'pressed', 'selected', 'ariaHidden', 'url', 'placeholder', 'ref', 'cursor', 'box']);
  const nativeRefs = new Set<string>();
  const pending = [...tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (typeof node === 'string') continue;
    if (!node || typeof node !== 'object' || typeof node.role !== 'string' || Object.keys(node).some(key => !fields.has(key))) throw new Error('Invalid native JSON snapshot node');
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error('Invalid native JSON snapshot children');
      for (let offset = 0; offset < node.children.length; offset += 1024) pending.push(...node.children.slice(offset, offset + 1024));
    }
    if (node.ref !== undefined) {
      if (!isPlaywrightSnapshotRef(node.ref)) throw new Error('Invalid native snapshot reference');
      nativeRefs.add(node.ref);
      if (nativeRefs.size > options.maxRefs) throw new PlaywrightSnapshotLimitError('Snapshot ref limit exceeded');
    }
  }
  const select = async (nodes: readonly (PlaywrightSnapshotJSONNode | string)[], inherited: boolean): Promise<(PlaywrightSnapshotJSONNode | string)[]> => {
    const output: (PlaywrightSnapshotJSONNode | string)[] = [];
    for (const node of nodes) {
      signal.throwIfAborted();
      if (typeof node === 'string') { if (inherited) output.push(node); continue; }
      let included = inherited;
      if (node.ref) {
        const handle = await page.locator(`aria-ref=${node.ref}`).elementHandle?.({ timeout: options.timeout ?? 5000 });
        if (!handle) throw new Error('Snapshot stale while selecting root');
        try { included = await handle.evaluate((element, root) => (root as unknown as { contains(node: SnapshotNode): boolean }).contains(element), options.root!); }
        catch (error) { if (!(error instanceof Error) || !error.message.includes('context they were created')) throw error; }
        finally { await handle.dispose(); }
      }
      const children = node.children ? await select(node.children, included) : undefined;
      if (included) output.push({ ...node, ...(children === undefined ? {} : { children }) });
      else if (children) for (let offset = 0; offset < children.length; offset += 1024) output.push(...children.slice(offset, offset + 1024));
    }
    return output;
  };
  const selected = options.root ? await select(tree, false) : tree;
  const refs = new Map<string, string>();
  const nextRef = await options.prepareNextRef?.() ?? options.nextRef;
  const issued = new Map<string, string>();
  const rewrite = (nodes: readonly (PlaywrightSnapshotJSONNode | string)[], depth: number): (PlaywrightSnapshotJSONNode | string)[] => {
    if (depth > 1024) throw new PlaywrightSnapshotLimitError('Snapshot depth limit exceeded');
    return nodes.map(node => {
      if (typeof node === 'string') return node;
      const { children, ref, ...fields } = node;
      let scoped = ref === undefined ? undefined : issued.get(ref);
      if (ref !== undefined && scoped === undefined) { scoped = nextRef(ref); issued.set(ref, scoped); refs.set(scoped, ref); }
      return { ...fields, ...(scoped === undefined ? {} : { ref: scoped }),
        ...(children?.length && (!options.depth || depth < options.depth) ? { children: rewrite(children, depth + 1) } : {}),
      };
    });
  };
  const result = rewrite(selected, 0).filter((node): node is PlaywrightSnapshotJSONNode => typeof node !== 'string');
  signal.throwIfAborted();
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > options.maxBytes) throw new PlaywrightSnapshotLimitError('Snapshot byte limit exceeded');
  return { tree: result, refs };
}
