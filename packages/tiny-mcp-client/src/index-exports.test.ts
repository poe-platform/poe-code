import { describe, expect, it } from "bun:test";

import * as api from "./index.js";

describe("index public API exports", () => {
  it("exports required runtime symbols", () => {
    expect(api).toHaveProperty("McpClient");
    expect(api).toHaveProperty("StdioTransport");
    expect(api).toHaveProperty("HttpTransport");
    expect(api).toHaveProperty("McpError");
    expect(api).toHaveProperty("JsonRpcMessageLayer");
    expect(api).toHaveProperty("createTestPair");
    expect(api).toHaveProperty("createInMemoryTransportPair");
    expect(api).toHaveProperty("createSdkTestPair");

    expect(api).toHaveProperty("ERROR_PARSE", -32700);
    expect(api).toHaveProperty("ERROR_INVALID_REQUEST", -32600);
    expect(api).toHaveProperty("ERROR_METHOD_NOT_FOUND", -32601);
    expect(api).toHaveProperty("ERROR_INVALID_PARAMS", -32602);
    expect(api).toHaveProperty("ERROR_INTERNAL", -32603);
  });

  it("does not export internal helpers", () => {
    expect(api).not.toHaveProperty("readLines");
    expect(api).not.toHaveProperty("parseJsonRpcMessage");
    expect(api).not.toHaveProperty("serializeJsonRpcMessage");
    expect(api).not.toHaveProperty("SseParser");
    expect(api).not.toHaveProperty("SdkTransportAdapter");
    expect(api).not.toHaveProperty("createMockEchoToolServer");
    expect(api).not.toHaveProperty("createMockResourceServer");
    expect(api).not.toHaveProperty("createMockPromptServer");
    expect(api).not.toHaveProperty("createMockSlowToolServer");
  });
});
