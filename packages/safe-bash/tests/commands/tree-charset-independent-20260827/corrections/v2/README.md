# Versioned correction v2

This correction does not rewrite either immutable post-source freeze. It was
authored after inspecting the exact candidate and author handoff and after an
independent invocation of the authenticated Darwin arm64 `tree` 2.2.1 binary
(SHA-256 `34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`).

The replacement verifier's supplemental `cases.json` incorrectly repeated the
predecessor's guess that empty/unknown selected environment values are usage
errors. The exact candidate contract instead distinguishes explicit option
values from environment values: invalid explicit `--charset` is status 2;
present empty/unknown `TREE_CHARSET` selects ASCII; an empty locale key is
skipped; and a nonempty unknown locale selects ASCII. The independent native
capture confirms ASCII and status 0 for empty/unknown `TREE_CHARSET`. The
candidate source README at `f1a90436c45208ca248e058a039893233c608daa` is the
normative virtual-contract rationale for empty locale fallthrough.

The supplemental native recipe also accidentally included `captures.sha256`
in the set redirected into that same file. The original execution and its
expected one-file checksum failure are retained. `native-capture-v2.sh` excludes
the manifest itself and adds an empty-`LC_ALL` observation. This is a fixture
repair only, not a product change or retroactive native result.
