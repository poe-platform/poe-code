---
severity: critical
impact: usability
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/logout.ts:11 description 'Remove all configuration and credentials.' matches implementation scope (provider logout :38-40, unconfigure all :47, deleteConfig :71-77); env residue is disclosed not hidden at :79-81 ('POE_API_KEY remains set; unset it to log out fully'); confirmed via 'npm run dev -- logout --help'"
comment: "Correctly Critical and the sharpest of the logout cluster: the copy says 'remove configuration and credentials' while the implementation logs out providers, unconfigures every agent and deletes config files - and the detail that makes it worse is the inverse gap it spots, that POE_API_KEY in the environment may survive. The command over-reaches on what users did not ask for and under-delivers on the one thing they did. That asymmetry is the argument for splitting logout from reset. Keep as canonical for the scope decision; the gate belongs to ux-auth-logout-no-confirmation-removes-all-agents.md and the copy to ux-logout-help-no-danger-or-scope-detail.md."
---

# UX: logout copy overpromises and overreaches user intent

## Summary

logout described as Remove all configuration and credentials but unconfigures every agent and deletes config files. Env POE_API_KEY may remain.

## Evidence

Help: Remove all configuration and credentials.
Implementation: logout providers, unconfigure all agents, delete config files.

## Why it matters

Destructive by surprise; wording mismatches residual env credentials.

## Suggested direction

Split logout (credentials only) vs reset; or rename description; require confirm.

## Severity

**Critical**

## Area

Auth / destructive
