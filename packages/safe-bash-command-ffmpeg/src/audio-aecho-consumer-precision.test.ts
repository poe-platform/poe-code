import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 PCM32 outputs, including the four-sample echo tail.
const echo = "aecho=0.67:0.83:0.25|0.5:0.24|0.35";
for (const [consumer, defaultFormat, floating, double, integer] of [
  ["", "s16p",
    [-1020484416, -692556160, -803136576, -357449952, -580467328, 36629532, 503141792, 1120099328, 305213472, 594138368, 361783040, 533088832],
    [-1020484398, -692556159, -803136582, -357449960, -580467320, 36629529, 503141771, 1120099369, 305213467, 594138388, 361783053, 533088842],
    [-1020461056, -692518912, -803078144, -357433344, -580452352, 36569088, 503119872, 1120075776, 305201152, 594083840, 361758720, 533069824]
  ],
  ["asoftclip=type=hard", "fltp",
    [-1020484416, -692556160, -803136576, -357449952, -580467328, 36629532, 503141792, 1120099328, 305213472, 594138368, 361783040, 533088832],
    [-1020484398, -692556159, -803136582, -357449960, -580467320, 36629529, 503141771, 1120099369, 305213467, 594138388, 361783053, 533088842],
    [-1020461056, -692518912, -803078144, -357433344, -580452352, 36569088, 503119872, 1120075776, 305201152, 594083840, 361758720, 533069824]
  ],
  ["aphaseshift", "fltp",
    [-1375482, -933477, 58995588, 40290472, -347123872, -246041328, 420680032, 333559808, 269448704, 175743488, 217459168, 136603680],
    [-1375482, -933477, 58995581, 40290470, -347123880, -246041319, 420679943, 333559805, 269448686, 175743448, 217459054, 136603685],
    [-1375450, -933427, 58994280, 40288300, -347118368, -246028032, 420685568, 333544320, 269416384, 175711072, 217450304, 136651680]
  ],
  ["aemphasis", "dblp",
    [-589046059, -955824733, -745393257, -606062095, -466077063, -274535639, 353336822, 913557231, 732666871, 430260515, 515133483, 463354077],
    [-589046048, -955824723, -745393262, -606062103, -466077062, -274535635, 353336808, 913557244, 732666893, 430260519, 515133503, 463354087],
    [-589032575, -955790504, -745341420, -606023540, -466064013, -274562714, 353289968, 913537487, 732647632, 430223922, 515091148, 463333761]
  ],
  ["asubboost", "dblp",
    [-1020484442, -692556398, -803137416, -357451889, -580470878, 36623910, 503133912, 1120089529, 305202455, 594126800, 361771547, 533078085],
    [-1020484425, -692556397, -803137422, -357451897, -580470869, 36623908, 503133892, 1120089571, 305202449, 594126820, 361771560, 533078095],
    [-1020461082, -692519150, -803078984, -357435281, -580455902, 36563467, 503111993, 1120065978, 305190135, 594072273, 361747227, 533059077]
  ]
] as const) {
  for (const [prefix, middle, format] of [
    ["", "", defaultFormat],
    ["aformat=sample_fmts=fltp,", "", "fltp"],
    ["aformat=sample_fmts=dblp,", "", "dblp"],
    ["aformat=sample_fmts=s16p,", "", "s16p"],
    ["", ",aformat=sample_fmts=s16p", "s16p"],
    ["", ",aformat=sample_fmts=dblp", "dblp"]
  ] as const) {
    const filter = `${prefix}${echo}${middle}${consumer ? `,${consumer}` : ""}`;
    for (const graph of [false, true]) {
      it(`negotiates echo PCM32 for ${filter} (graph=${graph})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from([-28001, -19003, -12007, -3001, 3001, 12007, 19003, 28001], sample => sample / 32768)
        ] }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s32le", "/out.pcm"],
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
        const pcm = fs.readFileSync("/out.pcm") as Buffer;
        assert.deepEqual(Array.from({ length: pcm.length / 4 }, (_, index) => pcm.readInt32LE(index * 4)),
          format === "fltp" ? floating : format === "dblp" ? double : integer);
      });
    }
  }
}
