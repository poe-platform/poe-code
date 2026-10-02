import { expect, it } from "vitest";
import * as api from "./index.js";
import { exchangeAuthorizationCode, refreshAccessToken, revokeOAuthToken, registerOAuthClient } from "mcp-oauth";
import { discoverOAuthMetadata } from "tiny-mcp-client";

it("exposes the existing OAuth implementation to hosts through the bundled MCP API", () => {
  expect(api.exchangeAuthorizationCode).toBe(exchangeAuthorizationCode);
  expect(api.refreshAccessToken).toBe(refreshAccessToken);
  expect(api.registerOAuthClient).toBe(registerOAuthClient);
  expect(api.revokeOAuthToken).toBe(revokeOAuthToken);
  expect(api.discoverOAuthMetadata).toBe(discoverOAuthMetadata);
  expect(api.prepareRemoteMcpAuthorization).toEqual(expect.any(Function));
});
