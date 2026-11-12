import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Exit status 0 and complete output bytes captured from FFmpeg 7.0.2.
const fixtures = [
  {
    format: "yuva444p", outputFormat: "yuv444p", filter: "framerate=8:flags=0",
    input: "0b0b0b0b2020202064646464141414142525252581818181242424246d6d6d6d",
    output: "0b0b0b0b2020202064646464181818185151515144444444252525258181818124242424252525258181818124242424"
  },
  {
    format: "rgb24", filter: "framerate=8",
    input: "0b20640b20640b20640b2064142a5a142a5a142a5a142a5a",
    output: "0b20640b20640b20640b2064112460112460112460112460142a59142a59142a59142a59142a59142a59142a59142a59"
  },
  {
    format: "rgba", filter: "framerate=8",
    input: "0b2064140b2064140b2064140b206414142a5a14142a5a14142a5a14142a5a14",
    output: "0b2064ff0b2064ff0b2064ff0b2064ff112460ff112460ff112460ff112460ff142a59ff142a59ff142a59ff142a59ff142a59ff142a59ff142a59ff142a59ff"
  },
  {
    format: "yuva420p", filter: "framerate=8",
    input: "0b0b0b0b20641414141414141414345014141414",
    output: "0b0b0b0b2064ffffffff101010102a5affffffff141414143450ffffffff141414143450ffffffff"
  },
  {
    format: "rgb24", filter: "framerate=8:flags=0",
    input: "0b20640b20640b20640b2064258124258124258124258124",
    output: "0b20640b20640b20640b2064195145195145195145195145258124258124258124258124258124258124258124258124"
  },
  {
    format: "rgba", filter: "framerate=8:flags=0",
    input: "0b2064140b2064140b2064140b2064142581246d2581246d2581246d2581246d",
    output: "0b2064ff0b2064ff0b2064ff0b2064ff195145ff195145ff195145ff195145ff258124ff258124ff258124ff258124ff258124ff258124ff258124ff258124ff"
  },
  {
    format: "yuva420p", filter: "framerate=8:flags=0",
    input: "0b0b0b0b2064141414142525252581246d6d6d6d",
    output: "0b0b0b0b2064ffffffff181818185144ffffffff252525258124ffffffff252525258124ffffffff"
  },
  {
    format: "bgra", filter: "framerate=8:flags=0",
    input: "64200b1464200b1464200b1464200b142481256d2481256d2481256d2481256d",
    output: "64200bff64200bff64200bff64200bff455119ff455119ff455119ff455119ff248125ff248125ff248125ff248125ff248125ff248125ff248125ff248125ff"
  },
  {
    format: "gbrap", filter: "framerate=8:flags=0",
    input: "20202020646464640b0b0b0b141414148181818124242424252525256d6d6d6d",
    output: "20202020646464640b0b0b0bffffffff515151514545454519191919ffffffff818181812424242425252525ffffffff818181812424242425252525ffffffff"
  },
  {
    format: "ya8", filter: "framerate=8:flags=0",
    input: "0b140b140b140b14256d256d256d256d",
    output: "0bff0bff0bff0bff18ff18ff18ff18ff25ff25ff25ff25ff25ff25ff25ff25ff"
  },
  {
    format: "rgb24", filter: "fps=8",
    input: "0b20640b20640b20640b2064258124258124258124258124",
    output: "0b20640b20640b20640b20640b20640b20640b20640b2064258124258124258124258124258124258124258124258124"
  },
  {
    format: "yuv420p", filter: "framerate=8:flags=0",
    input: "0b0b0b0b2064252525258124",
    output: "0b0b0b0b2064181818185144252525258124252525258124"
  }
];

for (const fixture of fixtures) {
  for (const graph of [false, true]) {
    it(`${fixture.filter} matches native ${fixture.format} bytes (${graph ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(fixture.input, "hex") });
      const stdout: Buffer[] = [];
      let stderr = "";
      const filter = `${fixture.filter},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "rawvideo", "-pix_fmt", fixture.format, "-s", "2x2", "-r", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", fixture.outputFormat ?? fixture.format, "-bitexact", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { stdout.push(Buffer.from(data)); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), fixture.output);
      if (fixture.format === "rgba") assert.ok(stderr.includes("fmt:yuv444p"), stderr);
      if (fixture.format === "yuva420p") assert.ok(stderr.includes("fmt:yuv420p"), stderr);
    });
  }
}
