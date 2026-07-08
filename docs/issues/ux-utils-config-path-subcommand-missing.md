# UX: utils config path is not a subcommand

## Summary

utils config path fails with too many arguments; only show/init/edit exist. Users often need the path without opening an editor.

## Evidence

```bash
$ poe-code utils config path
error: too many arguments for 'config'. Expected 0 arguments but got 1.
```
Commands: show, init, edit.

## Why it matters

Path is a common need for scripting and docs.

## Suggested direction

Add `utils config path [--global|--project]` printing absolute paths.

## Severity

Medium

## Area

Utils / config
