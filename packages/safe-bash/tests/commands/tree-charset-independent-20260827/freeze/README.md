# Independent post-commit holdout freeze

Chronology: this independent freeze is necessarily after candidate commit
`f1a90436c45208ca248e058a039893233c608daa`. It is not and must never be
described as a pre-source-commit freeze. These fixtures were committed before
this verifier inspected, built, installed, loaded, or executed that candidate,
its tests, or the author handoff.

The holdouts are deliberately derived only from the user's stated contract.
They test connector selection without changing traversal or counts, explicit
own-key environment lookup, precedence, supported and unsupported spellings,
terminal escaping, bounded UTF-8 bytes/work, cancellation, awaited sink writes,
and harness negative controls. `expectations.json` is literal and immutable.

Native parity is narrower than virtual extension behavior. In particular,
lowercase locale suffix `.utf8` is classified as a virtual extension and is not
an expected native-tree parity result. The native recipe refuses to run unless
the caller identifies an exact executable and expected SHA-256.
