import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, UserError, defineCommand, defineGroup } from "toolcraft";
import { runCLI } from "toolcraft/cli";

describe("generated array CLI shape", () => {
  const originalArgv = [...process.argv];
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  beforeEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    vi.restoreAllMocks();

    if (stdoutTTY === undefined) {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    } else {
      Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    }

    if (stdinTTY === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    } else {
      Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    }
  });

  it('accepts --starters-json alone for a required generated array param shape', async () => {
    const handler = vi.fn(async ({ params }: { params: { starters?: string[]; startersJson?: string } }) => {
      let resolvedStarters = params.starters;

      if (params.starters !== undefined && params.startersJson !== undefined) {
        throw new UserError('Options "--starters" and "--starters-json" are mutually exclusive.');
      }

      if (params.startersJson !== undefined) {
        const parsedJson: unknown = JSON.parse(params.startersJson);

        if (!Array.isArray(parsedJson)) {
          throw new UserError('Invalid value for "--starters-json". Expected a JSON array.');
        }

        resolvedStarters = parsedJson as string[];
      }

      if (resolvedStarters === undefined) {
        throw new UserError('Missing required parameter "starters".');
      }

      return { starters: resolvedStarters };
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const command = defineCommand({
      name: "set-conversation-starters",
      params: S.Object({
        starters: S.Optional(S.Array(S.String())),
        startersJson: S.Optional(
          S.String({
            description: "JSON-encoded value for starters.",
            scope: ["cli"]
          })
        )
      }),
      handler,
      render: {
        json: (result) => result
      }
    });
    const root = defineGroup({
      name: "internal-agent",
      children: [
        defineGroup({
          name: "bots",
          children: [command]
        })
      ]
    });

    process.argv = [
      "node",
      "internal-agent",
      "bots",
      "set-conversation-starters",
      "--starters-json",
      '["a"]',
      "--output",
      "json"
    ];

    await runCLI(root, { controls: { output: true } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      startersJson: '["a"]'
    });
    expect(stdoutWrite).toHaveBeenCalled();
  });
});
