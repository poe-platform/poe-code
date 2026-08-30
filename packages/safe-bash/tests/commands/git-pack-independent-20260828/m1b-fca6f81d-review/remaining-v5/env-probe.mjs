import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

process.stdout.write(JSON.stringify({ role: 'HARMLESS_PREADMISSION_START', pid: process.pid, compilerLoaded: false, productLoaded: false }) + '\n');
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--request' || args[2] !== '--sha256') throw new Error('PROBE_ARGV');
const bytes = await fs.readFile(args[1]);
if (createHash('sha256').update(bytes).digest('hex') !== args[3]) throw new Error('PROBE_REQUEST');
const request = JSON.parse(bytes);
const expected = { PATH: request.toolsRoot + '/bin', HOME: request.caseRoot, TMPDIR: request.caseRoot, TZ: 'UTC', LANG: 'C', LC_ALL: 'C', UV_THREADPOOL_SIZE: '1' };
const keys = Object.keys(process.env);
if (keys.length > 32 || keys.some(key => key.length > 256)) throw new Error('PROBE_ENV_KEY_BOUND');
const uid = typeof process.getuid === 'function' ? process.getuid() : null;
const facts = keys.map(key => ({
  key,
  declared: Object.hasOwn(expected, key),
  equalsExpected: Object.hasOwn(expected, key) ? process.env[key] === expected[key] : null,
  value: 'REDACTED',
  matchesDarwinUidTextEncoding: key === '__CF_USER_TEXT_ENCODING' && process.platform === 'darwin' && Number.isSafeInteger(uid) ? process.env[key] === `0x${uid.toString(16).toUpperCase()}:0x0:0x0` : null
}));
process.stdout.write(JSON.stringify({ role: 'HARMLESS_PREADMISSION_ENVIRONMENT', executable: process.execPath, argv: process.argv.slice(1), cwd: process.cwd(), platform: process.platform, uid, expectedKeys: Object.keys(expected), keys, facts, missingExpectedKeys: Object.keys(expected).filter(key => !Object.hasOwn(process.env, key)), compilerLoaded: false, productLoaded: false }) + '\n');
