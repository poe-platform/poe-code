import { describe, expect, it } from "vitest";
import { canonicalizeResourceIndicator } from "./resource-indicator.js";

describe("canonicalizeResourceIndicator", () => {
  const vectors = [
    {
      input: "HTTPS://RESOURCE.EXAMPLE.COM:443/mcp",
      expected: "https://resource.example.com/mcp",
    },
    {
      input: "http://RESOURCE.EXAMPLE.COM:80/mcp",
      expected: "http://resource.example.com/mcp",
    },
    {
      input: "https://RESOURCE.EXAMPLE.COM:8443/mcp",
      expected: "https://resource.example.com:8443/mcp",
    },
    {
      input: "https://RESOURCE.EXAMPLE.COM/MCP",
      expected: "https://resource.example.com/MCP",
    },
    {
      input: "https://RESOURCE.EXAMPLE.COM/mcp#fragment",
      expected: "https://resource.example.com/mcp",
    },
    {
      input: "https://RESOURCE.EXAMPLE.COM/mcp?tenant=acme#fragment",
      expected: "https://resource.example.com/mcp?tenant=acme",
    },
    {
      input: "https://[2001:db8::1]:443/mcp",
      expected: "https://[2001:db8::1]/mcp",
    },
  ] as const;

  for (const vector of vectors) {
    it(`canonicalizes ${vector.input}`, () => {
      expect(canonicalizeResourceIndicator(vector.input)).toBe(vector.expected);
    });
  }

  it("rejects relative URLs", () => {
    expect(() => canonicalizeResourceIndicator("/mcp")).toThrow(
      "Resource indicator must be an absolute URL"
    );
  });
});
