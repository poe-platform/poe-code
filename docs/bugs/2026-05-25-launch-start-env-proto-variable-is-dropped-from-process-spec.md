# `launch start --env` Drops a `__proto__` Process Variable from the Spec

## Summary

The public `poe-code launch start --env KEY=VALUE` CLI accepts an environment entry named `__proto__` but silently drops it before forwarding the process specification to the launch SDK. The command parser builds its environment map as an ordinary object and assigns dynamic user-provided names through bracket notation.

## Reproduction

Create a disposable Vitest probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../../utils/file-system.js";
import { createCliContainer } from "../container.js";
import { registerLaunchCommand } from "./launch.js";

const { startLaunchMock } = vi.hoisted(() => ({ startLaunchMock: vi.fn() }));

vi.mock("../../sdk/launch.js", () => ({
  followLaunchLogs: vi.fn(), listLaunches: vi.fn(), readLaunchLogs: vi.fn(), removeLaunch: vi.fn(),
  restartLaunch: vi.fn(), runLaunchDaemon: vi.fn(), startLaunch: startLaunchMock, stopLaunch: vi.fn()
}));

it("drops an explicitly provided __proto__ process variable", async () => {
  startLaunchMock.mockResolvedValue(undefined);
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  const volume = new Volume();
  volume.mkdirSync("/repo", { recursive: true });
  volume.mkdirSync("/home/test/.poe-code", { recursive: true });
  registerLaunchCommand(program, createCliContainer({
    fs: createFsFromVolume(volume).promises as unknown as FileSystem,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd: "/repo", homeDir: "/home/test", variables: { POE_CODE_OAUTH_LOGIN: "0" } },
    logger: () => {}
  }));

  await program.parseAsync(["node", "cli", "launch", "start", "api", "--env", "__proto__=visible", "--", "node", "server.js"]);

  const spec = startLaunchMock.mock.calls[0]?.[0].spec;
  expect(Object.hasOwn(spec.env, "__proto__")).toBe(false);
  expect(spec.env).toEqual({});
});
```

Run:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the successfully parsed CLI request reaches `startLaunch()` without the supplied environment entry. Remove the disposable probe after validation.

## Observed Behavior

Invoking `launch start api --env __proto__=visible -- node server.js` calls the SDK mock with `spec.env` equal to `{}` and without an own `__proto__` property. In `src/cli/commands/launch.ts`, the `--env` values are passed into `parseEnvEntries()`, which initializes `env = {}` and stores each user-controlled key via `env[key] = value` before assigning it to `spec.env`.

## Expected Behavior

The CLI should preserve each explicitly provided process environment variable, including a name such as `__proto__`, or reject unsupported variable names with a clear validation error rather than silently altering the requested launch specification.

## Impact

CLI users can successfully issue a managed-process launch command whose forwarded process specification does not contain all requested environment variables. A process that relies on such a variable starts with incomplete configuration and no indication that the CLI discarded it.
