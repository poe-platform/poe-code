# Provider config follows a symlinked services directory and writes or reads external metadata

## Summary

The provider configuration store persists provider-specific API-shape base URLs at `<home>/.config/poe-code/services.json`, but does not validate the canonical location of the `poe-code` directory. If `<home>/.config/poe-code` is a symbolic link, saving provider metadata creates or mutates an external `services.json`, and loading provider metadata reads it back through the same escape.

## Reproduction

From the repository root, invoke the exported provider config store with a disposable home whose services directory points outside that home:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.config" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.config/poe-code"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolveServicesConfigPath } from "file://$PWD/packages/poe-code-config/src/store.ts";
import { saveProviderShapeBaseUrls, loadProviderShapeBaseUrls } from "file://$PWD/packages/poe-code-config/src/provider-config.ts";

const filePath = resolveServicesConfigPath("$probe/home");
await saveProviderShapeBaseUrls({
  fs: fs as any,
  filePath,
  providerId: "cloudflare",
  shapeBaseUrls: { openai: "https://example.invalid/openai" } as any
});
console.log("filePath=" + filePath);
console.log("outside=" + await readFile("$probe/outside/services.json", "utf8"));
console.log("loaded=" + JSON.stringify(await loadProviderShapeBaseUrls({ fs: fs as any, filePath, providerId: "cloudflare" })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/poe-code-config/src/provider-config.ts | sed -n '1,72p'
nl -ba packages/poe-code-config/src/store.ts | sed -n '149,190p'
```

## Observed Behavior

The provider config API uses the textual services path under the selected home, but its actual persistent write and subsequent read occur at the external symlink target:

```text
filePath=<probe>/home/.config/poe-code/services.json
outside={
  "providers": {
    "cloudflare": {
      "shapeBaseUrls": {
        "openai": "https://example.invalid/openai"
      }
    }
  }
}
loaded={"openai":"https://example.invalid/openai"}
```

`resolveServicesConfigPath()` constructs the fixed services file beneath `<home>/.config/poe-code`. `saveProviderShapeBaseUrls()` delegates to the generic document writer, which creates parent directories and writes the file through any existing symlinked directory component; loading uses the same escaped path.

## Expected Behavior

Provider metadata for a selected user home should be read and written only inside the canonical `<home>/.config/poe-code` state directory. The store should reject symbolic-link escapes or otherwise prevent service URL metadata operations from reaching unrelated locations.

## Impact

An attacker or corrupted state able to replace the provider services directory with a symbolic link can redirect persisted provider endpoint metadata outside poe-code's expected state tree and cause future provider resolution to consume external values. This can silently alter which service endpoints subsequent tool configuration or execution uses.
