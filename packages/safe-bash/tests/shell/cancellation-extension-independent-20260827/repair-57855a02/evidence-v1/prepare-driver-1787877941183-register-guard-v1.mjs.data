import { appendFileSync } from 'node:fs';
import { register } from 'node:module';
const event = (kind, code) => appendFileSync(process.env.REVIEW_EXIT_LOG, JSON.stringify({ kind, pid: process.pid, ppid: process.ppid, code, argv: process.argv }) + '\n');
event('start');
process.once('exit', code => event('exit', code));
register('./load-guard-v1.mjs', import.meta.url);
