export const faultModes = ['wrong-id', 'wrong-operation', 'wrong-count', 'out-of-range-span', 'fractional-span', 'extra-key', 'late-reply', 'positive'];
export function workerSource(entryURL, ledgerURL, mode) {
  if (mode !== 'checkpoint' && !faultModes.includes(mode)) throw new Error('fixed wrapper mode');
  if (!entryURL.startsWith('file:///private/tmp/') || !ledgerURL.startsWith('file:///private/tmp/')) throw new Error('private literal import');
  return `import { parentPort } from 'node:worker_threads';
import { EreLedger } from ${JSON.stringify(ledgerURL)};
const mode = ${JSON.stringify(mode)};
const originalPost = parentPort.postMessage.bind(parentPort);
let replies = 0;
if (mode === 'checkpoint') {
  const subjects = new WeakSet();
  const admit = EreLedger.prototype.admitInput;
  const checkpoint = EreLedger.prototype.checkpoint;
  let witnessed = false;
  EreLedger.prototype.admitInput = function(...args) {
    const result = Reflect.apply(admit, this, args);
    if (args[0] === 'subjectBytes') subjects.add(this);
    return result;
  };
  EreLedger.prototype.checkpoint = async function(...args) {
    await Reflect.apply(checkpoint, this, args);
    if (subjects.has(this) && !witnessed) {
      witnessed = true;
      originalPost({ core70: 4, kind: 'matcher-checkpoint', ordinal: 1 });
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };
} else {
  parentPort.postMessage = function(message, ...rest) {
    if (message.kind !== 'result') return originalPost(message, ...rest);
    if (++replies > 2) throw new Error('fixed fault reply cap');
    const copy = { ...message, result: { ...message.result, spans: message.result.spans.map(span => span === null ? null : { ...span }) }, usage: { ...message.usage } };
    if (mode === 'wrong-id') copy.id++;
    if (mode === 'wrong-operation') copy.operation = 'not-shell-ere';
    if (mode === 'wrong-count') copy.result.groupCount++;
    if (mode === 'out-of-range-span') copy.result.spans[0].end = 1000;
    if (mode === 'fractional-span') copy.result.spans[0].start = 0.5;
    if (mode === 'extra-key') copy.extra = true;
    originalPost(copy, ...rest);
    if (mode === 'late-reply') originalPost(copy, ...rest);
  };
}
await import(${JSON.stringify(entryURL)});
`;
}
