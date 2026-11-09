import assert from "node:assert/strict";
import { it } from "node:test";
import { ripemd128, ripemd256, ripemd320 } from "./ripemd.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// FFmpeg 7.0.2: -f u8 -ar 8000 -ac 1 -i pipe:0 -c:a copy -f hash -hash RIPEMD<bits> -
const lengths = [0, 1, 55, 56, 63, 64, 65, 129, 65537];
const vectors = {
  "128": [
    "cdf26213a150dc3ecb610f18f6b38b46",
    "ae1cb7a0d59ff0af9841d1f76191d89f",
    "bfc4560bb7919663bcf7838030e28f48",
    "d3761ff56a6e6ad9c5e7dad737ed0822",
    "bd21dfddf4f9c352e77b135d58240991",
    "6cfc06d8df3cd6bf7be73ad156ee945d",
    "e12102d28e56c74be9ab31874bd0f81f",
    "e5f6682d00c0009051fe809638f02e13",
    "7d576607e15e3a2930ec069e18ef9b7a"
  ],
  "256": [
    "02ba4c4e5f8ecd1877fc52d64d30e37a2d9774fb1e5d026380ae0168e3c5522d",
    "aa32857fdc7146c6f9b0536bcaf307a871ae14ffb0317d5c62b27d4945365b60",
    "e966fc96821a9aeda233a32fd870b1c7370b9bd3515f5e61fc9d0cf58c92da71",
    "0228d3b41c1b95ed304ccc893c3dbe1a99edca204677a81755677cc13561460b",
    "92d22128c446f84d513f2c79ec8c013b99cfeea723756f8406ae179f144feb8b",
    "724266388cbfdfa3af478cdbf462dbfba5cebbe88529b8166de1c606598c82a6",
    "e1635557c6c2c9742457aebf3895c78094389b26937cb62021f1c906b9435224",
    "56d7f6e46e14bd4938a377f39546f133bc6f963851fd7c0661530a9f5e230cff",
    "c72dd2991c0e243344b2c48e7d8c8396f8cac6f40bf6e634e1ad70411b4c051e"
  ],
  "320": [
    "22d65d5661536cdc75c1fdf5c6de7b41b9f27325ebc61e8557177d705a0ec880151c3a32a00899b8",
    "f4316afbcb6ce03e94d2db63562e65703b59413246d44b76869a1bc0ed0185b9748d2b0b083233bc",
    "faa2d1cf4c4a506d3bf8f711de147eb7720908c92a6a31757a094e707f54633b570b04ce7410afeb",
    "1e1f2d32c7e9d628202b9d843c8b6f42bbf07ec6206cbbd33773e75367f37dc70a798e1bddcf07e8",
    "ad2426d50725bbf4efebedd8ed3c76cf2d5b8db2c8966a5cab5b4dbdff14d59ae10b0297a9b37a30",
    "56dc165ee81158779c5be04898122f8955f21842473404337ad7f6d1838e49df335288d07abf0a30",
    "798a7f624e823a234f37db324fb979333c98d6412365fea0e26b291c60def5dfb8634b69e20afb22",
    "7067d9fc0eecbbbb81b15a9f274f8f00c068ee4ecf2c0e9a28b75a88e7b8aca0a750799dfb4d3f60",
    "0fce13d15d17620404da2767b902789f4a90ed146f7861311cb3c6874d24a27acf2d980220a5b9d1"
  ]
} as const;

for (const [bits, hash] of [[128, ripemd128], [256, ripemd256], [320, ripemd320]] as const) {
  for (const [index, length] of lengths.entries()) {
    it(`RIPEMD${bits} hashes ${length} bytes across padding and update boundaries`, () => {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 17 + 31) % 256);
      const expected = vectors[bits][index];
      assert.equal(bytesToHex(hash(bytes)), expected);
      for (const chunk of [1, 7, 63, 64, 65536]) {
        const incremental = hash.create();
        for (let offset = 0; offset < bytes.length; offset += chunk) incremental.update(bytes.subarray(offset, offset + chunk));
        assert.equal(bytesToHex(incremental.digest()), expected, `chunk size ${chunk}`);
      }
    });
  }
}
