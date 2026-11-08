# Installed verifier metadata clarification, not verification execution

One DATA-only Node helper, no children/network/executable decoding,20s wall,
256KiB capture. Read exactly two bounded regular installed metadata files:
`/opt/homebrew/Cellar/gnupg/2.5.21/INSTALL_RECEIPT.json` and
`/opt/homebrew/Cellar/gnupg/2.5.21/.brew/gnupg.rb`, each at most128KiB.
Do not follow private paths, crawl, execute Ruby/Homebrew/GPG, or infer actual
dyld loaded closure from declared package dependencies. Capture exact bytes,
mode and hash; preserve missing-file observations. This uses the same ROOT
30min/64starts budget, not a renewal. Outer capture precedes reads.

Purpose: give ROOT concrete declared dependency metadata for an eventual
verification-tool admission rather than claiming the gpgv executable hash alone
establishes its loader/library closure. No repeated download or version probe.
