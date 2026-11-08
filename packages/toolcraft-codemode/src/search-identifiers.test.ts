import { describe, expect, it, vi } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { S, toJsonSchema } from "toolcraft-schema";
import { createSDK } from "toolcraft/sdk";
import { createMCPServer } from "toolcraft/mcp";
import { codeMode } from "./index.js";
import { makeSearchCommand, type SearchDefaults, type SearchResult } from "./search.js";
import { resolveCommandTree } from "./tree.js";

function fixture(defaults: SearchDefaults = {}) {
  const handler = vi.fn(() => "ready");
  const params = S.Object({ id: S.Optional(S.String()) });
  const root = defineGroup({ name: "audit", children: [
    defineGroup({ name: "people", children: ["get-user", "get-team", "delete-user", "user", "пользователь", "χρήστης", "用户"].map((name) =>
      defineCommand({ name, scope: ["sdk"], params, handler })) }),
    defineGroup({ name: "menu", children: ["café", "cafè"].map((name) =>
      defineCommand({ name, scope: ["sdk"], params, handler })) }),
    defineGroup({ name: "system", children: [defineCommand({ name: "XMLHttpRequest", scope: ["sdk"], params, handler })] }),
    defineGroup({ name: "account-admin", children: [defineCommand({ name: "reset-password", scope: ["sdk"], params, handler })] }),
    defineGroup({ name: "support", children: [
      defineCommand({ name: "inspect", description: "Get user details", scope: ["sdk"], params, handler }),
      defineCommand({ name: "notes", description: "User's version v1.2 notes", scope: ["sdk"], params, handler }),
      defineCommand({ name: "quotes", description: "Owner’s account reference", scope: ["sdk"], params, handler })
    ] })
  ] });
  const command = makeSearchCommand({
    entries: resolveCommandTree(root).then((tree) => tree.entries), defaults
  });
  return { root, command, handler, params };
}

describe("identifier-component search", () => {
  it.each([
    { query: "get_user", expected: "people.get_user" },
    { query: "get-user", expected: "people.get_user" },
    { query: "getUser", expected: "people.get_user" },
    { query: "GET_USER", expected: "people.get_user" },
    { query: "people.getUser", expected: "people.get_user" },
    { query: "admin", expected: "account_admin.reset_password" },
    { query: "password", expected: "account_admin.reset_password" },
    { query: "resetPassword", expected: "account_admin.reset_password" },
    { query: "accountAdmin.resetPassword", expected: "account_admin.reset_password" },
    { query: "XMLHttpRequest", expected: "system.xml_http_request" },
    { query: "http", expected: "system.xml_http_request" },
    { query: "request", expected: "system.xml_http_request" },
    { query: "SYSTEM/XMLHttpRequest!", expected: "system.xml_http_request" }
  ])("ranks the identifier match first for $query", async ({ query, expected }) => {
    const { command, handler } = fixture();
    const results = await command.handler({ params: { query } } as never);

    expect(results[0]?.path).toBe(expected);
    expect(new Set(results.map((result) => result.path)).size).toBe(results.length);
    expect(handler).not.toHaveBeenCalled();
  });

  it("finds resource nouns without relying on descriptions", async () => {
    const { command, handler } = fixture();
    const results = await command.handler({ params: { query: "user" } } as never);

    expect(results[0]?.path).toBe("people.user");
    expect(results.map((result) => result.path)).toEqual(expect.arrayContaining([
      "people.user", "people.get_user", "people.delete_user"
    ]));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("Unicode search terms", () => {
  it.each([
    { query: "café", expected: "menu.café" },
    { query: "cafe\u0301", expected: "menu.café" },
    { query: "CAFÉ", expected: "menu.café" },
    { query: "cafè", expected: "menu.cafè" },
    { query: "пользователь", expected: "people.пользователь" },
    { query: "ПОЛЬЗОВАТЕЛЬ", expected: "people.пользователь" },
    { query: "χρήστης", expected: "people.χρήστης" },
    { query: "ΧΡΉΣΤΗΣ", expected: "people.χρήστης" },
    { query: "用户", expected: "people.用户" }
  ])("preserves the complete term $query", async ({ query, expected }) => {
    const { command, handler } = fixture();
    const results = await command.handler({ params: { query } } as never);

    expect(results.map((result) => result.path)).toEqual([expected]);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("search compatibility controls", () => {
  it.each(["", "  ", "_", "__", "---...---", "😀"])("keeps %j token-free", async (query) => {
    const { command } = fixture();
    await expect(command.handler({ params: { query } } as never)).resolves.toEqual([]);
  });

  it.each([
    { query: "2", expected: "support.notes" },
    { query: "version", expected: "support.notes" },
    { query: "owner", expected: "support.quotes" }
  ])("retains punctuation-separated description terms for $query", async ({ query, expected }) => {
    const { command } = fixture();
    const results = await command.handler({ params: { query } } as never);
    expect(results.map((result) => result.path)).toEqual([expected]);
  });

  describe.each(["brief", "detailed", "full"] as const)("%s results", (detail) => {
    it.each([0, 1, 3])("keeps result limit %s and schema detail", async (limit) => {
      const { command, params, handler } = fixture({ limit: 2, detail });
      const results = await command.handler({ params: { query: "getUser", limit } } as never);

      expect(results).toHaveLength(limit);
      if (limit > 0) expect(results[0]?.path).toBe("people.get_user");
      for (const result of results) {
        if (detail === "brief") expect(result).not.toHaveProperty("schema");
        else expect(result.schema).toEqual(toJsonSchema(params));
      }
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it.each([undefined, 3])("retains default and explicit limits for %s", async (limit) => {
    const { command } = fixture({ limit: 2 });
    const results = await command.handler({ params: { query: "user", ...(limit === undefined ? {} : { limit }) } } as never);
    expect(results).toHaveLength(limit ?? 2);
  });

  it("keeps deterministic catalog order for equal scores", async () => {
    const root = defineGroup({ name: "audit", children: ["beta", "alpha"].map((name) => defineGroup({
      name, children: [defineCommand({ name: "lookup", description: "Shared", scope: ["sdk"], params: S.Object({}), handler: () => null })]
    })) });
    const command = makeSearchCommand({ entries: (await resolveCommandTree(root)).entries });
    const results = await command.handler({ params: { query: "shared" } } as never);

    expect(results.map((result) => result.path)).toEqual(["beta.lookup", "alpha.lookup"]);
  });
});

describe.each(["sdk", "mcp"] as const)("public %s search", (surface) => {
  it.each([
    { query: "user", expected: "people.get_user" },
    { query: "getUser", expected: "people.get_user" },
    { query: "admin", expected: "account_admin.reset_password" },
    { query: "request", expected: "system.xml_http_request" },
    { query: "café", expected: "menu.café" },
    { query: "cafè", expected: "menu.cafè" },
    { query: "cafe\u0301", expected: "menu.café" },
    { query: "用户", expected: "people.用户" }
  ])("finds $query without executing catalog handlers", async ({ query, expected }) => {
    const { root, handler } = fixture();
    const group = codeMode(root, { approvals: false });
    let results: SearchResult[];

    if (surface === "sdk") {
      const sdk = createSDK(group, { approvals: false }) as { search(params: { query: string }): Promise<SearchResult[]> };
      results = await sdk.search({ query });
    } else {
      const session = createMCPServer(group, { name: "audit", version: "1", errorReports: false }).createMessageSession(() => {});
      try {
        await session.handleMessage("initialize", {
          protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
        });
        await session.handleMessage("notifications/initialized");
        const response = await session.handleMessage("tools/call", { name: "code_mode__search", arguments: { query } });
        expect(response.error).toBeUndefined();
        results = (response.result as { content: Array<{ text: string }> }).content.map((block) => JSON.parse(block.text) as SearchResult);
      } finally {
        await session.close();
      }
    }

    expect(results.map((result) => result.path)).toContain(expected);
    if (query.startsWith("caf")) expect(results).toHaveLength(1);
    expect(handler).not.toHaveBeenCalled();
  });
});
