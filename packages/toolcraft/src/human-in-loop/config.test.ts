import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { ApprovalDeclinedError, defineCommand, defineGroup, UserError } from "../index.js";

describe("human-in-loop config", () => {
  it("materializes humanInLoop on commands", () => {
    const humanInLoop = {
      mode: "sync" as const,
      message: ({ params, commandPath }: { params: { name: string }; commandPath: string }) =>
        `Run ${commandPath} for ${params.name}?`,
      declineInputPrompt: "Why not?",
    };

    const command = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String(),
      }),
      humanInLoop,
      handler: async () => null,
    });

    expect(command.humanInLoop).toBe(humanInLoop);
    expect(command.humanInLoop?.declineInputPrompt).toBe("Why not?");
    expect(command.humanInLoop?.message({ params: { name: "production" }, commandPath: "deploy" })).toBe(
      "Run deploy for production?"
    );
  });

  it("throws when confirm and humanInLoop are both set", () => {
    expect(() =>
      defineCommand({
        name: "deploy",
        confirm: true,
        params: S.Object({}),
        humanInLoop: {
          mode: "sync",
          message: () => "Run deploy?",
        },
        handler: async () => null,
      })
    ).toThrowError("command 'deploy': use either confirm or humanInLoop, not both");
  });

  it("throws when humanInLoop.mode is invalid", () => {
    expect(() =>
      defineCommand({
        name: "deploy",
        params: S.Object({}),
        humanInLoop: {
          mode: "weird" as never,
          message: () => "Run deploy?",
        },
        handler: async () => null,
      })
    ).toThrowError('command \'deploy\': humanInLoop.mode must be "sync" or "async"');
  });

  it("throws when humanInLoop.message is not a function", () => {
    expect(() =>
      defineCommand({
        name: "deploy",
        params: S.Object({}),
        humanInLoop: {
          mode: "sync",
          message: "Run deploy?" as never,
        },
        handler: async () => null,
      })
    ).toThrowError("command 'deploy': humanInLoop.message must be a function");
  });

  it("throws when humanInLoop.plan is not a function", () => {
    expect(() =>
      defineCommand({
        name: "deploy",
        params: S.Object({}),
        humanInLoop: {
          mode: "sync",
          message: () => "Run deploy?",
          plan: {} as never
        },
        handler: async () => null
      })
    ).toThrowError("command 'deploy': humanInLoop.plan must be a function");
  });

  it("exports ApprovalDeclinedError from the package root", () => {
    const error = new ApprovalDeclinedError({
      commandPath: "deploy.production",
      reason: "Need ticket",
      approvalId: "approval-123",
    });

    expect(error).toBeInstanceOf(UserError);
    expect(error.commandPath).toBe("deploy.production");
    expect(error.approvalId).toBe("approval-123");
    expect(error.reason).toBe("Need ticket");
    expect(error.message).toBe("Declined: Need ticket");
  });

  it("inherits from groups, supports null opt-out, and allows overrides", () => {
    const rootHumanInLoop = {
      mode: "sync" as const,
      message: ({ commandPath }: { params: Record<string, never>; commandPath: string }) =>
        `Run ${commandPath}?`,
    };
    const overrideHumanInLoop = {
      mode: "async" as const,
      message: ({ commandPath }: { params: Record<string, never>; commandPath: string }) =>
        `Queue ${commandPath}?`,
    };

    const inheritedCommand = defineCommand({
      name: "inherited-command",
      params: S.Object({}),
      handler: async () => null,
    });
    const optedOutCommand = defineCommand({
      name: "opted-out-command",
      params: S.Object({}),
      humanInLoop: null,
      handler: async () => null,
    });
    const overriddenCommand = defineCommand({
      name: "overridden-command",
      params: S.Object({}),
      humanInLoop: overrideHumanInLoop,
      handler: async () => null,
    });

    const inheritedGroup = defineGroup({
      name: "inherited-group",
      children: [
        defineCommand({
          name: "nested-inherited-command",
          params: S.Object({}),
          handler: async () => null,
        }),
      ],
    });
    const optedOutGroup = defineGroup({
      name: "opted-out-group",
      humanInLoop: null,
      children: [
        defineCommand({
          name: "nested-opted-out-command",
          params: S.Object({}),
          handler: async () => null,
        }),
      ],
    });
    const overriddenGroup = defineGroup({
      name: "overridden-group",
      humanInLoop: overrideHumanInLoop,
      children: [
        defineCommand({
          name: "nested-overridden-command",
          params: S.Object({}),
          handler: async () => null,
        }),
      ],
    });

    const root = defineGroup({
      name: "root",
      humanInLoop: rootHumanInLoop,
      children: [
        inheritedCommand,
        optedOutCommand,
        overriddenCommand,
        inheritedGroup,
        optedOutGroup,
        overriddenGroup,
      ],
    });

    const materializedInheritedCommand = root.children[0];
    const materializedOptedOutCommand = root.children[1];
    const materializedOverriddenCommand = root.children[2];
    const materializedInheritedGroup = root.children[3];
    const materializedOptedOutGroup = root.children[4];
    const materializedOverriddenGroup = root.children[5];

    expect(materializedInheritedCommand?.kind).toBe("command");
    expect(materializedOptedOutCommand?.kind).toBe("command");
    expect(materializedOverriddenCommand?.kind).toBe("command");
    expect(materializedInheritedGroup?.kind).toBe("group");
    expect(materializedOptedOutGroup?.kind).toBe("group");
    expect(materializedOverriddenGroup?.kind).toBe("group");

    if (
      materializedInheritedCommand?.kind !== "command" ||
      materializedOptedOutCommand?.kind !== "command" ||
      materializedOverriddenCommand?.kind !== "command" ||
      materializedInheritedGroup?.kind !== "group" ||
      materializedOptedOutGroup?.kind !== "group" ||
      materializedOverriddenGroup?.kind !== "group"
    ) {
      throw new Error("Unexpected toolcraft node shape in test.");
    }

    expect(root.humanInLoop).toBe(rootHumanInLoop);
    expect(materializedInheritedCommand.humanInLoop).toBe(rootHumanInLoop);
    expect(materializedOptedOutCommand.humanInLoop).toBeNull();
    expect(materializedOverriddenCommand.humanInLoop).toBe(overrideHumanInLoop);

    expect(materializedInheritedGroup.humanInLoop).toBe(rootHumanInLoop);
    expect(materializedInheritedGroup.children[0]).toMatchObject({
      kind: "command",
      humanInLoop: rootHumanInLoop,
    });

    expect(materializedOptedOutGroup.humanInLoop).toBeNull();
    expect(materializedOptedOutGroup.children[0]).toMatchObject({
      kind: "command",
      humanInLoop: null,
    });

    expect(materializedOverriddenGroup.humanInLoop).toBe(overrideHumanInLoop);
    expect(materializedOverriddenGroup.children[0]).toMatchObject({
      kind: "command",
      humanInLoop: overrideHumanInLoop,
    });
  });
});
