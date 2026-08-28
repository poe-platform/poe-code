import { once } from "node:events";
const [mode, size] = process.argv.slice(2);
const bytes = Number(size), chunk = Buffer.alloc(65536, 97);
for (let offset = 0; offset < bytes; offset += chunk.length) if (!process.stdout.write(chunk.subarray(0, Math.min(chunk.length, bytes - offset)))) await once(process.stdout, "drain");
if (mode === "bad-exit") process.exitCode = 7;
if (mode === "hang") setInterval(() => {}, 1000);
