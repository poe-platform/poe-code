# Fresh preparation v2 — HOLD, no actual-review activation

ROOT supplied a fresh preparation-only allowance:40 minutes including
publication/cleanup,48 total OS processes (planned32 plus16 reserve), peak2,
128 MiB capture and512 MiB working. Previous preparation remains NONCOMPLIANT;
this allowance does not repair its records. Actual review remains suspended.

## Exact historical removal metadata

The prior cleanup event, read as DATA without the removed prefix, states:

- Original owned stdout:16027 bytes.
- Removed instruction/header prefix:15724 bytes.
- Removed prefix SHA256:
  `1203dc173bfc5f008b5adba473b9ef50c5f21b1a9dda953fddb7ed4af9a60789`.
- Retained noninstruction stdout:303 bytes.

The affected file remains `../PREP-01/stdout.raw`; its cleanup metadata remains
in the original event records. Nothing was recreated. Current applicable
instructions were read into instruction context only in this fresh preparation,
not written into owned raw captures or runtime inputs. No old capture was edited.
All prior incomplete-capture and descendant-census qualifications remain.

## Fresh failure, preserved without retry

`authenticate.py` opens exclusive stdout/stderr/events before source admission.
It checked the received SOURCE.json and EXECUTOR.json SHA256 values, then failed
while assembling its source/data authentication request list. It incorrectly
assumed this pathname existed:

`tests/integration/apply-patch-public-independent-20260829/PACKAGE.tgz.base64`

The exact FileNotFoundError and traceback are retained in
`capture-05-authenticate/stderr.raw`; the terminal event records reason presence,
type and message. The failure occurs at local lstat **before the development Git
child is spawned**, before archive decompression/authentication and before any
product import or tool execution. The planned Git slot was reserved but unused.

This is an independent preparation-helper pathname assumption error. It is not
evidence that the authentic baseline package is unavailable, that its bytes
changed, or that the candidate is faulty. No alternative lookup, helper retry,
candidate execution or permission expansion followed the failure. The helper
and failed captures remain unchanged. It is not a usable execution seal.

## Progress and remaining work

- Received candidate remains `c83f352f057c64917f219eb938f54aa42cdab829`, full950
  package SHA256 `4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156`.
- Read author source/data for the292-input composition, retained cohorts,
  constructor/entry Worker adapter, and proposed fixture-v2. These reads do not
  establish full Git-object/package authenticity or semantic acceptance.
- The authored authentication helper contains the proposed complete object,
  tree-projection, package-member and one-row fixture-v2 checks, but those checks
  were **UNEXECUTED** after the earlier pathname failure. No claim that they pass.
- Concrete executable novelties, complete option/worker-closure admission,
  exact tool inventories, controlled runner/collector integration, harmless
  guard controls and final executable preseal remain incomplete.
- No semantic, type, mutant, restore, runtime Worker, build, npm, native Git,
  comparator, private-source or gate execution occurred. No product files changed.

The next prerequisite is a narrowly authorized source/data correction based on
the actual committed baseline archive locator, not a guessed path. A corrected
helper must be versioned; this failed run must not be overwritten or rescored.
No automatic continuation is proposed as already authorized.

## Resource/publication accounting

Through the failed helper:12 conservative process slots, consisting of three
shell/exec-Python read helpers (six), one apply_patch helper invocation (four,
conservatively reserving its interpreter), and the authentication helper (two).
No Git child was actually launched by authentication. Documentation patch and
final metadata/explicit-path commit are counted separately in the publication
receipt and remain within the fresh48 ceiling, not outside this fresh allowance.

All known calls returned. The only launched subordinate before publication was
the patch tool, which returned0. No background/watch/leaf worker exists from this
preparation. This is known-owned-process accounting, not a complete system
descendant or foreign-process census. Fresh captures preserve the known failure;
the historical incomplete-capture qualifications are not generalized away.
