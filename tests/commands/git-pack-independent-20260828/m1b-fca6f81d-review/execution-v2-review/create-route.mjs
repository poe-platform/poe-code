import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const scope = path.dirname(directory);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const reviewBytes = await fs.readFile(path.join(directory, 'RECEIPT.json'));
if (sha(reviewBytes) !== '870501472d1d8d89ebab40835ca45b3bb354cff2414f661289e58e8689cad969') throw new Error('REVIEW_IDENTITY');
const review = JSON.parse(reviewBytes);
for (const [name, expected] of [['RECIPE-v2.json', review.recipeSha256], ['FINAL-SEAL-v2.json', review.finalSealSha256]]) {
  if (sha(await fs.readFile(path.join(scope, name))) !== expected) throw new Error('PRESEAL_IDENTITY');
}
const activation = path.join(directory, 'activation');
await fs.mkdir(activation, { mode: 0o700 });
const outputRoot = '/private/tmp/git-m1b-fca-independent-20260828-' + randomBytes(8).toString('hex');
const originHrtimeNs = process.hrtime.bigint().toString();
const route = {
  schema: 'm1b-root-route-v2',
  recipeSha256: review.recipeSha256,
  finalSealSha256: review.finalSealSha256,
  sourceCommit: 'fca6f81d2d96db2bbceabf3247cd57ffe240bde6',
  derivedTree: '23074ef0c443ca618c4f26204b5f3d2274b86895',
  packageSha256: 'cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a',
  componentReviews: review.components.map(row => ({ ...row, commit: '7419015eaab74396c44015e061df7f10cd26251c', receiptSha256: sha(reviewBytes), disposition: 'PRELAUNCH_COMPONENT_REVIEW_COMPLETE' })),
  outputRoot,
  originHrtimeNs,
  action: 'ONE_SCOPED_REVIEW'
};
const bytes = Buffer.from(JSON.stringify(route));
const filename = path.join(activation, 'ROOT-ROUTE.json');
await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
await fs.chmod(filename, 0o600);
const notice = { outputRoot, routeFile: filename, sha256: sha(bytes), originHrtimeNs, routingProcesses: 1, authority: 'USER_CONDITIONAL_ONE_REVIEW_AFTER_COMMITTED_PRESEAL', noRetry: true };
await fs.writeFile(path.join(activation, 'ROUTE-IDENTITY.json'), JSON.stringify(notice) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify(notice) + '\n');
