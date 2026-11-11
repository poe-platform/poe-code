import assert from "node:assert/strict";
import { it } from "node:test";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { parseWav, wavAst } from "./containers/adapters.js";

// Native FFmpeg output for every G.711 codeword, in byte order.
for (const [law, expected] of [
  ["alaw", "6a6b68696e6f6c6d6263606166676465757574747777767671717070737372722a2e22263a3e32360a0e02061a1e1216555751535d5f595b454741434d4f494b7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7a7a7a7a7b7b7b7b78787878797979797d7d7d7d7d7d7d7d7c7c7c7c7c7c7c7c95949796919093929d9c9f9e99989b9a8a8a8b8b888889898e8e8f8f8c8c8d8dd6d2dedac6c2cecaf6f2fefae6e2eeeaaba9afada3a1a7a5bbb9bfbdb3b1b7b581818181818181818181818181818181808080808080808080808080808080808585858584848484878787878686868682828282828282828383838383838383"],
  ["mulaw", "02060a0e12161a1e22262a2e32363a3e41434547494b4d4f51535557595b5d5f6162636465666768696a6b6c6d6e6f70707171727273737474757576767777787878797979797a7a7a7a7b7b7b7b7c7c7c7c7c7c7d7d7d7d7d7d7d7d7e7e7e7e7e7e7e7e7e7e7e7e7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f80fdf9f5f1ede9e5e1ddd9d5d1cdc9c5c1bebcbab8b6b4b2b0aeacaaa8a6a4a2a09e9d9c9b9a999897969594939291908f8f8e8e8d8d8c8c8b8b8a8a898988888787878686868685858585848484848383838383838282828282828282818181818181818181818181808080808080808080808080808080808080808080808080"]
] as const) {
  for (const format of ["u8", "wav"]) {
    it(`narrows every ${law} codeword to unsigned PCM8 in ${format}`, async () => {
      const doc = await rawAudioAsts().find(plugin => plugin.id === law)!.parse(
        Uint8Array.from({ length: 256 }, (_, i) => i), { sampleRate: 8000, channels: 1 });
      const plugin = format === "wav" ? wavAst() : rawAudioAsts().find(plugin => plugin.id === format)!;
      const bytes = await plugin.serialize!(doc, { audioCodec: "pcm_u8" });
      const pcm = format === "wav" ? Buffer.concat(parseWav(bytes).tracks[0]!.samples.map(sample => sample.data)) : bytes;
      assert.equal(Buffer.from(pcm).toString("hex"), expected);
    });
  }
}
