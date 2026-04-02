import { describe, expect, it, vi } from "vitest";
import { S } from "@poe-code/cmdkit-schema";
import {
  UserError,
  assertCommandRequirements,
  defineCommand,
  defineGroup,
  resolveCommandSecrets,
} from "@poe-code/cmdkit";

describe("@poe-code/cmdkit", () => {
  function createPreflightContext() {
    return {
      fetch: globalThis.fetch,
      fs: {
        readFile: async () => "",
        writeFile: async () => undefined,
        exists: async () => true,
      },
      env: {
        get: () => undefined,
      },
      progress: () => undefined,
    };
  }

  it("inherits secrets through nested groups", () => {
    const leaf = defineCommand({
      name: "leaf",
      params: S.Object({
        name: S.String(),
      }),
      secrets: {
        leafToken: {
          env: "LEAF_TOKEN",
        },
      },
      handler: async () => null,
    });

    const nested = defineGroup({
      name: "nested",
      secrets: {
        nestedToken: {
          env: "NESTED_TOKEN",
          optional: true,
        },
      },
      children: [leaf],
    });

    const root = defineGroup({
      name: "root",
      secrets: {
        rootToken: {
          env: "ROOT_TOKEN",
          description: "Root token",
        },
      },
      children: [nested],
    });

    const inheritedLeaf = root.children[0];
    expect(inheritedLeaf.kind).toBe("group");
    if (inheritedLeaf.kind !== "group") {
      throw new Error("Expected nested group");
    }

    const command = inheritedLeaf.children[0];
    expect(command.kind).toBe("command");
    if (command.kind !== "command") {
      throw new Error("Expected leaf command");
    }

    expect(command.secrets).toEqual({
      rootToken: {
        env: "ROOT_TOKEN",
        description: "Root token",
      },
      nestedToken: {
        env: "NESTED_TOKEN",
        optional: true,
      },
      leafToken: {
        env: "LEAF_TOKEN",
      },
    });
  });

  it("inherits scope through nested groups unless a child overrides it", () => {
    const inheritedLeaf = defineCommand({
      name: "inherited",
      params: S.Object({
        value: S.String(),
      }),
      handler: async () => null,
    });

    const overriddenLeaf = defineCommand({
      name: "overridden",
      scope: ["sdk"],
      params: S.Object({
        value: S.String(),
      }),
      handler: async () => null,
    });

    const nested = defineGroup({
      name: "nested",
      children: [inheritedLeaf, overriddenLeaf],
    });

    const root = defineGroup({
      name: "root",
      scope: ["mcp"],
      children: [nested],
    });

    const group = root.children[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      throw new Error("Expected nested group");
    }

    expect(group.scope).toEqual(["mcp"]);
    expect(group.children[0]?.kind).toBe("command");
    expect(group.children[1]?.kind).toBe("command");

    if (group.children[0]?.kind !== "command" || group.children[1]?.kind !== "command") {
      throw new Error("Expected commands");
    }

    expect(group.children[0].scope).toEqual(["mcp"]);
    expect(group.children[1].scope).toEqual(["sdk"]);
  });

  it("inherits and composes requires through group nesting", async () => {
    const calls: string[] = [];
    const rootCheck = vi.fn(async () => {
      calls.push("root");
      return { ok: true };
    });
    const nestedCheck = vi.fn(async () => {
      calls.push("nested");
      return { ok: true };
    });
    const leafCheck = vi.fn(async () => {
      calls.push("leaf");
      return { ok: true };
    });

    const leaf = defineCommand({
      name: "leaf",
      params: S.Object({
        name: S.String(),
      }),
      requires: {
        check: leafCheck,
      },
      handler: async () => null,
    });

    const nested = defineGroup({
      name: "nested",
      requires: {
        apiVersion: "2026-01-01",
        check: nestedCheck,
      },
      children: [leaf],
    });

    const root = defineGroup({
      name: "root",
      requires: {
        auth: true,
        check: rootCheck,
      },
      children: [nested],
    });

    const group = root.children[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      throw new Error("Expected nested group");
    }

    const command = group.children[0];
    expect(command.kind).toBe("command");
    if (command.kind !== "command") {
      throw new Error("Expected leaf command");
    }

    expect(command.requires?.auth).toBe(true);
    expect(command.requires?.apiVersion).toBe("2026-01-01");

    const result = await command.requires?.check?.({
      params: { name: "demo" },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: async () => "",
        writeFile: async () => undefined,
        exists: async () => true,
      },
      env: {
        get: () => undefined,
      },
      progress: () => undefined,
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["root", "nested", "leaf"]);
  });

  it("stops running descendant checks when an ancestor check fails", async () => {
    const nestedCheck = vi.fn(async () => ({ ok: true }));
    const leafCheck = vi.fn(async () => ({ ok: true }));

    const leaf = defineCommand({
      name: "leaf",
      params: S.Object({
        name: S.String(),
      }),
      requires: {
        check: leafCheck,
      },
      handler: async () => null,
    });

    const nested = defineGroup({
      name: "nested",
      requires: {
        check: nestedCheck,
      },
      children: [leaf],
    });

    const root = defineGroup({
      name: "root",
      requires: {
        check: async () => ({
          ok: false,
          message: "blocked",
        }),
      },
      children: [nested],
    });

    const group = root.children[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      throw new Error("Expected nested group");
    }

    const command = group.children[0];
    expect(command.kind).toBe("command");
    if (command.kind !== "command") {
      throw new Error("Expected leaf command");
    }

    const result = await command.requires?.check?.({
      params: { name: "demo" },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: async () => "",
        writeFile: async () => undefined,
        exists: async () => true,
      },
      env: {
        get: () => undefined,
      },
      progress: () => undefined,
    });

    expect(result).toEqual({
      ok: false,
      message: "blocked",
    });
    expect(nestedCheck).not.toHaveBeenCalled();
    expect(leafCheck).not.toHaveBeenCalled();
  });

  it("keeps secret definitions isolated from source config mutations and sibling nodes", () => {
    const rootSecret = {
      env: "ROOT_TOKEN",
      description: "Root token",
    };
    const leafSecret = {
      env: "LEAF_TOKEN",
    };

    const leaf = defineCommand({
      name: "leaf",
      params: S.Object({
        name: S.String(),
      }),
      secrets: {
        leafToken: leafSecret,
      },
      handler: async () => null,
    });

    const nested = defineGroup({
      name: "nested",
      children: [leaf],
    });

    const root = defineGroup({
      name: "root",
      secrets: {
        rootToken: rootSecret,
      },
      children: [nested],
    });

    rootSecret.env = "MUTATED_ROOT_TOKEN";
    leafSecret.env = "MUTATED_LEAF_TOKEN";

    expect(root.secrets.rootToken).toEqual({
      env: "ROOT_TOKEN",
      description: "Root token",
    });

    const group = root.children[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      throw new Error("Expected nested group");
    }

    const command = group.children[0];
    expect(command.kind).toBe("command");
    if (command.kind !== "command") {
      throw new Error("Expected leaf command");
    }

    expect(command.secrets).toEqual({
      rootToken: {
        env: "ROOT_TOKEN",
        description: "Root token",
      },
      leafToken: {
        env: "LEAF_TOKEN",
      },
    });

    command.secrets.rootToken.description = "Leaf view";
    expect(root.secrets.rootToken.description).toBe("Root token");
    expect(group.secrets.rootToken.description).toBe("Root token");
  });

  it("throws when a required secret has no description", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: { env: "TOKEN" },
      },
      handler: async () => null,
    });

    expect(() => resolveCommandSecrets(cmd, {})).toThrowError(
      new UserError("Error: Missing required secret TOKEN")
    );
  });

  it("passes undefined for optional secrets that are missing", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: { env: "TOKEN", optional: true },
      },
      handler: async () => null,
    });

    expect(resolveCommandSecrets(cmd, {})).toEqual({ token: undefined });
  });

  it("throws when a required inherited secret is missing", () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => null,
    });

    const root = defineGroup({
      name: "root",
      secrets: {
        apiKey: {
          env: "API_KEY",
          description: "Set it before running deploy.",
        },
      },
      children: [deploy],
    });

    const command = root.children[0];
    expect(command?.kind).toBe("command");
    if (command?.kind !== "command") {
      throw new Error("Expected deploy command");
    }

    expect(() =>
      resolveCommandSecrets(command, {
        API_KEY: undefined,
      })
    ).toThrowError(
      new UserError("Error: Missing required secret API_KEY\n  Set it before running deploy.")
    );
  });

  it("throws when auth is required and the auth env var is missing", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        auth: true,
      },
      handler: async () => null,
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext(), {
        env: {},
      })
    ).rejects.toThrowError(
      new UserError(`Error: Command "deploy" requires authentication.\n  Run 'poe-code login' first.`)
    );
  });

  it("throws when the runner api version does not satisfy the command requirement", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        apiVersion: ">=2.4.0",
      },
      handler: async () => null,
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext(), {
        apiVersion: "2.3.9",
      })
    ).rejects.toThrowError(
      new UserError(
        'Error: Command "deploy" requires API version >=2.4.0, but runner API version is 2.3.9.'
      )
    );
  });

  it("throws when a custom requirement check fails", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        check: async () => ({
          ok: false,
          message: "Account is not allowed to deploy.",
        }),
      },
      handler: async () => null,
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext())
    ).rejects.toThrowError(new UserError("Account is not allowed to deploy."));
  });

  it("uses a fallback message when check fails without one", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        check: async () => ({ ok: false }),
      },
      handler: async () => null,
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext())
    ).rejects.toThrowError(new UserError("Command precondition failed."));
  });

  it("throws when apiVersion requirement has invalid format", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        apiVersion: "1.0.0",
      },
      handler: async () => null,
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext())
    ).rejects.toThrowError(
      new UserError(
        'Error: Command "deploy" has invalid apiVersion requirement "1.0.0". Expected format ">=X.Y.Z".'
      )
    );
  });

  it("throws when apiVersion is required but runner provides none", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        apiVersion: ">=1.0.0",
      },
      handler: async () => null,
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext())
    ).rejects.toThrowError(
      new UserError(
        'Error: Command "deploy" requires API version >=1.0.0, but no runner API version was provided.'
      )
    );
  });

  it("throws when runner apiVersion is not valid semver", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        apiVersion: ">=1.0.0",
      },
      handler: async () => null,
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext(), {
        apiVersion: "not-semver",
      })
    ).rejects.toThrowError(
      new UserError(
        'Error: Command "deploy" requires API version >=1.0.0, but runner API version "not-semver" is not valid semver.'
      )
    );
  });

  it("materializes the default command and validates the declaration", () => {
    const run = defineCommand({
      name: "run",
      positional: ["name"],
      params: S.Object({
        name: S.String(),
      }),
      handler: async () => null,
    });

    const list = defineCommand({
      name: "list",
      params: S.Object({}),
      handler: async () => null,
    });

    const root = defineGroup({
      name: "root",
      scope: ["mcp"],
      secrets: {
        rootToken: {
          env: "ROOT_TOKEN",
        },
      },
      requires: {
        auth: true,
      },
      children: [run, list],
      default: run,
    });

    expect(root.default).toBe(root.children[0]);
    expect(root.default?.scope).toEqual(["mcp"]);
    expect(root.default?.secrets).toEqual({
      rootToken: {
        env: "ROOT_TOKEN",
      },
    });
    expect(root.default?.requires).toEqual({
      auth: true,
      apiVersion: undefined,
      check: undefined,
    });

    expect(() =>
      defineGroup({
        name: "invalid",
        children: [list],
        default: run,
      })
    ).toThrowError(
      new UserError('Default command "run" must be listed in children.')
    );
  });
});
