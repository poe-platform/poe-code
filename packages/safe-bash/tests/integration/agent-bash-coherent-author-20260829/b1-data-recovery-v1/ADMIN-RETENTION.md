# Recovery administration and retained qualifications

This recovery is a separate DATA phase. It does not repair or rerun the failed
publisher, identity admission, executed packet, or runtime. The original
seven-start ledger remains untouched.

## Actual recovery observations

- Preparation PID81832 returned0 through the tool, completing at
  `2026-08-29T17:01:06.718Z`; it froze34 source files/1,380,268 bytes.
- Recovery PID82629 returned0 through the tool, completing at
  `2026-08-29T17:02:21.120Z`; six DATA groups passed and all34 originals passed
  postchecks for inode/device/size/hash/mode/mtime. Both helpers spawn no children.
- The recovery helper counted76 newly written files/1,449,865 bytes. This excludes
  earlier helper/preseal files and later administrative documentation/Git streams;
  it is not a final zero-tail census. A16MiB tail was reserved inside64MiB.
- The manifest has34 payload files and34 separate identity receipts. Four tiny
  regular control-data files remain; the control-only symlink was removed in its
  own finally block. No original root was cleaned or modified.
- Preseal source commit: `ea9028bd6bdb2179fed09bdaab8aadb23c2af409`.
- PRESEAL:22056 bytes, SHA256
  `11756c57e651a4760b2d5ff81bda1dce2b51542865c8ba0bc105689d99eb076d`.
- MANIFEST:33502 bytes, SHA256
  `a0761e51f84c875dd13e2909251be80f0073eb97432f7265ee521a9d98f27551`.

Exact duplicate identity collapse is tested only for this new DATA manifest;
conflicting size/hash/mode/origin/inode refuses. The actual34 source paths are
distinct. This does not alter the duplicate-list behavior of the old admission.
Git preserves blob bytes and executable bits, not every POSIX mode: the manifest
records authoritative observed source/copied modes for any future reconstruction.
The current recovery payload was checked with those exact modes on disk.

## Fixed raw administration captures

The following stdout/stderr pairs are retained under `/private/tmp/` rather than
silently represented as part of the old actual ledger:

- `b1-recovery-data-source-locator.stdout` and `.stderr`.
- `b1-recovery-data-source-layout.stdout` and `.stderr`.
- `b1-data-recovery-v1-patch.stdout` and `.stderr`.
- `b1-data-recovery-v1-prelaunch-patch.stdout` and `.stderr`.
- `b1-data-recovery-v1-prepare.stdout` and `.stderr`.
- `b1-data-recovery-v1-preseal-publication.stdout` and `.stderr`.
- `b1-data-recovery-v1-recover.stdout` and `.stderr`.
- `b1-data-recovery-v1-final-docs-patch.stdout` and `.stderr`.
- `b1-data-recovery-v1-final-publication.stdout` and `.stderr` are the bounded
  prospective final Git-publication captures; their completion is external to
  the recovery producer receipt, not preclaimed here.

Initial trusted shell/tool startup is outside helper interception. Recorded tool
returns establish those directly supervised returns, not a full transitive PID,
group, OS-drain or RSS proof. Administrative source reads, patching and explicit
development Git are separate from the two Node invocations. No role is inserted
into the original runtime ledger. Git internal physical storage remains the
trusted/unobserved boundary; final publication output consumes reserved tail.

## Preserved runtime facts, not new execution

C10/C11/C15/C16/C18 each record PASS in source-built, installed and physically
moved layouts. All15 guest creation/exit records are preserved; exit-code1 remains
literal, not recast as OS process exit0. Four runtime children have recorded
exit/close0; their stream EOF remains separately UNOBSERVED. C16 provider cleanup
is controlled release, not opaque preemption. Preimport exit/close78 and
`Identity duplicate path` remain the original publication failure. No final
publication authority/receipt existed at the three missing slots. Old failures
are not rescored; this bundle is ready for independent DATA review only.
