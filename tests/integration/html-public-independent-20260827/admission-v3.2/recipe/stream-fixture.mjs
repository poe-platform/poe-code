import { once } from "node:events";
const bytes = Number(process.argv[2]);
if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 3 * 1024 ** 3) throw new Error("fixture size");
const chunk = Buffer.alloc(65536, 0x61);
let emitted = 0, drains = 0;
while (emitted < bytes) {
  const part = chunk.subarray(0, Math.min(chunk.length, bytes - emitted));
  if (!process.stdout.write(part)) { drains++; await once(process.stdout, "drain"); }
  emitted += part.length;
}
process.stderr.write(`${JSON.stringify({ emitted, drains })}\n`);
process.exitCode = Number(process.argv[3] ?? 0);
