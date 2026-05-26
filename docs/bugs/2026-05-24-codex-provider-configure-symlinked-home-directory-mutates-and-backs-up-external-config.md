# Codex provider configuration follows a symlinked home directory and mutates external config

## Summary

The Codex provider service applies its configuration manifest to fixed `~/.codex/config.toml` paths without checking their canonical location. If `~/.codex` in the selected home directory is a symlink to an external directory, normal configure and unconfigure operations rewrite an external TOML file and configure additionally creates an external backup artifact.

## Reproduction

From the repository root, create a disposable home with a symlinked Codex directory and invoke the exported Codex provider service with harmless local configuration data:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
outside="$probe/outside"
mkdir -p "$home" "$outside"
ln -s "$outside" "$home/.codex"

cat > "$outside/config.toml" <<'EOF'
user_setting = "keep"
EOF

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { readFile, readdir } from "node:fs/promises";
import { codexService } from "file://$PWD/src/providers/codex.ts";

const context = {
  fs: fs as any,
  env: { homeDir: "$home" } as any,
  command: { flushDryRun() {} } as any,
  options: {
    model: "gpt-5",
    reasoningEffort: "medium",
    provider: { id: "poe", baseUrl: "https://example.invalid/v1", credential: "secret" }
  }
} as any;

await codexService.configure(context);
console.log("afterConfigure=" + await readFile("$outside/config.toml", "utf8"));
console.log("outsideFiles=" + JSON.stringify(await readdir("$outside")));
await codexService.unconfigure({ ...context, options: { provider: { id: "poe" } } } as any);
console.log("afterUnconfigure=" + await readFile("$outside/config.toml", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" "$probe/repro.mts"

nl -ba src/providers/codex.ts | sed -n '146,224p'
nl -ba src/providers/create-provider.ts | sed -n '84,124p'
nl -ba packages/config-mutations/src/execution/path-utils.ts | sed -n '37,67p'
```

## Observed Behavior

Both provider lifecycle operations act through `home/.codex -> outside`, and configuration creates a backup in that external directory:

```text
afterConfigure=user_setting = "keep"
model_provider = "poe"
...
[model_providers.poe]
base_url = "https://example.invalid/v1"
experimental_bearer_token = "secret"

outsideFiles=["config.toml","config.toml.backup-..."]
afterUnconfigure=user_setting = "keep"
```

The provider settings are ordinary values; filesystem redirection occurs solely because the configured home contains a symlinked Codex parent directory.

## Expected Behavior

Provider configuration and its backup artifacts should remain beneath the canonical agent configuration directory in the chosen home. A provider config path whose parent resolves outside that home-scoped location should be rejected before mutation.

## Impact

A crafted home-directory symlink can redirect Codex provider configuration, secret-bearing TOML output, backup creation, and cleanup mutations into an external writable directory. This can expose credentials and alter unrelated external configuration while presenting the activity as ordinary Codex setup.
