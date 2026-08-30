const bytes = value => Buffer.from(value).toString('base64');
const rows = [];
function row(id, script, input, args, extra = {}) { rows.push({ id, script, stdin: bytes(input), args, files: {}, ...extra }); }
const historical = Array.from({ length: 5000 }, (_, index) => `value-${(index * 71) % 997}\n`).join('');
row('historical-sort-uniq-5000', 'sort | uniq', historical, [], { nativeUniq: true });
row('plain-5000', 'sort', historical, []);
row('unique-paths-20000', 'sort -u', Array.from({ length: 20000 }, (_, index) => `src/module-${index * 7919 % 9001}/file-${index % 97}.ts\n`).join(''), ['-u']);
row('reverse-logs-12000', 'sort -r', Array.from({ length: 12000 }, (_, index) => `2026-08-${String(index % 28 + 1).padStart(2, '0')} level=${index % 3} event-${index * 71 % 4001}\n`).join(''), ['-r']);
row('unicode-8000', 'sort', Array.from({ length: 8000 }, (_, index) => `${['雪', '😀', '\uE000', 'é', 'a', '𐀀'][index % 6]}-${index * 71 % 2003}\n`).join(''), []);
row('numeric-stable-8000', 'sort -n -s', Array.from({ length: 8000 }, (_, index) => `${index * 71 % 201 - 100}.${index % 10} record-${index}\n`).join(''), ['-n', '-s']);
row('numeric-key-8000', "sort -s -t: -k2,2n", Array.from({ length: 8000 }, (_, index) => `item-${index}:${index * 71 % 4001}:value\n`).join(''), ['-s', '-t:', '-k2,2n']);
row('in-place-5000', 'sort -o input input; cat input', '', ['-o', 'input', 'input'], { files: { input: bytes(historical) }, nativeReadOutput: true });
row('tiny-32', 'sort', Array.from({ length: 32 }, (_, index) => `x-${index * 71 % 23}\n`).join(''), []);
row('invalid-bytes-8000', 'sort', Buffer.concat(Array.from({ length: 8000 }, (_, index) => Buffer.from([...[0xff, 0xc0, 0x80, 0x00, 0xfe, 0x41].slice(index % 5), 48 + index % 10, 10]))), []);
export const workloads = rows;
