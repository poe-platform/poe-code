import assert from "node:assert/strict";
import { it } from "node:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { murmur3 } from "./murmur3.js";

// FFmpeg 7.0.2: -f u8 -ar 8000 -ac 1 -i pipe:0 -c:a copy -f streamhash -hash murmur3 -
const vectors = [
  "f172e5acc891f8bf6981a829b5a83a3d",
  "517c38f3cfe25836eaf05b066674c448",
  "66cd0c0708c8f054b01c699fcd48e360",
  "4b0b9cb76151b812ee3127bf243ef7fa",
  "6821d5103feb75a1aeac95e59335e15d",
  "94037b48dcfe36ea7457b7f319914b6a",
  "2add015e110c264a346393258811e8c4",
  "39132e3a8529104cf54b8b67b820bfd6",
  "bc39973ce3176590e8a475a70ec9fd79",
  "a68252435c332b7bb4e055a162acaa19",
  "20af9930d44cc724ecffbada9b86fd5e",
  "8c2bfed1c146432957a18807a4d868d9",
  "79feba9b56bdf6529d53c2f3bb13cceb",
  "31d4cf0eba0657b05f68a1ac9f6b8f2c",
  "280c4d3c45367f49737d0f9008de5564",
  "9cf240426539b1725361c9646603189e",
  "c6440eb8b0920152ac833c95768c4634",
  "5f5b4990f792997e8a19a618d6f2a9c7",
  "fabe70e12c20111ef61ad51b21f2289c",
  "b2b49f1f5e4fd96c17383cde78449cb2",
  "84093462123ba0537ea8a8837e5165ad",
  "948b3d83b023b3f696de0c75456ad3cb",
  "d5d9e33b1bb9f7d0e80259354daab780",
  "a3b4ee642d1cda6f256390da3062f281",
  "c1b27b4346c9400ee59b29d2527df917",
  "7007636c78c62f347abd32eff6869ea2",
  "bbb22245a82fd6de405c26d6b7ee19b4",
  "4750f642f8d9c042cd0544ad6db7738b",
  "37c8080b8ba808e8bf90439e6ae9f6a3",
  "abb5e49146025338c980feab4999ecdd",
  "c3795790a5e537c9dcd1dbb2323f912e",
  "fff998ed40794e02f2900f63b13a4d58",
  "928511d9077c77328dd8afbf593e776e",
  "8200b09b82d63e8891237f68c54d1411",
];

it("matches native Murmur3 for empty input, every tail length, and packet boundaries", () => {
  for (const [index, expected] of vectors.entries()) {
    const length = index === vectors.length - 1 ? 65539 : index;
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
    for (const size of [1, 7, 16, 17, 1024, Math.max(1, length)]) {
      const chunks: Uint8Array[] = [new Uint8Array()];
      for (let i = 0; i < length; i += size) chunks.push(bytes.subarray(i, i + size));
      chunks.push(new Uint8Array());
      assert.equal(bytesToHex(murmur3(chunks, new MediaBudgetTracker())), expected,
        `length ${length}, chunk size ${size}`);
    }
  }
});

it("checks the CPU budget while hashing a large packet", () => {
  const budget = new MediaBudgetTracker();
  let checks = 0;
  budget.checkCpu = () => {
    if (++checks === 3) throw new Error("CPU budget exceeded");
  };
  assert.throws(() => murmur3([new Uint8Array(65536)], budget), /CPU budget exceeded/);
  assert.equal(checks, 3);
});
