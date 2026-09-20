import type { PlaywrightElementHandle, PlaywrightPage, PlaywrightSnapshotJSONCapture, PlaywrightSnapshotJSONNode, SnapshotNode } from './adapter.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';
import { isPlaywrightSnapshotRef } from './targets.js';

/** Serialize the native accessibility tree, keeping controller-issued refs. */
export async function captureNativePlaywrightJSON(page: PlaywrightPage, options: {
  maxBytes: number; maxRefs: number; nextRef(): string; signal?: AbortSignal;
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
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > options.maxBytes) throw new PlaywrightResourceLimitError('Snapshot byte limit exceeded');
  if (!Array.isArray(tree)) throw new Error('Invalid native JSON snapshot');
  const fields = new Set(['role', 'name', 'text', 'children', 'checked', 'disabled', 'expanded', 'active', 'invalid', 'level', 'pressed', 'selected', 'ariaHidden', 'url', 'placeholder', 'ref', 'cursor', 'box']);
  const nativeRefs = new Set<string>();
  const pending = [...tree];
  let count = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++count > Math.max(options.maxRefs * 4, 4096)) throw new PlaywrightResourceLimitError('Snapshot node limit exceeded');
    if (!node || typeof node !== 'object' || typeof node.role !== 'string' || Object.keys(node).some(key => !fields.has(key))) throw new Error('Invalid native JSON snapshot node');
    if (node.children !== undefined) { if (!Array.isArray(node.children)) throw new Error('Invalid native JSON snapshot children'); pending.push(...node.children); }
    if (node.ref !== undefined) {
      if (!isPlaywrightSnapshotRef(node.ref)) throw new Error('Invalid native snapshot reference');
      nativeRefs.add(node.ref);
      if (nativeRefs.size > options.maxRefs) throw new PlaywrightResourceLimitError('Snapshot ref limit exceeded');
    }
  }
  const select = async (nodes: readonly PlaywrightSnapshotJSONNode[], inherited: boolean): Promise<PlaywrightSnapshotJSONNode[]> => {
    const output: PlaywrightSnapshotJSONNode[] = [];
    for (const node of nodes) {
      signal.throwIfAborted();
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
      else if (children) output.push(...children);
    }
    return output;
  };
  const selected = options.root ? await select(tree, false) : tree;
  const refs = new Map<string, string>();
  const issued = new Map<string, string>();
  const rewrite = (nodes: readonly PlaywrightSnapshotJSONNode[], depth: number): PlaywrightSnapshotJSONNode[] => {
    if (depth > 1024) throw new PlaywrightResourceLimitError('Snapshot depth limit exceeded');
    return nodes.map(node => {
      const { children, ref, ...fields } = node;
      let scoped = ref === undefined ? undefined : issued.get(ref);
      if (ref !== undefined && scoped === undefined) { scoped = options.nextRef(); issued.set(ref, scoped); refs.set(scoped, ref); }
      return { ...fields, ...(scoped === undefined ? {} : { ref: scoped }),
        ...(children?.length && (!options.depth || depth < options.depth) ? { children: rewrite(children, depth + 1) } : {}),
      };
    });
  };
  const result = rewrite(selected, 0);
  signal.throwIfAborted();
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > options.maxBytes) throw new PlaywrightResourceLimitError('Snapshot byte limit exceeded');
  return { tree: result, refs };
}
