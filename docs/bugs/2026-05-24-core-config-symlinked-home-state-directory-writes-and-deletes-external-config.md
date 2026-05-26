# Core config persistence follows a symlinked home-state directory and writes or deletes external config

## Summary

The core config API accepts a global config path under `<home>/.poe-code/config.json` but performs normal reads, writes, and deletion without checking that the `.poe-code` parent directory is real storage inside the supplied home. If `<home>/.poe-code` is a symbolic link, saving an API key writes an external `config.json`, and deleting config removes that external file.

## Reproduction

From the repository root, invoke the exported config operations with a disposable home whose poe-code state directory points to an external directory:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { readFile, stat } from "node:fs/promises";
import { resolveConfigPath } from "file://$PWD/packages/poe-code-config/src/store.ts";
import { saveConfig, deleteConfig } from "file://$PWD/src/services/config.ts";

const homeDir = "$probe/home";
const configPath = resolveConfigPath(homeDir);
await saveConfig({ fs: fs as any, filePath: configPath, apiKey: "probe-key" });
console.log("configPath=" + configPath);
console.log("outside=" + await readFile("$probe/outside/config.json", "utf8"));
console.log("deleted=" + await deleteConfig({ fs: fs as any, filePath: configPath }));
try { await stat("$probe/outside/config.json"); console.log("remaining=true"); }
catch { console.log("remaining=false"); }
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba src/services/config.ts | sed -n '118,160p'
nl -ba packages/poe-code-config/src/store.ts | sed -n '1,42p;118,194p'
```

## Observed Behavior

The API reports and accepts the textual home config path, while the actual write and subsequent deletion occur in the external target of the `.poe-code` symlink:

```text
configPath=<probe>/home/.poe-code/config.json
outside={
  "core": {
    "apiKey": "probe-key"
  }
}
deleted=true
remaining=false
```

`resolveConfigPath()` joins the supplied home with `.poe-code/config.json`. `saveConfig()` delegates to config document writes at that path, while `deleteConfig()` unlinks the same path; neither operation rejects a symlinked parent component.

## Expected Behavior

Global poe-code configuration intended for a selected home directory should remain within the canonical `$HOME/.poe-code` state root. Configuration APIs should reject symlink-mediated escapes or otherwise avoid writing and deleting files outside that owned state directory.

## Impact

An attacker or damaged local state able to replace `$HOME/.poe-code` with a symbolic link can redirect API-key configuration writes to an unrelated writable directory and cause logout or cleanup-style deletion to remove an external `config.json`. The redirected file contains sensitive credential material and lies outside the location users are told poe-code manages.
