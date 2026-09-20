# LaTeX writer implementation and QA

Scope: original TypeScript serialization in packages/pandoc, exposed by the
existing thin byte-only safe-bash adapter. No native product backend, compilation,
shell escape, downloaded fixtures, arbitrary templates, or PDF changes.

1. Write original failing SDK/adapter tests for the Writers.LaTeX obligation
   categories: escaping, delimiter hazards, adjacent formatting, heading levels,
   notes, lists, definitions, math, links, images, long tables and spans.
2. Implement context-specific escaping, fixed package preamble, deterministic
   labels/references and finite language selection. Reject unsupported semantics
   in strict mode; permit only explicit diagnosed projections with lossy mode.
3. Run maintained pandoc unit, lint/typecheck and selected workspace build routes.
4. Record evidence and package requirements under docs/pandoc. Commit owned paths
   and this plan locally on main; do not push.

## External QA lane

Outside unit discovery, generate owned representative standalone samples under
docs/pandoc. If a TeX oracle is installed, record its exact engine/version and
binary SHA-256, pin that binding for the run, and compile using -no-shell-escape,
-interaction=nonstopmode and -halt-on-error. Use a fresh owned output directory,
disable unrestricted input/output access, supply only owned image resources,
clear TEXINPUTS and related ambient search overrides, and enforce a 30-second
timeout, bounded log output and controlled process/memory/file resources. Check
logs for errors and unresolved references after a second pass. Record unavailable
oracle runs as unperformed, never passes. This oracle only validates exported
LaTeX; the PDF product remains the separate TypeScript engine.

Status: implemented and verified locally. Twenty-three original writer cases pass;
the maintained package suite passes 699 tests. Package lint/source-test typechecks
and the selected maintained workspace build pass. Owned samples and the inspected
adapter screenshot are under docs/pandoc. No installed TeX oracle was available:
external compilation remains unperformed. Commit only task-owned paths and this
plan; exclude the independently modified pandoc-typescript-safe-bash plan.
