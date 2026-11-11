import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const info of [false, true]) {
  for (const explicitMapping of [false, true]) {
    it(`exports Broadcast WAV metadata with INFO=${info}, explicit mapping=${explicitMapping}`, async () => {
      const chunk = (id: string, payload: Uint8Array) => {
        const bytes = new Uint8Array(8 + payload.length + payload.length % 2);
        bytes.set(new TextEncoder().encode(id));
        new DataView(bytes.buffer).setUint32(4, payload.length, true);
        bytes.set(payload, 8);
        return bytes;
      };
      const bext = new Uint8Array(606);
      for (const [offset, value] of [[0, "TakeOne"], [256, "StudioA"], [288, "ABC"], [320, "2025-01-02"], [330, "03:04:05"], [602, "PCM"]] as const) {
        bext.set(new TextEncoder().encode(value), offset);
      }
      new DataView(bext.buffer).setBigUint64(338, 4294967301n, true);
      const plain = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
      const list = chunk("LIST", Uint8Array.of(...new TextEncoder().encode("INFO"), ...chunk("ISFT", new TextEncoder().encode("Encoder\0"))));
      const input = Uint8Array.of(...plain, ...chunk("bext", bext), ...(info ? list : []));
      new DataView(input.buffer).setUint32(4, input.length - 8, true);
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const args = ["-v", "error", "-y", "-i", "/in.wav", ...(explicitMapping ? ["-map_metadata", "0"] : []), "-f", "ffmetadata", "/out.ffmeta"];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.ffmeta", "utf8") as string;
      const tags = Object.fromEntries(output.trim().split("\n").slice(1).map(line => line.split("=")));
      assert.deepEqual(tags, {
        comment: "TakeOne", encoded_by: "StudioA", originator_reference: "ABC",
        date: "2025-01-02", coding_history: "PCM", time_reference: "4294967301",
        encoder: "Lavf61.7.100", ...(explicitMapping ? { creation_time: "03:04:05" } : {})
      });
      assert.equal(evalSyncFfmpeg(args, undefined, () => input, (_path, bytes) => {
        assert.equal(new TextDecoder().decode(bytes), output);
        return true;
      }), "");
    });
  }
}

for (const timebase of ["", "TIMEBASE=1/8000\n"]) {
  it(`exports a quarter-second FFmetadata chapter with ${timebase ? "explicit" : "default"} time base`, async () => {
    const volume = Volume.fromJSON({
      "/in.ffmeta": `;FFMETADATA1\n[CHAPTER]\n${timebase}START=0\nEND=${timebase ? 2000 : 250000000}\ntitle=Demo\n`
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-bitexact", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", "-f", "ffmetadata", "/out.ffmeta"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(volume.readFileSync("/out.ffmeta", "utf8"),
      `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/${timebase ? 8000 : 1000000000}\nSTART=0\nEND=${timebase ? 2000 : 250000000}\ntitle=Demo\n`);
  });
}
