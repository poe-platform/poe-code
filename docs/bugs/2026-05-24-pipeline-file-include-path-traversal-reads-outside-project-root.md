# Pipeline file include path traversal reads outside project root

## Summary

Pipeline prompt file inclusion accepts traversal segments despite documentation stating that `{{file 'path'}}` values resolve relative to the project root. A plan containing `{{file '../secret.txt'}}` can read and display a file outside the project when validated with `--preview`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME` and disposable project directory; validation/preview only, with no agent or network execution

## Reproduction

From the repository root, create a disposable project and a sibling secret file outside that project, then preview a pipeline plan that includes it through `../`:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home" "$project"
printf 'outside-project-secret\n' > "$probe/secret.txt"
cat > "$project/plan.md" <<'EOF_PLAN'
---
kind: pipeline
version: 1
tasks:
  - id: leak
    title: Leak
    status: open
    prompt: "Read {{file '../secret.txt'}}"
---
Plan
EOF_PLAN

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" pipeline validate plan.md --preview
)
```

## Observed Behavior

The plan validates successfully and preview output displays the contents of the sibling file outside the project directory:

```text
Plan is valid.
task: leak — Leak
   Read outside-project-secret
```

## Expected Behavior

As documented, file includes should remain constrained to paths relative to and within the project root. A path such as `../secret.txt` should be rejected rather than reading data from outside the project.

## Impact

- Pipeline plans can exfiltrate files outside their project root into preview output and, during actual runs, into agent prompts.
- Reviewing or validating an untrusted pipeline plan can disclose neighboring filesystem content without launching any agent.
- The documented project-root boundary does not protect secrets in parent or sibling locations.

## Supporting Evidence

`packages/pipeline/README.md` states that `{{file 'path'}}` paths resolve relative to the project root. In `packages/pipeline/src/run/runner.ts`, `resolveFileIncludes()` instead resolves each captured string using `path.resolve(cwd, match[1])` and immediately reads it, with no check that the resolved path remains inside `cwd`. `src/cli/commands/pipeline.ts` invokes this expansion while processing `pipeline validate --preview`, making the disclosure reachable without execution.

## Suspected Area

Pipeline file inclusion should reject absolute paths and parent traversal, or enforce canonical containment beneath the configured project root before reading included files.
