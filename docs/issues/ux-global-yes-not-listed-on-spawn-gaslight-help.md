---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/program.ts:852 defines root '-y, --yes'; 'npm run dev -- spawn --help' Options list omits --yes (only '--mode <mode> ... (prompted; --yes uses yolo)'), and 'npm run dev -- gaslight --help' Options list has no --yes entry"
comment: "Best-evidenced member of the global-flags family: spawn mentions --yes only obliquely inside the --mode description while gaslight omits it entirely, which is exactly how a global flag becomes invisible. Merge with ux-global-flags-hidden-on-subcommand-help.md and treat this as its evidence. The spawn detail matters beyond discoverability: the only mention of --yes is the one warning that it implies yolo (ux-spawn-yes-defaults-mode-to-yolo.md)."
---

# UX: global --yes not listed on spawn/gaslight command help (reconfirmed via files)

## Summary

spawn help only mentions --yes in mode description (--yes uses yolo); gaslight help has no --yes at all though root has -y/--yes. Users may not know global flags apply.

## Evidence

spawn: (prompted; --yes uses yolo) only
gaslight Options: no --yes
root: -y, --yes Accept defaults

## Why it matters

Global options should appear on command help or be clearly inherited.

## Suggested direction

List global options on subcommand help footers.

## Severity

**High**

## Area

Help
