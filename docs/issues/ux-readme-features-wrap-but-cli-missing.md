# UX: README features wrap as primary quickstart but CLI has no wrap command

## Summary

Public README leads with npx poe-code@latest wrap claude. On current main, wrap is unknown and absent from root help. Screenshot confirms command-not-found for wrap.

## Evidence

README: npx poe-code@latest wrap claude
$ poe-code wrap --help → Unknown command: wrap
$ poe-code --help | rg wrap → no matches

## Why it matters

Highest-traffic docs path broken copy-paste.

## Suggested direction

Restore wrap or update README same-day; CI that README fences reference existing commands.

## Severity

**Critical**

## Area

Docs / CLI sync
