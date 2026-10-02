import { byteText } from './bytes.js';
import { classify, protocol, resolveLocation } from './resolution-path.js';
import type { AccessGraph, AccessNode } from './resolution-types.js';

/** Classification is advisory, never an authorization to open or upload. Unknown
 * schemes remain native resources; protocol support is determined at native open. */
export function classifyResource(value: Uint8Array): {
  original: Uint8Array;
  kind: 'filesystem' | 'descriptor' | 'native-protocol';
  protocol?: string;
} {
  if (!(value instanceof Uint8Array)) throw new TypeError('Resource classification requires original bytes');
  // Own native buffer contents before interpreting metadata: a typed array can
  // shadow length and otherwise disguise a network operand as an empty path.
  value = new Uint8Array(value);
  const kind = classify(value);
  return {
    original: value,
    kind: kind === 'url' ? 'native-protocol' : kind === 'descriptor' ? 'descriptor' : 'filesystem',
    protocol: protocol(byteText(value)),
  };
}

/** Local candidates only, NOT a materialization admission. Live filesystem
 * authority must separately admit every candidate. Network references, even
 * incorrectly labelled by a discovery hint, cannot become uploaded snapshots. */
export function filesystemCandidates(graph: AccessGraph): AccessNode[] {
  // Inspect indexed graph entries without invoking producer array methods or
  // iterators that could substitute unclassified network nodes.
  const nodes = graph.nodes;
  return Array.from({ length: nodes.length }, (_, index) => {
    // Return the exact bytes classified below. Producer accessors or later
    // buffer reuse must not replace a local candidate with a network URL.
    const node = { ...nodes[index] };
    const base = { ...node.base };
    if (!(node.value instanceof Uint8Array) || !(node.original instanceof Uint8Array)
      || (node.path !== undefined && !(node.path instanceof Uint8Array))
      || (node.location !== undefined && !(node.location instanceof Uint8Array))
      || (node.readerLocation !== undefined && !(node.readerLocation instanceof Uint8Array))
      || !(base.value instanceof Uint8Array)) {
      throw new TypeError('Filesystem candidates require original byte fields');
    }
    // Traversal hints accompany candidates too. Own their bytes so later
    // producer buffer reuse cannot replace a selected filesystem spelling.
    const entries = node.trace;
    if (!Array.isArray(entries)) throw new TypeError('Filesystem candidates require original byte fields');
    const trace = Array.from({ length: entries.length }, (_, index) => {
      if (!Object.hasOwn(entries, index)) throw new TypeError('Filesystem candidates require original byte fields');
      const entry = { ...entries[index] };
      if (!(entry.path instanceof Uint8Array)
        || (entry.target !== undefined && !(entry.target instanceof Uint8Array))) {
        throw new TypeError('Filesystem candidates require original byte fields');
      }
      return { ...entry, path: new Uint8Array(entry.path),
        target: entry.target === undefined ? undefined : new Uint8Array(entry.target) };
    });
    return { ...node, value: new Uint8Array(node.value), original: new Uint8Array(node.original),
      path: node.path === undefined ? undefined : new Uint8Array(node.path),
      location: node.location === undefined ? undefined : new Uint8Array(node.location),
      readerLocation: node.readerLocation === undefined ? undefined : new Uint8Array(node.readerLocation),
      base: { ...base, value: new Uint8Array(base.value) }, trace };
  }).filter(node => {
    // Manifest readers join '-' to the opened resource before AVIO dispatch.
    // This is a filename only in that reader context, never CLI stdin. The
    // resolved location must still be local; network playlists keep native URLs.
    const readerDash = node.base.kind === 'resource' && byteText(node.original) === '-'
      && byteText(node.value) === '-'
      && (node.path === undefined || byteText(node.path) === '-');
    return ['path', 'file-protocol', 'image-selector', 'glob', 'output-pattern', 'filename-expression'].includes(node.kind)
      && (node.literal === true || readerDash || classifyResource(node.original).kind === 'filesystem')
      && (node.literal === true || readerDash || classifyResource(node.value).kind === 'filesystem')
      && (node.literal === true || readerDash || classifyResource(node.path ?? node.original).kind === 'filesystem')
      // A local snapshot hint cannot replace the endpoint selected by the
      // reader's network base, including root-relative playlist members.
      && classifyResource(resolveLocation(node.original, node.base, node.literal)).kind === 'filesystem'
      && classifyResource(resolveLocation(node.value, node.base, node.literal)).kind === 'filesystem'
      // The native reader operand outranks a canonical/snapshot location hint.
      // Keep redirected endpoints out even when every other hint is local.
      && (node.readerLocation === undefined || classifyResource(node.readerLocation).kind === 'filesystem')
      && node.location !== undefined && classifyResource(node.location).kind === 'filesystem';
  });
}
