import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createCLICommandTreeSnapshot } from "./cli.js";

describe("createCLICommandTreeSnapshot", () => {
  it("returns deterministic CLI structure with hidden commands and typed options", async () => {
    const deploy = defineCommand({
      name: "deploy",
      description: "Deploy the service.",
      aliases: ["ship"],
      positional: ["environment"],
      params: S.Object({
        environment: S.String({ description: "Target environment." }),
        replicas: S.Number({ description: "Replica count.", default: 2 }),
        dryRun: S.Optional(S.Boolean({ description: "Preview the deployment.", short: "n" }))
      }),
      scope: ["cli"],
      handler: async () => ({ ok: true })
    });
    const internal = defineCommand({
      name: "internal",
      hidden: true,
      params: S.Object({}),
      scope: ["cli"],
      handler: async () => ({ ok: true })
    });
    const mcpOnly = defineCommand({
      name: "mcp-only",
      params: S.Object({}),
      scope: ["mcp"],
      handler: async () => ({ ok: true })
    });
    const root = defineGroup({
      name: "acme",
      children: [deploy, internal, mcpOnly],
      default: deploy
    });

    const controls = {
      debug: true,
      output: { formats: { compact: () => "" } },
      verbose: true,
      yes: true
    } as const;
    const first = await createCLICommandTreeSnapshot(root, {
      controls,
      presets: true,
      version: "1.2.3"
    });
    const second = await createCLICommandTreeSnapshot(root, {
      controls,
      presets: true,
      version: "1.2.3"
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      globalOptions: [
        { name: "help", flags: ["-h", "--help"], type: "boolean", hidden: false },
        { name: "preset", flags: ["--preset"], type: "string", hidden: true },
        { name: "yes", flags: ["--yes"], type: "boolean", hidden: true },
        {
          name: "output",
          flags: ["--output"],
          type: "enum",
          hidden: true,
          choices: ["rich", "md", "markdown", "json", "compact"]
        },
        { name: "debug", flags: ["--debug"], type: "enum", hidden: true },
        { name: "verbose", flags: ["-v", "--verbose"], type: "boolean", hidden: true },
        { name: "version", flags: ["--version"], type: "boolean", hidden: false }
      ],
      root: {
        kind: "group",
        name: "acme",
        path: [],
        children: [
          {
            kind: "command",
            name: "deploy",
            path: ["deploy"],
            aliases: ["ship"],
            hidden: false,
            default: true,
            options: [
              {
                name: "environment",
                flags: ["<environment>"],
                type: "string",
                required: true,
                positional: true
              },
              {
                name: "replicas",
                flags: ["--replicas <value>"],
                type: "number",
                required: false,
                default: 2
              },
              {
                name: "dryRun",
                flags: ["-n", "--dry-run"],
                type: "boolean",
                required: false
              }
            ]
          },
          {
            kind: "command",
            name: "internal",
            path: ["internal"],
            hidden: true,
            default: false
          }
        ]
      }
    });
    expect(first.root.children.map((child) => child.name)).not.toContain("mcp-only");
  });

  it("includes Toolcraft-injected approval commands when enabled", async () => {
    const root = defineGroup({ name: "acme", children: [] });

    const snapshot = await createCLICommandTreeSnapshot(root, { approvals: true });
    const approvals = snapshot.root.children.find((child) => child.name === "approvals");

    expect(approvals).toMatchObject({
      kind: "group",
      path: ["approvals"],
      children: [{ name: "list" }, { name: "show" }, { name: "run" }]
    });
  });
});
