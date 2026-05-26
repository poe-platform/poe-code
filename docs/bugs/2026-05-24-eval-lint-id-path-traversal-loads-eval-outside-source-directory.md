# Eval lint id path traversal loads eval outside source directory

## Summary

The `poe-code eval lint <evalId>` command accepts path traversal segments in an eval identifier. Supplying `../victim` with an eval source directory of `./evals` causes linting to read and validate `./victim`, outside the configured eval source root, even though other eval paths reject the same identifier as invalid.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME` and disposable project directory; generated eval fixture only, no agent or network execution

## Reproduction

From the repository root, create a valid eval immediately outside an empty `evals/` source directory, then lint it by traversing out of that source:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home" "$project/evals"

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" eval init victim --cwd "$project" --kind plan
)

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" eval lint ../victim --cwd "$project/evals"
)

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" eval check ../victim --cwd "$project/evals"
)
```

## Observed Behavior

`eval lint` reads and lints the external eval successfully, reporting it under the traversing identifier:

```text
victim
next: poe-code eval check victim
../victim
Warnings
... target.ref "main" is not a full commit SHA ...
```

The control command rejects the same external lookup rather than loading it:

```text
Eval source ".../project/evals" does not contain any first-level <id>/eval.yaml files.
```

## Expected Behavior

All eval commands that accept an `evalId` should enforce the documented first-level identifier boundary. `eval lint ../victim --cwd ./evals` should reject `../victim` and must not inspect files outside `./evals`.

## Impact

- Linting can disclose validation results and filesystem-dependent metadata about arbitrary adjacent eval-shaped directories outside the configured source root.
- The command violates the same first-level eval-id contract enforced by core eval loading/check paths, producing inconsistent security and behavior guarantees.
- Automation that permits linting of selected eval IDs cannot rely on `--cwd` to confine accessed input files.

## Supporting Evidence

`packages/agent-eval/src/source/registry.ts` defines `assertSafeEvalId()` and rejects ids containing `/` or `\\` before `loadEval()` resolves an eval directory. However, `packages/agent-eval/src/lint/lint.ts` computes `const evalDir = path.join(input.sourceDir, input.evalId)` directly and reads `eval.yaml`, `plan.md`, and oracle directories without invoking that validation. Consequently, `../victim` collapses to a sibling directory for lint only.

## Suspected Area

`evalLint()` should share the same eval-id validation and source-root containment checks as `loadEval()` before performing any reads.
