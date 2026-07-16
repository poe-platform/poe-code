---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- configure gemini --yes --dry-run --provider cloudflare --base-url <url> prints only 'Gemini model gemini-2.5-pro', two 'mkdir -p ... # ensure' lines, and 'Dry run: would configure Gemini CLI.' (src/cli/commands/configure.ts:279); the settings.json backup/transform/merge mutations declared in src/providers/gemini-cli.ts:134-168 and the provider/base URL are never surfaced."
comment: "Duplicate in shape of the cursor 'too quiet' dry-run pair with gemini substituted; consolidate into one cross-agent dry-run fidelity issue rather than one per agent. Its framing is the most useful in the family and should survive: 'too quiet is as bad as too noisy' - the codex flood and this silence are the same missing capability, an intentional-only plan. Note it contradicts ux-configure-gemini-dry-run-minimal-good.md, which praises this same output."
---

# UX: configure gemini --dry-run is almost silent about what changes

## Summary

configure gemini --yes --dry-run only shows Gemini model resolved line and would configure without listing files, provider, base URL, or model id — opposite extreme of codex dry-run flood.

## Evidence

```bash
$ poe-code configure gemini --yes --dry-run
◇  Gemini model
●  Dry run: would configure Gemini CLI.
```

## Why it matters

Dry-run should be a readable plan of changes; too quiet is as bad as too noisy.

## Suggested direction

Print agent, provider, model, files that would change (summary).

## Severity

Medium

## Area

Dry-run
