# Harness new basename path traversal writes outside harnesses directory

## Summary

The `poe-code harness new <kind> <basename>` command accepts traversal segments in `basename`. Supplying `../victim` makes it create the generated `.md` and `.ajs` pair directly beneath `.poe-code/` instead of within `.poe-code/harnesses/`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME` and disposable project directory; no external command execution or network access

## Reproduction

From the repository root, scaffold a built-in harness template using a traversal basename in a disposable project:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home" "$project"

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes harness new pipeline-demo ../victim
)

find "$project" -maxdepth 6 -type f -print | sort
```

## Observed Behavior

The command reports success and writes the pair outside the documented harness scaffold directory:

```text
Created harness pair at .poe-code/victim
.../project/.poe-code/victim.ajs
.../project/.poe-code/victim.md
```

No files are created under `.poe-code/harnesses/` for this invocation.

## Expected Behavior

`harness new` should require a safe basename and create generated files only within the intended default `.poe-code/harnesses/<basename>/` directory, unless the user explicitly chooses a separate output directory through `--dir`. A basename containing `../` should be rejected.

## Impact

- A crafted basename can cause scaffold writes outside the harness namespace and overwrite or collide with unrelated `.poe-code` documents.
- Automation that treats `basename` as a simple name cannot rely on the command's default directory containment.
- The output message conceals the boundary escape by presenting the traversed destination as a successful generated harness pair.

## Supporting Evidence

In `src/cli/commands/harness.ts`, `executeHarnessNew()` computes `defaultDir = path.join(".poe-code", "harnesses", basename)` and then resolves it against the project cwd without validating `basename`. For `basename=../victim`, the default directory normalizes to `.poe-code/victim`; the subsequent filenames also use `basename` in `path.join(resolvedDir, `${basename}.md`)` and `path.join(resolvedDir, `${basename}.ajs`)`, resolving to `.poe-code/victim.md` and `.poe-code/victim.ajs`.

## Suspected Area

Harness scaffolding should validate `basename` as a single safe filename component and separately validate resolved default output/file paths stay within the harness directory before writing.
