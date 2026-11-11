import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 PCM streams for a mono PCM16 ramp remixed before amultiply.
for (const [branch, format, expected] of [
  ["volume=0.971", "f32le", "8aa0273a8aa027ba8aa0273b8aa027bb9c94bc3b9c94bcbb8aa0273c8aa027bc6df5823c6df582bc9c94bc3c9c94bcbcea56003dea5600bd8aa0273d8aa027bd3027543d302754bd6df5823d6df582bdc3759e3dc3759ebd9c94bc3d9c94bcbd"],
  ["anull", "f64le", "000040804594453f00004080459445bf000040804594653f00004080459465bf0000003cce46783f0000003cce4678bf000040804594853f00004080459485bf0000d85ad6db903f0000d85ad6db90bf0000003cce46983f0000003cce4698bf000048478585a03f000048478585a0bf000040804594a53f000040804594a5bf00008003a84fab3f00008003a84fabbf0000d85ad6dbb03f0000d85ad6dbb0bf0000ecb52966b43f0000ecb52966b4bf0000003cce46b83f0000003cce46b8bf"],
  ["volume=0.971:precision=double", "f32le", "8ba0273a8ba027ba8ba0273b8ba027bb9c94bc3b9c94bcbb8ba0273c8ba027bc6df5823c6df582bc9c94bc3c9c94bcbcea56003dea5600bd8ba0273d8ba027bd3027543d302754bd6df5823d6df582bdc3759e3dc3759ebd9c94bc3d9c94bcbd"],
  ["anull", "s16le", "1600eaff5600aaffc2003eff5901a7fe1b02e5fd0903f7fc2104dffb65059bfad4062cf96e0892f7330acdf5230cddf3"]
]) {
  it(`amultiply remixes ${branch} at input precision before ${format} output`, async () => {
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 12 }, (_, i) => (i + 1) * 1000 / 32768)] })) });
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `[0:a]asplit[x][y];[x]pan=stereo|c0=c0|c1=-1*c0[a];[y]${branch}[b];[a][b]amultiply,anull[o]`,
        "-map", "[o]", "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
  });
}
