# Inherited help and version verification

Task `inherited-help-and-version`, September 19, 2026. Working-tree qualification;
existing package/integration work was already uncommitted and remains preserved.
No commits, push, publication or README edits were performed.

Gnumeric 1.12.61 official archive was acquired/extracted exclusively under out
and authenticated against
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
GTK 3.24.49 archive authenticated against
`5ea52c6a28f0e5ecf2e9a3c2facbb30d040b73871fcd5f33cd1317e9018a146e`.
Reference dependency/plugin/locale identities remain in reference-profile.json
and glib-cli-parser-profile.json. GTK upstream source does not certify Debian's
patch set. Native ssconvert is absent and Docker's daemon is unavailable here;
this task did not execute fresh native probes.

The parser defaults to the existing C-locale capture's exact main, all,
libspreadsheet and GTK help bytes, with only argv0 mapped to `ssconvert`.
`-h`, `-?` and `--help` share main help. `--help-all` includes inherited groups;
GTK group help includes display while all-help puts display in Application
Options. Hidden solve/goal-seek/tool-test/resize/clipboard/range entries stay
hidden. `--help-gdk`, `--usage`, `--gtk-help`, `--gdk-help`, `--screen`, `--sync`,
GTK/GDK debug options and GDK-qualified aliases remain unknown in this captured
non-debug GTK profile. The manual's usage mention is not a supported option.

`--version` emits exactly three stdout lines headed by ssconvert; inherited
`--libspreadsheet-version` emits gnumeric and exits from Gnumeric's post-parse
hook before GTK module loading and the main version check. `-v` remains verbose.
Parser errors precede post-parse version; early help precedes later errors.
`-L`/`--lib-dir`, `-D`/`--data-dir` and their libspreadsheet-qualified aliases
consume filename arguments, preserving owned raw bytes as scalarBytes. These
upstream parameters are only declared and populated in libgnumeric.c:130–153;
they have no later consumers in released source. Existing native captures show
unchanged initialized version roots. They therefore do not redirect library,
plugin or data loading in this implementation either.

CommandProfile.configurationRoots binds explicit virtual dataDir/libDir identities
used by generated version output. Defaults are the captured deployment's
`/opt/ssconvert-reference/share/gnumeric/1.12.61` and
`/opt/ssconvert-reference/lib/gnumeric/1.12.61`. These strings confer no host
access and trigger no filesystem reads. Safe Bash snapshots roots and help-group
maps at registration. Explicit help/version/libraryVersion text can supply
locale captures; missing groups alongside custom main help are named blockers.
No automatic ambient locale/catalog lookup is performed.

GTK parsing accepts display/class/name/module/fatal-warning entries and their
GTK-qualified aliases, including `--gtk-gtk-module` and
`--gtk-g-fatal-warnings`. Version-only captures for display/class/name/fatal
warnings match; operational GUI/warning effects remain named blockers.
Nonempty module occurrences accumulate as GTK's callback does, even across empty
later aliases. Their observable module loading remains a named blocker instead
of unsafe native or host loading. Empty module values have no callback effect.

Concrete tests failed before each repair: four initial inherited cases, virtual
root configuration, missing translated group text, invalid UTF-8 filename roots,
repeated module accumulation and registration-time root ownership. A different
agent stressed and repaired the latter domain defects. SDK tests use injected
byte I/O and memfs, check unchanged namespace/no file accesses and exact borrowed
cancellation reason. Shell tests use the same command/SDK parser, check exact
terminal channels and unchanged memfs contents. No unit native utilities, LLMs
or disk fixtures were used.

Historical capture differential: 59 terminal observations compared, 57 exact
matches and two mismatches, both `--gtk-module=missing --version` captures.
Native status0/stdout version plus timestamped load-failure stderr differs from
the virtual status1 named blocker. These are failures, not parity passes. The
selector excluded importer/exporter/image listings and separator conversion
observations; it establishes no conversion or format parity.

Verified checks: uncached maintained selected build closures for
`@poe-code/ssconvert` and `@poe-platform/safe-bash`; fresh domain workspace tests
(207 tests, 16 files), domain lint plus source/test TypeScript checks, maintained
Safe Bash command test route (11 tests) and scoped adapter/test ESLint.
Final changed workspaces were rebuilt through their maintained build scripts;
built public SDK and virtual command matched all seven checked help/version/
usage terminal results exactly. `git diff --check` passed.
The attempted root `npm test -- --workspace=... --no-cache` selector was rejected
because unit-mode workspace selection is unsupported; fresh workspace-native
`npm test --workspace=@poe-code/ssconvert` was used instead. Full root tests/lint
and all Safe Bash consumers were not run or certified by these focused checks.

Actual opt-in virtual Shell screenshots were captured with the maintained
`npm run screenshot` tool for --help-all, --list-exporters and --usage, then
visually inspected. Help spacing/group placement and error text are readable;
the supplied empty-codec profile lists only the header, not native plugin parity.
Owned source/screenshot/host scratch is purged after recording verification.

Remaining mismatches/unmeasured profiles: nonempty GTK module loading and its
diagnostic timestamps/status; GUI state and fatal-warning effects during
operations; automatic translated help/errors/version and locale catalogs;
debug-enabled GTK/GDK builds and other GTK versions/profiles; fresh native
requalification and unobserved alias/cluster/byte combinations. Explicit locale
text injection is supported but is not translated-native parity evidence.
Existing workbook/format/harness parity gaps remain outside this task.

Candidate SHA-256:

- cli/parser.ts: `4b5cfe5ab0f6e447bef31960f6ce2934158f9b04a312f63e7a7c78b24c7f4503`
- cli/reference.ts: `b580a608c7477c6dcc624b3e714f08f7fbb0d1ef1432f2105a3f119c50236557`
- cli/inherited.test.ts: `75730ceeab9581ca5b32e53816cef1e1b1c31982714f8ec93b3c761cbcde2d7f`
- cli/inherited-stress.test.ts: `19f493e7573c21a6eab82f8391cb9e0cd6e1ed256dcf5c62e2a9c38de3ed1b24`
- Safe Bash adapter: `47ac11c6b53c936d31b2bcf680a4b51c09a1bc91ed3aa558eb73890e7482c4fe`
- Safe Bash command tests: `4671515bb98759c89f945e5a2781a65926c5cd7851c24264eac73a1c29432fd7`

## Current requalification: abbreviated group aliases

Preserved the existing implementation and unrelated edits. A new regression
failed twice before repair: retained native observations accepted `--l-version`
and abbreviated GTK warning aliases that the parser rejected. The parser now
resolves nonempty group-name prefixes against exact inherited entry names after
ordinary lookup. Help groups and option names remain exact. Missing arguments
use canonical entry names: `--gt-name` reports `Missing argument for --name`.
Main `--version` and short `-v` keep their precedence and namespaces.

The mandatory official Gnumeric archive was acquired again exclusively under out,
matched the task SHA-256 before extraction, and its libgnumeric.c:129–178 entries
and hook were inspected. Supplementary GLib 2.84.4 source confirmed first-dash
prefix dispatch at goption.c:1934 and canonical diagnostics at goption.c:1484.
Its downloaded archive SHA-256 was
`8a9ea10943c36fc117e253f80c91e477b673525ae45762942858aef57631bb90`;
no independently acquired publisher checksum or native dependency rebuild was
performed in this follow-up.

A different agent independently stressed the implemented parser: GTK module
blockers, canonical diagnostics, empty GUI values, disabled debug options,
invalid raw filename bytes and last-wins ownership, short clusters, namespace
negatives, exact SDK output and rejecting byte sinks without file acquisition.
Its initial alias-spelled diagnostic expectation was disproved by inspected
GLib source and corrected. No additional product defect was validated.
Unit tests use in-memory inputs/injected I/O; integration namespace tests use
memfs. No unit native processes, LLMs or disk fixtures were used.

Expanded retained-capture differential: **178 distinct terminal observations;
172 exact matches; six failures**. Captured channel lengths and SHA-256 values
were validated first. Selection covers help/version/inherited argv records with
terminal parses; nonterminal records are excluded. Deduplication includes argv,
status and both exact channels; only native argv0 is mapped to ssconvert. All six
failures are timestamp-distinct `--gtk-module=missing --version` observations:
native status0/version plus module load-failure stderr versus virtual status1
named blocker. These are not parity passes and no module/timestamp simulation
or host/native fallback was introduced.

Fresh candidate checks:

- Both maintained selected workspace build closures passed with `--no-cache`:
  `@poe-code/ssconvert` and `@poe-platform/safe-bash`, including declared build
  dependencies and postbuild stages.
- `npm test --workspace=@poe-code/ssconvert`: 214 tests passed in 18 files,
  workspace-native fresh execution without task-result caching.
- `npm run lint --workspace=@poe-code/ssconvert`: passed ESLint and source/test
  TypeScript checks.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts`:
  12 passed, no failures/cancellations/skips/todo.
- Scoped Safe Bash adapter/test ESLint passed.
- Built SDK and built virtual command passed three independent library-version,
  missing-argument and overlong-group negative cases on both routes.
- `git diff --check` passed.

The Markdown QA procedure was executed against the built virtual Shell.
Help-all, empty-codec exporter listing and abbreviated missing-argument error
screenshots were captured with the maintained screenshot route and inspected.
Spacing, group placement and diagnostics are readable. The listing qualifies
header rendering only. The error command exited1 as expected while screenshot
capture succeeded. Scratch was reduced before cleanup; automatic review initially
rejected combined cleanup because ownership had not yet been checked.

Full root tests/lint/build and the complete Safe Bash test inventory were not
run or certified; no fresh verification run was left incomplete. Fresh native
QA remains unavailable: native ssconvert is absent and the default Docker daemon
socket is unavailable. Translated native help/errors/version, debug-enabled GTK
builds and GUI/module/fatal-warning operational effects remain unverified or
named blockers. Explicit locale captures/virtual roots remain supported without
ambient directory/library/catalog reads. Browser/worker and original/checkpoint/
replay harness cells were not executed; this parser change does not modify their
boundary/lifecycle implementations. No performance measurements or generated
corpus were used. Overall parity remains incomplete.

No commits, push, remote delivery, release, publication or README changes.
Current candidate SHA-256 supersedes earlier hashes only for these bytes:

- cli/parser.ts: `1d73eb1df82496acabc1bbacaa348e84be21db6cb4bb1b5dbc3db769b61b00ba`
- cli/reference.ts: `b580a608c7477c6dcc624b3e714f08f7fbb0d1ef1432f2105a3f119c50236557`
- cli/group-aliases.test.ts: `2cefe461c471575b2ac9dc0c67ebacd60b3807fdc7697d44c3dd91591b33d249`
- cli/inherited-independent-review.test.ts: `283b1bcda9d5a7368b820bb8ea5287a8ef59dae4af18c2daf364d9864a93a66e`
- Safe Bash command tests: `381961ee6cb7d8e1da9224bd5bd582ce5d23464a9e96a6ce3728646737e6ef21`

Cleanup was subsequently approved after verifying the exact top-level inventory
and all extracted paths/content against both owned archives (2,333 GLib and
2,213 Gnumeric regular files, plus authenticated directory/symlink membership).
Only this invocation's scratch directory was removed; final diff whitespace
verification passed. No approval remains pending.
