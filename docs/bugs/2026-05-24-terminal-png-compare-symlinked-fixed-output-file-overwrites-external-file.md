# Terminal PNG compare follows a symlinked fixed output file and overwrites an external file

## Summary

The `@poe-code/terminal-png` comparison script always renders its new screenshot to the shared fixed path `/tmp/ts-compare-new.png` without rejecting symbolic links. A symlink placed at that path redirects generated PNG output to another file.

## Reproduction

1. From the repository root, run this disposable output-target probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-terminal-compare-probe.XXXXXX)
   printf 'ORIGINAL\n' > "$probe/outside.png"
   rm -f /tmp/ts-compare-new.png
   ln -s "$probe/outside.png" /tmp/ts-compare-new.png

   "$PWD/node_modules/.bin/tsx" packages/terminal-png/scripts/compare.ts

   realpath /tmp/ts-compare-new.png
   wc -c "$probe/outside.png"
   rm -f /tmp/ts-compare-new.png
   ```

## Observed Behavior

The script reports `PNG: /tmp/ts-compare-new.png`, but that fixed output resolves to the external target. The probe overwrites `outside.png` with the rendered PNG payload, producing a 1533280-byte file.

`packages/terminal-png/scripts/compare.ts:8` defines the predictable shared output path and `packages/terminal-png/scripts/compare.ts:93` through `packages/terminal-png/scripts/compare.ts:106` render through it. `packages/terminal-png/src/index.ts:23` through `packages/terminal-png/src/index.ts:25` perform the unchecked file write.

## Expected Behavior

Screenshot comparison should allocate an exclusive safe temporary output file or reject a symbolic-link destination before writing PNG bytes.

## Impact

Another local actor or stale temporary-file symlink can cause the comparison utility to overwrite an arbitrary file accessible to the invoking user with rendered image data.
