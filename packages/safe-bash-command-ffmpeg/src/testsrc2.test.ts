import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static SHA-256 hashes of individual packed RGB24 / planar YUV420P frames.
const cases = [
  [
    "testsrc2=s=64x48:r=2:d=1",
    "rgb24",
    64,
    48,
    [
      "e15139d9c381734c4ea3669545720c12c34efdb7542f406fd9120bd9f1482617",
      "a967991b5a1edefb66394a0f25455e8f982f4314c1b2e5b266eec7b522b885d3"
    ]
  ],
  [
    "testsrc2=s=64x48:r=2:d=1",
    "yuv420p",
    64,
    48,
    [
      "8f8084cba39d8738fa969b8df57f7d6419161eab82cd8f1a3d87a347c27ed4f3",
      "bf3765caa3b5d61f45d1d953f503c29eb646e5306010563475ec7f01eacd31a9"
    ]
  ],
  [
    "testsrc2=s=16x16:r=2:d=1",
    "rgb24",
    16,
    16,
    [
      "ae7336b465b1e62c44cbff1edf83e31199a5b740a1bcfeee9f7b16a09b776141",
      "fb0f7a1ca5b58be19b0b7f5eaaa8d409aaf907eaef775db645c75c7b330aa36e"
    ]
  ],
  [
    "testsrc2=s=16x16:r=2:d=1",
    "yuv420p",
    16,
    16,
    [
      "7496a5837480a949a4342dc0c41f2ea8091d62935b9cebb76eb76a3f84e1cba4",
      "a5aad829870d90b1d82c369de63e01bbd45eba9dbb4093b977aaddf76be61cc6"
    ]
  ],
  [
    "testsrc2=s=128x96:r=2:d=2",
    "rgb24",
    128,
    96,
    [
      "982962e0fbe57d59275cdd38bd5b80f0737243b2f9ab7f7f9b45dc0cd1406b12",
      "49401f958d22aec41a6d514d56db590364e9ae5efd48fc3f12930695ff6da410",
      "fd265a1bfa6b62fa3381349d119ca9866c3fe034dc72b985deda7a71cf640d23",
      "bcc88392fb8897fe0149f80be1d7369c55fa8bc01cb20f4bed2e42f5bdfff71f"
    ]
  ],
  [
    "testsrc2=s=128x96:r=2:d=2",
    "yuv420p",
    128,
    96,
    [
      "56e52afa30e34107ac278d2cf3e53a4ca3b7e05d547b14df39719905582ea530",
      "9bc507ba3c4d3c5b1fc45a541466313a0b6d2a1b2640a6f133f89f9c45b6f02f",
      "e3022820c5962386902c9bd6f33518fa38629212744dffc6515560add49615ef",
      "e650a458c14dc32f0011435826c3acc8b68ed5d472a9d16ec3ecb765cb3a2d67"
    ]
  ],
  [
    "testsrc2=s=320x240:r=3/2:d=2",
    "rgb24",
    320,
    240,
    [
      "091e229ee0bdd400d91f6821e123b4c3441ef5ee5193bf2a2287c4d5f5e5c1c7",
      "3550c3de4a592838f20818ab808573de3ee20c292ae7b53c4352c16281975844",
      "b74c059cb60ad0ce9c6759b85fe9a89b47665576179b76b5594a9ee1743be3b2"
    ]
  ],
  [
    "testsrc2=s=320x240:r=3/2:d=2",
    "yuv420p",
    320,
    240,
    [
      "77781814e080bb04a95db0c0dc4bda0dceceed30f3a2903fce46fb4b3be78f76",
      "6768001a0f89c41fe56ad447b2269553ce7db9b8ff15c4749256849ba7fbd5ab",
      "5c485080ea5ecba76e23beab0bcd1759e399c8d62b6ce354b27ba320d8fdd827"
    ]
  ],
  [
    "testsrc2=s=97x65:r=2:d=1",
    "rgb24",
    96,
    64,
    [
      "9a0d6ed5d6707b3482fee50051063ba22924312ac575df7620acb8b97ca422c1",
      "b675c10dd79b9edcfbad534c7bb6ad07c7ea1c984c5b528a8717fdaf661a229d"
    ]
  ],
  [
    "testsrc2=s=97x65:r=2:d=1",
    "yuv420p",
    96,
    64,
    [
      "2ce3de1aff5fff2a3d4ecc9952ac073310bab78671df68068e659d7356486610",
      "7363ba58c373a45b06677b850de0f13eb7a7071b1a4f352c616e14ecf63388b8"
    ]
  ],
  [
    "testsrc=s=64x48:r=2:d=1",
    "rgb24",
    64,
    48,
    [
      "7cf4233ef373a8fbe4a88ad0a0dbc6c303e0a5080d36d2a74c8229e9f2899155",
      "dafa692ce87a2bbea8158e9f47975f590fb0a45d0be1ea641066693b0fa3c32c"
    ]
  ],
  [
    "testsrc2=s=146x110:r=1:d=8",
    "rgb24",
    146,
    110,
    [
      "5520e51d570b3e8ce0b84cdf0d4c5ec1e3bcbd21ee566e534b46394a8882392f",
      "c7659c8651c928291a19b8bc9162ae951c50d3249d6b74e959dcf7f5458c20ec",
      "73c5c7d2190374868d7195300de988334caee3a15418345fd53c43847d117bf9",
      "b7b4435dcaeec748fbcd92698b89bc142e27670117a8cbc153ba9cd97f855732",
      "33516ffef4c9ce6cfa7de41963150e8f1759ecab47d51adcb4ffadc22a92f77f",
      "b2e9ad0cec5f1ed89ba20dc49e1807d294532bbc4be0e8cb5ed9d26e273b6441",
      "d7fe42dac017ca86aa273d72ea41d6f7d6a3e7d96425c100c6554ad329430b2a",
      "7a8b357e37126982f09910b79d76ed7299698746b99df45834b4d3a4aad4b6e3"
    ]
  ],
  [
    "testsrc2=s=146x110:r=1:d=8",
    "yuv420p",
    146,
    110,
    [
      "e9ee67ed81ef74a65e69bbe8392856fde03fa1fd38d18794f7717a75aaba531b",
      "c9bb8462b2ee99c923476b966256ee769895da2026c0d4eb2624c2bf29db3058",
      "bfa937657002056072764f725ea7fc496bdc265ffda53fa697b49766908b0336",
      "d0043a897ccba57fc49fb3a73628148666d8312076860bc2e6fb78f9da283199",
      "510d9dbc41141656c4a69206d8b817f6c51e9e66739b2add2b9848b5b459d85a",
      "e4d75bbf512a55309e70daea2af9ea2ca14939522832b3eb7acd4fe43cec1283",
      "c7046c9e4ddd6ea7ada19e6386eb6dcf5ff28995b38f7782ff2eeb1fd4145995",
      "b64ff9644ee32b71ee5d8b8f7b4182291f4e59c154b21034f936c1eba6aeec32"
    ]
  ],
  [
    "testsrc2=s=2x2:r=1:d=1",
    "rgb24",
    2,
    2,
    [
      "455116da04287975a721ed95afa8b3c6b4f0d9ea7d8841061c58147cba4cafb4"
    ]
  ],
  [
    "testsrc2=s=2x2:r=1:d=1",
    "yuv420p",
    2,
    2,
    [
      "d44b96b03d78a1e07189e53c25f33081c71e8e6f0f1a4a08baba346f12f9d9ef"
    ]
  ]
] as const;

for (const [source, format, width, height, hashes] of cases) {
  it(`renders native calibration frames for ${source} as ${format}`, async () => {
    const volume = Volume.fromJSON({});
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "lavfi", "-i", source, "-c:v", "rawvideo",
        "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const bytes = Buffer.concat(output);
    const frameSize = width * height * (format === "rgb24" ? 3 : 1.5);
    assert.equal(bytes.length, hashes.length * frameSize);
    assert.deepEqual(hashes.map((_, frame) => createHash("sha256")
      .update(bytes.subarray(frame * frameSize, (frame + 1) * frameSize)).digest("hex")), hashes);
  });
}

for (const [source, limits, diagnostic] of [
  ["testsrc2=s=1x8", {}, "dimensions must be at least 2x2"],
  ["testsrc2=s=64x48:r=1:d=1", { maxMemoryBytes: 16000 }, "maxMemoryBytes"],
  ["testsrc2=s=64x48:r=1:d=1", { maxPixelsPerFrame: 3000 }, "maxPixelsPerFrame"]
] as const) {
  it(`rejects ${source} with ${diagnostic} before writing output`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "keep" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand({ limits }).execute({
      args: ["-y", "-v", "error", "-f", "lavfi", "-i", source, "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(Buffer.concat(errors).toString().includes(diagnostic), Buffer.concat(errors).toString());
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
  });
}
