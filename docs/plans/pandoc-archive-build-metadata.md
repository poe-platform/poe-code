# Pandoc archive build metadata

The maintained native test route reproduced missing Pandoc/PDF metadata in the
isolated S3 packed-revision compiler fixture. A focused committed-admission test
also reproduced rejection of the Pandoc command's public artifact export.

Admit bounded private workspace manifests through the existing authenticated Git
blob reader, verify identities and workspace lock bindings before source reads,
and preserve the exact public command artifact export. Synthetic S3 repositories
without Pandoc sources omit its unneeded build dependency.

Validate the focused admission regression, full archive controls, ESLint, and the
maintained repository test route before delivery.
