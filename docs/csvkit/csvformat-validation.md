# csvformat qualification

The executable engine now lives in packages/csvkit/src/commands/csvformat.ts;
its existing descriptor and safe-bash family registration remain authoritative.
The unused operations/format.ts implementation was removed. CLI and SDK call the
same engine and retain the shared runtime's stream/cleanup/backpressure contract.
No product host process, Python fallback or implicit capability was added.

Source archive SHA-256:
147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b.
Research used CPython 3.14.2, interpreter SHA-256
3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae,
with the existing requirements-cpython-3.14.2.txt hash-locked dependency closure
including Agate 1.14.2, Babel 2.18.0 and SQLAlchemy 2.0.54. No database driver is
used by this executable. Locale inference is frozen to en_US and de_DE.
The upstream German-locale test failed first with status 78 and now emits
`"a","b","c"\n1.7,200000000,""\n` with status 0.

Qualification covers raw streaming, generated headers, header omission,
physical skip-lines, output delimiter/tabs/ASV precedence, independent input and
output quoting/escaping, arbitrary terminator characters, missing-escape errors,
writer validation before reading, preserved partial output and virtual input
files, number/text-only inference, typed nulls/empty input, argv collisions and
CLI/SDK parity. Empty output delimiter/terminator options deliberately fall back
to defaults as the source does. Runtime QUOTE choices retain the existing 3.14
profile (0 through 5); modes 4/5 write raw strings without Agate inference.

## Explicit compatibility blockers

- Input -u 2/4/5: the shared operation reader rejects these with status 78.
  csvformat-reference.json records a measured source -u 2 case; it is not
  qualified as implemented. The stress assertion verifies honest rejection,
  not csvkit parity.
- Typed duplicate/unnamed headers: shared table inference rejects warning cases
  with status 78. The measured duplicate observation records source renaming and
  the installation-specific Agate warning location. It is not a passing case.
- Number locales other than en_US/de_DE remain rejected; general Babel/CLDR
  locale compatibility is not established by the German upstream regression.
- CPython 3.9.6 differences and verbose traceback deployment identities have
  not been requalified for this focused implementation.

Validation: maintained csvkit build closure and lint pass; workspace unit tests
pass (1841 passing, 1 existing skipped, 6 existing todo). Focused safe-bash shell
registration/writer/stress checks pass, including eight independent stress
checks; one of those eight checks asserts blockers rather than compatibility.
Maintained inventory discovery includes the new stress file. Screenshot output
was inspected ad hoc; no snapshot test or README change was added.

## Independent user edge recheck

The separate user edge review restored the exact CPython 3.14.2 binary (SHA-256
above) with the hash-locked dependency profile and reverified the source archive
SHA-256. Nine additional Unicode, multiline, quoting and error observations and
a 31-case number/text/null inference cohort matched reference stdout, stderr and
status exactly. Representative cases are retained in
packages/safe-bash/tests/commands/csvformat-user-edge.test.ts; the procedure is
docs/plans/csvformat-user-edge-qa.md. Named virtual input, redirected output and
borrowed stdin isolation were checked separately as capability integration.
These cases required no product fix and do not resolve the blockers above.

The domain unit suite, maintained selected workspace build closure and domain
lint passed again. Focused shell checks and maintained test discovery passed;
an actual tab-separated shell output screenshot was inspected ad hoc. Temporary
reference and screenshot artifacts were purged; no README, commit or publication
change was made.
