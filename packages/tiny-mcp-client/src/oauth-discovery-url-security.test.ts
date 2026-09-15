import { expect, it } from "vitest";
import { resolveAuthorizationServerMetadataUrl, resolveProtectedResourceMetadataUrl } from "./oauth-discovery.js";

it.each(["http://127.attacker.example/mcp", "http://127.0.0.1.attacker.example/mcp"])(
  "rejects HTTP DNS hosts that only resemble IPv4 loopback: %s", (url) => {
    expect(() => resolveProtectedResourceMetadataUrl(url)).toThrow("https");
    expect(() => resolveAuthorizationServerMetadataUrl(url)).toThrow("https");
  }
);

it.each(["http://[::1]/mcp", "http://127.0.0.1/mcp", "http://127.255.0.1/mcp", "http://localhost/mcp"])(
  "allows actual HTTP loopback metadata endpoints: %s", (url) => {
    expect(() => resolveProtectedResourceMetadataUrl(url)).not.toThrow();
    expect(() => resolveAuthorizationServerMetadataUrl(url)).not.toThrow();
  }
);

it.each(["https://user:secret@resource.example/metadata", "https://resource.example/metadata#fragment"])(
  "rejects metadata challenge URLs containing credentials or fragments: %s", (url) => {
    expect(() => resolveProtectedResourceMetadataUrl("https://resource.example/mcp", url)).toThrow();
  }
);

it("rejects issuer URLs containing credentials", () => {
  expect(() => resolveAuthorizationServerMetadataUrl("https://user:secret@auth.example")).toThrow();
});
