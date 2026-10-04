import type { IndexedDocument } from 'safe-bash-diff-engine/document';
import { Diff3Error, type Diff3Range } from './contracts.js';
import type { Diff3Invocation } from './behavior.js';
import { StoredWork, StoredOutput, bodyEnd, storedLine, type StoredLine } from './stored.js';
import { alignStoredPair } from './stored-alignment.js';
import { alignStoredRegions } from './stored-regions.js';

export async function compareStoredDiff3(inputs: readonly IndexedDocument[], options: Diff3Invocation, work: StoredWork): Promise<{ stdout: StoredOutput; stderr: StoredOutput; exitCode: 0 | 1; outputBytes: number }> {
  const out = work.output(), err = work.output();
  let outputBytes = 0;
  const emit = async (bytes: Uint8Array, destination = out): Promise<void> => {
    work.step(bytes.length + 1);
    if (bytes.length > work.behaviorLimits.outputBytes - outputBytes) throw new Diff3Error('LIMIT', 'Output byte limit exceeded');
    outputBytes += bytes.length;
    await destination.append(bytes);
  };
  const literal = async (value: string, destination = out): Promise<void> => {
    work.step(value.length * 4);
    if (value.length) work.reserve();
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + 4096, value.length);
      const unit = value.charCodeAt(end - 1);
      if (end < value.length && unit >= 0xd800 && unit <= 0xdbff) end--;
      await emit(new TextEncoder().encode(value.slice(start, end)), destination);
      start = end;
    }
  };
  if (options.information) {
    await literal(options.information === 'version' ? 'diff3 (safe-bash; GNU diffutils 3.12 qualified profile)\n' : 'Usage: diff3 [OPTION]... OURS BASE THEIRS\nReports, -m merge, -A/-e/-E/-3/-x/-X ed scripts; -a -T -L -i --strip-trailing-cr.\nNo external diff/ed programs. One stdin operand in any position. Ed labels must be single-line.\n');
    return { stdout: out, stderr: err, exitCode: 0, outputBytes };
  }
  const report = !options.selector && !options.merge;
  const preferredCommon = report ? 2 : 1;
  const common = options.files[preferredCommon] === '-' ? 3 - preferredCommon : preferredCommon;
  const other = 3 - common;
  let identical = true;
  for (const input of inputs.slice(1)) {
    if (input.size !== inputs[0]!.size || input.length !== inputs[0]!.length) { identical = false; break; }
    for (let index = 0; index < input.length; index++) {
      if (!await input.equal(index, inputs[0]!, index)) { identical = false; break; }
    }
    if (!identical) break;
  }
  if (!identical && !options.text && inputs.some(input => input.binary)) throw new Diff3Error('BINARY', 'Binary input requires text comparison');
  const documents = { base: inputs[common]!, left: inputs[0]!, right: inputs[other]! };
  const leftEdits = await alignStoredPair(documents.base, documents.left, options, work);
  const rightEdits = await alignStoredPair(documents.base, documents.right, options, work);
  const regions = await alignStoredRegions(documents, leftEdits, rightEdits, options, work);
  const analysis = { files: documents, leftEdits, rightEdits, regions };
  const files = inputs;
  const labels = options.files.map((file, i) => options.labels?.[i] ?? file);
  const line = async (token: StoredLine, mode: 'source' | 'changed' | 'report' | 'ed'): Promise<void> => {
    const end = mode === 'source' ? token.end : await bodyEnd(token, options);
    for await (const bytes of token.document.range(token.start, end)) await emit(bytes);
    if (mode !== 'source' && token.terminated) await literal('\n');
    if (!token.terminated && (mode === 'ed' || mode === 'report')) await literal('\n');
    if (!token.terminated && mode === 'report') await literal('\\ No newline at end of file\n');
  };
  const range = async (file: number, address: Diff3Range, mode: 'source' | 'changed' | 'report' | 'ed'): Promise<boolean> => {
    let dots = false;
    for (let i = address.start; i < address.end; i++) {
      work.step(); const token = await storedLine(files[file]!, i);
      if (mode === 'report') await literal(options.initialTab ? '\t' : '  ');
      if (mode === 'ed' && (await token.document.data.read(8 + token.start, 1))[0] === 46) { await literal('.'); dots = true; }
      await line(token, mode);
    }
    return dots;
  };
  const address = (r: Diff3Range): string => r.start === r.end ? `${r.start}a` : `${r.start + 1}${r.end > r.start + 1 ? `,${r.end}` : ''}c`;
  let conflict = false;
  if (!report && !options.merge) {
    // Pairwise protocol warns for each changed unterminated endpoint.
    for (const edits of [analysis.leftEdits, analysis.rightEdits]) for await (const edit of edits) {
      const variant = edits === analysis.leftEdits ? analysis.files.left : analysis.files.right;
      for (const [tokens, r] of [[analysis.files.base, edit.base], [variant, edit.variant]] as const) {
        if (r.end > r.start && !(await storedLine(tokens, r.end - 1)).terminated) await literal('diff3: No newline at end of file\n', err);
      }
    }
  }
  let cursor = 0;
  const orderedRegions = analysis.regions.iterate(!options.merge && !report);
  for await (const region of orderedRegions) {
    work.step();
    const ranges: Diff3Range[] = [];
    ranges[0] = region.left; ranges[other] = region.right; ranges[common] = region.base;
    const base = ranges[1]!, theirs = ranges[2]!;
    const different = region.kind === 'left' ? 1 : region.kind === 'right' ? other + 1 : region.kind === 'identical' ? common + 1 : 0;
    if (report) {
      await literal(`====${different || ''}\n`);
      const sequence = different === 2 ? [0, 2, 1] : [0, 1, 2];
      for (let i = 0; i < sequence.length; i++) {
        const file = sequence[i]!;
        await literal(`${file + 1}:${address(ranges[file]!)}\n`);
        if (different === 0 || file === different - 1 || i === 1 && different !== 1 || i === 2 && different === 1) await range(file, ranges[file]!, 'report');
      }
      continue;
    }
    const selector = options.selector!;
    const flagged = different === 0 && (selector === 'A' || selector === 'E' || selector === 'X') || different === 2 && selector === 'A';
    const replace = different === 3 && ['A', 'E', 'e', '3'].includes(selector) || different === 0 && ['e', 'x'].includes(selector);
    if (options.merge) {
      await range(0, { start: cursor, end: region.left.start }, 'source');
      if (flagged) {
        conflict = true;
        if (different === 2) { await literal(`<<<<<<< ${labels[1]}\n`); await range(1, base, 'changed'); }
        else { await literal(`<<<<<<< ${labels[0]}\n`); await range(0, region.left, 'changed'); if (selector === 'A') { await literal(`||||||| ${labels[1]}\n`); await range(1, base, 'changed'); } }
        await literal('=======\n'); await range(2, theirs, 'changed'); await literal(`>>>>>>> ${labels[2]}\n`);
      } else await range(replace ? 2 : 0, replace ? theirs : region.left, replace ? 'changed' : 'source');
      cursor = region.left.end;
    } else if (replace) {
      if (theirs.start === theirs.end) { if (region.left.start !== region.left.end) await literal(address(region.left).slice(0, -1) + 'd\n'); }
      else {
        await literal(address(region.left) + '\n');
        const dots = await range(2, theirs, 'ed'); await literal('.\n');
        if (dots) { const start = region.left.start + 1, end = region.left.start + theirs.end - theirs.start; await literal(`${start}${end > start ? `,${end}` : ''}s/^\\.//\n`); }
      }
    } else if (flagged) {
      conflict = true;
      await literal(`${region.left.end}a\n`);
      let dots = false;
      if (different !== 2) {
        if (selector === 'A') { await literal(`||||||| ${labels[1]}\n`); dots = await range(1, base, 'ed'); }
        await literal('=======\n'); dots = await range(2, theirs, 'ed') || dots;
      }
      await literal(`>>>>>>> ${labels[2]}\n.\n`);
      if (dots) await literal(`${region.left.end + 2},${region.left.end + base.end - base.start + theirs.end - theirs.start + 2}s/^\\.//\n`);
      await literal(`${region.left.start}a\n<<<<<<< ${labels[different === 2 ? 1 : 0]}\n`);
      if (different === 2) { const baseDots = await range(1, base, 'ed'); await literal('=======\n.\n'); if (baseDots) { const start = region.left.start + 2, end = region.left.start + base.end - base.start + 1; await literal(`${start}${end > start ? `,${end}` : ''}s/^\\.//\n`); } }
      else await literal('.\n');
    }
  }
  if (options.merge) await range(0, { start: cursor, end: files[0]!.length }, 'source');
  else if (!report && options.writeQuit) await literal('w\nq\n');
  return { stdout: out, stderr: err, exitCode: options.merge && conflict ? 1 : 0, outputBytes };
}
