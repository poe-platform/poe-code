# Model strategy config follows a symlinked home-state directory and writes or reads an external file

## Summary

The exported `StrategyConfigManager` persists model-selection configuration at `$HOME/.poe-code/strategy-config.json`, but it does not verify canonical containment of `.poe-code`. If `$HOME/.poe-code` is a symbolic link, saving strategy configuration creates an external JSON file and loading configuration reads it back through the symlink.

## Reproduction

From the repository root, run the exported strategy manager with a disposable home whose poe-code directory points to an external directory:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code"

HOME="$probe/home" "$repo/node_modules/.bin/tsx" -e '
  import { StrategyConfigManager } from "./src/services/model-strategy.ts";
  StrategyConfigManager.saveConfig({ type: "fixed", fixedModel: "probe-model" as any });
  console.log(JSON.stringify(StrategyConfigManager.loadConfig()));
'

find "$probe/outside" -maxdepth 1 -type f -print -exec cat {} \;

nl -ba src/services/model-strategy.ts | sed -n '224,263p'
```

## Observed Behavior

The strategy manager writes and reloads the selected model successfully, while the persistent file is physically created in the external symlink target:

```text
{"type":"fixed","fixedModel":"probe-model"}
<probe>/outside/strategy-config.json
{
  "type": "fixed",
  "fixedModel": "probe-model"
}
```

`StrategyConfigManager.CONFIG_DIR` is initialized as `path.join(os.homedir(), ".poe-code")`, and `saveConfig()` uses `fs.writeFileSync()` at the joined strategy path after merely checking whether the directory exists. A symbolic-link directory therefore becomes the storage target without validation.

## Expected Behavior

Model strategy state associated with the current home directory should remain inside the canonical `$HOME/.poe-code` state root. The manager should reject symlink-mediated escapes or otherwise prevent strategy reads and writes outside its designated storage directory.

## Impact

An attacker or corrupted local state able to replace `$HOME/.poe-code` with a symbolic link can redirect model strategy persistence to an unrelated writable location and influence later model-selection behavior by modifying the external JSON file. This violates the documented user-state boundary for strategy configuration.
