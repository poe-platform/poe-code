# Local JSON filters with Pandoc

Run local filters using an interpreter you explicitly register with Safe Bash:

```ts
import {pandocCommands} from "@poe-platform/safe-bash/commands/pandoc";

// Register your configured python3 or node command first.
shell.use(pandocCommands({jsonFilterCommand: "python3"}));
await shell.exec("pandoc -f commonmark -t html -F ./identity.py sample.md");
```

The interpreter receives `--`, the absolute virtual filter path, and the target
writer name. It reads Pandoc JSON from stdin and writes transformed Pandoc JSON
to stdout. Repeated `--filter` / `-F` options run in order. Filter stderr goes to
the command's stderr; nonzero exits, invalid output, and cancellation prevent
Pandoc from publishing its output.

Interpreter access follows its existing filesystem and capability configuration.
This option does not install an interpreter or run a host executable. Choose
either `jsonFilterCommand` or the SDK's `filters` capability. Lua filters and
citeproc require their own explicit SDK capability.
