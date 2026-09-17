# @poe-code/terminal-name

Internal, private package bundled into poe-code for best-effort terminal tab naming. It has no third-party dependencies and is not published separately.

```ts
import { setTerminalTabName } from "@poe-code/terminal-name";

await setTerminalTabName("Fix login");
```

In tmux, this renames the window containing the calling pane, leaving the pane title unchanged. Outside tmux, iTerm receives its tab-title escape sequence (OSC 1) when stdout is a TTY. Other terminals and redirected output are left alone.

Control characters are stripped from names. Empty names are ignored. The tmux process has a 500 ms timeout; launch errors, command failures and terminal write exceptions are ignored so naming cannot fail the caller's operation.

## Environment variables

These existing terminal variables are detected automatically; users do not need to configure them:

| Variable | Purpose |
| --- | --- |
| `TMUX` | Detects a tmux session. |
| `TMUX_PANE` | Identifies the calling pane and therefore its window. If absent, tmux naming is skipped to avoid renaming another window. |
| `TERM_PROGRAM` | Enables local iTerm tab naming when its value is `iTerm.app` and the process is outside tmux. |

## Configuration

The API accepts only the tab name. There are no config options or custom environment variables. Terminal naming is optional and needs no user interaction.
