import { expect, it } from "vitest";
import { parseJsonRpcMessage } from "./internal.js";

it.each(["1.5", "1e309"])("rejects a non-integer JSON-RPC error code %s", (code) => {
  expect(
    parseJsonRpcMessage(`{"jsonrpc":"2.0","id":1,"error":{"code":${code},"message":"invalid"}}`)
  ).toMatchObject({ type: "invalid" });
});
