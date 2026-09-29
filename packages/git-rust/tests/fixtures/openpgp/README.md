# OpenPGP interoperability fixtures

The payload, detached Ed25519 signature, and matching certificates come from
Sequoia OpenPGP 2.4.1's `tests/data/messages/a-cypherpunks-manifesto.txt*` and
`tests/data/keys/emmelie-dorothea-dina-samantha-awina-ed25519*.pgp` fixtures:
https://gitlab.com/sequoia-pgp/sequoia/-/tree/openpgp/v2.4.1/openpgp/tests/data

Sequoia is licensed under LGPL-2.0-or-later. The certificates have been converted
to ASCII armor without changing their packets. `test-secret-key.asc` is a
publicly available test key, never a production credential.
