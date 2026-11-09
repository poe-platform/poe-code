import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Independent G.711 PCM16 reference from Python audioop.ulaw2lin(bytes(range(256)), 2).
const pcm = Buffer.from(
  "84828486848a848e84928496849a849e84a284a684aa84ae84b284b684ba84be84c184c384c584c784c984cb84cd84cf84d184d384d584d784d984db84dd84df" +
  "04e104e204e304e404e504e604e704e804e904ea04eb04ec04ed04ee04ef04f0c4f044f1c4f144f2c4f244f3c4f344f4c4f444f5c4f544f6c4f644f7c4f744f8" +
  "a4f8e4f824f964f9a4f9e4f924fa64faa4fae4fa24fb64fba4fbe4fb24fc64fc94fcb4fcd4fcf4fc14fd34fd54fd74fd94fdb4fdd4fdf4fd14fe34fe54fe74fe" +
  "8cfe9cfeacfebcfeccfedcfeecfefcfe0cff1cff2cff3cff4cff5cff6cff7cff88ff90ff98ffa0ffa8ffb0ffb8ffc0ffc8ffd0ffd8ffe0ffe8fff0fff8ff0000" +
  "7c7d7c797c757c717c6d7c697c657c617c5d7c597c557c517c4d7c497c457c417c3e7c3c7c3a7c387c367c347c327c307c2e7c2c7c2a7c287c267c247c227c20" +
  "fc1efc1dfc1cfc1bfc1afc19fc18fc17fc16fc15fc14fc13fc12fc11fc10fc0f3c0fbc0e3c0ebc0d3c0dbc0c3c0cbc0b3c0bbc0a3c0abc093c09bc083c08bc07" +
  "5c071c07dc069c065c061c06dc059c055c051c05dc049c045c041c04dc039c036c034c032c030c03ec02cc02ac028c026c024c022c020c02ec01cc01ac018c01" +
  "74016401540144013401240114010401f400e400d400c400b400a400940084007800700068006000580050004800400038003000280020001800100008000000", "hex");

for (const [name, codes, samples] of [
  ["zero and adjacent codewords", Buffer.from("7ffffe7e", "hex"), Buffer.from("000000000800f8ff", "hex")],
  ["all 256 codewords", Buffer.from(Array.from({ length: 256 }, (_, code) => code)), pcm]
] as const) {
  for (const codec of ["pcm_f32be", "pcm_f64be", "pcm_s16be", "copy"]) {
    for (const mode of ["async file", "async stdin", "sync file"]) {
      it(`converts mu-law AU ${name} to ${codec} (${mode})`, async () => {
        const header = Buffer.from("2e736e6400000018000000000000000100001f4000000001", "hex");
        header.writeUInt32BE(codes.length, 8);
        const input = Buffer.concat([header, codes]);
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.au", input);
        const args = ["-v", "error", "-y", "-i", mode === "async stdin" ? "pipe:0" : "/in.au",
          "-c:a", codec, "-f", "au", "/out.au"];
        if (mode === "sync file") {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () { if (mode === "async stdin") yield input; })(),
            stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const output = volume.readFileSync("/out.au") as Buffer;
        const payload = output.subarray(output.readUInt32BE(4));
        const width = codec === "pcm_f64be" ? 8 : codec === "pcm_f32be" ? 4 : 2;
        const expected = codec === "copy" ? codes : Buffer.alloc(codes.length * width);
        if (codec !== "copy") {
          for (let i = 0; i < codes.length; i++) {
            const sample = samples.readInt16LE(i * 2);
            if (codec === "pcm_f64be") expected.writeDoubleBE(sample / 32768, i * width);
            else if (codec === "pcm_f32be") expected.writeFloatBE(sample / 32768, i * width);
            else expected.writeInt16BE(sample, i * width);
          }
        }
        assert.deepEqual(payload, expected);
      });
    }
  }
}
