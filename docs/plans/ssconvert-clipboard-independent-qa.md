# Independent clipboard serialization QA

## Procedure

Use a different agent from the implementation/integration owner. Read root and
safe-bash instructions; do not change exports, integration registration, Git,
README files, or unrelated edits. Primary source remains under `out`.

Use released Gnumeric 1.12.61 with archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The separate Docker oracle is `ssconvert-statistics-qa`, accessed through
`unix:///Users/kjopek/.colima/default/docker.sock`; the executable is
`/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`. The root capture
`out/ssconvert-clipboard/profile.json` recorded dependency/plugin hashes, locale,
environment and binary identity during QA. Its identity and profile details are
transcribed in `ssconvert-clipboard-export-qa.md`; temporary captures were purged
after use. Native execution is manual QA only and does
not enter product execution or unit tests.

1. Create original small CSV/XML fixtures under `out/ssconvert-clipboard`.
2. Capture native output bytes/status/stderr for hidden clipboard targets,
   original-coordinate formulas, nonzero range origins, styles, axes, array
   corners/followers and selected objects.
3. Add failing memfs regressions before repairing concrete differences.
4. Invoke the real SDK engine with injected byte I/O for native byte comparisons.
5. Exercise cancellation after diagnostics, budgets, unknown SDK sheets and
   preserved destination content on failures. Use no native subprocesses or disk
   writes from unit tests.
6. Run maintained uncached package checks through the root owner; focused local
   discovery runs are supplemental evidence only.

## Executed evidence

The review ran against the live edited checkout; it is not a frozen candidate
or release qualification. No desktop clipboard or GUI display was accessed.

| Case | Native evidence and result |
| --- | --- |
| `B2:D3`, `--set` formulas | `stress-native.xml`: original Cell coordinates; native ExprID attributes precede ValueType/cache. |
| Separate relative-equivalent `--set` formulas | `stress-shared-native.xml`: each independently assigned formula receives a distinct ExprID. The initial review repair incorrectly deduplicated normalized expressions; its failure was retained as a new regression and corrected. |
| Imported uniform bold/`0.00`, nonzero axes | `stress-style-native.xml`: exact SDK/native bytes, 1011 bytes, after repair. Original axis No is preserved; single entries omit Count and retain HardSize. |
| Mixed styled/default empty selection | `stress-style-mixed-native.xml`: exact SDK/native bytes, 1689 bytes, after repair. Resolved nonoverlapping style regions; column-first ordering; no Cells element. |
| Imported styled table | `stress-style-html-native.html`: native table uses one occupied cell, drops source axis sizes and displays bold `2.00`. |
| Qualified same-sheet formula | `stress-qualified-native.xml`: `=Original!B2` retains its sheet qualification. |
| Array corner | `stress-array-native.xml`: exact SDK/native 1059 bytes after import-calculation repair; ExprID, Rows and Cols precede ValueType/cache, followers omitted. |
| Array follower-only range | `stress-array-follower-native.xml`: exact SDK/native 821 bytes after repair; NotAsContent=1 plus empty Cells element is retained, unlike a range with no copied cells. |
| Text targets | Root `targets.json`: four accepted text targets serialize empty bytes due to unset GtkSelectionData target in this released hidden test path. They are not a fabricated text clipboard. |
| Objects/images without selected objects | Root `targets.json`: accepted image/graph targets return status 0 and empty output with native assertions; graph additionally emits Unknown info type. |

Repairs validated by unit regressions include default font Script, formula IDs,
array dimensions/followers, strict SDK sheet lookup, fresh table date convention
and axis defaults, clipped resolved styles, contained object/comment anchors,
and preserving destination content on budget/cancellation failure.

The earlier supplemental run of `clipboard.test.ts` and `clipboard-objects.test.ts`
passed all 28 tests. An earlier contained-comment regression found that the
object-record copier used only qualified attributes, dropping ObjectBound and
Text; the object owner repaired it and the final test verifies exact retained
records and rejection of outside/partially contained anchors. Test typechecking
also passed after resolving memfs's union return type. Maintained uncached
package/workspace checks are reported separately by the root owner.

Follow-up stress reviewed the root owner's import-calculation repair and engine
wiring before updates. The native root capture `loadcalculation.json` shows
dirty imported formula caches settle on load in both calculation modes. Actual
array corner and follower outputs now match native exactly (1059 and 821 bytes).
Three added SDK/memfs cases pass: injected import calculation sees temporary
automatic mode and force=false, manual mode is restored before update handling,
the imported fixture remains unchanged, cancellation retains the original
reason before destination effects, and returned provider data must satisfy the
workbook cell budget before publication. No repair to this helper was needed.
The focused run including lifecycle cases passed 36 tests before these three
additional SDK cases; the clipboard file then passed all 20 cases. A concurrent
root regression exposed 1904 DateConvention handling. Native workbook input
uses an unqualified Calculation DateConvention attribute; a qualified input
attribute is ignored by the native reader. Clipboard output uses qualified
gnm:DateConvention. The root owner corrected the fixture to the native input
grammar and repaired clipboard output qualification; no reader behavior change
remains. The independent rerun then passed all 40 tests and test typechecking.

A final read-only review covered root-authored SDK range admission and output
error translation. Range validation rejects noninteger/nonfinite, negative and
reversed bounds before target serialization. Known filesystem opener failures
translate to the measured clipboard diagnostic while opaque host failures keep
their identity; cancellation is checked before translation. No new concern was
found in that bounded review. The final independent focused rerun passed all 45
tests (20 serialization, 11 objects and 14 lifecycle cases).

Object source review confirmed PNG raster dimensions/work/output admission before
RGBA allocation, per-decode and pixel cancellation checks, output limits on
empty graph XML, and no native/desktop/implicit host capabilities. This is a
bounded implementation review and existing-case rerun, not qualification of
arbitrary codec malformed data or all native image bytes.

## Remaining mismatches and unmeasured cases

- Native GLib assertion prefixes contain process IDs and timestamps. The product
  preserves the stable assertion message, not those native process/time bytes.
- Arbitrary conditional-style expressions, validation formulas, hyperlinks and
  cross-sheet relative-style expression rebasing have not been differentially
  qualified. Simple imported font/format regions are the measured cases.
- General overlapping style mosaics may partition or order regions differently
  from Gnumeric's style tree; the two measured uniform/mixed fixtures do not
  establish all-region byte parity.
- Explicit shared-expression groups, rich-text XML, empty imported cells, partial
  merges and arbitrary row/column default/outline metadata are not independently
  qualified by this review.
- The earlier imported `={1,2;3,4}` array corner mismatch was concrete: blank
  ValueType=10/empty Value and 1058 SDK bytes versus native ValueType=40/Value=1
  and 1059 bytes. Import-calculation repair now resolves this measured case;
  it does not establish arbitrary imported formula or array evaluation parity.
- Native XML object passthrough preserves supported source records and rebased
  anchors but does not synthesize every native object default. Non-Gnumeric
  object/comment record forms are not established by the contained-comment case.
- Root object tests cover same-type embedded image bytes and native empty graph
  defaults. Complex graphs/components, graph image rendering and all image-source
  transcoding remain unsupported or unmeasured. JPEG transcoding is not a native
  byte pass; BMP native padding can contain uninitialized bytes and only its
  measured stable prefix is compared.
- The root target census measured a BIFF table mismatch: native 4608 bytes versus
  product 5632 bytes from the shared existing writer. Rich/object BIFF metadata
  and every plugin-dependent saver failure are not independently established by
  these fixtures.

Unsupported and unmeasured cases are not counted as passes. Final maintained
build/test/lint results and cross-workspace delivery remain with the root owner;
this review does not authorize a push or publication.
