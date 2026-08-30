# Bounded seq extra-directive diagnostic fix

Only the already-rejected extra-directive branch in `parseFormat` changes:
it now includes the supplied format and says `has too many % directives`.
No parser, formatting, output, exit-status, filesystem, plugin, default, or
public-export behavior changes. The leaf owns only seq.ts and these new focused
regression/evidence files; the original stream-format author had closed.

## Initial failure and preserved controls

`seq-diagnostic-initial.json` captures all 16 actual memory-Shell/native cases
before the edit, including the routed `seq -f '%f %f' 3` failure. Both return 1
and empty stdout; source stderr was `seq: format must contain exactly one
conversion\n`, while GNU includes `'%f %f'` and the extra-directive reason.
Initial seq.ts SHA256:
`ce1bbce84a6fb8a57ed43dfc52126d1e5ea64c0a93112dee7c44d7a0bcb36929`.
Fixed seq.ts SHA256:
`da12d6b4792fe42a9c21b0dae93e85a00f7a30f0b5067c051cfb9ef0d2f35198`.

The 16 controls cover two multiple-valid-conversion formats, four zero-conversion
formats (including escaped percent), four malformed-first-directive formats,
four extra suffix directives (including malformed/escaped-percent combinations),
and two successful escaped-percent formats. GNU's malformed suffix rejection
already agrees with this parser's branch order; no new conversion parsing is
needed. The existing zero-conversion and malformed-first-directive messages are
asserted exactly and left unchanged. Their remaining GNU diagnostic differences
are retained, not treated as exact parity. Source/native status and stdout match
on all 16 both before and after; exact status/stdout/stderr match improves from
2/16 to 8/16 in this deliberately narrow diagnostic control set only.

## Verification

- Focused regression before edit: 17 tests, 11 pass, 6 fail, exit 1.
- Same regression after edit: 17/17 pass, exit 0; 16 cases plus oracle identity.
- Original author suite separately: 144/144 pass, exit 0.
- Scoped project-equivalent noEmit including new test: exit 0, no diagnostics.
- All test runs: zero skipped, cancelled, or TODO tests. No emitted build.

Regression command: `node --import tsx --test
tests/commands/stream-format/seq-diagnostic.test.ts`.
`seq-diagnostic-final.json` preserves exact author/typecheck argv, summaries,
initial/new test hashes, all six format source hashes, and post-fix observations.
The author run explicitly lists its original tests, excluding the new regression,
so 144 remains the original denominator; this is not independent verification.

## Profile and remaining limits

Native controls use only the supplied existing GNU coreutils 9.7 seq binary,
SHA256 `ffc2f2585818b4185924d73e839c93c44b9115f6e91a28b340760e4a0533f70f`,
on Darwin 25.4.0 arm64 with an explicit environment containing only `LC_ALL=C`.
The primary GNU live seq manual and upstream seq.c were consulted for context;
their newer live versions are not substituted for this measured pinned oracle.
This is not GNU/Linux or Apple seq evidence. Existing author Apple rev controls
remain separately qualified; no native oracle was edited or rebuilt.

The user-routed immutable1c745c3 review's original strict61/82 eachbackend and
selectedstrong initial81/82 eachbackend remain historical evidence, as do the
original author's 22 diagnostic differences and frozen82 GNU/Apple originals.
No independent hidden corpus was inspected and no independent replay was run.
Root releases unchanged replay only after all fixers have closed. The source-only
format APIs remain opt-in; defaults remain 60, not 65. No global suite, root dist,
public-consumer build, broad parity, superiority, or full-completion claim.
