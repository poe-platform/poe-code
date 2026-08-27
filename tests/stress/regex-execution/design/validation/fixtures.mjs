const hex = text => Buffer.from(text).toString('hex');
const command = (id, tool, args, input, output, status = 0, native = undefined) => ({ id, tool, args, inputHex: hex(input), expected: { stdoutHex: hex(output), status }, native: native ?? { stdoutHex: hex(output), status } });
export const commands = [
  command('grep-bre-group', 'grep', ['-o', '\\(ab\\)'], 'ab x\n', 'ab\n'),
  command('grep-ere-order', 'grep', ['-Eo', 'a|ab'], 'ab\n', 'a\n', 0, { stdoutHex: hex('ab\n'), status: 0 }),
  command('grep-fixed-punctuation', 'grep', ['-Fo', 'a.b'], 'a.b axb\n', 'a.b\n'),
  command('grep-posix-digit', 'grep', ['-Eo', '[[:digit:]]+'], 'a12b\n', '12\n'),
  { ...command('grep-raw-byte', 'grep', ['-Eao', '.'], '', ''), inputHex: 'ff0a', expected: { stdoutHex: 'ff0a', status: 0 }, native: { stdoutHex: 'ff0a', status: 0 } },
  command('grep-utf8-literal', 'grep', ['-Fo', 'é'], 'é x\n', 'é\n'),
  command('grep-empty-only', 'grep', ['-Eo', ''], 'abc\n', ''),
  command('grep-ascii-i', 'grep', ['-Eio', 'abc'], 'ABC\n', 'ABC\n'),
  command('grep-word', 'grep', ['-Ewo', 'cat'], 'scat cat!\n', 'cat\n'),
  command('grep-whole', 'grep', ['-Ex', 'ab'], 'abc\nab\n', 'ab\n'),
  command('grep-bre-backref', 'grep', ['-o', '\\(a\\)\\1'], 'aa\n', 'aa\n'),
  command('grep-special-rejected', 'grep', ['-Eo', '(?<letter>a)'], 'a\n', '', 2),
  command('rg-unicode-dot', 'rg', ['-o', '.'], '😀é\n', '😀\né\n'),
  { ...command('rg-invalid-fragments', 'rg', ['-ao', '.'], '', ''), inputHex: '61ff620a', expected: { stdoutHex: '610a620a', status: 0 }, native: { stdoutHex: '610a620a', status: 0 } },
  command('rg-word-unicode', 'rg', ['-wo', 'a'], 'éa a\n', 'a\n'),
  command('rg-undocumented-named-backref', 'rg', ['-o', '(?<letter>a)\\k<letter>'], 'aa\n', 'aa\n', 0, { stdoutHex: '', status: 2 }),
  command('rg-lookaround-rejected', 'rg', ['-o', '(?=a)a'], 'a\n', '', 2),
  command('rg-unicode-i-kelvin', 'rg', ['-Fio', 'k'], 'K K k\n', 'K\nK\nk\n'),
  command('rg-declared-js-digit', 'rg', ['-o', '\\d'], '١1\n', '1\n', 0, { stdoutHex: hex('١\n1\n'), status: 0 }),
  command('rg-empty-byte-boundaries', 'rg', ['-o', ''], 'é\n', '\n\n\n'),
  command('rg-capture', 'rg', ['-o', '(ab)(c)?'], 'ab abc\n', 'ab\nabc\n'),
  command('rg-pattern-order', 'rg', ['-o', '-e', 'a', '-e', 'ab'], 'ab\n', 'a\n'),
];
export const raw = [
  { id: 'captures-optional', source: '(ab)(c)?', flags: 'g', text: 'ab abc', captures: [['ab', 'ab', null], ['abc', 'ab', 'c']] },
  { id: 'unicode-supplementary', source: '(.)', flags: 'gu', text: '😀é', captures: [['😀', '😀'], ['é', 'é']] },
  { id: 'empty-advance', source: '', flags: 'gu', text: '😀', captures: [[''], ['']] },
  { id: 'named-benign-capture', source: '(?<letter>a)', flags: 'g', text: 'a', captures: [['a', 'a']] },
  { id: 'fixed-punctuation-capture', source: '(a\\.b)', flags: 'g', text: 'a.b', captures: [['a.b', 'a.b']] },
  { id: 'nonmatch', source: '^z+$', flags: 'g', text: 'aaaa', captures: [] },
];
export const workloads = ['long-linear', 'small-many-line'];
export function workload(name) {
  if (!workloads.includes(name)) throw new Error('UNKNOWN_WORKLOAD');
  const texts = name === 'long-linear' ? Array.from({ length: 8 }, () => 'a'.repeat(32760) + 'Z') : Array.from({ length: 128 }, (_, index) => `record-${index}-value`);
  const descriptors = [{ source: name === 'long-linear' ? '(a{8})Z$' : '^record-([0-9]+)-(value)$', flags: 'g' }];
  return { descriptors, rows: texts.map(text => ({ text, all: true })), batchSize: name === 'long-linear' ? 2 : 32 };
}
export const policyNames = ['fifo-release-before-await', 'live-one-record-stream', 'lease-free-live-shell', 'concurrent-shell-pipelines', 'idle-invocation-rejection-demonstration'];
