import { describe, expect, it } from "vitest";
import { UserError } from "@poe-code/cmdkit";
import { deriveNoun, deriveVerb, normalizeParamName, splitWords, toMcpPrefix } from "./naming.js";

describe("naming", () => {
  it("uses tags[0] as the noun", () => {
    expect(deriveNoun({ tags: ["bots", "ignored"] }, "listBots")).toBe("bots");
  });

  it("throws when tags[0] is missing", () => {
    expect(() => deriveNoun({}, "listBots")).toThrowError(
      new UserError('Operation "listBots" must define tags[0] to derive a command noun.')
    );
  });

  it("uses delete as the default delete verb", () => {
    expect(deriveVerb("delete", "/bots/{handle}", { operationId: "deleteBot" }, "deleteBot")).toBe(
      "delete"
    );
  });

  it("keeps explicit camel-cased parameter names", () => {
    expect(normalizeParamName("botHandle")).toBe("botHandle");
  });

  it("splits separators and camelCase words", () => {
    expect(splitWords("set-image_comprehension.Mode")).toEqual([
      "set",
      "image",
      "comprehension",
      "mode"
    ]);
  });

  it("splits acronym boundaries", () => {
    expect(splitWords("createOAuthToken")).toEqual(["create", "o", "auth", "token"]);
    expect(splitWords("getSSOConfig")).toEqual(["get", "sso", "config"]);
    expect(splitWords("userAPIKey")).toEqual(["user", "api", "key"]);
  });

  it("maps CLI names to MCP prefixes", () => {
    expect(toMcpPrefix("internal-agent")).toBe("internal_agent");
  });
});
