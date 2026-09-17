# Reserved macro command verification

The existing TypeScript reader already implements the document, token/group/
environment, math-source, table, macro and injected-resource profile described in
latex-reader.md. This follow-up closes a validated allowlist gap: supported Unicode,
accent and newline commands were replaceable through simple macro definitions.

An original test failed before the correction (latex-reserved-red.log). It now
checks all three allowed definition forms and strict, raw-retain and lossy
policies. Every reserved replacement fails E_CAPABILITY. No unit filesystem,
external executable, fixture download or LLM is involved.

Maintained verification: npm test --workspace=@poe-code/pandoc passes 1045 tests;
npm run lint --workspace=@poe-code/pandoc includes both typechecks;
npm run build:workspaces -- --workspace=@poe-code/pandoc builds its declared closure.
Corresponding logs use the latex-reserved prefix. Existing command wiring remains
thin and conversion stays in packages/pandoc. This change has no visual CLI impact.

The ledger adds an original profile case; prior verification counts are historical
and no upstream compatibility claim is promoted. Local delivery only.
