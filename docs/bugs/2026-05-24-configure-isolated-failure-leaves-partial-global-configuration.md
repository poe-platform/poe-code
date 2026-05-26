# Configure isolated failure leaves partial global configuration

## Summary

If global tool configuration succeeds but required isolated configuration fails, `configure` exits with an error while leaving global tool config and configured-service metadata persisted. For services that deploy credentials in files, those failed configurations retain plaintext credentials. This reproduces for Codex, Kimi, OpenCode, Goose, and Gemini CLI.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, isolated-path blocker files, a stubbed Poe authentication response for Kimi, and a stubbed Goose model-catalog response

## Reproduction

From the repository root, make isolated configuration base paths regular files so isolated writes fail after the global writes:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/codex/home/.poe-code" "$probe/codex/project" \
  "$probe/kimi/home/.poe-code" "$probe/kimi/project" \
  "$probe/open/home/.poe-code" "$probe/open/project" \
  "$probe/goose/home/.poe-code" "$probe/goose/project" \
  "$probe/gemini/home/.poe-code" "$probe/gemini/project"
printf 'blocking-file\n' > "$probe/codex/home/.poe-code/codex"
printf 'blocking-file\n' > "$probe/kimi/home/.poe-code/kimi"
printf 'blocking-file\n' > "$probe/open/home/.poe-code/opencode"
printf 'blocking-file\n' > "$probe/goose/home/.poe-code/goose"
printf 'blocking-file\n' > "$probe/gemini/home/.poe-code/gemini-cli"
cat > "$probe/kimi-fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
EOF
cat > "$probe/goose-fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(JSON.stringify({ data: [
  { id: 'anthropic/claude-opus-4.7', context_window: { context_length: 200000 } },
  { id: 'anthropic/claude-sonnet-4.6', context_window: { context_length: 200000 } },
  { id: 'openai/gpt-5.3-codex', context_window: { context_length: 128000 } },
  { id: 'openai/gpt-5.5', context_window: { context_length: 1050000 } },
  { id: 'google/gemini-3.1-pro', context_window: { context_length: 1000000 } }
] }), { status: 200, headers: { 'content-type': 'application/json' } });
EOF
(
  cd "$probe/codex/project" &&
  HOME="$probe/codex/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes configure codex --provider cloudflare \
      --api-key partial-secret --base-url https://gateway.example.test \
      --model partial-model --reasoning-effort high
) > "$probe/out" 2>&1 || true
cat "$probe/out"
cat "$probe/codex/home/.codex/config.toml"
cat "$probe/codex/home/.poe-code/config.json"
(
  cd "$probe/kimi/project" &&
  HOME="$probe/kimi/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/kimi-fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes configure kimi --provider poe \
      --api-key partial-kimi-secret --model kimi-k2.5
) > "$probe/kimi.out" 2>&1 || true
cat "$probe/kimi.out"
cat "$probe/kimi/home/.kimi/config.toml"
cat "$probe/kimi/home/.poe-code/config.json"
(
  cd "$probe/open/project" &&
  HOME="$probe/open/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes configure opencode --provider cloudflare \
      --api-key partial-open-secret --base-url https://gateway.example.test --model partial-open
) > "$probe/open.out" 2>&1 || true
cat "$probe/open.out"
cat "$probe/open/home/.local/share/opencode/auth.json"
cat "$probe/open/home/.poe-code/config.json"
(
  cd "$probe/goose/project" &&
  HOME="$probe/goose/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/goose-fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes configure goose --provider cloudflare \
      --api-key partial-goose-secret --base-url https://gateway.example.test \
      --model openai/gpt-5.5
) > "$probe/goose.out" 2>&1 || true
cat "$probe/goose.out"
cat "$probe/goose/home/.config/goose/secrets.yaml"
cat "$probe/goose/home/.poe-code/config.json"
(
  cd "$probe/gemini/project" &&
  HOME="$probe/gemini/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes configure gemini-cli --provider cloudflare \
      --api-key partial-gemini-secret --base-url https://gateway.example.test \
      --model gemini-probe
) > "$probe/gemini.out" 2>&1 || true
cat "$probe/gemini.out"
cat "$probe/gemini/home/.gemini/settings.json"
cat "$probe/gemini/home/.poe-code/config.json"
```

## Observed Behavior

- Each command fails with `ENOTDIR` while trying to create its isolated configuration beneath a blocked `~/.poe-code/<service>` path.
- Failed Codex configuration leaves `~/.codex/config.toml` containing `experimental_bearer_token = "partial-secret"` and records Codex as configured.
- Failed Kimi configuration leaves `~/.kimi/config.toml` containing `api_key = "partial-kimi-secret"`, plus metadata recording Kimi as configured.
- Failed OpenCode configuration leaves `~/.local/share/opencode/auth.json` containing `"key": "partial-open-secret"`, plus metadata recording OpenCode as configured.
- Failed Goose configuration leaves `~/.config/goose/secrets.yaml` containing `CUSTOM_POE_API_KEY: partial-goose-secret`, plus model/provider config and metadata recording Goose as configured.
- Failed Gemini CLI configuration leaves `~/.gemini/settings.json` selecting the requested auth/model and metadata recording Gemini CLI as configured even though its required isolated settings were not written.

## Expected Behavior

Configuration must be atomic across global, metadata, and isolated configuration steps: if isolated setup fails, it must roll back prior writes or avoid committing global secret-bearing state and configured-service metadata until all required writes succeed.

## Impact

- Failed configure commands leave plaintext provider credentials deployed to several tool configurations unexpectedly, and leave Gemini CLI partially installed even without a file-based credential.
- Later commands treat the failed services as configured even though setup exited with an error and isolated configuration is absent.
- Users and automation cannot rely on failure status to mean the attempted configuration was not installed.

## Supporting Evidence

In `src/cli/commands/configure.ts`, `entry.configure(...)` writes global configuration, then `saveConfiguredService(...)` persists metadata, and only afterward `applyIsolatedConfiguration(...)` is invoked. There is no rollback if isolated configuration throws, allowing earlier global and metadata mutations to survive for any provider manifest that requires isolated configuration.

## Suspected Area

Configure execution needs transactional staging/rollback across global files, service metadata, and isolated files, especially where credentials are copied into tool-specific configuration.
