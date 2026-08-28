import { readCapture } from './capture-io.mjs';
import { parseTree, treeHash } from '../path-transport-v2/path-bytes.mjs';

export function admitCapturedTree(directory, id, profile, manifest) {
  const bytes = readCapture(directory, id, profile, manifest);
  const entries = parseTree(bytes);
  return { bytes, entries, root: treeHash(entries) };
}
