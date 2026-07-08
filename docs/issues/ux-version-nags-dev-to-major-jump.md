# UX: version nags 0.0.0-dev → 4.0.0 major jump

## Summary

Local 0.0.0-dev build reports Update available to 4.0.0 and suggests npm install -g, which is noise for contributors and alarming major-version messaging.

## Evidence

```bash
$ poe-code --version
0.0.0-dev local build
▲ Update available: 0.0.0-dev -> 4.0.0
```

## Why it matters

Strengthens version nag on dev builds with live major jump evidence.

## Suggested direction

Skip update check for dev builds; never compare 0.0.0-dev to published majors.

## Severity

Medium

## Area

Version
