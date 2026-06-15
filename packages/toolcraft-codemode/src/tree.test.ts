import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { S } from "toolcraft-schema";

import { resolveCommandTree } from "./tree.js";

function testCommand(name: string, scope?: Array<"cli" | "mcp" | "sdk">) {
  return defineCommand({
    name,
    scope,
    params: S.Object({}),
    handler: async () => null
  });
}

describe("resolveCommandTree", () => {
  it("walks nested commands in insertion order and groups export names by parent path", async () => {
    const statusCommand = testCommand("status", ["sdk"]);
    const root = defineGroup({
      name: "root",
      children: [
        statusCommand,
        defineGroup({
          name: "issues",
          children: [
            testCommand("list", ["mcp"]),
            defineGroup({
              name: "comments",
              children: [
                testCommand("create", ["sdk"]),
                testCommand("preview", ["cli"]),
                testCommand("mirror", ["cli", "sdk"])
              ]
            }),
            testCommand("archive", ["cli"])
          ]
        }),
        defineGroup({
          name: "users",
          children: [testCommand("get")]
        })
      ]
    });

    const tree = await resolveCommandTree(root);
    const resolvedStatusCommand = root.children[0];

    expect(resolvedStatusCommand?.kind).toBe("command");
    expect(tree.entries[0]?.command).toBe(resolvedStatusCommand);
    expect(
      tree.entries.map((entry) => ({
        path: entry.path,
        groupPath: entry.groupPath,
        name: entry.name,
        commandName: entry.command.name
      }))
    ).toEqual([
      {
        path: "status",
        groupPath: "",
        name: "status",
        commandName: "status"
      },
      {
        path: "issues.comments.create",
        groupPath: "issues.comments",
        name: "create",
        commandName: "create"
      },
      {
        path: "issues.comments.mirror",
        groupPath: "issues.comments",
        name: "mirror",
        commandName: "mirror"
      },
      {
        path: "users.get",
        groupPath: "users",
        name: "get",
        commandName: "get"
      }
    ]);

    expect([...tree.exportsByGroupPath.entries()]).toEqual([
      ["", ["status"]],
      ["issues.comments", ["create", "mirror"]],
      ["users", ["get"]]
    ]);
  });

  it("respects resolved inherited scopes and omits groups without programmatic commands", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "cli_only",
          scope: ["cli"],
          children: [
            testCommand("inherited_cli"),
            testCommand("explicit_sdk", ["sdk"]),
            defineGroup({
              name: "nested",
              children: [testCommand("still_cli"), testCommand("explicit_mcp", ["mcp"])]
            })
          ]
        }),
        defineGroup({
          name: "empty",
          children: []
        }),
        defineGroup({
          name: "mcp_group",
          scope: ["mcp"],
          children: [testCommand("inherited_mcp")]
        })
      ]
    });

    const tree = await resolveCommandTree(root);

    expect(tree.entries.map((entry) => entry.path)).toEqual(["cli_only.explicit_sdk"]);

    expect([...tree.exportsByGroupPath.entries()]).toEqual([["cli_only", ["explicit_sdk"]]]);
  });

  it("canonicalizes separator names without colliding nested groups", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({ name: "a.b", children: [testCommand("read.secret", ["sdk"])] }),
        defineGroup({
          name: "a",
          children: [defineGroup({ name: "b", children: [testCommand("read_secret", ["sdk"])] })]
        })
      ]
    });

    const tree = await resolveCommandTree(root);

    expect(tree.entries.map((entry) => entry.path)).toEqual(["a_b.read_secret", "a.b.read_secret"]);
    expect([...tree.exportsByGroupPath.entries()]).toEqual([
      ["a_b", ["read_secret"]],
      ["a.b", ["read_secret"]]
    ]);
  });

  it("fails when commands collapse onto the same executable export", async () => {
    const root = defineGroup({
      name: "root",
      children: [testCommand("read.secret", ["sdk"]), testCommand("read_secret", ["sdk"])]
    });

    await expect(resolveCommandTree(root)).rejects.toThrow(
      'Duplicate codemode command path "read_secret".'
    );
  });

  it("rejects executable command names that normalize to an empty path segment", async () => {
    const root = defineGroup({
      name: "root",
      children: [testCommand("---", ["sdk"])]
    });

    await expect(resolveCommandTree(root)).rejects.toThrow(
      'Codemode command name "---" must include at least one non-separator character.'
    );
  });
});
