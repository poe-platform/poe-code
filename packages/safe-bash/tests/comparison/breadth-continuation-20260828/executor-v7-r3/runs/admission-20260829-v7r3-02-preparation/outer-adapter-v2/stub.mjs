import { writeSync } from 'node:fs';
const mode = process.argv[2];
if (mode === 'normal' || mode === 'seven') {
  writeSync(1, 'outer-ok\n');
  writeSync(2, 'outer-diagnostic\n');
  writeSync(3, '{"stub":true}\n');
  process.exitCode = mode === 'seven' ? 7 : 0;
} else if (mode === 'bootstrap') {
  writeSync(2, 'STUB_BOOTSTRAP_BEFORE_INNER_COLLECTOR\n');
  process.exitCode = 1;
} else if (mode === 'overflow') {
  writeSync(1, Buffer.alloc(65537, 65));
} else if (mode === 'fd3-overflow') {
  writeSync(3, Buffer.alloc(262145, 66));
} else if (mode === 'wait') {
  writeSync(1, 'waiting\n');
  setInterval(() => {}, 1000);
} else throw Error('UNDECLARED_STUB');
