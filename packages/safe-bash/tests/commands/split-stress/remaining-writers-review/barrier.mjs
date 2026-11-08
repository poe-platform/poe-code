import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

if (process.env.REVIEW_BARRIER && process.env.NODE_TEST_CONTEXT) {
  const entry = { pid: process.pid, mode: process.env.REVIEW_MODE, argv: process.argv, ready: new Date().toISOString() };
  await fs.writeFile(join(process.env.REVIEW_BARRIER, `${process.pid}.ready.json`), JSON.stringify(entry), { flag: 'wx' });
  const deadline = Date.now() + 45000;
  for (;;) {
    try { await fs.access(join(process.env.REVIEW_BARRIER, 'release')); break; }
    catch { if (Date.now() >= deadline) throw new Error('Review rendezvous deadline'); await setTimeout(10); }
  }
  await fs.writeFile(join(process.env.REVIEW_BARRIER, `${process.pid}.released.json`), JSON.stringify({ ...entry, released: new Date().toISOString() }), { flag: 'wx' });
}
