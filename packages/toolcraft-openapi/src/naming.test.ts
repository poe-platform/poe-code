import { describe, expect, it } from "vitest";
import { UserError } from "toolcraft";
import {
  deriveNoun,
  deriveVerb,
  normalizeParamName,
  splitWords,
  toCliFlag,
  toMcpPrefix
} from "./naming.js";

describe("naming", () => {
  it("uses tags[0] as the noun", () => {
    expect(deriveNoun({ tags: ["bots", "ignored"] }, "/bots", "listBots")).toBe("bots");
  });

  it("falls back to the first static path segment when tags[0] is missing", () => {
    expect(deriveNoun({}, "/v1/accounts", "listAccounts")).toBe("accounts");
    expect(deriveNoun({}, "/api/v1/chat/completions", "createChatCompletion")).toBe("chat");
  });

  it("falls back to the operation ID when the path has no usable noun segment", () => {
    expect(deriveNoun({}, "/{botHandle}", "viewBot")).toBe("view-bot");
    expect(deriveNoun({}, "/", "OPTIONS /")).toBe("options");
  });

  it("normalizes punctuation-heavy nouns", () => {
    expect(deriveNoun({ tags: ["Product [identifier]"] }, "/products", "listProducts")).toBe(
      "product-identifier"
    );
    expect(
      deriveNoun({}, "/#X-Amz-Target=AWSMigrationHub.AssociateCreatedArtifact", "associate")
    ).toBe("x-amz-target-aws-migration-hub-associate-created-artifact");
  });

  it("uses delete as the default delete verb", () => {
    expect(
      deriveVerb("delete", "/bots/{handle}", { operationId: "deleteBot" }, "deleteBot", "bots")
    ).toBe("delete");
  });

  it("derives stable create and update verbs when operationId is absent", () => {
    expect(deriveVerb("post", "/bots", {}, "POST /bots", "bots")).toBe("create");
    expect(deriveVerb("post", "/bots/search", {}, "POST /bots/search", "bots")).toBe(
      "create-search"
    );
    expect(deriveVerb("put", "/bots/{id}", {}, "PUT /bots/{id}", "bots")).toBe("update");
    expect(deriveVerb("put", "/bots/{id}/roles", {}, "PUT /bots/{id}/roles", "bots")).toBe(
      "update-roles"
    );
  });

  it("uses stable defaults for HEAD and OPTIONS", () => {
    expect(deriveVerb("head", "/bots/{id}", {}, "HEAD /bots/{id}", "bots")).toBe("check");
    expect(deriveVerb("options", "/bots", {}, "OPTIONS /bots", "bots")).toBe("options");
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

  it("derives GET verbs for actions endpoints from the operationId instead of the path segment", () => {
    expect(
      deriveVerb(
        "get",
        "/repos/{owner}/{repo}/actions/workflows",
        { operationId: "actions/list-repo-workflows" },
        "actions/list-repo-workflows",
        "actions"
      )
    ).toBe("repo-workflows");
  });

  it("keeps delete as the default verb for delete actions endpoints", () => {
    expect(
      deriveVerb(
        "delete",
        "/repos/{owner}/{repo}/actions/caches",
        { operationId: "actions/delete-actions-cache-by-key" },
        "actions/delete-actions-cache-by-key",
        "actions"
      )
    ).toBe("delete");
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

  it("shares CLI flag kebab-casing across camelCase, snake_case, and acronyms", () => {
    expect(toCliFlag("botHandle")).toBe("bot-handle");
    expect(toCliFlag("bot_handle")).toBe("bot-handle");
    expect(toCliFlag("userAPIKey")).toBe("user-api-key");
  });
});
