# Static Preparation History

Date: 2026-08-28

The initial grouped policy/status read ended with exit127: its zsh loop variable
`path` changed the shell's special PATH array, so its final `git rev-parse` was
not found. Earlier policy/status reads completed. No files or executable targets
were changed by that command. A fresh shell without that variable authenticated
the requested revisions and confirmed live AGENTS.md equals f5fa0d3f.

SYNTAX-CAPTURE.json preserves the first static-validation attempt unchanged.
All four `node --check` calls exited0. The specification checker exited1 because
the H1 lacked “Specification” and three required section headings differed from
its expected names. The enclosing metadata command then failed its assertion;
the full command outputs were already saved. Only those headings were corrected.
DOC-CHECK-V2.json preserves a second exit1: splitting the original combined
heading had removed the separately required “Goals and Non-Goals” heading. That
heading was added without changing the contract. DOC-CHECK-V3.json records the
next document check. Neither earlier lint failure is rescored or overwritten.

These are preparation errors, not compiler, candidate, coordinator, budget-class,
clock or control executions. All original b1/FC-F02/FC-F03 findings and all older
failed captures remain unchanged. There is no dynamic pass, RootGO or retry of
an actual review attempt in this component.
