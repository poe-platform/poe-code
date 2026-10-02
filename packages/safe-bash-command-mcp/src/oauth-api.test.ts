import { expect, it } from "vitest";
import * as api from "./index.js";
import { exchangeAuthorizationCode, refreshAccessToken } from "../../mcp-oauth/src/client/token-endpoint.js";
import { discoverOAuthMetadata } from "tiny-mcp-client";

it("exposes the existing OAuth implementation to hosts through the bundled MCP API", () => {
  expect(api.exchangeAuthorizationCode).toBe(exchangeAuthorizationCode);
  expect(api.refreshAccessToken).toBe(refreshAccessToken);
  expect(api.discoverOAuthMetadata).toBe(discoverOAuthMetadata);
  expect(api.prepareRemoteMcpAuthorization).toEqual(expect.any(Function));
});
