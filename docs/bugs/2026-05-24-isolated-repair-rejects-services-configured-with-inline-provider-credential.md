# Isolated repair rejects services configured with inline provider credential

## Summary

Services configured successfully using `configure --provider ... --api-key ...` can contain complete isolated credential-bearing configuration and pass isolated health checks while those files exist, yet any isolated repair or wrapper refresh refuses to proceed unless the same provider credential was separately stored through `provider login`. This reproduces for Cloudflare-backed Codex, Kimi, Goose, and OpenCode wrappers, and for Codex `test --isolated` after its isolated file is missing.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and fake agent executables where execution verification is needed

## Reproduction

From the repository root, configure Codex using an inline Cloudflare credential, confirm the isolated health path can use the generated configuration, then invoke its wrapper:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"
cat > "$probe/bin/codex" <<'EOF'
#!/bin/sh
printf 'CODEX_OK\n'
EOF
chmod +x "$probe/bin/codex"
run() {
  (
    cd "$probe/project" &&
    PATH="$probe/bin:$PATH" HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run configure codex --provider cloudflare \
  --api-key configured-only-secret \
  --base-url https://gateway.example.test \
  --model configured-model --reasoning-effort high
cat "$probe/home/.poe-code/codex/config.toml"
run test codex --isolated
run wrap codex -- --version || true
rm "$probe/home/.poe-code/codex/config.toml"
run test codex --isolated || true
```

The same wrapper failure occurs after configuring Kimi, Goose, or OpenCode through Cloudflare using only their inline `--api-key` configure option:

```sh
run configure kimi --provider cloudflare --api-key inline-kimi \
  --base-url https://gateway.example.test --model inline-model
run wrap kimi -- --version || true

# Goose additionally requires its normal model-catalog response to be stubbed for a disposable probe.
run configure goose --provider cloudflare --api-key inline-goose \
  --base-url https://gateway.example.test --model openai/gpt-5.5
run wrap goose -- --version || true

run configure opencode --provider cloudflare --api-key inline-open \
  --base-url https://gateway.example.test --model inline-model
run wrap opencode -- --version || true
```

## Observed Behavior

- `configure codex --provider cloudflare --api-key configured-only-secret ...` succeeds and writes isolated `~/.poe-code/codex/config.toml` containing `experimental_bearer_token = "configured-only-secret"`.
- `test codex --isolated` succeeds using the same successfully configured service and fake Codex executable.
- `wrap codex -- --version` does not launch the fake executable; it fails with `No stored credential for provider "cloudflare". Run \`poe-code provider login cloudflare\`.`.
- After the isolated Codex file is removed, `test codex --isolated` fails with the same missing stored credential error instead of repairing the isolated state from the successful inline configuration.
- Equivalent direct wrappers for inline-configured Kimi, Goose, and OpenCode fail with the same missing stored provider credential error despite isolated configurations already containing their deployed Cloudflare key.

## Expected Behavior

If `configure` accepts an inline credential and creates usable isolated configuration, wrapper launch and isolated repair must operate without imposing a second, undocumented provider-login prerequisite. Alternatively, configuration should explicitly require and persist the credential needed by all later repair/refresh behavior.

## Impact

- The documented non-interactive configuration path produces isolated installations that direct wrapper invocation cannot run.
- `test --isolated` succeeds only while existing isolated state remains intact, but cannot repair it; `wrap` fails even while that valid state exists.
- CI and automation using inline credentials can configure an agent successfully, then fail at actual isolated execution.

## Supporting Evidence

In `src/cli/commands/wrap.ts`, `wrap` always calls `ensureIsolatedConfigForService(...)` with `refresh: true` before launching services that require isolated configuration. In `src/cli/commands/ensure-isolated-config.ts`, refresh rebuilds a payload by resolving the configured provider credential from the provider registry rather than reusing the already deployed isolated configuration. `packages/providers/src/auth/api-key.ts` rejects that resolution unless a stored provider credential exists, even when `configure --api-key` already successfully wrote a complete isolated credential-bearing file.

## Suspected Area

Isolated refresh/repair should reuse valid configured state or preserve an authenticated provider context from inline configuration instead of requiring unrelated credential storage after configuration succeeds.
