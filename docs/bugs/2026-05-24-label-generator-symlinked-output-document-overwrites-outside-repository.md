# Label generator follows a symlinked output document and overwrites outside the repository

## Summary

The `labels:generate` script writes the committed `docs/LABELS.md` artifact directly without rejecting a symbolic link at that output path. A crafted checkout can therefore redirect normal label-document generation into an external file overwrite.

## Reproduction

1. From the repository root, run this disposable clean-copy probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-labels-probe.XXXXXX)
   git archive --format=tar HEAD | tar -xf - -C "$probe"
   ln -s "$PWD/node_modules" "$probe/node_modules"
   printf 'EXTERNAL ORIGINAL\n' > "$probe/outside-labels.md"
   rm -f "$probe/docs/LABELS.md"
   ln -s "$probe/outside-labels.md" "$probe/docs/LABELS.md"

   "$PWD/node_modules/.bin/tsx" "$probe/scripts/generate-labels.ts"

   realpath "$probe/docs/LABELS.md"
   sed -n '1,8p' "$probe/outside-labels.md"
   ```

## Observed Behavior

The `docs/LABELS.md` path resolves to the external target, and that target is overwritten with generated output beginning with `# Agent Labels` and `Generated via npm run labels:generate`. Generation completes successfully.

`scripts/generate-labels.ts:11` fixes the output path as `<root>/docs/LABELS.md`, obtains generated markdown from the provider definitions, and calls `writeFile(docPath, ...)` at line 17 without canonical validation or symlink rejection.

## Expected Behavior

Generating label documentation should only modify the canonical committed `docs/LABELS.md` file within the selected repository. An output symlink escaping the repository should be rejected rather than followed.

## Impact

A crafted repository can make routine label-document regeneration overwrite arbitrary external files with developer or CI privileges. The operation is plausible during documentation maintenance and presents the modified path as an ordinary generated repository artifact.
