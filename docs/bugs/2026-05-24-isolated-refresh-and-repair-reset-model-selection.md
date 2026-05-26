# Isolated refresh and repair reset model selection

## Summary

Refreshing or recreating isolated configuration for a Poe-backed configured service silently writes default model selections instead of preserving the model chosen during `configure`. This reproduces through `wrap` for Codex, OpenCode, Kimi, and Goose, and through `test --isolated` when the isolated files are missing; Codex also loses its configured reasoning effort.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, stubbed Poe/model-catalog responses, and fake wrapped executables

## Reproduction

From the repository root, configure four Poe-backed services with non-default model choices, capture their isolated files, run each wrapper once, and compare the files:

```sh
repo=$PWD
probe=$(mktemp -d)
for service in codex opencode kimi goose; do
  mkdir -p "$probe/$service/home" "$probe/$service/project" "$probe/$service/bin"
done
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/models')) {
    return new Response(JSON.stringify({ data: [
      { id: 'anthropic/claude-opus-4.7', context_window: { context_length: 200000 } },
      { id: 'anthropic/claude-sonnet-4.6', context_window: { context_length: 200000 } },
      { id: 'openai/gpt-5.3-codex', context_window: { context_length: 128000 } },
      { id: 'openai/gpt-5.5', context_window: { context_length: 1050000 } },
      { id: 'google/gemini-3.1-pro', context_window: { context_length: 1000000 } }
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(
    JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};
EOF
for binary in codex opencode kimi-cli goose; do
  cat > "$probe/fake-$binary" <<EOF
#!/bin/sh
printf 'RAN_$binary\n'
EOF
  chmod +x "$probe/fake-$binary"
done
cp "$probe/fake-codex" "$probe/codex/bin/codex"
cp "$probe/fake-opencode" "$probe/opencode/bin/opencode"
cp "$probe/fake-kimi-cli" "$probe/kimi/bin/kimi-cli"
cp "$probe/fake-goose" "$probe/goose/bin/goose"
run() {
  service=$1
  shift
  (
    cd "$probe/$service/project" &&
    PATH="$probe/$service/bin:$PATH" HOME="$probe/$service/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run codex configure codex --provider poe --api-key inline-poe \
  --model configured-codex --reasoning-effort high
run opencode configure opencode --provider poe --api-key inline-poe --model configured-open
run kimi configure kimi --provider poe --api-key inline-poe --model configured-kimi
run goose configure goose --provider poe --api-key inline-poe --model openai/gpt-5.3-codex
cp "$probe/codex/home/.poe-code/codex/config.toml" "$probe/codex.before"
cp "$probe/opencode/home/.poe-code/opencode/.config/opencode/config.json" "$probe/opencode.before"
cp "$probe/kimi/home/.poe-code/kimi/.kimi/config.toml" "$probe/kimi.before"
cp "$probe/goose/home/.poe-code/goose/.config/goose/config.yaml" "$probe/goose.before"
run codex wrap codex -- --version
run opencode wrap opencode -- --version
run kimi wrap kimi -- --version
run goose wrap goose -- --version
diff -u "$probe/codex.before" "$probe/codex/home/.poe-code/codex/config.toml" || true
diff -u "$probe/opencode.before" "$probe/opencode/home/.poe-code/opencode/.config/opencode/config.json" || true
diff -u "$probe/kimi.before" "$probe/kimi/home/.poe-code/kimi/.kimi/config.toml" || true
diff -u "$probe/goose.before" "$probe/goose/home/.poe-code/goose/.config/goose/config.yaml" || true
```

The same default replacement is performed when `test --isolated` must repair missing isolated files:

```sh
rm "$probe/codex/home/.poe-code/codex/config.toml" \
  "$probe/opencode/home/.poe-code/opencode/.config/opencode/config.json" \
  "$probe/kimi/home/.poe-code/kimi/.kimi/config.toml" \
  "$probe/goose/home/.poe-code/goose/.config/goose/config.yaml"
run codex test codex --isolated
run opencode test opencode --isolated
run kimi test kimi --isolated
run goose test goose --isolated
rg -n '^model =|^model_reasoning_effort|^default_model|^GOOSE_MODEL|"model"' \
  "$probe/codex/home/.poe-code/codex/config.toml" \
  "$probe/opencode/home/.poe-code/opencode/.config/opencode/config.json" \
  "$probe/kimi/home/.poe-code/kimi/.kimi/config.toml" \
  "$probe/goose/home/.poe-code/goose/.config/goose/config.yaml"
```

## Observed Behavior

- `wrap codex` launches the fake binary only after replacing isolated `model = "configured-codex"` with `model = "gpt-5.5"` and replacing `model_reasoning_effort = "high"` with `"medium"`.
- `wrap opencode` replaces isolated `"model": "poe/configured-open"` with `"model": "poe/anthropic/claude-opus-4.7"`.
- `wrap kimi` replaces isolated `default_model = "poe/configured-kimi"` with `default_model = "poe/kimi-k2.5"`.
- `wrap goose` replaces isolated `GOOSE_MODEL: openai/gpt-5.3-codex` with `GOOSE_MODEL: anthropic/claude-opus-4.7`.
- All four wrapped fake binaries execute after the mutation, so launching an agent is itself destructive to the previously configured isolated selection.
- If the isolated files are removed instead, `test --isolated` recreates them successfully but produces the same default selections (`gpt-5.5` / `medium`, `poe/anthropic/claude-opus-4.7`, `poe/kimi-k2.5`, and `anthropic/claude-opus-4.7`) rather than the originally configured values.

## Expected Behavior

Refreshing or repairing isolated configuration must preserve the configuration produced by `configure` unless the user explicitly requests a model or settings change. Launching wrappers and verifying configuration must not replace selected models or reasoning settings with defaults.

## Impact

- A normal wrapper invocation silently changes the model used for subsequent isolated executions.
- Users configuring a specific model or Codex reasoning effort do not receive the requested behavior when launching through wrappers.
- Wrapper execution can destroy carefully selected configuration state, and health-check repair can silently recreate the wrong state after isolated files are absent, causing unexpected cost, quality, or capability changes.

## Supporting Evidence

In `src/cli/commands/wrap.ts`, `wrap` calls `ensureIsolatedConfigForService(...)` with `refresh: true` on every invocation. `src/cli/commands/test.ts` also calls that helper whenever `--isolated` requires a missing file to be recreated. In `src/cli/commands/ensure-isolated-config.ts`, configuration is rebuilt through `createConfigurePayload(...)` with empty command options rather than values from stored configured-service metadata or an existing prior selection. Provider defaults therefore flow into each service manifest during both refresh and repair.

## Suspected Area

Isolated setup should avoid unconditional destructive refresh, and repair/refresh should preserve previously selected model and reasoning values while updating only the required provider-dependent state.
