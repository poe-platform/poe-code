---
name: "Provider logout Anthropic leaves Claude Code API key"
---

# Provider logout Anthropic leaves Claude Code API key

## Summary

Running `provider logout anthropic` removes Anthropic's provider login state but leaves the Anthropic API key embedded in the configured Claude Code settings file.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, store an Anthropic credential, configure Claude Code from that provider, and then log out in a disposable home:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run provider login anthropic --api-key anthropic-secret
run configure claude-code --provider anthropic --model claude-custom
printf '%s\n' '=== before provider logout ==='
cat "$probe/home/.claude/settings.json"
run provider logout anthropic
printf '%s\n' '=== after provider logout ==='
cat "$probe/home/.claude/settings.json"
run provider list
```

## Observed Behavior

- Before logout, `~/.claude/settings.json` contains `"ANTHROPIC_API_KEY": "anthropic-secret"`.
- After `provider logout anthropic`, `provider list` reports Anthropic as `[-]`.
- The same plaintext `ANTHROPIC_API_KEY` remains in `~/.claude/settings.json` after provider logout.

## Expected Behavior

Logging out of Anthropic must remove or invalidate Anthropic credential material previously deployed into Claude Code configuration, or explicitly warn that the agent remains authenticated through its local settings file.

## Impact

- A user can believe Anthropic access was removed while Claude Code still retains an immediately reusable API key.
- Shared-machine cleanup and key revocation workflows leave secret material behind in plaintext configuration.
- The provider status display contradicts the effective authentication state of the configured tool.

## Supporting Evidence

In `src/cli/commands/provider.ts`, `executeProviderLogout(...)` only invokes `container.providerRegistry.logout(id)`. In `src/providers/claude-code.ts`, provider configuration writes `provider.extraEnv`, including Anthropic's `ANTHROPIC_API_KEY`, into `~/.claude/settings.json`, while no provider-logout path invokes the service unconfigure mutation.

## Suspected Area

Provider logout needs to remove provider-derived credentials from configured service manifests, including environment credentials written into Claude Code settings.
