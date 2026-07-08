# UX: skill install requires --file before reporting missing name/path set

## Summary

skill install claude-code --name onlyname fails required option --file first — both name and file required; order of error is flag-first (related skill install both required).

## Evidence

```bash
$ poe-code skill install claude-code --name onlyname --yes --local
error: required option '--file <path>' not specified
```

## Why it matters

Commander raw error; list all missing fields.

## Suggested direction

ValidationError: require --name and --file together.

## Severity

Medium

## Area

Skills
