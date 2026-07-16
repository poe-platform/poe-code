---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/constants.ts:40 DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro'; positive note, no defect - stale default tracked in ux-gemini-default-model-unnamespaced-and-stale-vs-frontier.md"
comment: "Weak positive: it praises gemini's dry-run as quieter while admitting mkdir noise and a wrong default model id, and the quietness may simply be the cursor problem (nothing rendered) rather than a virtue. Do not treat it as the reference for the intentional-only diff - ux-configure-api-key-dry-run-redacts-bearer.md and ux-code-review-prompt-preview-good.md are the sound precedents. Its default-model concern belongs with ux-configure-gemini-requires-cloudflare-base-url-when-provider-set.md."
---

# UX: configure gemini --yes --dry-run is relatively minimal (positive-ish)

## Summary

configure gemini dry-run shows model gemini-2.5-pro and mkdir ensures without full settings flood when already configured paths — cleaner than claude flood in some cases (still mkdir noise).

## Evidence

◇  Gemini model → gemini-2.5-pro
Dry run: would configure Gemini CLI.

## Why it matters

Positive quieter dry-run when no full rewrite shown.

## Suggested direction

Keep intentional-only; fix default model id.

## Severity

Low

## Area

Configure / positive pattern
