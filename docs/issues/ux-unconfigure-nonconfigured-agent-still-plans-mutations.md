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
