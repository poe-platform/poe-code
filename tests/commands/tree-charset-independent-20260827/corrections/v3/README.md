# Versioned correction v3

This correction preserves the predecessor freeze, supplemental freeze, and v2
correction unchanged. The executed moved-package holdout exposed one additional
supplemental literal error: `en_US.UTF8` (without a hyphen or lowercase `.utf8`)
is not in the exact virtual locale table, so it selects ASCII. The authenticated
candidate contract lists only `C.UTF-8`, `C.utf8`, `en_US.UTF-8`, and
`en_US.utf8` as UTF-8 locales.

This file also makes explicit that v2's environment corrections apply to the
predecessor's guessed cases as well as the supplemental IDs. Finally, the
supplemental negative control N04 was based on those wrong guesses. It is replaced
by separate controls for invalid explicit charset acceptance and failure to skip
empty locale values. No product behavior or prior fixture is rewritten.
