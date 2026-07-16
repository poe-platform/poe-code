---
severity: medium
impact: polish
reproduced: y
recommendation: fix
evidence: "src/services/version.ts:41 semver.gt(latestVersion, currentVersion) has no 0.0.0-dev guard; src/cli/commands/version.ts:50-55 prints the nag plus 'npm install -g poe-code@latest' whenever updateAvailable"
comment: "Keep as canonical of the five-file version-nag cluster: best framing (a 0.0.0-dev build compared against a published major is meaningless, and the suggested npm install -g would replace the contributor's local build). Correctly diagnosed as contributor noise rather than a user-facing defect - which caps its priority. Its fix is right: skip the update check for dev/local builds entirely rather than tuning the comparison."
---

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
