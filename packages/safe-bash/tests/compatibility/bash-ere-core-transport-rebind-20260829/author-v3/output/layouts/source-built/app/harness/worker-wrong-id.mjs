import { parentPort } from 'node:worker_threads';
import { EreLedger } from "file:///private/tmp/safe-bash-core70-v4-20260829/apps/source-built/app/package/dist/commands/regex-execution/ere/limits.js";
const mode = "wrong-id";
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
await import("file:///private/tmp/safe-bash-core70-v4-20260829/apps/source-built/app/package/dist/commands/regex-execution/ere/transport/worker-entry.js");
