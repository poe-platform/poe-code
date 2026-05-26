# Root help omits supported global options

## Summary

The root `poe-code --help` page lists commands but does not display any of the global options accepted by the CLI. Users cannot discover `--yes`, `--dry-run`, `--verbose`, or `--version` from the primary help output.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run:

```sh
npx tsx --import ./scripts/register-template-loader.mjs src/index.ts --help
```

Search the printed output for the supported global flags:

```sh
npx tsx --import ./scripts/register-template-loader.mjs src/index.ts --help | rg -- '--yes|--dry-run|--verbose|--version'
echo $?
```

## Observed Behavior

- The root help output contains `Usage`, `Commands`, and project links.
- It does not contain an `Options` section.
- It does not mention `--yes`, `--dry-run`, `--verbose`, or `--version`.
- The search command exits `1` because none of those flags are documented in root help.

## Expected Behavior

The primary `--help` output should list all supported global options, including descriptions for `--yes`, `--dry-run`, `--verbose`, `--version`, and `--help`.

## Impact

- Users cannot discover non-interactive or safe simulation modes from the main CLI documentation.
- Automation authors may miss `--yes`, which is required by commands that refuse non-interactive operation without it.
- The implemented global CLI surface and the generated user-facing help are inconsistent.

## Supporting Evidence

The global flags are registered in `src/cli/program.ts` and are accepted during normal parsing. For example, each of these prints valid command help and exits successfully:

```sh
npx tsx --import ./scripts/register-template-loader.mjs src/index.ts --yes configure --help
npx tsx --import ./scripts/register-template-loader.mjs src/index.ts --dry-run configure --help
npx tsx --import ./scripts/register-template-loader.mjs src/index.ts --verbose configure --help
```

## Suspected Area

The customized root help renderer in `src/cli/program.ts` formats only command rows and footer links, without formatting the command's option terms.
