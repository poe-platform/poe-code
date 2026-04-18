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
    expect(
      deriveVerb("delete", "/bots/{handle}", { operationId: "deleteBot" }, "deleteBot", "bots")
    ).toBe("delete");
  });

  it("uses the operationId for singleton GET endpoints", () => {
    expect(
      deriveVerb(
        "get",
        "/v1/whoami",
        { operationId: "whoami_v1_whoami_get" },
        "whoami_v1_whoami_get",
        "agent"
      )
    ).toBe("whoami");
  });

  it("preserves GET qualifiers from operationId when the path tail is too generic", () => {
    expect(
      deriveVerb(
        "get",
        "/events",
        { operationId: "activity/list-public-events" },
        "activity/list-public-events",
        "activity"
      )
    ).toBe("public-events");
  });

  it("falls back to the collection verb for generic GET operationIds", () => {
    expect(deriveVerb("get", "/users", { operationId: "listUsers" }, "listUsers", "users")).toBe(
      "list"
    );
  });

  it("keeps the path tail for non-collection GET operationIds that match it", () => {
    expect(
      deriveVerb("get", "/bots/search", { operationId: "viewSearch" }, "viewSearch", "bots")
    ).toBe("search");
  });

  it("drops duplicated tag prefixes from slash-delimited operationIds", () => {
    expect(
      deriveVerb(
        "post",
        "/repos/{owner}/{repo}/environments/{environment_name}/variables",
        { operationId: "actions/create-environment-variable" },
        "actions/create-environment-variable",
        "actions"
      )
    ).toBe("create-environment-variable");
  });

  it("keeps explicit camel-cased parameter names", () => {
    expect(normalizeParamName("botHandle")).toBe("botHandle");
  });

  it("splits separators and camelCase words", () => {
    expect(splitWords("set-image_comprehension.Mode/path")).toEqual([
      "set",
      "image",
      "comprehension",
      "mode",
      "path"
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
