# Plan merger follows a symlinked source plan and imports external content

## Summary

The `scripts/merge-plan-files.ts` utility discovers `docs/plans/plan-*.md` entries and reads their contents without rejecting symbolic links. A symlinked pipeline source causes external Markdown instructions to be merged into a repository plan, then removes the link while leaving the external source intact.

## Reproduction

1. From the repository root, run this disposable repository-fixture probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-merge-plan-source-probe.XXXXXX)
   mkdir -p "$probe/repo/scripts" "$probe/repo/docs/plans"
   printf '{"type":"module"}\n' > "$probe/repo/package.json"
   ln -s "$workspace/node_modules" "$probe/repo/node_modules"
   cp scripts/merge-plan-files.ts "$probe/repo/scripts/"
   cat > "$probe/outside-plan.md" <<'EOF'
   ---
   kind: pipeline
   ---
   EXTERNAL PIPELINE INSTRUCTIONS
   EOF
   cat > "$probe/repo/docs/plans/probe.md" <<'EOF'
   ---
   kind: feature
   ---
   LOCAL TARGET
   EOF
   ln -s "$probe/outside-plan.md" "$probe/repo/docs/plans/plan-probe.md"

   (cd "$probe/repo" && "$workspace/node_modules/.bin/tsx" scripts/merge-plan-files.ts)

   cat "$probe/repo/docs/plans/probe.md"
   test -e "$probe/outside-plan.md" && echo external-source-remains
   test -e "$probe/repo/docs/plans/plan-probe.md" || echo source-link-deleted
   ```

## Observed Behavior

The local target plan is rewritten with `EXTERNAL PIPELINE INSTRUCTIONS` imported from the external symlink target. The utility then unlinks only the apparent `plan-probe.md` source entry, leaving the external source file intact while reporting a successful merge.

`scripts/merge-plan-files.ts:15` through `scripts/merge-plan-files.ts:25` discover pipeline-source paths, and `scripts/merge-plan-files.ts:28` through `scripts/merge-plan-files.ts:42` read their contents and merge them into local documentation without checking canonical containment.

## Expected Behavior

Plan merging should ingest content only from canonical pipeline plan files within `docs/plans`. A discovered source plan that resolves outside the plans directory should be rejected.

## Impact

A crafted plans directory can silently inject external instructions into repository planning documentation during a normal merge operation, potentially misleading downstream agents or reviewers.
