import { writeFileSync } from "node:fs";
import { memoryObserver } from "./memory.mjs";

const memory = memoryObserver();
memory.sample("fresh-launch-after-observer-builtin-imports");
const output = process.stdout;
const originalWrite = output.write;
const metrics = { writes: 0, bytes: 0, minimumFragmentBytes: null, maximumFragmentBytes: 0, falseWrites: 0, drains: 0, maximumWritableLength: 0, maximumPendingDrain: 0, writableHighWaterMark: output.writableHighWaterMark };
let pendingDrain = 0;
output.on("drain", () => { metrics.drains++; pendingDrain = 0; });
output.write = function (...args) {
  if (metrics.writes === 0) memory.sample("before-first-write-after-authenticated-fixture-allocation");
  const bytes = args[0].byteLength;
  metrics.writes++;
  metrics.bytes += bytes;
  metrics.minimumFragmentBytes = Math.min(metrics.minimumFragmentBytes ?? bytes, bytes);
  metrics.maximumFragmentBytes = Math.max(metrics.maximumFragmentBytes, bytes);
  metrics.maximumWritableLength = Math.max(metrics.maximumWritableLength, output.writableLength);
  const accepted = Reflect.apply(originalWrite, this, args);
  if (!accepted) { metrics.falseWrites++; pendingDrain++; }
  metrics.maximumPendingDrain = Math.max(metrics.maximumPendingDrain, pendingDrain);
  metrics.maximumWritableLength = Math.max(metrics.maximumWritableLength, output.writableLength);
  if (metrics.writes % 256 === 0) memory.sample();
  return accepted;
};
memory.sample("after-observer-setup-before-fixture-import");
process.once("beforeExit", code => {
  memory.sample("after-settled-producer-before-natural-exit");
  output.write = originalWrite;
  writeFileSync(process.env.HTML74_PRODUCER_TELEMETRY, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ppid: process.ppid, argv: process.argv, execArgv: process.execArgv, memory: memory.report(), metrics: { ...metrics, pendingDrainAtEnd: pendingDrain, writableLengthAtEnd: output.writableLength, writableNeedDrainAtEnd: output.writableNeedDrain }, beforeExitCode: code, limitations: "No callbacks added; write fragments forwarded unchanged. writableLength is observable Node queue length, not kernel pipe occupancy. Pending-drain count is not outstanding native write-request count. No retained byte chunks. Sampling every256 writes plus phases misses intervening peaks." }, null, 2)}\n`, { flag: "wx" });
});
