import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const scope = path.dirname(directory);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function bound(filename, expected) {
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 1048576 || await fs.realpath(filename) !== filename) throw new Error('ROUTE_INPUT_ROLE');
  const bytes = await fs.readFile(filename);
  const after = await fs.lstat(filename);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mode !== after.mode || before.mtimeMs !== after.mtimeMs || sha(bytes) !== expected) throw new Error('ROUTE_INPUT_IDENTITY');
  return bytes;
}
if (process.argv.length !== 3 || !/^[a-f0-9]{64}$/.test(process.argv[2])) throw new Error('EXACT_SOURCE_RECEIPT_REQUIRED');
await bound(path.join(directory, 'ROOT-GRANT.json'), '0430ff1a25dafbd6af130c9070c415b198109d945a9ee54faf1519a66aac3443');
const reviewBytes = await bound(path.join(directory, 'REVIEW.json'), 'a8b791e0b21df5684e054d3e9ead2cdb6363c61f50587ce0a902337e75b5d0ea');
const review = JSON.parse(reviewBytes);
await bound(path.join(scope, 'RECIPE-v5.json'), 'c2f2ba391c1578d17035338810901808a8a5f6a6f582b71df1e7954bb18eecc0');
await bound(path.join(scope, 'FINAL-SEAL-v5.json'), '05e83d63d328562280950971dccfc38176aea3472c8375ab76f2b99651237e68');
const sourceBytes = await bound(path.join(directory, 'source-observations/RESULT.json'), process.argv[2]);
const source = JSON.parse(sourceBytes);
if (source.failure !== null || source.result.status !== 'MATCH_SOURCE_DATA_ONLY' || source.result.selectedFiles !== 58 || source.result.captureRows !== 515 || source.result.newCaptureRows !== 30 || !source.allMetadataChildrenKnownRetired || source.result.recipeSha256 !== review.recipeSha256) throw new Error('SOURCE_PREFLIGHT_NOT_COMPLETE');
const originHrtimeNs = source.originHrtimeNs;
if (!/^[0-9]{1,24}$/.test(originHrtimeNs) || process.hrtime.bigint() < BigInt(originHrtimeNs) || process.hrtime.bigint() - BigInt(originHrtimeNs) > 300000000000n) throw new Error('FRESH_PREFLIGHT_ORIGIN');
const activation = path.join(directory, 'activation');
await fs.mkdir(activation, { mode: 0o700 });
const outputRoot = '/private/tmp/git-m1b-fca-independent-20260828-remaining5-' + randomBytes(8).toString('hex');
const route = {
  schema: 'm1b-root-route-v2',
  recipeSha256: review.recipeSha256,
  finalSealSha256: '05e83d63d328562280950971dccfc38176aea3472c8375ab76f2b99651237e68',
  sourceCommit: 'fca6f81d2d96db2bbceabf3247cd57ffe240bde6',
  derivedTree: '23074ef0c443ca618c4f26204b5f3d2274b86895',
  packageSha256: 'cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a',
  componentReviews: review.components.map(row => ({ ...row, commit: 'e0b385439c9aaa6c203c9fccb0540e0e8a769be1', receiptSha256: sha(reviewBytes), disposition: 'PRELAUNCH_COMPONENT_REVIEW_COMPLETE' })),
  outputRoot,
  originHrtimeNs,
  action: 'ONE_SCOPED_REVIEW'
};
const bytes = Buffer.from(JSON.stringify(route));
const filename = path.join(activation, 'ROOT-ROUTE.json');
await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
if (((await fs.lstat(filename)).mode & 0o777) !== 0o600) throw new Error('ACTUAL_ROUTE_MODE');
const notice = { outputRoot, routeFile: filename, sha256: sha(bytes), originHrtimeNs, routingProcesses: 1, sourceReceiptSha256: sha(sourceBytes), rootGrantSha256: '0430ff1a25dafbd6af130c9070c415b198109d945a9ee54faf1519a66aac3443', authority: 'USER_ROOT_ONE_REMAINING60_CONTINUATION', noRetry: true };
await fs.writeFile(path.join(activation, 'ROUTE-IDENTITY.json'), JSON.stringify(notice) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify(notice) + '\n');
