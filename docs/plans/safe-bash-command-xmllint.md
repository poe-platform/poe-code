# xmllint extraction

Issue #1001 authorizes extracting this existing command while preserving its
registration, runtime profiles, imports, diagnostics and resource limits.

The private `safe-bash-command-xmllint` workspace owns argument admission and the
command handler. The private `safe-bash-xml-engine` owns XML budgets, XPath tree
queries, serialization and bounded input decoding. Both use the canonical
safe-fs parser and safe-bash-contracts identities. Safe Bash retains xq's jq
integration and supplies its existing scheduling, path and diagnostic policies.
The default XML plugin still registers exactly xq and xmllint.

Keep the existing XML regression suite as Shell integration coverage. Add direct
workspace tests and packed-consumer checks for public XML exports, strict
NodeNext declarations, VFS scripts, pipes, raw argv, limits, cancellation and
registration. Validate maintained build/unit/type/lint/package gates, then verify
remote main before recording all acceptance evidence and closing the issue.
Neither private workspace is independently published or needed by consumers.
