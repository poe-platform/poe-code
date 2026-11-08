import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { memoryObserver } from "./memory.mjs";

const memory = memoryObserver();
memory.sample("fresh-launch-after-builtin-and-observer-imports");
const expectedBytes = 1073872896;
const expectedSha256 = "f5b4c8bf0f2f882ef51effdb305a5edf1c8c657d05ba2fd7594c679478fe668f";
const fixture = new URL("../../html-public-independent-20260827/admission-v2/stream-fixture.mjs", import.meta.url).pathname;
const core = new URL("../../html-public-independent-20260827/admission-v2/core.mjs", import.meta.url);
const observer = new URL("./producer-observer.mjs", import.meta.url).pathname;
const originalSpawn = childProcess.spawn;
const transport = { spawnCount: 0, producerReadFragments: 0, producerReadBytes: 0, minimumReadFragmentBytes: null, maximumReadFragmentBytes: 0, maximumReadableLength: 0, maximumPendingIteratorNext: 0, closeObserved: false };
const consumer = { chunks: 0, bytes: 0, minimumChunkBytes: null, maximumChunkBytes: 0, pending: 0, maximumPending: 0 };
let child, iteratorPending = 0;
childProcess.spawn = function (executable, args, options) {
  transport.spawnCount++;
  if (transport.spawnCount !== 1 || executable !== process.execPath || JSON.stringify(args) !== JSON.stringify(["--max-old-space-size=96", fixture, String(expectedBytes)])) throw new Error("unexpected producer invocation");
  const observedArgs = [args[0], "--import", observer, ...args.slice(1)];
  child = Reflect.apply(originalSpawn, this, [executable, observedArgs, options]);
  transport.pid = child.pid;
  transport.originalArgv = [executable, ...args];
  transport.observedArgv = [executable, ...observedArgs];
  transport.readableHighWaterMark = child.stdout.readableHighWaterMark;
  const source = child.stdout;
  const originalIterator = source[Symbol.asyncIterator];
  source[Symbol.asyncIterator] = function (...iteratorArgs) {
    const iterator = Reflect.apply(originalIterator, this, iteratorArgs);
    return {
      [Symbol.asyncIterator]() { return this; },
      async next(...nextArgs) {
        iteratorPending++;
        transport.maximumPendingIteratorNext = Math.max(transport.maximumPendingIteratorNext, iteratorPending);
        transport.maximumReadableLength = Math.max(transport.maximumReadableLength, source.readableLength);
        try {
          const result = await iterator.next(...nextArgs);
          transport.maximumReadableLength = Math.max(transport.maximumReadableLength, source.readableLength);
          if (!result.done) {
            const bytes = result.value.byteLength;
            transport.producerReadFragments++;
            transport.producerReadBytes += bytes;
            transport.minimumReadFragmentBytes = Math.min(transport.minimumReadFragmentBytes ?? bytes, bytes);
            transport.maximumReadFragmentBytes = Math.max(transport.maximumReadFragmentBytes, bytes);
          }
          return result;
        } finally { iteratorPending--; }
      },
      return(...returnArgs) { return iterator.return(...returnArgs); },
      throw(...throwArgs) { return iterator.throw(...throwArgs); }
    };
  };
  child.once("close", (code, signal) => { Object.assign(transport, { closeObserved: true, code, signal, readableLengthAtClose: source.readableLength, destroyedAtClose: source.destroyed }); });
  return child;
};
syncBuiltinESMExports();
const { hashProcess, limits } = await import(core);
memory.sample("after-authenticated-core-import-and-observer-setup");
let result, error;
try {
  memory.sample("before-stream");
  result = await hashProcess(process.execPath, ["--max-old-space-size=96", fixture, String(expectedBytes)], {}, {
    expectedBytes,
    expectedSha256,
    consume: async bytes => {
      consumer.pending++;
      consumer.maximumPending = Math.max(consumer.maximumPending, consumer.pending);
      consumer.chunks++;
      consumer.bytes += bytes.byteLength;
      consumer.minimumChunkBytes = Math.min(consumer.minimumChunkBytes ?? bytes.byteLength, bytes.byteLength);
      consumer.maximumChunkBytes = Math.max(consumer.maximumChunkBytes, bytes.byteLength);
      await setImmediate();
      transport.maximumReadableLength = Math.max(transport.maximumReadableLength, child.stdout.readableLength);
      consumer.pending--;
      if (consumer.chunks % 256 === 0) memory.sample();
    }
  });
} catch (caught) {
  error = { name: caught.name, message: caught.message, stack: caught.stack, code: caught.code, process: caught.process };
} finally {
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
}
memory.sample("after-settled-stream");
const report = { at: new Date().toISOString(), pid: process.pid, ppid: process.ppid, node: process.version, execArgv: process.execArgv, expectedBytes, expectedSha256, limits, result, error, memory: memory.report(), consumer, transport: { ...transport, iteratorPendingAtEnd: iteratorPending }, diagnostic: { thresholdBytes: 256 * 1024 ** 2, operator: "<", nativeMaxRssBytes: result?.maxRssBytes ?? null, below256MiB: result ? result.maxRssBytes < 256 * 1024 ** 2 : null, acceptanceRun: false, actual34: 0 }, limitations: "Fresh process without binding/tree/inventory/prefix controls; no reconstruction of historical baseline. Consumer current RSS excludes producer RSS. Stream implementation and fixture bytes unchanged; observational iterator wrapper adds async scheduling and producer preload adds measurements. Every256 consumer chunks plus phase snapshots; no continuous peak guarantee or forced GC. No stream chunks retained by observers." };
writeFileSync(process.env.HTML74_RESULT, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ resultRecorded: true, error: error?.message ?? null, diagnostic: report.diagnostic }));
if (error) process.exitCode = 1;
