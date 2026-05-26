# `resolveCacheDir()` allows application names to escape the cache root

## Summary

`@poe-code/cached-resource` documents `resolveCacheDir(appName)` as returning `$XDG_CACHE_HOME/<appName>` or `~/.cache/<appName>`, but the helper joins unrestricted `appName` input without checking containment. An application name such as `../escaped-app` resolves outside `~/.cache`, and normal cache persistence then writes into that escaped location.

## Reproduction

From the repository root, resolve a cache directory using a traversal application name and persist a resource into it:

```sh
repo=$PWD
probe=$(mktemp -d)

cat > "$probe/repro.mts" <<EOF
import { resolveCacheDir, persist } from "file://$PWD/packages/cached-resource/src/disk-cache.ts";
import { promises as fs } from "node:fs";

const cacheDir = resolveCacheDir("../escaped-app", {
  env: {},
  homedir: () => "$probe/home"
});
console.log("cacheDir=" + cacheDir);

await persist(
  { value: "outside-dot-cache" },
  { cacheDir, cacheName: "models" },
  { fs: {
    readFile: (path: string, encoding: BufferEncoding) => fs.readFile(path, encoding),
    writeFile: (path: string, data: string) => fs.writeFile(path, data),
    mkdir: (path: string, options?: { recursive?: boolean }) => fs.mkdir(path, options).then(() => undefined),
    unlink: (path: string) => fs.unlink(path)
  }}
);

console.log("written=" + await fs.readFile("$probe/home/escaped-app/models.json", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/cached-resource/README.md | sed -n '22,33p;95,109p'
nl -ba packages/cached-resource/src/disk-cache.ts | sed -n '70,77p'
```

## Observed Behavior

The helper resolves outside the documented cache base and persistence writes there:

```text
cacheDir=<probe>/home/escaped-app
written={"data":{"value":"outside-dot-cache"},"timestamp":...}
```

With a normal app name, the cache path would be `<probe>/home/.cache/<appName>`. The traversal name normalizes `join(home, ".cache", "../escaped-app")` to `<probe>/home/escaped-app`, escaping the XDG-style cache root.

## Expected Behavior

`resolveCacheDir(appName)` should accept only a safe application-directory name or verify that its resolved output remains within `$XDG_CACHE_HOME` or `~/.cache`. Traversal input should not produce a directory outside the advertised cache root.

## Impact

Consumers that use dynamic application names can be induced to persist cache files in arbitrary sibling directories beneath the selected home or XDG cache parent, violating storage isolation even when individual cache filenames are safe.
