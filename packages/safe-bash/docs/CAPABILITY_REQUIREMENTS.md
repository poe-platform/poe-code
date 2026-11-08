# Capability-aware command requirements

Command definitions carry optional `filesystemRequirements` metadata. The browser
and root entry points export `evaluateCommandSupport`, `assertCommandRequirements`,
and the `CommandFileSystemRequirement`, `CommandModeSupport`, and `CommandSupport`
types. Hosts can derive help directly from their installed definitions:

```ts
import { createBrowserCommands, evaluateCommandSupport } from "poe-code/safe-bash/browser";

const commands = createBrowserCommands();
const help = commands.map(command => ({
  name: command.name,
  ...evaluateCommandSupport(command, filesystem.capabilities),
}));
```

## Reporting

- Missing metadata means unknown: `declared: false`, `status: "partial"`, and no
  modes. It must not be presented as a supported command.
- An explicit empty array declares no filesystem requirements: `declared: true`,
  `status: "supported"`. This does not declare requirements for shell redirections.
- Each mode has an ID, description, mandatory `capabilities`, optional `anyOf`
  alternatives, and a `mutates` marker. Every capability in an alternative must
  be supported; one complete alternative suffices.
- Modes report `supported`, `unsupported`, or `unknown`, with separate `missing`
  and `unknown` capability names. Absent flags are unknown, never inferred from
  required or optional method presence. `readOnly: true` rejects mutating modes.
- The aggregate is supported when every declared mode is supported, unsupported
  when every mode is unsupported, and partial otherwise. Inspect individual
  modes before describing the supported subset. No-op or stdin modes can remain
  supported on a filesystem that rejects every mutation.

These are primitive/mode declarations, not a guarantee that arbitrary paths,
permissions, byte limits, provider preconditions, or combinations of operands
succeed. Some modes are additive: copying a directory containing symbolic links
needs the recursive, file-copy, and link-preservation requirements together.

## Execution and coverage

The browser pack declares every installed command. Pure commands (`echo`,
`printf`, `true`, `false`, `basename`, `dirname`, `tr`) use explicit empty metadata.
`pwd` distinguishes logical output from physical path resolution; `test` and `[`
distinguish expressions, metadata predicates, and access predicates. Predicate
short-circuiting does not admit filesystem modes that are never evaluated.

`cat`, `head`, `tail`, `wc`, `cut`, `sort`, and `uniq` distinguish stdin from file
input. File input admits streaming reads or ordinary reads, not method existence.
`sort -o` and `uniq` output files have an additional write/truncate mode. Their
input/output admission runs before consuming stdin or opening an output file.
`tee` distinguishes stdout-only, overwrite, and append requirements; the shared
file-output implementation additionally checks the actual selected write route.

The filesystem family declares `mkdir`, `touch`, `cp`, `mv`, `rm`, `rmdir`, `ln`,
`readlink`, `realpath`, and `ls`. Execution selects the same requirement records
that help evaluates. In particular:

- Missing-file `touch` needs exclusive creation; existing-file `touch` needs
  timestamps. Reference timestamps on a new file need both. Missing `touch -c`
  does not need a mutation primitive.
- `mkdir` needs explicit directories, distinct from an implicit prefix namespace;
  `-p` also needs recursive creation. Recursive copy needs real directory creation,
  traversal, and copying; recursive removal is separate from file/empty-dir removal.
- Rename is distinct from atomic rename. Native `ENOTSUP` is never converted into
  a new copy/delete fallback. The existing `EXDEV` move route remains available;
  its metadata separately describes source removal and destination publication.
  Its existing visited plan admits every required removal, copy, exclusive copy,
  directory creation, and link operation before publishing any destination.
- Link inspection and symbolic/hard-link creation are separate. Forced replacement
  admits removal before unlinking. Forced copy conservatively admits its exclusive
  replacement fallback when a target already exists.

Mutating filesystem-family operations preflight their operands; recursive copy
also visits source descendants without creating destinations. Unsupported known
requirements reject before mutation, including a later `touch` operand or a
parent of `rmdir -p`. Ordinary operand errors retain per-operand diagnostics.
Preflight is not a transaction or snapshot: subsequent concurrent changes,
backend failures, and undeclared capabilities can still fail during execution.
Copy preflight does not consume provider identity-authority decisions. Execution
retains the actual comparison and the fresh comparison before forced replacement.
No unsupported primitive is emulated by the requirement evaluator. Existing
explicitly configured adapter and cross-device behaviors remain their own contracts.

For routed filesystems, optional `capabilitiesFor(path, { signal })` supplies
selected-path declarations. Filesystem-family admission uses the selected profile
rather than rejecting a capable path from an aggregate intersection; an explicit
global read-only policy still prohibits mutations. Missing parent lookup can use
the nearest existing parent's profile; this neither creates the parent nor
certifies missing-path validity.

Multi-mount rename and copy behavior depends on both endpoints. Global metadata
therefore leaves `rename`, `copy`, and `exclusiveCopy` unknown. Selected-path
metadata also omits those claims when an existing cross-mount route may differ
from the selected backend's native operation. It retains copy refusal when both
the native copy and possible publication primitives are explicitly unavailable,
including independent exclusive creation (`wx`); unavailable ordinary overwrite
does not prohibit a create-only destination. Streaming write declarations alone
do not certify exclusive creation. Read-only policy is retained. Unknown does not
certify a route: actual adapter,
permission, identity-authority, and exclusive-creation checks remain in force.
There is no pair-specific capability API or new transfer implementation.

Read-only wrappers copy only known inspection metadata and explicitly prohibit
mutations. They do not forward unknown authority extensions or claim a delegated
`snapshotRmdir` profile. An overlay's `readOnly` describes its upper's actual
policy; missing staging primitives produce unsupported mutation modes, not a
fabricated read-only policy.

Empty-directory removal never substitutes listing plus recursive deletion for
`rmdir`. When removal is known unsupported but ordinary writes and directory
inspection are not known unavailable, nonmutating inspection can preserve an
`ENOTEMPTY` diagnostic. The unavailable removal primitive is not called. An
entirely unsupported writable overlay profile still refuses with `ENOTSUP`,
whereas a read-only policy refuses with `EROFS`.

## Portable search pack

The opt-in `portableSearchCommands()` pack declares requirements for all three
installed definitions: `grep`, `rg`, and `sed`. Their execution uses the same
requirement records that the evaluator reports. No provider/workerd permission,
network capability, or filesystem primitive is enabled by these declarations.

`grep` distinguishes stdin, file operands, and `-f` pattern files. Ordinary input
and pattern files can use an advertised stream or ordinary read route; a known
unsupported route is not selected simply because its method exists. Pattern files
are loaded when needed to construct the matcher, even with `-m0`. Data-file
admission stays lazy: `-m0` does not open/admit data files, and `-q` does not admit
files after a successful short circuit.

`rg` distinguishes stdin/content reads, named-operand metadata, directory walking,
directory-link canonicalization, pattern files, and ignore files. Pattern and
ignore files use ordinary `readFile`, so streaming-only support does not imply
support for those modes. `--files --no-ignore` does not require content reading.
Ignore configuration is admitted only when the walker attempts to load it,
including inherited ignore files and repository-related configuration. Directory
capabilities are checked at actual traversal, not for every named operand:
`-m0`, quiet-mode completion, and depth limits preserve their no-I/O short
circuits. Enumerated file types do not require an extra child `stat`, and resolving
a directory link does not require an unvisited child's `readdir` capability.

`sed` distinguishes stdin/file input, `-f` program files, `r` script reads, `w`
and substitution-write outputs, in-place rewriting, and optional backups.
Program files require ordinary reads. Output requirements come from the existing
parsed instruction list, not another script parser. `-i` needs metadata and
ordinary write/truncate; `-iSUFFIX` additionally needs copying for backup
destinations. Script output files need ordinary write/truncate and append because
the interpreter initializes them before processing records and appends selected
records afterward. Declared readonly/unsupported writes or backups are rejected
before initialization, input consumption, or mutation of earlier output paths.

Non-mutating sed input stays lazy, including quit and unreached addressed `r`
instructions. A reached pending `r` is admitted before the cycle's automatic
printing. Mutating scripts conservatively preflight their parsed input/read/output
plan before any output initialization, including all selected in-place targets
and backup destinations. This is not a transaction or proof that every branch
executes: it prevents known unsupported planned file access from failing only
after a destination has already been truncated. Runtime failures and changes
after admission remain possible.

## Boundaries

Optional command packs outside `createBrowserCommands()` are not automatically
annotated. In particular, absent metadata on `curl -o`, Node
metadata/archive/patch commands, or other separately installed commands remains
unknown, not supported. Inspect the actual installed definition rather than
assuming all exports share browser-pack coverage. Shared network output may have
its own execution admission without complete command help metadata.

Shell redirection is an execution-layer concern independent of a command's argv:
`echo > file` requires output capabilities even though `echo` itself does not.
Command help does not certify redirections, append/exclusive combinations, or
independently opened descriptor interactions. The output layer must admit those
against its selected filesystem/path and preserve its own cleanup and budgets.

Custom commands opt in by declaring modes and calling `assertCommandRequirements`
with the selected IDs before effects. Registering metadata alone does not parse
custom argv or automatically enforce it. Unknown declarations remain compatible
at execution time; hosts requiring exclusively proven support can impose a
stricter admission policy using the evaluator.
