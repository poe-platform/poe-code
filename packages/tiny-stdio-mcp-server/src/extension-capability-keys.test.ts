import { expect, it } from "vitest";
import { validateProtocolValue } from "./protocol.js";

it.each(["unprefixed", "bad key", "/name", "9prefix/name", "com..example/name", "com.example/a/b"])("rejects invalid extension identifier %j in both capability maps", (key) => {
  expect(validateProtocolValue("ClientCapabilities", { extensions: { [key]: {} } })).toBe(false);
  expect(validateProtocolValue("DiscoverResult", {
    resultType: "complete", supportedVersions: ["2026-07-28"], ttlMs: 0, cacheScope: "private",
    capabilities: { extensions: { [key]: {} } }
  })).toBe(false);
});

it.each(["com.example/feature", "io.modelcontextprotocol/tasks", "prefix/"])("preserves valid extension identifier %j and application settings", (key) => {
  expect(validateProtocolValue("ClientCapabilities", { extensions: { [key]: { "application key": null } } })).toBe(true);
});
