import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 references: remix the second input before the S16 fade.
for (const reverse of [false, true]) {
  it(`acrossfade negotiates mono/stereo inputs, reverse=${reverse}`, async () => {
    const volume = Volume.fromJSON({});
    for (const [name, values] of [["mono", [12000]], ["stereo", [-4000, 8000]]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: values.map(value => new Float64Array(1000).fill(value / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", reverse ? "/stereo.wav" : "/mono.wav",
        "-i", reverse ? "/mono.wav" : "/stereo.wav", "-filter_complex",
        "[0:a][1:a]acrossfade=ns=4[o]", "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
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
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, reverse ? 2 : 1);
    const transitions = reverse ? [[-3000, 121, 3242, 6363], [6000, 6121, 6242, 6363]]
      : [[9000, 6500, 4000, 1500]];
    for (const [channel, samples] of audio.channelData.entries()) {
      assert.equal(samples.length, 1996);
      assert.deepEqual(Array.from(samples, value => value * 32768), [
        ...Array(996).fill(reverse ? [-4000, 8000][channel] : 12000),
        ...transitions[channel]!, ...Array(996).fill(reverse ? 8485 : 2000)
      ]);
    }
  });
}

// FFmpeg 7.0.2 references for distinct constant values in every speaker.
for (const [first, second, hash] of [
  [1, 6, "d2284aa21f69d06cc77561cbfbffb2c5910b2ae19d9c3830afc04e25d8d329ad"],
  [2, 6, "2f57154aa88868daf7edf21c1107b0fcffc40d282aec9995b821afb52a76d996"],
  [6, 1, "fbde00ea1a72d4f3c4fec5699f077bdbe001d7617884b56c3232693ffd9780e4"],
  [6, 2, "7e38028faed1e58dde9997078e131b1de8e9cd55dd6a0d93af14ba8a12aad0c1"],
  [1, 2, "706d9c7e57992786954f468723d8161de126083c815991c2c4128fe76390c04a"],
  [2, 1, "367ba760e79f14f43b9bd70e38c0a0bdb80ffb834611b62b7f25412c1a971bfc"],
  [6, 6, "98725a1cf3018f211f5da13691dd87fd2ab06e021827bceb93ac20f478425012"]
] as const) for (const channelMask of first === 6 || second === 6 ? [undefined, 0x3f, 0x60f] : [undefined]) {
  it(`acrossfade matches native PCM for ${first} then ${second} channels, mask=${channelMask}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    for (const [index, channels] of [first, second].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        ...(channels === 6 && channelMask !== undefined ? { channelMask } : {}),
        channels: Array.from({ length: channels }, (_, channel) =>
          new Float64Array(20).fill((channel + 1) * (index === 0 ? 1000 : 300) / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        "[0:a][1:a]acrossfade=ns=4[o]", "-map", "[o]", "-f", "s16le", "/out.raw"],
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
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, 36 * first * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

// Native FFmpeg references for 16-sample WAVs with the default 4.0 layout.
for (const [first, second, hash] of [
  [4, 1, "20c9a2640ff6d5e4"],
  [1, 4, "f48b60c35698926d"],
  [4, 2, "7610b0471f5b9536"],
  [2, 4, "ce792ebb1e0590d1"],
  [4, 4, "e7fc5d9a8667e84a"]
] as const) for (const channelMask of [undefined, 0x107]) {
  it(`acrossfade matches native PCM for ${first} then ${second} channels, mask=${channelMask}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    for (const [index, channels] of [first, second].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        ...(channels === 4 && channelMask !== undefined ? { channelMask } : {}),
        channels: Array.from({ length: channels }, (_, channel) =>
          Float64Array.from({ length: 16 }, (_, sample) =>
            (3001 + 17 * sample + 251 * channel) * (index === 0 ? 1 : -1) / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        "[0:a][1:a]acrossfade=ns=5[o]", "-map", "[o]", "-f", "s16le", "/out.raw"],
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
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, 27 * first * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex").slice(0, 16), hash);
  });
}

// Native FFmpeg 9.0.1 references. Four-sample fades avoid platform-dependent
// fused multiply-add rounding at integer boundaries.
for (const [first, second, samples, hash] of [
  [1, 3, 3, "74b4c193a0c71d0c27fb3a630b8b30a89495e9c23516a981a91020025e946db1"],
  [2, 2, 3, "70a55a285cd9539debaafd04df18d4342254a68f6ea57c9e233c8d74f1178782"],
  [2, 6, 3, "03d80370814c71f2b99e2daeb4755a211cffd0c4724022a4f6adc236f4548358"],
  [2, 8, 3, "e945f112620f3d84bfa24033ce07c3a79a47d6380ea0d1ed987fa4fcc6af7db4"],
  [3, 1, 3, "647760f864881926363a6972ba294a5c4481077693681a916ce9c2353c88a841"],
  [4, 6, 3, "afd1e84303c7dd39dad7e7b84b09de21e420565f90bac4cbe801a5a1254bbd9b"],
  [6, 4, 3, "d244d7dfabad9dac33a54ba83f55c96a6ffc3c42340461fc982f53ee03118517"],
  [8, 2, 3, "0534e2412a58d298bb2a448a973c1062f7b326427b3c412fc07b5e3851a333a4"],
  [8, 8, 3, "f0c0d770e63160490cfd95299ef7a05b13965e8cdadc8c99679a6ad064606fb8"],
  [1, 1, 4, "3cbc05f6a83767c83644f4a56d11fad891677d1087ef258592019d13442388c6"],
  [1, 2, 4, "1296acca5bb3f855aba54eb07ee31f928dad2c00b2db1af33f8e3dff86553d8c"],
  [1, 3, 4, "1296acca5bb3f855aba54eb07ee31f928dad2c00b2db1af33f8e3dff86553d8c"],
  [1, 4, 4, "6137ff332a91ce0c6539b52588416b7fcb85c0f355b606f16c9fd9591ddf4bbb"],
  [1, 5, 4, "814593ca02a88227409959421eb4760afdabe370e640cf43aacc05f4f66f7dd0"],
  [1, 6, 4, "1fe1382c5c2384d8a2b3d9a30ce8f71ee74cdac1c39933f70dd411b347740435"],
  [1, 7, 4, "a29af89c4508020bea3e193ec7204b9bf9ef7d98271a8ffd547197969d6ca8ad"],
  [1, 8, 4, "317bec948c95cbe696fe0be81bcf20bd660b403820d899689fae3100eb8b648d"],
  [2, 1, 4, "28cec4257f673af50dd4ec4c5a6249268b90f8fcc907d6280ac10f81d06e4c2c"],
  [2, 2, 4, "ab9b64ffdc94c44e6440e2c8be0b11e5931e6bfd7553acda8eb33fa4ba0a5cc5"],
  [2, 3, 4, "ab9b64ffdc94c44e6440e2c8be0b11e5931e6bfd7553acda8eb33fa4ba0a5cc5"],
  [2, 4, 4, "1db493f1275b2d650fde8474aa091d23ef703e603f19b7c4ebc32edb18ec617d"],
  [2, 5, 4, "2b4684711af02d07565eeedca498928765bef2e96efe847669beda10a4aafe30"],
  [2, 6, 4, "98efb25221354b9ad606c496b133b6af9bf15f8bb3b180198a5a244f0113d28c"],
  [2, 7, 4, "045605387bfc1dd2a3239b513a2061fd58ad07170b643eec2dc7890b5ced0ba4"],
  [2, 8, 4, "d572f5d0b954feda14cfcd5578c410d518d3349726c9304873dcd02f1f6e794c"],
  [3, 1, 4, "d0daa6685a5c4dcd13e6b3e6db1f461fe740be5a1a4c8a1cc569adee9be95148"],
  [3, 2, 4, "afc22a2b1daa675b786bb5abd5e27bc8a399e95917d58f1fbe1b7dce9fe31883"],
  [3, 3, 4, "a0f88eb1125e27eb70c15aec3888dc556d81d0037ea6e68cdade9133b2ae21c2"],
  [3, 4, 4, "3806f34822a32501ae1d1b571b765e37a603fb9c8e934964f414edbfb58567ff"],
  [3, 5, 4, "f5c00ad16ae2ba944df2fd260716006922165bf5c1e89cf894390c7367c97f4e"],
  [3, 6, 4, "82f5b027d347053c18138006d1501ef8463bd991694ca93c6d0221f4e28897c2"],
  [3, 7, 4, "ca2e655e58d71666a691c66b4d4f6762075ed134aaf197704c7c1edc04d6b910"],
  [3, 8, 4, "e53830a910a44a875fb25cf9f74f661e4fb6a3747bdf9c73e6ecfab40f030e79"],
  [4, 1, 4, "4dfc64e8bbc5c094ccfe6ac9c68ee45ce122c0f7e8ff08ff5c0d9957db407ece"],
  [4, 2, 4, "31c04dd9f6131acb7149340d6539080f3fd0d4435514304d718cb956010c7e00"],
  [4, 3, 4, "31c04dd9f6131acb7149340d6539080f3fd0d4435514304d718cb956010c7e00"],
  [4, 4, 4, "2654749e9cf6d0b3e57a0e8d48b0b75636513cf12f244a2db032f087dce178d6"],
  [4, 5, 4, "d39051172f3840f843ce1b047f96dbd51569376241ec11e91491d467685683f6"],
  [4, 6, 4, "4442131961013f3d313d22aa9be227e625f3e9f205eccbde770e703114669381"],
  [4, 7, 4, "e0e48b133b86f5fe2482f7feeeb49c92a15f1ae0961f056f8c31ecdedb18c50d"],
  [4, 8, 4, "473004d2150072066961863513384cb10a8e4061f5b7a5de06853b9e88df82e4"],
  [5, 1, 4, "306526fe21f29f787a59d3cd10ce5307d7944c1285dfdada53ad77b38ef35e58"],
  [5, 2, 4, "e012fd2ec32c6def907c32c14cd64eaf8569db7ada7167f17358bae03aac0948"],
  [5, 3, 4, "e012fd2ec32c6def907c32c14cd64eaf8569db7ada7167f17358bae03aac0948"],
  [5, 4, 4, "85ca1a9eb50b01aa20d1e2d5ca7ad6b1ab4e245281162de7b608bc6251b71bf9"],
  [5, 5, 4, "cadec0c3a5d2383049fd60a307bc02111951cb2ee5e30d19b8858ded5dcca6f0"],
  [5, 6, 4, "a42cc2f4d364ad26425185dd3ca97ce7c28e98cac74e08845367e37b63f778f2"],
  [5, 7, 4, "bdc447113db19564dd0882c8c51195a078892e510cebbf8eb905407cd1b0cf99"],
  [5, 8, 4, "cc7db47b7d5926f4c4780ff7ac5ea7d62bfa9754c7ce0458d25f21d77fea1e55"],
  [6, 1, 4, "d7aae0b9a25d377090d359781f61f05d2316f91bef565a3d8e057b5d08add82a"],
  [6, 2, 4, "785d10feb5633d23845569cad377fc9fdb72523d443d9ceb0f418e799670415e"],
  [6, 3, 4, "516c5043d5008b921c1c4efdf63d0c7157fb802e623cb4d96c7da454adcd7e67"],
  [6, 4, 4, "efb7c38237804d0878b2f3e939efa395b0bc0c737c01d0d519da40235377bf09"],
  [6, 5, 4, "9894c18038726e1de55d444772c4ce7653b28b77e7078c1b0aa041059fe3509c"],
  [6, 6, 4, "a8d683039f396b89479a9344e9059c674315c1697b4f0fb3ef09451e7f63730a"],
  [6, 7, 4, "1f2c6afc5669cf36ad41f1962a57eedb44baac976094681e8f0360243c26edbe"],
  [6, 8, 4, "080b90d068de084f11a7428ca0e28f384c8e09d9e70c1267244c502988c3b75f"],
  [7, 1, 4, "8317cf2e7fea7ca37a45dda035b7e6b9b6838c636c33b303569e9dacb565fa79"],
  [7, 2, 4, "76e4f8cca77e76cfed3f9124a2e83fcd73f03e5aa84d16c4aba838c96acf49bb"],
  [7, 3, 4, "f2fcbe10c54a3f18204fcff146fd1c89bb70e8956986f829ac0ba5bcd9019c5b"],
  [7, 4, 4, "dc1715d447e6deb4d3be39af411c514f64fd3a7749e5174e46d0acdbd1d03aa7"],
  [7, 5, 4, "7002cb27980b2a2e54823ace72d2a1f337fad344f88a515699440f012b3bc510"],
  [7, 6, 4, "c328b7870d85a228d44159d93a939f576999cdde42ddfcdbaa2d125e3bad0751"],
  [7, 7, 4, "93026e1fac01b477dc21e98d126a06e619feb449eb9dc93721ee7b93af0dcdd8"],
  [7, 8, 4, "510e0b571c90c400faea8c80abd2edeefacdff229bab9f1a87938b0c821367b7"],
  [8, 1, 4, "2c70acb903106daf0e68c371112285735f184e9e8f7cb103bf9115c34656e413"],
  [8, 2, 4, "74596ac075c31d965654adbbfa6e9c5aa3ad4707bdb4ed490057dc2fc3847420"],
  [8, 3, 4, "ac47ca69c05a1ff1c29b7a930a5ee16a0ed2aed040fe3af2eaefb6dd9b46394c"],
  [8, 4, 4, "848fae9fa87803567a052cabb49815adbb2676a0a7d2b47a2d6979bc74bd782d"],
  [8, 5, 4, "ab1bc9f968f5f83f71d039c42e3b71d71b227e3a1d7760f2e943e74098271b56"],
  [8, 6, 4, "84be19ce28e2039068467b39edc301e2622d55e3ee26c396400706788c5cf014"],
  [8, 7, 4, "83f683d4a02607630974213f99345707b46fb5cb2dcda767bdb057512e33f80c"],
  [8, 8, 4, "0de616c7398d924b2e213647c35a0a780ef94cb706dc45b9826a537b8e11590c"]
] as const) {
  it(`acrossfade matches native PCM for ${first} then ${second} channels, default WAV layout, ns=${samples}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    for (const [index, channels] of [first, second].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: Array.from({ length: channels }, (_, channel) =>
          Float64Array.from({ length: 5 }, (_, sample) =>
            ((channel + 1) * 1000 + sample * 11) * (index === 0 ? 1 : -1) / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        `[0:a][1:a]acrossfade=ns=${samples}[o]`, "-map", "[o]", "-f", "s16le", "/out.raw"],
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
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, (10 - samples) * first * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
