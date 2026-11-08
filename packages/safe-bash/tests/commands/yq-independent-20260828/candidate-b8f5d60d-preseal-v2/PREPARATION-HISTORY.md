# Preparation history

August 28, 2026. No new data audit or candidate execution had begun during these
preseal preparation actions.

- Original v1 inspection remains reaped exit 1 after 922 ms, before artifact
  authentication. Its full packet is immutable at 90a633e89d35085183a1d57716451438335b93f3.
- An inline file-generation command had a JavaScript template-literal quoting
  SyntaxError before it could create the new inspector. Exit 1 was a preparation
  generator error, not the data inspector or any candidate/harness result. The
  helper patch preceding it had applied. The generator quoting was corrected
  before any new inspector preseal or audit; no product or archive was loaded.
- Both new own-script syntax checks then exited 0. The exact resulting source
  and diff, not the failed inline generator, are inputs to the new data preseal.
- Metadata inspection found original committed exact authorities for all three
  old 35da scopes, including the original compound-result 0600 entry. It found no
  full-POSIX-mode authority for the prior b8 v1 self-excluded final seal. That gap
  is predeclared as DENY; no mode is inferred from current stat or Git100644.
