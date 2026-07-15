---
severity: medium
impact: usability
comment: "Good observation and distinct from the flood filings: unconfigure plans large mutations for an agent the user never configured via poe-code, so nothing distinguishes 'poe-code owns these keys' from 'this is your file'. That is the same ownership question behind the skills wipe (ux-skill-unconfigure-force-deletes-entire-skills-dir.md), where poe-code deleted skills it did not install. Its 'detect managed vs unmanaged' fix is the general answer to both, and the more valuable framing."
---

# UX: unconfigure on seemingly unconfigured agent still plans large mutations

## Summary

unconfigure gemini --dry-run still emits large settings diffs and backup deletes even when user mental model is agent not configured via poe-code, with no "not managed" short-circuit message.

## Evidence

```bash
$ poe-code unconfigure gemini --dry-run
# large settings.json +/- and backup rm
●  Dry run: would remove Gemini CLI configuration.
```

## Why it matters

Scary dry-run for agents user thought untouched; unclear if poe-code owns those files.

## Suggested direction

Detect managed vs unmanaged; short message if nothing to do; summarize files touched.

## Severity

Medium

## Area

Unconfigure
