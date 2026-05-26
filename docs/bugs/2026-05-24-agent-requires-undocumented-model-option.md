# Agent requires undocumented model option

## Summary

Running the documented `agent <prompt>` form without `--model` immediately fails with `Missing model`, although the CLI exposes `--model` as an optional option and does not describe any required model argument or default-selection step.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and an environment API key

## Reproduction

From the repository root, invoke the one-shot agent command exactly in the form shown by its help output:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" POE_API_KEY=environment-agent-key \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" agent 'hello'
)
echo "exit=$?"

"$repo/node_modules/.bin/tsx" \
  --import "$repo/scripts/register-template-loader.mjs" \
  "$repo/src/index.ts" agent --help
```

## Observed Behavior

- `agent 'hello'` exits with status `1` before sending a prompt.
- The command prints `Error: Missing model. Provide a non-empty model to createAgentSession.`.
- `agent --help` shows usage as `poe-code agent [options] <prompt>` and lists `--model <model>` without marking it as required or identifying a default model.

## Expected Behavior

The advertised `agent <prompt>` invocation should run using a documented default model or interactive/default-selection behavior, or the CLI must require and clearly document a model argument before accepting the command form.

## Impact

- The primary one-shot agent invocation shown in CLI help is unusable as written.
- Scripts and users receive an internal session-construction error instead of an actionable command-level requirement.
- The command appears to accept a valid authenticated prompt request but cannot start unless callers discover an unstated `--model` requirement.

## Supporting Evidence

In `src/cli/commands/agent.ts`, the command registers `.option("--model <model>", "Model identifier")` and passes `options.model` directly to `createAgentSession(...)` without assigning a default or validating that the option is mandatory. In `packages/poe-agent/src/agent-session.ts`, `createAgentSession(...)` throws whenever that value is absent or empty.

## Suspected Area

The CLI agent entrypoint should resolve a default model or expose model selection as a required, validated command input before constructing the Poe agent session.
