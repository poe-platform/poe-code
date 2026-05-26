# Legacy config migration follows a symlinked credentials file and imports external secrets

## Summary

When the current poe-code config is missing, `loadConfig()` automatically migrates legacy data from `<home>/.poe-code/credentials.json`. The migration reads that legacy path without rejecting symbolic links. If `credentials.json` is a symlink to an external JSON document, a normal configuration load imports the external API key and configured-services metadata into the user's new config, then removes the symlink entry.

## Reproduction

From the repository root, place legacy-looking credentials in an external file and expose it through the expected home-state legacy path:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/outside"
printf '{"apiKey":"external-legacy-key","configured_services":{"codex":{"provider":"poe","files":["x"]}}}\n' \
  > "$probe/outside/credentials.json"
ln -s "$probe/outside/credentials.json" "$probe/home/.poe-code/credentials.json"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { readFile, lstat } from "node:fs/promises";
import { loadConfig } from "file://$PWD/src/services/config.ts";

const configPath = "$probe/home/.poe-code/config.json";
console.log("key=" + await loadConfig({ fs: fs as any, filePath: configPath }));
console.log("config=" + await readFile(configPath, "utf8"));
try { await lstat("$probe/outside/credentials.json"); console.log("externalRemaining=true"); }
catch { console.log("externalRemaining=false"); }
try { await lstat("$probe/home/.poe-code/credentials.json"); console.log("linkRemaining=true"); }
catch { console.log("linkRemaining=false"); }
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba src/services/config.ts | sed -n '181,245p;297,318p'
```

## Observed Behavior

Loading config reads and migrates the external file's contents into a new local config document. Migration removes the symlink path after import, while leaving the external source file itself present:

```text
key=external-legacy-key
config={
  "configured_services": {
    "codex": {
      "provider": "poe",
      "files": ["x"]
    }
  },
  "core": {
    "apiKey": "external-legacy-key"
  }
}
externalRemaining=true
linkRemaining=false
```

`migrateLegacyCredentialsFile()` reads `path.join(path.dirname(configPath), "credentials.json")`, writes recovered metadata and secrets to the current config, and then unlinks the legacy path. No check verifies that the legacy data originates inside the selected poe-code state directory.

## Expected Behavior

Automatic legacy migration should import credentials only from a canonical legacy file within the selected user's poe-code state directory. A symlinked legacy credential path escaping that directory should be rejected rather than consumed as trusted credential input.

## Impact

An attacker or corrupted state able to install a symlink at the legacy credentials path can inject an externally controlled API key and service metadata into active poe-code configuration during an otherwise read-like config load. This can silently alter future authenticated behavior and configured-service selection.
