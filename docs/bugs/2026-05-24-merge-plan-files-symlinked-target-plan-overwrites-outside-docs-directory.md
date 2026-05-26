# Plan merger follows a symlinked target plan and overwrites outside the docs directory

## Summary

The `scripts/merge-plan-files.ts` utility derives a target Markdown file for each `docs/plans/plan-*.md` input and overwrites an existing target without rejecting symbolic links. A symlinked target plan redirects merged plan content to an external file.

## Reproduction

1. From the repository root, run this disposable repository-fixture probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-merge-plans-probe.XXXXXX)
   mkdir -p "$probe/repo/scripts" "$probe/repo/docs/plans"
   printf '{"type":"module"}\n' > "$probe/repo/package.json"
   ln -s "$PWD/node_modules" "$probe/repo/node_modules"
   cp scripts/merge-plan-files.ts "$probe/repo/scripts/"
   cat > "$probe/repo/docs/plans/plan-probe.md" <<'EOF'
   ---
   kind: pipeline
   ---
   PIPELINE BODY
   EOF
   printf '%s\n' '---' 'kind: feature' '---' 'EXTERNAL ORIGINAL' > "$probe/outside.md"
   ln -s "$probe/outside.md" "$probe/repo/docs/plans/probe.md"

   (cd "$probe/repo" && "$workspace/node_modules/.bin/tsx" scripts/merge-plan-files.ts)

   realpath "$probe/repo/docs/plans/probe.md"
   cat "$probe/outside.md"
   test ! -e "$probe/repo/docs/plans/plan-probe.md" && echo source-deleted
   ```

## Observed Behavior

The derived target `docs/plans/probe.md` resolves to the external file. Running the merger overwrites that external file with merged plan content and deletes the original `plan-probe.md` source after reporting a successful merge.

`scripts/merge-plan-files.ts:15` through `scripts/merge-plan-files.ts:25` derive existing target paths, and `scripts/merge-plan-files.ts:28` through `scripts/merge-plan-files.ts:42` read, overwrite, and then remove files without checking whether the target remains inside the canonical plans directory.

## Expected Behavior

Plan merging should update only canonical Markdown files within `docs/plans`. A derived target that resolves through a symbolic link outside that directory should be rejected without modifying or deleting plan files.

## Impact

A crafted plans directory can make a maintenance command overwrite arbitrary external Markdown files and delete the pipeline source, combining an out-of-scope write with local data loss.
