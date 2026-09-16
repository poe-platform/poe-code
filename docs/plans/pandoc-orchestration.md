# Pandoc conversion orchestration

Implement and validate the original TypeScript pipeline, with no native fallback.

- Write original failing fixtures for operand admission, joining, metadata precedence,
  warnings before publication, source errors and CLI acquisition ordering.
- Describe operand composition in format descriptors. Markdown joins normalized
  operands with a final newline per operand and shares references. Delimited tables
  retain ordered independent document composition. JSON and binary accept one input.
- Merge parsed metadata objects recursively; later lists/scalars replace, null
  removes the key. Explicit options override document metadata.
- Keep CLI parsing and acquisition in the package; the command delegates to convert.
  JSON metadata files use an explicit injected input capability; reject YAML.
- Run package tests, lint/typecheck and selected workspace build. Record evidence
  under docs/pandoc. Commit verified task paths on main without pushing.

QA: execute byte-input command fixtures with rejected flags and metadata files,
inspect deterministic stderr and content bytes, and verify destination callbacks
are untouched by preflight failures. This command has no visual prompt UI.

Completed: original failures reproduced and fixed; package tests, lint/typecheck,
selected workspace build and compiled-command screenshot inspected. The contract
and validation evidence are recorded in docs/pandoc/orchestration-contract.md.
Delivery is local only; pushing and releasing remain unauthorized.
