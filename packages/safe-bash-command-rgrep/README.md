# Recursive grep for Safe Bash

`rgrep` searches virtual directories recursively, using the same bounded handler as `grep -r`. Use `rgrep -n -i pattern src` for numbered, case-insensitive matches or `rgrep --include='*.ts' pattern src` to select TypeScript files. Use `-` as an operand to read stdin.

The default Safe Bash agent commands include `rgrep`. For standalone registration, import `rgrepCommands` from `@poe-platform/safe-bash/commands/rgrep`. The module also exports `createRgrepCommand`, `createRgrepCommands`, `RgrepCommandsOptions`, and `RgrepLimits`.

This private package is bundled into Safe Bash; no separate installation is required.
