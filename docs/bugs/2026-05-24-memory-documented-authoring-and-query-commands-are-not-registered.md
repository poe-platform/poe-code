# `memory` documents authoring and query commands that the CLI does not register

## Summary

The shipped `@poe-code/memory` documentation and installed memory skill instruct users and agents to run `poe-code memory write`, `append`, `edit`, `ingest`, `lint`, `cache`, `query`, `explain`, and `install`, but the root CLI only registers `init`, `ls`, `show`, `search`, `status`, and `clear`. The documented authoring, retrieval, and setup workflows are therefore unavailable through the advertised `poe-code memory` command surface.

## Reproduction

From the repository root, run the source CLI with an isolated home and project:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home" "$project"

(
  cd "$project" || exit 1

  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory --help

  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory query 'what is stored?'

  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory write facts --reason test </dev/null
)

sed -n '31,47p' packages/memory/README.md
sed -n '1,18p' packages/memory/src/templates/SKILL_memory.md
```

The command registrations can also be inspected directly:

```sh
rg -n '\.command\("(init|ls|show|search|status|clear|write|append|edit|ingest|lint|query|explain|cache|install)' \
  src/cli/commands/memory.ts
```

## Observed Behavior

`poe-code memory --help` lists only these subcommands:

```text
Commands:
  init              Create .poe-code/memory/ with empty INDEX.md and LOG.md.
  ls                List every page with a one-line description.
  show <path>       Print a page to stdout.
  search <query>    Search over memory files for a substring.
  status [options]  Show memory status.
  clear             Delete all memory content and re-initialize INDEX.md and
                    LOG.md.
```

Running a documented query command exits with failure and reports that it does not exist:

```text
Unknown command: query
Run npm run dev -- memory --help for available commands.
```

Running the documented write invocation also exits with failure because no `write` command exists to own its advertised option:

```text
error: unknown option '--reason'
```

In contrast, `packages/memory/README.md` documents `memory edit`, `memory write`, `memory append`, `memory ingest`, `memory lint`, `memory cache`, `memory query`, `memory explain`, and `memory install`, and `packages/memory/src/templates/SKILL_memory.md` directs installed agents to use the same missing commands.

## Expected Behavior

Every command advertised in the shipped memory README and installed memory skill should be registered and callable through `poe-code memory`, or the distributed documentation and skill should not claim those workflows are available.

## Impact

Users cannot follow the package's documented memory authoring, ingest, query, explanation, cache, lint, or installation workflows from the main CLI. Installed agents are additionally instructed to invoke commands that fail at runtime, which breaks memory-management tasks and can waste agent iterations attempting nonexistent operations.
