# Original OLD9 / nested-NUL independent baseline

Source is committed shell `f7000b05b15fa34371226b35cf537d3f73bbf004`.
Runtime SHA256 `c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449`;
parser `28492059750ba7f11fad563dfc03dba049f232b3f2212186cf3553e4559ae905`.
All ten shell-file hashes match that commit before/after phases. The author
remained read-only; no product, original fixture, oracle or benchmark was edited.
The handoff and diagnostic TYPECHECK_CHECKPOINT were read before execution.

## Original cohorts, unchanged assertions

The complete affected native fixture set is72 differential +5 syntax +11
remaining-gap rows =88. Original differential and remaining-gap test files run
unchanged. The original historical helper uses /bin/bash; a separate uniform
modern launch profile substitutes ONLY that executable for every native child,
including its version control. Both retain their original `-c SCRIPT shell-stress`
arguments. The existing diagnostic-profile compatibility test runs unchanged
under each complete pinned profile using `-c SCRIPT shell` and its immutable
expected tuples. No case-dependent selection or output normalization occurs.

| Invocation/cohort | Original TAP result | Raw fixture tuples |
| --- | --- | --- |
| Original helper, Bash3.2, shell-stress |80/89, original OLD9 fail|74/88 exact|
| Uniform GNU5.3 original-helper profile, shell-stress |80/89, same OLD9 fail|74/88 exact|
| Existing GNU5.3 diagnostic profile, shell |89 assertions pass, one separate after-hook failure:89/90 TAP|88/88 exact|
| Existing Bash3.2 diagnostic profile, shell |75/89,14 fail|74/88 exact|

The raw88 denominator includes five syntax fixtures whose original tests assert
status/no effects/nonempty diagnostic, NOT exact stderr. Their exact diagnostic
differences are retained, not silently added to or removed from the original
OLD9 test-failure denominator. All352 fresh native fixture observations exactly
match their respective unchanged stored profile/label captures: ZERO native drift.
All nine match the consistent modern `shell` profile. Their original failures
remain failures, not changed expectations or claimed original-test closure.

### Classification of the original nine

- Moved input/output descriptors: bytes/status/files agree; historical Bash
  omits modern line context, and original helpers name the shell `shell-stress`.
- Fatal parameter/arithmetic and substitution-only fatal expansion: correct
  status/earlier-only effects; historical diagnostic line context and original
  source label differ. All modern `shell` bytes match.
- The two same-unit malformed-substitution cases genuinely differ in execution
  effects across profiles: Bash3.2 creates the earlier marker (and one emits
  `beforeafter`) and returns0; GNU5.3/current virtual prevalidate the unit,
  create no marker and return127. Do not reintroduce the historical behavior
  as a modern target fix. Original modern helper retains its name-only mismatch.
- Original NUL removal: all remove NUL correctly; Bash3.2 has no warning while
  GNU5.3/current virtual warn. The original modern helper's warning source name
  differs. The uniform modern `shell` observation is exact.

Full named nine fixtures, statuses, stdout/stderr bytes, effects and four-profile
observations are in `findings.json`; no diagnostic was normalized to classify.
There is no demonstrated modern target defect WITHIN these original nine after
consistent source-name selection. This does not erase their exact original losses.

## Genuine modern NUL diagnostic defects

Eight independent fixtures are frozen in `nul-cases.mjs`, including the exact
documented repro and its original paired backtick control. Each WHOLE eight runs
under both pinned native profiles with both consistent names `shell` and
`diagnostic-nul-script`:32 native executions. Virtual runs both names once:16.
The named case is a `-c` source label, NOT a physical script file. Product uses
its real supported `bash -c SCRIPT NAME` for the named profile; default uses
Shell.exec. Exact launch/source strings are retained, with no line normalization.

| Nested dollar source | GNU5.3 warning line | Current line |
| --- | --- | --- |
| No blank lines after initial colon |4|4|
| One blank line |5|6|
| Original two blank lines |6|8|
| Three blank lines |7|10|
| Original repro after two prefix lines |8|10|
| Multiple NUL bytes in the original inner substitution |6, one warning|8, one warning|
| Paired multiline backtick control |4|4|
| Two independent substitutions |1 and2|1 and2|

Exact original repro (empty stdout, status0, no file effects):

```bash
value=$(:


printf '%s' "$(printf 'a\0b')"
)
```

Second concrete defect: for explicit name `diagnostic-nul-script`, native
warnings start `diagnostic-nul-script:` while virtual warnings still start
`shell:`. This is NOT the original default-name policy conflict: the caller
explicitly supplies the child source identity. The current warning formatter
at runtime.ts:1537 contains literal `shell`; this is a source-owner finding,
not a patch from this verifier. Nested line-offset mapping near runtime.ts:1533
needs author investigation; no blanket parser/source-line rewrite is proposed.

NUL primary exact results:3/8 default-name and0/8 explicit-name =3/16.
Historical exact results:0/16, preserving Bash3.2's silent-removal dialect.
All16 virtual rows match modern stdout bytes/status/files AND warning counts;
only line/source-context diagnostics differ. Multiple NUL bytes warn once per
substitution; the two-substitution control warns twice. These are red native
comparisons, not skips/xfails or successful known-defect characterizations.
`nul-native-frozen.json` is immutable authoritative evidence for later reruns.

## Provenance, guards and boundaries

Pinned GNU5.3 executable `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`,
SHA256 `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`;
historical `/bin/bash`, SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Version strings, exact process argv0, args, cwd, C/UTC scrubbed env, raw stdin/
stdout/stderr and effects are retained. Historical documents call the final
`-c` name argv0; evidence distinguishes that shell `$0` from OS process argv0,
which defaults to the executable path. Original temporary-root roles remain
unchanged. VFS fixtures live at `/`; native fixtures in per-case temp roots;
only relative effect keys correspond. No output/cwd mapping was needed or used.

The capture hook observes actual source imports and child launches; it does not
replace test assertions or product execution.130 actual source imports match
before/load/after hashes throughout. Per-PID maps share digest-addressed
manifests. The GNU5.3 profile's unchanged after-hook failed because unimported
`src/fs/s3/http/transport.ts` changed during the cohort. That raw hook failure is
preserved. The imported module set and shell anchors did NOT change; this is
qualified productive88/88 native evidence, not a clean aggregate certification
or a reason to discard it/retry. No source/import mismatch is concealed.

Original phases ran03:50:36–03:52:13 UTC August27,2026; NUL captures followed.
All768 recorded child PIDs/groups are absent and native scratch directories
were cleaned; no SIGSTOP or other workers' children were touched. Original
bounded helpers retain their native deadlines. The profile identity test's two
native pipeline timeout controls are preserved; these are NOT the five custom
virtual first-read requirements. `resources.test.ts` and the benchmark runner
that imports it were deliberately NOT run, because they include that excluded
lifecycle cohort. No custom5, Plato output-budget8, corrected72, expanded7,
global build/typecheck or unrelated suite was run or changed.

Historical HANDOFF audit counts and its dirty57d9 snapshot stay historical.
No lifecycle API, source correction, full Bash/kernel parity or superiority
claim. ROOT may now route only the frozen concrete diagnostics to the author;
this verifier stops until an explicit author READY is handed back.
