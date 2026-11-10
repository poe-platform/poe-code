import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(72 * 4);
for (let i = 0; i < 72; i++) {
  input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
  input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
}

// Native FFmpeg 7.0.2 hashes for dry, time-gated, and fully widened PCM16 output.
for (const [filter, hash] of [
  ["asendcmd=c=0 stereowiden@w enable 0,stereowiden@w=delay=1", "25e58d6b487c539be75ca5170556cae39d310ac4ce1666620fe2783c9d5dfe13"],
  ["asendcmd=c=0.003 stereowiden@w enable 0,stereowiden@w=delay=1", "bce32a9ff6b52fee2cc71bff3f11cfc967238d5282ed7ba8edc3f9abe9f30b43"],
  ["asendcmd=c=0.0025 stereowiden@w enable 0,stereowiden@w=delay=1", "bce32a9ff6b52fee2cc71bff3f11cfc967238d5282ed7ba8edc3f9abe9f30b43"],
  ["asendcmd=c=0.003 stereowiden enable 0,stereowiden@w=delay=1", "bce32a9ff6b52fee2cc71bff3f11cfc967238d5282ed7ba8edc3f9abe9f30b43"],
  ["asendcmd=c=0 stereowiden@w enable lt(t\\,0.003),stereowiden@w=delay=1", "bce32a9ff6b52fee2cc71bff3f11cfc967238d5282ed7ba8edc3f9abe9f30b43"],
  ["asendcmd=c=0 stereowiden@w enable 1,stereowiden@w=delay=1:enable=0", "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a"],
  ["asendcmd=c='0 stereowiden@w enable 0;0.003 stereowiden@w enable invalid',stereowiden@w=delay=1", "25e58d6b487c539be75ca5170556cae39d310ac4ce1666620fe2783c9d5dfe13"],
  ["asendcmd=c=0 stereowiden@other enable 0,stereowiden@w=delay=1", "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a"],
  ["asendcmd=c=0.003 stereowiden@w enable 0,stereowiden@other=feedback=0:crossfeed=0:drymix=1,stereowiden@w=delay=1", "bce32a9ff6b52fee2cc71bff3f11cfc967238d5282ed7ba8edc3f9abe9f30b43"],
  ["anull", "25e58d6b487c539be75ca5170556cae39d310ac4ce1666620fe2783c9d5dfe13"],
  ["stereowiden=delay=1:enable=lt(t\\,0.003)", "bce32a9ff6b52fee2cc71bff3f11cfc967238d5282ed7ba8edc3f9abe9f30b43"],
  ["asendcmd=c=0.003 stereowiden@other feedback 0,stereowiden@w=delay=1", "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a"]
] as const) {
  for (const graph of [false, true]) {
    it(`stereowiden enable commands match native: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const chain = `asetnsamples=n=8:p=0,${filter}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", ...(graph
          ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, input.length);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
