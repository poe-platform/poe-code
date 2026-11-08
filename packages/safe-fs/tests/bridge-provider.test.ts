import { expect, it } from "vitest";
import * as bridgeApi from "../src/bridge/index.js";
import { createNodeFsBridge, getNodeFsBridgeProvider } from "../src/node/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

it("recognizes provider identity across portable and Node bridges without trusting lookalikes", () => {
  const fs = new MemoryFileSystem();
  const portable = bridgeApi.createFsBridge(fs, { codec: {
    isEncoding: encoding => encoding === "utf8",
    encode: text => new TextEncoder().encode(text),
    decode: bytes => new TextDecoder().decode(bytes)
  } });
  const node = createNodeFsBridge(fs);
  expect(bridgeApi.getFsBridgeProvider(portable)).toBe(fs);
  expect(bridgeApi.getFsBridgeProvider(node)).toBe(fs);
  expect(getNodeFsBridgeProvider(portable)).toBe(fs);
  expect(bridgeApi.getFsBridgeProvider({ fs })).toBeUndefined();
  expect(bridgeApi.getFsBridgeProvider(Object.create(Object.getPrototypeOf(portable)))).toBeUndefined();
});
