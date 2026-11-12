import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 headers and decoded RGBA for the 24x3 input below.
const native = {
  "bgr24":{"header":[0,0,10,0,0,0,0,0,0,0,0,0,24,0,3,0,24,32],"rgba":"211180ff211180ff211180ff211180ff211180ff211180ff211180ff211180ff215280ff215280ff215280ff215280ff215280ff215280ff215280ff215280ff219380ff219380ff219380ff219380ff219380ff219380ff219380ff219380ff671168ff671168ff671168ff671168ff671168ff671168ff671168ff671168ff675268ff675268ff675268ff675268ff675268ff675268ff675268ff675268ff679368ff679368ff679368ff679368ff679368ff679368ff679368ff679368ffad1150ffad1150ffad1150ffad1150ffad1150ffad1150ffad1150ffad1150ffad5250ffad5250ffad5250ffad5250ffad5250ffad5250ffad5250ffad5250ffad9350ffad9350ffad9350ffad9350ffad9350ffad9350ffad9350ffad9350ff"},
  "bgra":{"header":[0,0,10,0,0,0,0,0,0,0,0,0,24,0,3,0,32,40],"rgba":"21118020211180202111802021118020211180202111802021118020211180202152806021528060215280602152806021528060215280602152806021528060219380a0219380a0219380a0219380a0219380a0219380a0219380a0219380a067116820671168206711682067116820671168206711682067116820671168206752686067526860675268606752686067526860675268606752686067526860679368a0679368a0679368a0679368a0679368a0679368a0679368a0679368a0ad115020ad115020ad115020ad115020ad115020ad115020ad115020ad115020ad525060ad525060ad525060ad525060ad525060ad525060ad525060ad525060ad9350a0ad9350a0ad9350a0ad9350a0ad9350a0ad9350a0ad9350a0ad9350a0"},
  "rgb555le":{"header":[0,0,10,0,0,0,0,0,0,0,0,0,24,0,3,0,16,32],"rgba":"211084ff211084ff211084ff211084ff211084ff211084ff211084ff211084ff215284ff215284ff215284ff215284ff215284ff215284ff215284ff215284ff219484ff219484ff219484ff219484ff219484ff219484ff219484ff219484ff63106bff6b106bff63106bff6b106bff63106bff6b106bff63106bff6b106bff63526bff6b526bff63526bff6b526bff63526bff6b526bff63526bff6b526bff63946bff6b946bff63946bff6b946bff63946bff6b946bff63946bff6b946bffb51052ffad1052ffb51052ffad1052ffb51052ffad1052ffb51052ffad1052ffb55252ffad5a52ffb55252ffad5a52ffb55252ffad5a52ffb55252ffad5a52ffb5944affad9c52ffb5944affad9c52ffb5944affad9c52ffb5944affad9c52ff"},
  "gray":{"header":[0,0,11,0,0,0,0,0,0,0,0,0,24,0,3,0,8,32],"rgba":"222222ff222222ff222222ff222222ff222222ff222222ff222222ff222222ff494949ff494949ff494949ff494949ff494949ff494949ff494949ff494949ff6f6f6fff6f6f6fff6f6f6fff6f6f6fff6f6f6fff6f6f6fff6f6f6fff6f6f6fff353535ff353535ff353535ff353535ff353535ff353535ff353535ff353535ff5b5b5bff5b5b5bff5b5b5bff5b5b5bff5b5b5bff5b5b5bff5b5b5bff5b5b5bff818181ff818181ff818181ff818181ff818181ff818181ff818181ff818181ff474747ff474747ff474747ff474747ff474747ff474747ff474747ff474747ff6d6d6dff6d6d6dff6d6d6dff6d6d6dff6d6d6dff6d6d6dff6d6d6dff6d6d6dff939393ff939393ff939393ff939393ff939393ff939393ff939393ff939393ff"},
  "pal8":{"header":[0,1,9,0,0,0,1,24,0,0,0,0,24,0,3,0,8,32],"rgba":"2400aaff000055ff2400aaff240055ff2400aaff000055ff2400aaff240055ff2448aaff004855ff2448aaff244855ff2448aaff004855ff2448aaff244855ff2490aaff009055ff2490aaff249055ff2490aaff009055ff2490aaff249055ff6c0055ff6c2455ff6c2455ff6c2455ff6c0055ff6c2455ff6c2455ff6c2455ff6c4855ff6c6c55ff6c4855ff6c6c55ff6c4855ff6c6c55ff6c4855ff6c6c55ff6c9055ff6c9055ff6c9055ff6c9055ff6c9055ff6c9055ff6c9055ff6c9055ffb40055ffb40055ffb40055ffb42455ffb40055ffb42455ffb40055ffb40055ffb46c55ffb44855ffb44855ffb44855ffb44855ffb44855ffb44855ffb44855ffb49055ffb49055ffb49055ffb49055ffb49055ffb49055ffb49055ffb49055ff"}
} as const;
const input = Uint8Array.from(Array.from({ length: 72 }, (_, i) => {
  const y = Math.floor(i / 24), band = Math.floor(i % 24 / 8);
  return [33 + 70 * y, 17 + 65 * band, 128 - 24 * y, 32 + 64 * band];
}).flat());

for (const format of Object.keys(native) as (keyof typeof native)[]) {
  for (const rle of [true, false]) for (const output of ["pipe:1", "/out.tga", "/out%d.tga"]) {
    it(`encodes Targa ${format}, rle=${rle}, output=${output} with native headers and samples`, async () => {
      const volume = Volume.fromJSON({ "/in.rgba": Buffer.from(input) });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "24x3", "-i", "/in.rgba",
          "-frames:v", "1", "-c:v", "targa", "-pix_fmt", format, "-rle", rle ? "1" : "0",
          "-f", output === "pipe:1" ? "image2pipe" : "image2", output],
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
      const bytes = output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output.replace("%d", "1")) as Buffer;
      const header: number[] = [...native[format].header];
      if (!rle) header[2] = header[2]! - 8;
      assert.deepEqual([...bytes.subarray(0, 18)], header);
      assert.equal(Buffer.from(decodeImage(bytes).data).toString("hex"), native[format].rgba);
    });
  }
}
