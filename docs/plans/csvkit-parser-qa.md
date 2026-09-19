# Parser and argv qualification

1. Read root instructions and preserve index/unrelated edits. Canonical tests
   must remain fast, in-memory and independent of native oracle availability.
2. First add original failing tests for raw byte identity, admission limits,
   command-specific flags, clusters, attached values, abbreviation, terminator,
   repeated store/append values, negative tokens, quoting choices and FileType
   timing. Implement only after observing each failure.
3. Use the authenticated isolated CPython 3.14.2 reference to reproduce reported
   grammar mismatches. Preserve exact argv, namespace, stdout/stderr/status in
   owned out evidence. Do not use native csvkit in product execution or canonical
   units. Separately track UTF-8 surrogateescape and Unicode integer behavior.
4. After code work, have an independent agent stress/fix the parser and argv
   implementation using original regression tests. Keep command descriptor/root
   export/integration/Git ownership with root. This scope is parser stress, not
   stress qualification of unimplemented safe-bash CSV tools.
5. Run npm test --workspace=@poe-code/csvkit, npm run lint
   --workspace=@poe-code/csvkit and npm run build:workspaces --
   --workspace=@poe-code/csvkit, uncached. Maintained workspace declarations
   determine build membership; do not substitute a fixed task census.
6. Render the SDK parser's csvcut help and a parser error through the existing
   terminal-png API into out, inspect screenshots, then reduce findings. This
   measures the SDK output text only. Actual CLI screenshots/pipelines must wait
   for safe-bash registration; do not count SDK rendering as CLI integration.
7. Explicitly qualify FileType opening/handle transfer/exit cleanup without content
   reads. Report missing native traceback behavior, unqualified optional
   runtime profiles and every unimplemented operation. A namespace parsing or
   version/help pass does not execute a CSV command.
8. Purge owned scratch after reduction and independent review. Do not add README
   content, change unrelated staging or commit/push/publish.
