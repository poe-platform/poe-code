import fs from 'node:fs';
if (!['ready', 'exit7'].includes(process.argv[2])) throw new Error('UNKNOWN_FIXTURE');
fs.writeSync(1, `harmless:${process.argv[2]}\n`);
fs.writeSync(2, 'bounded-stderr\n');
process.exitCode = process.argv[2] === 'ready' ? 0 : 7;
