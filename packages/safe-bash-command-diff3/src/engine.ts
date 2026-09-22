import { Diff3Error, type Diff3Analysis, type Diff3Engine, type Diff3File, type Diff3Limits, type Diff3Line, type Diff3Options } from './contracts.js';
import { Budget } from './budget.js';
import { alignPair } from './alignment.js';
import { alignRegions } from './regions.js';
import { byteView } from './bytes.js';

const fileNames: readonly Diff3File[] = ['base', 'left', 'right'];
interface FileState { chunks: Uint8Array[]; size: number; lines: Diff3Line[]; ended: boolean }
export function createDiff3Engine(limits: Diff3Limits, options: Diff3Options = {}, signal?: AbortSignal): Diff3Engine {
  const budget = new Budget(limits, signal);
  const comparison = { stripTrailingCR: options.stripTrailingCR === true, text: options.text === true };
  const files: Record<Diff3File, FileState> = {
    base: { chunks: [], size: 0, lines: [], ended: false },
    left: { chunks: [], size: 0, lines: [], ended: false },
    right: { chunks: [], size: 0, lines: [], ended: false }
  };
  let closed = false;
  const dispose = (): void => {
    closed = true;
    for (const file of fileNames) { files[file].chunks = []; files[file].lines = []; files[file].size = 0; }
    budget.retainedBytes = budget.tokens = budget.graphCells = 0;
  };
  const execute = <T>(operation: () => T): T => {
    if (closed) throw new Diff3Error('CLOSED', 'Diff3 engine is closed');
    try { budget.admit('work', 1); return operation(); } catch (error) { dispose(); throw error; }
  };
  const state = (file: Diff3File): FileState => {
    if (!fileNames.includes(file)) throw new Diff3Error('STATE', 'Unknown diff3 input');
    return files[file];
  };
  return {
    push(file, bytes) {
      execute(() => {
        const input = state(file);
        if (input.ended) throw new Diff3Error('STATE', 'Input has already ended');
        bytes = byteView(bytes);
        if (bytes.length === 0) return;
        budget.admit('inputBytes', bytes.length); budget.admit('retainedBytes', bytes.length);
        budget.admit('graphCells', 1); // Retained spool-fragment slot.
        budget.admit('work', bytes.length);
        input.chunks.push(new Uint8Array(bytes)); input.size += bytes.length;
      });
    },
    end(file) {
      execute(() => {
        const input = state(file);
        if (input.ended) throw new Diff3Error('STATE', 'Input has already ended');
        budget.admit('retainedBytes', input.size); // Coalescing admits both copies.
        budget.admit('work', input.size);
        const bytes = new Uint8Array(input.size);
        let offset = 0;
        for (const chunk of input.chunks) { budget.admit('work', 1); bytes.set(chunk, offset); offset += chunk.length; }
        budget.retainedBytes -= input.size; budget.graphCells -= input.chunks.length; input.chunks = [];
        let start = 0;
        const line = (end: number, terminated: boolean): void => {
          budget.admit('tokens', 1); input.lines.push({ bytes: bytes.subarray(start, end), terminated }); start = end;
        };
        for (let index = 0; index < bytes.length; index++) {
          budget.admit('work', 1);
          if (bytes[index] === 0 && !comparison.text) throw new Diff3Error('BINARY', 'Binary input requires text comparison');
          if (bytes[index] === 10) line(index + 1, true);
        }
        if (start < bytes.length) line(bytes.length, false);
        input.ended = true;
      });
    },
    finish() {
      return execute(() => {
        if (fileNames.some(file => !files[file].ended)) throw new Diff3Error('STATE', 'All three inputs must end before alignment');
        const tokens = { base: files.base.lines, left: files.left.lines, right: files.right.lines };
        const leftEdits = alignPair(tokens.base, tokens.left, comparison, budget);
        const rightEdits = alignPair(tokens.base, tokens.right, comparison, budget);
        const regions = alignRegions(tokens, leftEdits, rightEdits, comparison, budget);
        const result: Diff3Analysis = { files: tokens, leftEdits, rightEdits, regions, alignmentProfile: 'gnu-3.12-qualified' };
        dispose(); // Transfer ownership; invocation retains no result references.
        return result;
      });
    },
    dispose,
    accounting: () => budget.snapshot()
  };
}
/** Pure byte API; base is explicit, never inferred from GNU operand ordering. */
export function analyzeDiff3(files: Readonly<Record<Diff3File, Uint8Array>>, limits: Diff3Limits, options: Diff3Options = {}, signal?: AbortSignal): Diff3Analysis {
  const engine = createDiff3Engine(limits, options, signal);
  try {
    for (const file of fileNames) { engine.push(file, files[file]); engine.end(file); }
    return engine.finish();
  } finally { engine.dispose(); }
}
