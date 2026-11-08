const bytes = text => Buffer.from(text).toString('base64');
export function fixtures() {
  const rows = [];
  const add = (id, script, input, output, options = {}) => rows.push({ id, script, input: bytes(input), expected: { stdout: bytes(output), stderr: bytes(options.stderr ?? ''), status: options.status ?? 0, files: { input: bytes(input), ...(options.files ?? {}) } }, ...options });
  const numeric = (style, count, width, duplicates = false) => {
    const ordered = Array.from({ length: count }, (_, index) => {
      const value = String(duplicates ? index % 16 : index).padStart(width, '0');
      return style === 'unkeyed' ? value : `r${String(index).padStart(5, '0')}:${value}:x`;
    });
    const indices = Array.from({ length: count }, (_, index) => (index * (count === 8000 ? 7919 : count - 1)) % count);
    const input = indices.map(index => ordered[index]);
    const expected = duplicates ? Array.from({ length: 16 }, (_, value) => indices.filter(index => index % 16 === value).map(index => ordered[index])).flat() : ordered;
    return { input: input.join('\n') + '\n', output: expected.join('\n') + '\n' };
  };
  for (const style of ['unkeyed', 'keyed']) {
    const command = style === 'unkeyed' ? 'sort -sn input' : 'sort -s -t: -k2,2n input';
    for (const duplicates of [false, true]) {
      const count = 8000;
      const generated = numeric(style, count, 7, duplicates);
      if (style === 'unkeyed') {
        const original = generated.input.trimEnd().split('\n');
        const records = original.map((line, index) => `${line} r${String(index).padStart(4, '0')}`);
        generated.input = records.join('\n') + '\n';
        const buckets = Array.from({ length: duplicates ? 16 : count }, () => []);
        for (const record of records) buckets[Number(record.slice(0, 7))].push(record);
        generated.output = buckets.flat().join('\n') + '\n';
      }
      add(`${style}-${duplicates ? 'duplicates' : 'distinct'}-8000`, command, generated.input, generated.output, { timing: true, cold: true, pair: style === 'unkeyed' ? ['A', 'B'] : ['B', 'C'], count, distinctNumericValues: duplicates ? 16 : count, logicalCharge: count * (6 * (style === 'unkeyed' ? 13 : 7) + 2) });
    }
    for (const [boundary, count, width] of [['entries-at', 16384, 5], ['entries-over', 16385, 5], ['charge-at', 8192, 21], ['charge-over', 8193, 21]]) {
      const generated = numeric(style, count, width);
      const timing = style === 'unkeyed' && boundary === 'entries-over' || style === 'keyed' && boundary === 'charge-over';
      add(`${style}-${boundary}`, command, generated.input, generated.output, { timing, cold: false, pair: style === 'unkeyed' ? ['A', 'B'] : ['B', 'C'], count, logicalCharge: count * (6 * width + 2) });
    }
  }
  const plain = Array.from({ length: 1024 }, (_, index) => String(index).padStart(4, '0'));
  for (const pair of [['A', 'B'], ['B', 'C']]) add(`plain-control-${pair.join('')}`, 'sort input', [...plain].reverse().join('\n') + '\n', plain.join('\n') + '\n', { timing: true, cold: false, pair, count: 1024 });
  add('unkeyed-precision-stable', 'sort -sn input', '9007199254740993 z\n-0 a\n9007199254740992 y\n-1.00000000000000001 b\n-1.00000000000000002 c\n0 d\n', '-1.00000000000000002 c\n-1.00000000000000001 b\n-0 a\n0 d\n9007199254740992 y\n9007199254740993 z\n');
  add('keyed-precision-stable', 'sort -s -t: -k2,2n input', 'z:9007199254740993\na:-0\ny:9007199254740992\nb:-1.00000000000000001\nc:-1.00000000000000002\nd:0\n', 'c:-1.00000000000000002\nb:-1.00000000000000001\na:-0\nd:0\ny:9007199254740992\nz:9007199254740993\n');
  add('unkeyed-unique-reverse', 'sort -nru input', '01 z\n1 a\n-2 b\n3 c\n', '3 c\n01 z\n-2 b\n');
  add('keyed-unique-reverse', 'sort -ru -t: -k2,2nr input', 'z:01\na:1\nb:-2\nc:3\n', 'c:3\nz:01\nb:-2\n');
  add('unkeyed-nul', 'sort -zn input', '2\0-1\0', '-1\0' + '2\0');
  add('keyed-nul', 'sort -z -t: -k2,2n input', 'a:2\0b:-1\0', 'b:-1\0a:2\0');
  add('unkeyed-in-place', 'sort -n -o input input', '2\n1\n', '', { files: { input: bytes('1\n2\n') } });
  add('keyed-in-place', 'sort -t: -k2,2n -o input input', 'a:2\nb:1\n', '', { files: { input: bytes('b:1\na:2\n') } });
  for (const script of ['sort -nb input', 'sort -nf input']) add(`excluded-${script.split(' ')[1]}`, script, '2\n1\n', '1\n2\n');
  add('excluded-key-b', 'sort -t: -k2,2nb input', 'a:2\nb:1\n', 'b:1\na:2\n');
  add('excluded-key-f', 'sort -t: -k2,2nf input', 'a:2\nb:1\n', 'b:1\na:2\n');
  add('excluded-multikey', 'sort -k2,2n -k1,1 input', 'b 1\na 1\nc 0\n', 'c 0\na 1\nb 1\n');
  add('excluded-check', 'sort -cn input', '2\n1\n', '', { status: 1, stderr: 'sort: disorder at record 2\n' });
  add('excluded-key-check', 'sort -cu -k2,2n input', 'z 01\na 1\n', '', { status: 1, stderr: 'sort: disorder at record 2\n' });
  add('borrowed-unkeyed', 'sort -n input', '2\n1\n', '1\n2\n', { borrowed: true });
  add('borrowed-keyed', 'sort -t: -k2,2n input', 'a:2\nb:1\n', 'b:1\na:2\n', { borrowed: true });
  return rows;
}
