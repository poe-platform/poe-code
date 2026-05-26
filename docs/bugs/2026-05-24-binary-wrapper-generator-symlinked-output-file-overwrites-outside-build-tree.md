# Binary wrapper generator follows a symlinked output file and overwrites outside the build tree

## Summary

`scripts/generate-bin-wrappers.mjs` writes generated executable wrapper modules beneath `dist/bin` without rejecting symbolic links at those destinations. A symlinked wrapper output causes a normal build step to overwrite an external JavaScript file.

## Reproduction

1. From the repository root, run this disposable dist-fixture probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-bin-wrapper-probe.XXXXXX)
   mkdir -p "$probe/repo/scripts" "$probe/repo/dist/providers" \
     "$probe/repo/dist/cli" "$probe/repo/dist/bin"
   printf '{"type":"module"}\n' > "$probe/repo/package.json"
   cp scripts/generate-bin-wrappers.mjs scripts/node-version-gate.mjs "$probe/repo/scripts/"
   cat > "$probe/repo/dist/providers/index.js" <<'EOF'
   export function getDefaultProviders() { return [{ name: 'codex' }]; }
   EOF
   cat > "$probe/repo/dist/cli/binary-aliases.js" <<'EOF'
   export function deriveWrapBinaryAliases() {
     return [{ binName: 'poe-codex', serviceName: 'codex' }];
   }
   EOF
   printf 'EXTERNAL ORIGINAL\n' > "$probe/outside.js"
   ln -s "$probe/outside.js" "$probe/repo/dist/bin/poe-codex.js"

   node "$probe/repo/scripts/generate-bin-wrappers.mjs"

   realpath "$probe/repo/dist/bin/poe-codex.js"
   sed -n '1,14p' "$probe/outside.js"
   ```

## Observed Behavior

The generated wrapper output path resolves to the external `outside.js` file, which is overwritten with a valid generated `poe-codex` executable wrapper containing `const service = "codex"`. The generator completes normally.

`scripts/generate-bin-wrappers.mjs:8` computes the generated `dist/bin` directory, builds each alias output path at line 24, and writes wrapper source with `writeFile(filePath, content, ...)` at line 45 without checking whether that file resolves outside the build tree.

## Expected Behavior

Build-time binary wrapper generation should only overwrite canonical files located inside the repository's `dist/bin` directory. A symbolic-link output that escapes that build directory should be rejected.

## Impact

A crafted checkout or pre-existing build-tree symlink can turn the standard build pipeline into an external file overwrite with developer or CI privileges. The generated wrappers run during packaging and distribution preparation, making this a practical build-time overwrite primitive.
