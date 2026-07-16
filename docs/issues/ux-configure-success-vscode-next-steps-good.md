---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/providers/claude-code.ts:71 postConfigureMessages emits the VSCode deep-link note; positive note, no defect. Only provider with postConfigureMessages (grep src/providers)."
comment: "Positive pattern with a genuinely reusable idea: post-configure Next steps carrying an actionable deep link, framed in the design system. Its 'mirror for other agents' suggestion is the actionable half and pairs directly with ux-configure-cursor-dry-run-no-filesystem-changes.md, where users are left guessing what configure even did. Keep as the precedent; no fix needed here."
---

# UX: configure success Next steps for VSCode is good (positive)

## Summary

After configuring Claude Code, a Next steps note with vscode://settings/claudeCode.disableLoginPrompt deep link is helpful and design-system framed.

## Evidence

```text
◇  Next steps.
│  If using VSCode - Open the Disable Login Prompt setting…
│  vscode://settings/claudeCode.disableLoginPrompt
```

## Why it matters

Positive pattern for post-configure guidance.

## Suggested direction

Mirror next-steps notes for other agents (Cursor, Codex, etc.).

## Severity

Low

## Area

Configure / positive pattern
