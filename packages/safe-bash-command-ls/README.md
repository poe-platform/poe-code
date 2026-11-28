# Virtual directory listings

List files in Safe Bash's configured filesystem with `ls`, including recursive listings, sorting, long metadata records, and filename quoting.

```sh
ls -b                       # Backslash-escape spaces and control characters
ls --quoting-style=shell     # Quote names for shell input
ls --quoting-style=c         # Double-quote names with C escapes
ls -N                       # Print literal names
ls -l --time-style=long-iso  # YYYY-MM-DD HH:MM timestamps
ls -l --time-style=+%Y      # Custom date format
ls --full-time              # Long listing with seconds, nanoseconds and zone
```

`--escape` is an alias for `-b`; `--literal` is an alias for `-N`. `-Q` and `--quote-name` select C quoting. The last quoting option wins. `--quoting-style` accepts `literal`, `escape`, `shell`, `shell-always`, `shell-escape`, `shell-escape-always`, `c`, `c-maybe`, `locale`, and `clocale`.

`--time-style` accepts `long-iso`, `full-iso`, `iso`, `locale`, and `+FORMAT` date directives. A custom format can contain one newline to separate older and recent timestamp formats. `--full-time` selects long listings and `full-iso`; later time-style options override its format. Dates use the shell's `TZ`, defaulting to UTC. Fractional seconds reflect the filesystem's reported timestamp precision.

Safe Bash includes `ls` by default. For a custom registry, import `lsCommands`, `createLsCommand`, or `createLsCommands` from `@poe-platform/safe-bash/commands/ls`. The `limits` option accepts `maxDirectoryEntries` and `maxRecursiveDirectoryDepth`, plus `maxFormatWidth` and `maxOutputBytes` to bound each formatted timestamp; `replace` allows replacing an existing registration.
