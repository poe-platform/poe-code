# `@poe-code/cached-resource` follows symlinked cache subdirectories outside `cacheDir`

## Summary

Even with a path-shaped but non-traversing cache name, the exported disk-cache operations do not enforce canonical containment. If a directory beneath `cacheDir` is a symlink to an external location, `persist()`, `loadFromDisk()`, and `removeFromDisk()` follow it and write, read, and delete files outside the configured cache directory.

## Reproduction

From the repository root, create a disposable cache directory with a symlinked child directory, then invoke the exported helpers using `cacheName: "linked/models"`:

```sh
repo=$PWD
probe=$(mktemp -d)
cache="$probe/cache"
outside="$probe/outside"
mkdir -p "$cache" "$outside"
ln -s "$outside" "$cache/linked"

cat > "$probe/repro.mts" <<EOF
import { promises as fs } from "node:fs";
import { persist, loadFromDisk, removeFromDisk } from "file://$PWD/packages/cached-resource/src/disk-cache.ts";

const deps = { fs: {
  readFile: (path: string, encoding: BufferEncoding) => fs.readFile(path, encoding),
  writeFile: (path: string, data: string) => fs.writeFile(path, data),
  mkdir: (path: string, options?: { recursive?: boolean }) => fs.mkdir(path, options).then(() => undefined),
  unlink: (path: string) => fs.unlink(path)
}};
const config = {
  cacheDir: "$cache",
  cacheName: "linked/models",
  staleTtl: Number.MAX_SAFE_INTEGER
};

await persist({ escaped: true }, config, deps);
console.log("written=" + await fs.readFile("$outside/models.json", "utf8"));
console.log("loaded=" + JSON.stringify(await loadFromDisk(config, deps)));
await removeFromDisk(config, deps);
console.log("exists=" + String(await fs.stat("$outside/models.json").then(() => true, () => false)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/cached-resource/src/disk-cache.ts | sed -n '21,66p'
```

## Observed Behavior

The operations follow `cache/linked -> outside` and act on the external file:

```text
written={"data":{"escaped":true},"timestamp":...}
loaded={"data":{"escaped":true},"timestamp":...}
exists=false
```

No `../` component is required in this reproduction. The cache functions construct a textual path beneath `cacheDir`, but never validate the canonical location before filesystem operations follow the symlink.

## Expected Behavior

Disk-cache operations should remain within the canonical configured `cacheDir`, rejecting symlink-mediated escapes or operating only on trusted cache storage. They must not access external files through directory symlinks.

## Impact

A crafted or replaced cache subdirectory can redirect normal cached-resource reads, writes, and cleanup deletes to arbitrary locations accessible to the process. This remains exploitable even if callers validate cache names against traversal segments.
