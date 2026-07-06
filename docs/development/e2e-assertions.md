# E2E Assertion Guide

Use this guide when adding or reviewing tests under `e2e/`. Keep assertions tied
to observable behavior, generated files, and the selected backend. Do not copy
absolute paths or model ids from one provider test into another.

## Baseline Pattern

New provider e2e tests should normally cover this flow:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { useContainer } from "@poe-code/e2e-test-runner";

describe("agent-name", () => {
  const container = useContainer({ testName: "agent-name" });

  beforeEach(async () => {
    const installResult = await container.exec("poe-code install agent-name");
    expect(installResult).toHaveExitCode(0);
  });

  it("configure and test", async () => {
    const configureResult = await container.exec("poe-code configure agent-name --yes");
    expect(configureResult).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.home}/path/to/generated/config`);

    const testResult = await container.exec("poe-code test agent-name");
    expect(testResult).toSucceedWith("Tested Agent Label.");
  });
});
```

Prefer the runner matchers over raw string checks:

- `toHaveExitCode(0)` for command success.
- `toSucceedWith("...")` when the CLI must print a stable success line.
- `toFail()` and `toHaveStderr("...")` for expected failures.
- `toHaveFile(path)` for generated config and state files.

## Path Rules

Always build paths from runner-provided locations:

- Use `container.home` for user config such as `.codex/config.toml`.
- Use `container.workspace` for files the agent should create in the test repo.
- Avoid `/root`, `/home/poe`, and host temp paths in assertions.

`container.home` changes by backend:

| Backend   | `container.home`         |
| --------- | ------------------------ |
| `env`     | Temporary host directory |
| `sandbox` | Temporary host directory |
| `podman`  | `/home/poe`              |

## Configure Assertions

`poe-code configure <agent> --yes` should assert:

- exit code `0`;
- the provider-specific config file exists under `container.home`;
- the config parses with the right parser for its format;
- required Poe wiring is present: provider name, base URL, API-key reference or
  stored secret;
- provider-specific files are created when the provider needs more than one file.

Do not assert every generated field. Assert the fields that prove the command
wrote a usable provider config.

For model assertions, import the default from `src/cli/constants.ts` when the
test is checking the current default. Use an explicit `--model <model-id>` when
the behavior under test is model override handling.

## Test Command Assertions

`poe-code test <agent>` should assert:

- command success through `toSucceedWith("Tested <Agent Label>.")`;
- no dependency on `POE_API_KEY` when the provider stores its own secret during
  configure;
- isolated mode when the provider supports it:

```typescript
const result = await container.exec("poe-code test agent-name --isolated");
expect(result).toSucceedWith("Tested Agent Label.");
```

For isolated mode, assert copied or generated state under
`${container.home}/.poe-code/<agent>/...` only when that state is part of the
contract.

## Spawn Assertions

Use spawn e2e coverage only when a provider feature cannot be proven by
`configure` plus `test`.

Good spawn assertions:

- command exits with code `0`;
- the agent creates or edits an expected file in `container.workspace`;
- the file content proves the prompt was followed;
- MCP spawn tests validate tool output, not generic agent prose.

Keep prompts deterministic and scoped to one observable effect.

## Output Matching

The e2e runner success matcher treats expected stdout as a complete trimmed line.
Use stable CLI result lines such as `Tested Codex.` rather than full output
transcripts.

When warnings are part of the behavior, combine stdout and stderr and assert on
the exact warning fragments that matter.

## What Not To Assert

Avoid assertions on:

- provider default model ids copied into the test as string literals;
- full config file snapshots;
- absolute backend paths;
- terminal color codes or decorative formatting;
- generated config fields that are not part of the behavior under test;
- installation messages that vary by already-installed state.

## When Adding A Provider

A provider e2e test should prove the one provider file works through the public
CLI:

1. `poe-code install <agent>` succeeds or no-ops cleanly.
2. `poe-code configure <agent> --yes` writes valid provider config.
3. `poe-code test <agent>` succeeds.
4. `poe-code test <agent> --isolated` succeeds when isolation is supported.
5. A focused spawn test exists only for provider-specific spawn behavior.
