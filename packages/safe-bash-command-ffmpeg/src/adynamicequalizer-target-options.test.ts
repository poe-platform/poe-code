import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(96 * 2);
for (let i = 0; i < 96; i++) input.writeInt16LE((i * 3779) % 44001 - 22000, i * 2);

// Native FFmpeg 7.0.2, mono PCM16 at 8 kHz with asetnsamples=n=8:p=0.
const references = [
  ["mode=cutabove:tfrequency=500", "08ad7ad882d9ccdab100382ce6b3f071ead2dcef121e2b7e4eefde0b8acd22d4"],
  ["mode=cutabove:tfrequency=1000", "de3ff303ec02f0a7f43cf27e491b98390a1aeb517ecc689e84fbac619bd63d35"],
  ["mode=boostabove:tftype=lowshelf", "81e01e57e872ace4f482eef7d476cfc276ad36b19403ab9d5765bdf150b8523a"],
  ["mode=cutabove:attack=1", "7dd14d8f726f857d89ed451f84f42ffb6469a408fc57e08da0f53c7cb37fe262"],
  ["mode=cutabove:threshold=1", "7083a74b37f8872e2b91bb4b8c62e80fdd270c3bb9a330c549794d269d293db9"],
  ["mode=cutabove", "de3ff303ec02f0a7f43cf27e491b98390a1aeb517ecc689e84fbac619bd63d35"],
  ["mode=boostabove", "e3fba0abe193cd67345169fca315585ea7374e3ea40373deaed155489453fd82"],
  ["mode=listen:tfrequency=500", "02acb6f48dd9a08f5c7c14f8be257b8c0538c4d879b8b76c31bba20d97d39272"],
  ["mode=cutabove:tfrequency=500:tqfactor=0.7", "236103b0c45aaa2f0c05aa29efaf88f499f6d552ce7acd9ae091700b97aa5abb"],
  ["mode=cutabove:tftype=highshelf", "d70aa9eb131296914fffb64a9951c545dbef8b7579aa176d9639e8addeb6c49e"],
  ["mode=cutabove:tftype=lowshelf", "2b26cc6af32a087949678df35a5c97e9208fad3ae48bf38ff8d04b732edbee2b"],
  ["mode=cutabove:attack=1:release=1", "7dd14d8f726f857d89ed451f84f42ffb6469a408fc57e08da0f53c7cb37fe262"],
  ["mode=cutabove:threshold=0.05:attack=1:ratio=2", "b1c597f5b1dcf88b76953fcab720bd227fb76e76b82e954f9ee5adfdee291ee7"],
  ["mode=cutabove:threshold=0.05:attack=1:makeup=3", "97fcdc11705dc85a4cd562b675acf5a45b0d74754a02fddb19b1d3c643dc587b"],
  ["mode=cutabove:range=6", "647c233d5c72adafe720e648eb206a5839f7912a77aa9e85c15e035c1460ea3f"],
  ["mode=cutabove:threshold=0.05:tfrequency=500:tqfactor=0.7:tftype=highshelf:attack=1:release=1:ratio=2:makeup=3:range=6:precision=double", "33d269b9d390f3e0b2bacdfccb668e3beb249e2840cea43c0bb5598a2de014d0"],
  ["mode=boostabove:tfrequency=500:tqfactor=0.7", "26411bde52753af46229ee706e8791dc94c25ddf7d181868394234af613d43f5"],
  ["mode=boostabove:tftype=highshelf", "f5b854cbec5b6dd63db21a1e9c6691769b896be9309d86275fd8684a417a867a"],
  ["mode=boostabove:tftype=lowshelf", "81e01e57e872ace4f482eef7d476cfc276ad36b19403ab9d5765bdf150b8523a"],
  ["mode=boostabove:attack=1:release=1", "a01ea1176790cf1170e4182bf9ee941772e456a094ab4c6f73ddf622e68fb71a"],
  ["mode=boostabove:threshold=0.05:attack=1:ratio=2", "ae93a62e219e8076d6769eb3dadbc7100b94184cd12c4e602418710dcb807407"],
  ["mode=boostabove:threshold=0.05:attack=1:makeup=3", "04d6bf102975b895936a01f2e32fa99f94ca4f639688f15bd382fb41275e1834"],
  ["mode=boostabove:range=6", "d9f1c98c4e4497d1ce955d86796dfb037f027d3579566c154a050790a7573bfb"],
  ["mode=boostabove:threshold=0.05:tfrequency=500:tqfactor=0.7:tftype=highshelf:attack=1:release=1:ratio=2:makeup=3:range=6:precision=double", "3a1f6e31f5be347578b4f4cf5ef8f21b09fb1822beecfd3cf90277ea2a1c8dea"],
  ["mode=cutbelow:tfrequency=500:tqfactor=0.7", "631140a7db32233ad6618ffb983303a5d37a5a8f4304722437705a696d0523d0"],
  ["mode=cutbelow:tftype=highshelf", "1bf83db42f25106201df453e5be012ba75f3da9e5b2f6115698fff9bb9bb5bde"],
  ["mode=cutbelow:tftype=lowshelf", "6b85423487219f794bbbcf24061e065155a9fc3fc57e0fd9f10c515ceca6d82c"],
  ["mode=cutbelow:attack=1:release=1", "24f59f3ec43005be31544004fa0465bc13793d46d67b0572d30237932a1e9428"],
  ["mode=cutbelow:threshold=0.05:attack=1:ratio=2", "73b9bd221ebaf36e7be94e30aa58922c2d31506341690cbe67a55b411f259dc6"],
  ["mode=cutbelow:threshold=0.05:attack=1:makeup=3", "c46d4b4c2ce8445610b9b8ed09e816da186424d49f864e830b2053647f88fa0e"],
  ["mode=cutbelow:range=6", "7083a74b37f8872e2b91bb4b8c62e80fdd270c3bb9a330c549794d269d293db9"],
  ["mode=cutbelow:threshold=0.05:tfrequency=500:tqfactor=0.7:tftype=highshelf:attack=1:release=1:ratio=2:makeup=3:range=6:precision=double", "ce5e53ef4a0a540f13bbf062c82cccc333c5c33a676e019942fecc8f525f35a5"],
  ["mode=boostbelow:tfrequency=500:tqfactor=0.7", "631140a7db32233ad6618ffb983303a5d37a5a8f4304722437705a696d0523d0"],
  ["mode=boostbelow:tftype=highshelf", "1bf83db42f25106201df453e5be012ba75f3da9e5b2f6115698fff9bb9bb5bde"],
  ["mode=boostbelow:tftype=lowshelf", "6b85423487219f794bbbcf24061e065155a9fc3fc57e0fd9f10c515ceca6d82c"],
  ["mode=boostbelow:attack=1:release=1", "24f59f3ec43005be31544004fa0465bc13793d46d67b0572d30237932a1e9428"],
  ["mode=boostbelow:threshold=0.05:attack=1:ratio=2", "41269212e3f8fea3e0169c2636970e376d6cae666eb9f6d60f80ad560b457dde"],
  ["mode=boostbelow:threshold=0.05:attack=1:makeup=3", "270d8145ca4baf22a9fab14e1efabebcea879c1cc9c602b6a667b7e534123825"],
  ["mode=boostbelow:range=6", "7083a74b37f8872e2b91bb4b8c62e80fdd270c3bb9a330c549794d269d293db9"],
  ["mode=boostbelow:threshold=0.05:tfrequency=500:tqfactor=0.7:tftype=highshelf:attack=1:release=1:ratio=2:makeup=3:range=6:precision=double", "3bec3a2592186c592be8f0b2391a0bf7e0e3a1eb256e46a9ad3850082d20c552"],
  ["0:1000:1:1000:1:20:200:1:0:50:cutbelow", "7083a74b37f8872e2b91bb4b8c62e80fdd270c3bb9a330c549794d269d293db9"],
  ["mode=boostabove:tftype=1+1", "f5b854cbec5b6dd63db21a1e9c6691769b896be9309d86275fd8684a417a867a"],
  ["mode=cutabove:threshold=0.05:attack=1:ratio=0", "24f59f3ec43005be31544004fa0465bc13793d46d67b0572d30237932a1e9428"]
];

for (const [options, hash] of references) {
  for (const graph of [false, true]) {
    it(`matches native target/dynamics PCM for ${options} (${graph ? "graph" : "simple"})`, async () => {
      for (let repetition = 0; repetition < 3; repetition++) {
        const fs = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=8:p=0,adynamicequalizer@e=${options}`;
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = Buffer.concat(chunks);
        assert.equal(pcm.length, input.length);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      }
    });
  }
}
