import { once } from "node:events";

const [mode, declared] = process.argv.slice(2);
const total = Number(declared);
if (!Number.isSafeInteger(total) || total < 0) throw new Error("invalid fixture length");
const chunk = Buffer.alloc(65536, 97);
if (mode === "hang") await new Promise(() => { setInterval(() => {}, 1000); });
for (let offset = 0; offset < total; offset += chunk.length) {
  if (!process.stdout.write(chunk.subarray(0, Math.min(chunk.length, total - offset)))) await once(process.stdout, "drain");
}
process.exitCode = mode === "exit" ? 7 : 0;
