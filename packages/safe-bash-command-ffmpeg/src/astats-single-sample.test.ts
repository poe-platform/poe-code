import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 prints DBL_MAX with %f when no adjacent pair exists.
const maximum = "179769313486231570814527423731704356798070567525844996598917476803157260780028538760589558632766878171540458953514382464234321326889464182768467546703537516986049910576551282076245490090389328944075868508455133942304583236903222948165808559332123348274797826204144723168738177180919299881250404026184124858368.000000";
for (const samples of [[32767], [32767, 30000]]) {
  for (const count of [1, 2]) {
    for (const level of ["info", "error"]) {
      it(`matches native astats differences for ${samples.length} samples, ${count} channels at ${level}`, async () => {
        const channels = Array.from({ length: count }, () => Float64Array.from(samples, value => value / 32768));
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })) });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const selection = "Min_difference+Mean_difference+RMS_difference";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", level, "-guess_layout_max", "0", "-i", "/in.wav", "-af",
            `astats=measure_perchannel=${selection}:measure_overall=${selection}`, "-f", "s16le", "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = Buffer.alloc(samples.length * count * 2);
        samples.forEach((value, i) => {
          for (let channel = 0; channel < count; channel++) pcm.writeInt16LE(value, (i * count + channel) * 2);
        });
        assert.deepEqual(Buffer.concat(stdout), pcm);
        const fields = samples.length === 1
          ? `Min difference: ${maximum}\nMean difference: -nan\nRMS difference: -nan\n`
          : "Min difference: 2767.000000\nMean difference: 2767.000000\nRMS difference: 2767.000000\n";
        const sections = [...channels.map((_, i) => `Channel: ${i + 1}`), "Overall"];
        assert.equal(stderr, level === "error" ? "" : sections.map(section => `${section}\n${fields}`).join(""));
      });
    }
  }
}
