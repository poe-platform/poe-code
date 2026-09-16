# Pandoc explicit safe-bash plugin

Implement only the original TypeScript converter adapter, preserving the existing
modified overarching plan. Keep conversion/options in the pandoc SDK and use the
safe-bash contracts for argv, VFS identity, budgets and owned output lifetimes.

1. Reproduce CLI inference, stdout dash and information-mode gaps with original
   failing SDK tests, then implement typed publication options.
2. Write failing actual Shell tests using memfs-backed operations for registration,
   quoting, operand ordering, pipes/redirection, raw RTF and binary publication.
3. Add cancellation, broken-pipe, identity-unknown and filesystem-error cases;
   independently review the adapter under scoped delegation instructions.
4. Run maintained scoped tests, lints, workspace builds and strict consumer checks.
   Record verified evidence in docs/pandoc. Commit owned atomic improvements on
   main, with no push or release.

QA procedure: invoke the built explicit plugin in a VFS Shell; inspect help and
version, convert quoted operands through a pipeline, compare PDF/EPUB stdout and
command `-o` bytes, and check failure diagnostics and preserved destinations.
Capture CLI output as a screenshot and inspect it. Distinguish shell redirection
truncation from deferred command output. Do not use native Pandoc as a runtime.

Execution: original tests and implementation are complete, including independent
stress review and a follow-up review of retained consumer closure. Scoped checks,
the full maintained build and public bundled-import QA passed. Evidence and
remaining broad gate limitations are recorded in docs/pandoc/safe-bash-plugin.md.
Commit the verified adapter and its necessary packaging/build integration as one
atomic feature; retain separate earlier PDF and SDK commits. Do not push.
