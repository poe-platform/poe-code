# UX: skill and memory absent from root help (reconfirmed)

## Summary

Root --help does not list skill or memory though both exist as parent commands — reaffirm important-commands-absent-from-root-help.

## Evidence

```bash
$ poe-code --help | rg skill|memory → no matches
$ poe-code skill --help → works
$ poe-code memory --help → works
```

## Why it matters

Discoverability failure for major features.

## Suggested direction

Add skill and memory to root help command list.

## Severity

**High**

## Area

Help / discoverability
