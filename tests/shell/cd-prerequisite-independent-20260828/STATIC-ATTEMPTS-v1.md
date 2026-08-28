# Preliminary static attempts v1

These are own-harness preparation results, not candidate/product/native failures
or passes. No product runtime, native oracle, provider, service or guest was run.
Original author/native/provider evidence was not modified or rescored.

1. First `typecheck-v1.mjs --capture` stopped at its evidence hash assertion before
   TypeScript program creation. It incorrectly compared the base64 text wrapper's
   SHA256 `583f870007f3fe4cd2f9d1b8e979e715b0d8bd975e486a88d2716d705063d0e6`
   to the decoded compressed payload's SHA256
   `88fadf81a9ab984e4c25ff26f9f1d13331967549c0dbe08fbce268ee7ed1da12`.
   AssertionError actual/expected were those exact hashes. Corrected the harness
   to authenticate BOTH levels separately. No input bytes or assertion weakened.
2. Second attempt authenticated the846-entry package, but failed the zero-error
   positive type gate: TS2688 `Cannot find type definition file for 'node'` and
   TS2304 `Cannot find name 'AbortSignal'` at positive.mts:18. The virtual compiler
   directory guard admitted tool-package children but hid their ancestor directory.
   Corrected directory-existence admission for ancestors ONLY; file reads remain
   confined to authenticated in-memory declarations and three explicit tool roots.
   Neither missing import/type diagnostic counted as a positive or negative pass.
3. Third attempt completed ten positive assertions with zero diagnostics and ten
   negative inputs with their exact intended TS2322/TS2375 diagnostics. No emits,
   builds, installs, product imports or future negative inversions. See
   `TYPE-BINDING-v1.json` for actual declaration/tool inputs and diagnostic lines.
4. Initial own syntax/schema/arithmetic validation is retained as
   `VALIDATION-v1.json`. Final baseline-only review corrected A06's complete
   ENOTSUP syscall phrase to `access execute permission checks`, rather than
   shortening it to `access`. This was a prefreeze assertion correction from
   accepted source, not a candidate mismatch or diagnostic-assertion waiver.
   `VALIDATION-v2.json` is the final static capture and additionally binds its
   exact owned input hashes. Exposure ranges were extended for these final reads;
   accepted source bytes and all original evidence remain unchanged.

These initial terminal failures are recorded here as transcriptions of the tool
responses, not mislabeled raw child-capture files. No failing type evidence file
was created because capture occurs only after all assertions succeed.

Before final freeze, the own preliminary complete tracked-index enumeration was
compacted to its entry count39668 and digest; protected path membership/bytes and
the observed empty initial foreign staged diff were retained. The full index is
not an immutability gate against other workers' legitimate HEAD changes. No
foreign index or file was modified by this preparation change.
