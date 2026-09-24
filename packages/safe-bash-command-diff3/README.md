# Compare and merge three byte streams

Compare three byte inputs without changing encoding, line endings or file content.
Import the bundled API from `@poe-platform/safe-bash/commands/diff3`; this private
workspace is not an installation dependency.

| API                                                          | Use                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `diff3Commands({ limits?, replace? })`                       | Opt in to the `diff3` shell command                                                |
| `diff3(context, { files, merge?, selector?, labels?, ... })` | Run the same VFS invocation from the SDK                                           |
| `compareDiff3(inputs, invocation, limits?, signal?)`         | Produce report, merge or ed bytes without I/O                                      |
| `parseDiff3Arguments(args, limits?)`                         | Parse the fixed GNU 3.12 option inventory and unique long prefixes                 |
| `analyzeDiff3(files, limits?, options?, signal?)`             | Pure analysis of explicit `base`, `left`, `right` byte inputs                      |
| `createDiff3Engine(limits?, options?, signal?)`               | Feed byte-stream chunks using `push(file, bytes)`, then `end(file)` and `finish()` |
| `Diff3Error`                                                 | Structured cancellation, quota, binary-admission, lifecycle and alignment errors   |

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { diff3Commands } from "@poe-platform/safe-bash/commands/diff3";

const fs = createMemoryFileSystem();
const encode = (text: string) => new TextEncoder().encode(text);
await fs.writeFile("/ours", encode("ours\n"));
await fs.writeFile("/base", encode("base\n"));
await fs.writeFile("/theirs", encode("theirs\n"));
const shell = new Shell({ fs }).use(diff3Commands());
const result = await shell.exec("diff3 -m /ours /base /theirs");
console.log(result.stdout); // conflict markers and all three versions
await shell.dispose();
```

For a byte-only SDK comparison without a filesystem:

```ts
import { compareDiff3 } from "@poe-platform/safe-bash/commands/diff3";

const encode = (text: string) => new TextEncoder().encode(text);
const result = compareDiff3([encode("ours\n"), encode("base\n"), encode("theirs\n")], {
  files: ["ours", "base", "theirs"],
  merge: true
});
// result.stdout and result.stderr are Uint8Array; result.exitCode is 1.
```

Exactly three VFS file operands are required. With no selector, output is a
native-style comparison report (differences return status 0). `-m` merges;
`-A`, `-e`, `-E`, `-3`, `-x` and `-X` select ed scripts without `-m`, or merge
filtering with it. Repeating one selector is valid; distinct selectors fail 2.
GNU diffutils **3.12** is the qualified target: `-X` is unflagged, like `-x`.
The reference is the official `diffutils-3.12.tar.xz` release, SHA256
`7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd`.
Default merge flags identical ours/theirs changes relative to base; `-mE`
preserves those changes cleanly. Flagged conflicts return 1; errors return 2.

`-L` supplies up to three literal labels in flagging modes, `-T` changes report
indentation, `-a` admits binary comparison, and `--strip-trailing-cr` changes
comparison and changed lines while retaining untouched merge bytes. Missing LF
is preserved in merge; reports add warning lines and ed emits stderr warnings.
Ed scripts run in reverse block order and quote leading dots with repair
substitutions. `-i` adds `w`/`q` only; it never edits a VFS input or runs ed.
Unknown options/selectors and `--diff-program` are explicitly refused.

The exact accepted flags are:

| Short      | Long                  | Effect                                            |
| ---------- | --------------------- | ------------------------------------------------- |
| `-m`       | `--merge`             | Merge bytes; implies A if no selector is supplied |
| `-A`       | `--show-all`          | Flag conflicts including base                     |
| `-E`       | `--show-overlap`      | Flag overlaps without base                        |
| `-e`       | `--ed`                | Take theirs for overlaps and theirs-only changes  |
| `-3`       | `--easy-only`         | Take only theirs-only changes                     |
| `-x`       | `--overlap-only`      | Take only overlaps, unflagged                     |
| `-X`       | None                  | Same unflagged output as x in GNU 3.12            |
| `-i`       | None                  | Append w/q to ed output; incompatible with merge  |
| `-T`       | `--initial-tab`       | TAB indentation in reports                        |
| `-L LABEL` | `--label=LABEL`       | At most three labels, only A/E flagging modes     |
| `-a`       | `--text`              | Admit NUL-containing comparisons                  |
| None       | `--strip-trailing-cr` | Ignore CR before LF in comparisons                |
| None       | `--help`              | Capability help, status 0                         |
| `-v`       | `--version`           | Qualified version profile, status 0               |
| `--`       | None                  | End options                                       |

Short flags may be grouped (`-mE`); labels also accept `-LNAME` and
`--label NAME`. Unique long prefixes are accepted against this fixed inventory
(including the rejected `diff-program` entry); ambiguous prefixes fail 2.
For example, `--mer` works, while `--show` does not.

After registering the plugin, these are equivalent shell/SDK modes:

```sh
diff3 /ours /base /theirs                 # report; status 0 even for differences
diff3 -m /ours /base /theirs > /merged    # flagged merge; conflicts return 1
diff3 -e -i /ours /base /theirs           # ed script only; never executes it
diff3 -mE - /base /theirs                # one supplied stdin byte stream
```

One stdin operand in any position is copied into bounded owned memory once;
multiple stdin operands fail before consumption. This deliberately avoids GNU's
stdin reopen/duplicate-input defects. Labels in merge may contain literal LF;
ed labels (including inherited path labels in flagging modes) must contain no CR
or LF, a deliberate script-injection safety deviation. Paths/labels require
NUL-free UTF-8 metadata; unpaired UTF-16 surrogates are rejected before I/O
instead of being replaced during encoding. Arbitrary source bytes remain undecoded. Diagnostics
contain no untrusted path/label text. Directory operands use the VFS file
contract and fail rather than recurse. Output goes through the supplied byte
sinks after all input and rendering quotas pass, including aliased VFS operands.
This is not atomic file publication: a sink may accept a prefix before failing.
Shell redirects open and truncate their destination before operand reads, including
same-file symlink aliases, and neither cancellation nor quota failure restores
the previous destination. Use a separate destination when preserving inputs.

All quotas in `diff3DefaultLimits` are unlimited unless explicitly configured.
Set independent input, retained-storage, token, graph-cell, work, output, argument,
decoded-metadata and label-byte quotas through `diff3Commands({ limits })` or
`diff3(context, { files, limits })`. Pure analysis and streaming engines accept
omitted or partial limits as well. Setting one quota leaves the others unlimited.
Exhaustion returns command/SDK status 2; byte-only APIs throw
`Diff3Error`. No approximate merge is returned.

Analysis uses explicit `base`, `left`, `right` inputs. Default reports select
operand three as pairwise common; ed/merge select operand two. Regions use
zero-based, half-open line ranges (empty for insertions), preserving bytes and
final LF. Identical/adjacent regions do not universally merge cleanly. Analysis
requires `text: true` for NUL; report/merge/ed also admit three byte-identical
binary operands without `-a`.

The `gnu-3.12-qualified` alignment profile uses variant-to-common direction,
100-line prefix/suffix horizons, confusing-line discard rules, midpoint ties and
boundary shifting. Repeated-line controls around 99/100/101 lines qualify this
profile, without universal GNU tie parity. GNU's costly-search shortcut is
unsupported: its cutoff fails with `ALIGNMENT`; quota exhaustion fails with
`LIMIT`. Neither enables minimal alignment or a greedy fallback.

Limits are nonnegative safe integers and conservative logical bounds, not
heap/RSS guarantees. Copies, spool fragments, tokens, alignment and output are
admitted before allocation. Accounting reports cumulative work/bytes, peak live
storage/graph slots and zero final live counters. Diagnostic quota exhaustion
still returns 2 with an SDK `error`, possibly without stderr bytes.

The streaming engine owns copied chunks and configuration. End each input once;
register `engine.dispose` with invocation cleanup before acquisition and call it
in `finally`. Disposal is idempotent; `finish()` transfers owned result buffers.
Explicit cancellation is checked at work checkpoints; synchronous work cannot
schedule an abort in a blocked realm. Command cleanup drains iterators, late VFS
acquisition and owned writes, preserving sink errors/cancellation reasons.

Runtime profile: Node ESM, byte streams, supplied VFS capabilities only. Analysis
performs no I/O. No external runtime dependencies, host executables, implicit
network/ambient files, downloads or native/WASM fallbacks are used by this command.
Registration is opt-in. Private implementation and declarations are bundled into
safe-bash with canonical contract identity; never install or publish this workspace
separately. Actual browser/workerd engine qualification remains open.
