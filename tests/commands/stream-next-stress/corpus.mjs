const bytes = value => Buffer.from(value).toString('base64');
const textFile = (path, content) => ({ path, type: 'file', bytes: bytes(content) });
const cases = [];
const add = (command, id, args, input = '', extra = {}) => cases.push({
  id: `${command}-${id}`, command, args, stdin: bytes(input), files: [], locale: 'C', ...extra,
});

add('seq', 'integers', ['4']);
add('seq', 'decimal-precision', ['0.10', '0.05', '0.30']);
add('seq', 'decimal-endpoint', ['0', '0.1', '0.3']);
add('seq', 'descending-negative', ['--', '1', '-0.5', '-1']);
add('seq', 'negative-first', ['-2', '1']);
add('seq', 'zero-step', ['1', '0', '3'], '', { diagnostic: ['zero', 'increment'] });
add('seq', 'empty', ['0']);
add('seq', 'reversed', ['4', '2']);
add('seq', 'descending-empty', ['1', '-1', '3']);
add('seq', 'separator', ['-s', '::', '2', '4']);
add('seq', 'empty-separator', ['-s', '', '1', '3']);
add('seq', 'equal-width', ['-w', '-2', '2', '10']);
add('seq', 'format-fixed', ['-f', '[%+06.2f]%%', '-1', '.5', '1']);
add('seq', 'format-scientific', ['-f', '%.2E', '0.01', '.01', '.03']);
add('seq', 'format-general', ['-f', '%.3g', '999', '1', '1001']);
add('seq', 'format-rounding', ['-f', '%.0f', '0.5', '1', '3.5']);
add('seq', 'exponent', ['1e-2', '1e-2', '3e-2']);
add('seq', 'invalid-format', ['-f', '%f %f', '3'], '', { diagnostic: ['format', 'conversion'] });
add('seq', 'format-width-conflict', ['-w', '-f', '%g', '2'], '', { diagnostic: ['format', 'width'] });
add('seq', 'invalid-number', ['one'], '', { diagnostic: ['invalid', 'argument'] });
add('seq', 'missing-operand', [], '', { diagnostic: ['operand', 'usage'] });

const pages = 'before\n\\:\\:\\:\nhead\n\\:\\:\nbody\n\n\\:\nfoot\n\\:\\:\\:\nnext\n\\:\\:\nlast\n';
add('nl', 'default-blank', [], 'alpha\n\n \n\t\nbeta');
add('nl', 'logical-pages', [], pages);
add('nl', 'section-styles', ['-h', 'a', '-b', 'n', '-f', 't', '-w', '2', '-s', '|'], pages);
add('nl', 'no-reset', ['-p', '-b', 'a', '-v', '7', '-i', '3', '-w', '2'], pages);
add('nl', 'blank-joining', ['-b', 'a', '-l', '3', '-w', '2', '-s', ':'], '\n\n\n\n\n\ntext\n\n\n \n\n\n\n');
add('nl', 'zero-fill-negative', ['-b', 'a', '-n', 'rz', '-w', '4', '-v', '-2', '-i', '1'], 'a\nb\nc\nd\n');
add('nl', 'left-format', ['-b', 'a', '-n', 'ln', '-w', '3', '-s', '::'], 'a\nb\n');
add('nl', 'custom-delimiter', ['-d', '@!', '-h', 'a', '-b', 'a'], '@!@!@!\nhead\n@!@!\nbody\n@!\nfoot\n');
add('nl', 'pattern-basic', ['-b', 'p^a[0-9]'], 'a1\nb2\na3\n\n');
add('nl', 'multiple-files', ['-b', 'a', 'first', 'second'], '', { files: [textFile('first', 'a\nb\n'), textFile('second', 'c\nd\n')] });
add('nl', 'missing-then-file', ['missing', 'good'], '', { files: [textFile('good', 'alive\n')], diagnostic: ['missing'] });
add('nl', 'invalid-style', ['-b', 'z'], 'keep\n', { diagnostic: ['style', 'numbering', 'invalid'] });
add('nl', 'invalid-blank-count', ['-l', '0'], '\n', { diagnostic: ['blank', 'invalid', 'number'] });
add('nl', 'binary', ['-b', 'a', '-w', '1'], Buffer.from([65, 0, 255, 10, 66, 10]));

add('rev', 'ascii-c', [], 'ab\n\ncd\n');
add('rev', 'ascii-no-final-newline', [], 'abcd');
add('rev', 'nul-c', [], Buffer.from([65, 0, 66, 10]));
add('rev', 'high-byte-c', [], Buffer.from([65, 255, 66, 10]), { diagnostic: ['stdin', 'character', 'byte', 'UTF'] });
add('rev', 'unicode-utf8', [], 'Aé🙂\ne\u0301x\n', { locale: 'en_US.UTF-8' });
add('rev', 'malformed-utf8', [], Buffer.from([65, 0xc3, 0x28, 10]), { locale: 'en_US.UTF-8', diagnostic: ['stdin', 'character', 'byte', 'UTF'] });
add('rev', 'truncated-utf8', [], Buffer.from([65, 0xe2, 0x82]), { locale: 'en_US.UTF-8', diagnostic: ['stdin', 'character', 'byte', 'UTF'] });
add('rev', 'env-cleared-unicode', [], 'Aé🙂\n', { locale: null, diagnostic: ['stdin', 'character', 'byte', 'UTF'] });
add('rev', 'files', ['first', 'second'], '', { files: [textFile('first', 'abc\n'), textFile('second', 'def\n')] });
add('rev', 'missing-then-file', ['missing', 'good'], '', { files: [textFile('good', 'alive\n')], diagnostic: ['missing'] });
add('rev', 'unknown-option', ['-q'], 'untouched\n', { diagnostic: ['option', 'usage'] });

const spaced = '        lead    inner        end\n  next\n        \n';
add('unexpand', 'initial-only', [], spaced);
add('unexpand', 'all', ['-a'], spaced);
add('unexpand', 'tab-four-implies-all', ['-t', '4'], '    a   b    c\n');
add('unexpand', 'explicit-stops', ['-a', '-t', '3,7,11'], '   a   b   c        z\n');
add('unexpand', 'first-only-override', ['-a', '-t', '4', '--first-only'], '    a   b    c\n');
add('unexpand', 'mixed-tabs-backspace', ['-a', '-t', '4'], ' \t  x\b    y\t z\r    end\n');
add('unexpand', 'single-space', ['-a', '-t', '4'], 'abc def  gh\n');
add('unexpand', 'no-final-newline', ['-a'], '        a       b');
add('unexpand', 'binary', ['-a', '-t', '4'], Buffer.from([32,32,32,32,255,0,32,32,10]));
add('unexpand', 'multiple-files', ['-t', '4', 'first', 'second'], '', { files: [textFile('first', '    a\n'), textFile('second', '    b\n')] });
add('unexpand', 'invalid-zero-stop', ['-t', '0'], spaced, { diagnostic: ['tab', 'invalid', 'zero'] });
add('unexpand', 'decreasing-stops', ['-t', '8,4'], spaced, { diagnostic: ['tab', 'ascending', 'increasing'] });
add('unexpand', 'missing-then-file', ['missing', 'good'], '', { files: [textFile('good', '        ok\n')], diagnostic: ['missing'] });

add('split', 'default-thousand-lines', [], 'z\n'.repeat(1001));
add('split', 'empty', [], '');
add('split', 'line-groups', ['-l', '2', '-', 'part.'], 'a\nb\nc\nd\ne');
add('split', 'bytes-binary', ['-b', '3', '-', 'bin.'], Buffer.from([0,255,10,128,65,66,13,0,10,90]));
add('split', 'byte-size-suffix', ['-b', '1K', '-', 'k.'], 'Q'.repeat(1025));
add('split', 'line-bytes', ['-C', '5', '-', 'line.'], 'abc\nd\n123456789\nx\n');
add('split', 'long-line', ['-l', '1', '-', 'long.'], 'q'.repeat(8193) + '\ntail');
add('split', 'named-input', ['-b', '4', 'input', 'chunk.'], 'ignored', { files: [textFile('input', 'abcdefghij')] });
add('split', 'numeric-suffix', ['-d', '-a', '3', '-b', '2', '-', 'num.'], 'abcdef');
add('split', 'numeric-start-additional', ['--numeric-suffixes=8', '-a', '2', '--additional-suffix=.dat', '-b', '1', '-', 'n.'], 'abc');
add('split', 'suffix-exhaustion', ['-a', '1', '-b', '1', '-', 'p.'], 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!', { diagnostic: ['suffix', 'exhaust'] });
add('split', 'overwrite-shorter', ['-b', '2', '-', 'out.'], 'abcd', { files: [textFile('out.aa', 'stale-long'), textFile('out.ab', 'old'), textFile('sentinel', 'preserve')] });
add('split', 'output-is-input', ['-b', '2', 'xaa', 'x'], '', { files: [textFile('xaa', 'abcdef')], diagnostic: ['input', 'same', 'overwrite'] });
add('split', 'hardlink-output-alias', ['-b', '2', 'input', 'out.'], '', { files: [textFile('input', 'abcdef'), { path: 'out.aa', type: 'hardlink', target: 'input' }], diagnostic: ['input', 'same', 'overwrite'] });
add('split', 'symlink-output-alias', ['-b', '2', 'input', 'out.'], '', { files: [textFile('input', 'abcdef'), { path: 'out.aa', type: 'symlink', target: 'input' }], diagnostic: ['input', 'same', 'overwrite'] });
add('split', 'second-output-directory', ['-b', '2', '-', 'out.'], 'abcd', { files: [{ path: 'out.ab', type: 'directory' }], diagnostic: ['directory', 'out.ab'] });
add('split', 'missing-parent', ['-b', '2', '-', 'missing/out.'], 'abc', { diagnostic: ['missing', 'directory'] });
add('split', 'missing-input', ['missing', 'out.'], '', { diagnostic: ['missing'] });
add('split', 'input-directory', ['input', 'out.'], '', { files: [{ path: 'input', type: 'directory' }], diagnostic: ['directory', 'input'] });
add('split', 'zero-size', ['-b', '0'], 'abc', { diagnostic: ['invalid', 'zero', 'size'] });
add('split', 'conflicting-modes', ['-b', '2', '-l', '1'], 'abc\n', { diagnostic: ['split', 'option', 'mode', 'combine'] });
add('split', 'extra-operand', ['input', 'out.', 'extra'], '', { files: [textFile('input', 'abc')], diagnostic: ['operand', 'usage'] });
add('split', 'option-terminator', ['-b2', '--', '-input', 'dash.'], '', { files: [textFile('-input', 'abcde')] });

export const corpus = Object.freeze(cases);
export const workflows = Object.freeze([
  { id: 'pipeline-format-to-split', locale: 'C', stdin: '', files: [],
    script: "seq -f '%04.1f' 1 .5 3 | nl -ba -w2 -s: | rev | split -l2 - page.",
    stages: [['seq', '-f', '%04.1f', '1', '.5', '3'], ['nl', '-ba', '-w2', '-s:'], ['rev'], ['split', '-l2', '-', 'page.']] },
  { id: 'pipeline-tab-roundtrip-split', locale: 'C', stdin: bytes('    a   b\n        c\n'), files: [],
    script: 'unexpand -a -t4 | expand -t4 | rev | nl -ba -w2 -s: | split -b9 - row.',
    stages: [['unexpand', '-a', '-t4'], ['expand', '-t4'], ['rev'], ['nl', '-ba', '-w2', '-s:'], ['split', '-b9', '-', 'row.']] },
  { id: 'pipeline-double-rev-tab-roundtrip', locale: 'C', stdin: bytes('    ab  cd\n        ef\n'), files: [],
    script: 'rev | rev | unexpand -a -t4 | expand -t4',
    stages: [['rev'], ['rev'], ['unexpand', '-a', '-t4'], ['expand', '-t4']] },
]);

export const contractPlan = Object.freeze([
  'Actual default factory and initialized Shell stay 60 before and after opt-in tests; five names absent without opt-in.',
  'Actual opt-in Shell dispatch preserves byte outputs/files on MemoryFS and explicit-root RealFS; no terminal-text substitute.',
  'One-byte and reused producer chunks agree with frozen native inputs; byte ownership and awaited delayed sinks.',
  'Transparent invoke middleware forwards source/cwd/env/signal and shares command/output budgets; no fresh Shell workaround.',
  'Family output/input/argument/record/file limits fail before exceeding configured publication bound; native parity not asserted for safety limits.',
  'Caller cancellation with errno-shaped reason rejects identically; pending reads/writes observe late rejection; no false rollback.',
  'Split completed segments and adapter-observed partial current write survive injected ENOSPC/cancellation without cleanup.',
  'Plugin collision preflight leaves registry unchanged; invalid limit configurations rejected.',
]);
