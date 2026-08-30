# Native permission fixture profiles

Root approved bounded fixture/oracle qualification, not a production chmod fix.
See `PROPOSAL.md` for the pre-implementation scope and `AUTHOR_CHECKPOINT.md` for
the measured author result. Independent review is still required.

## Qualified mode-transition fixtures

Only the first tests in `../chmod-controls.test.ts` and
`../native-differential.test.ts` use `qualifyModeFixtures(root, names)` from
`fixtures.ts`. The returned `{ uid, gid, setMode(name, mode) }` fixture helper:

- Accepts only explicit owned regular-file/directory children of the metadata
  test-created `.native-*` root; rejects symlinks and mismatched caller identities.
- Establishes the caller's effective/real primary group with builtin
  `fs.chown(target, originalUid, callerPrimaryGid)`, preserving uid, then verifies
  ownership, group and entry identity. It never requests a nonmember group.
- Establishes each original initial mode AFTER group qualification and requires
  exact observed mode bits and unchanged qualified owner/group/identity before
  the original GNU/virtual commands execute.
- Fails a clear `metadata permission prerequisite` error when unsafe or
  unavailable. There is no skip, ignored chown, substituted mode or relaxed
  original status/mode assertion. This is trusted fixture setup, not a lease or
  race-proof public permission API.

All384 seeded transitions and48 directory-setid vectors remain. Native metadata
preconditions deliberately change: inherited host group becomes verified member
primary group, and requested06755 must now really establish06755. Do not describe
this as unchanged-all-input proof or a repair of the old GNU-strict profile.
The generic metadata namespace/oracle helper and all unrelated fixtures are
unchanged.

## Preserved strict mismatch

`classification-seal/` contains all25 byte-exact surviving classification files,
including original failures and later measured metadata. Every captured file uses
a `.data` suffix and has an authenticated manifest; none is executable canonical
source or a discovered test. Existing immutable reports and original `/tmp`
artifacts were not edited. The first control's original requested06755 is not a
historical measurement of04755; that actual mode belongs to the later replay.

`darwin-profile.test.ts` characterizes two representative nonmember-group cases
with the original authenticated GNU9.7 Darwin binary and Node22.22.2/libuv1.51.0.
The names say **strict GNU gap remains**. They require a nonprivileged caller
outside group0 and newly created `/tmp` fixtures that genuinely inherit gid0;
they never manufacture group membership or chgrp to0. Missing profile prerequisites
fail explicitly rather than silently skip. These assertions intentionally observe
GNU1/unchanged versus Node/RealFS0/SGID-cleared and MemoryFS0/requested-mode: a
passing characterization assertion is NOT a GNU equality pass. This is a pinned
Darwin profile, not OS-universal behavior or Linux acceptance.

Archive authentication keeps all17 original transitions separately visible.
Further tests verify legitimate member-group SGID, unsafe/unavailable prerequisite
failure, and actual permission denial preserving typed RealFS EACCES, virtual path,
child ctime/mode/bytes and each layer's exact diagnostic (not diagnostic equality).

## Bounded reproduction

With the existing development tooling and authenticated local GNU oracle:

```sh
node --import tsx --test --test-name-pattern '^GNU chmod seeded symbolic/numeric differential: 384 mode transitions$' tests/commands/metadata-stress/native-differential.test.ts
node --import tsx --test tests/commands/metadata-stress/chmod-controls.test.ts tests/commands/metadata-stress/permission-profile/archive.test.ts tests/commands/metadata-stress/permission-profile/qualification.test.ts tests/commands/metadata-stress/permission-profile/darwin-profile.test.ts
```

Ordinary tests write no evidence files. Explicit capture requires a NEW destination:

```sh
node tests/commands/metadata-stress/permission-profile/capture-author.mjs author-review-1
```

Use a lowercase `author-*` name. The runner refuses existing destinations, records
the exact vector-preservation proof, source hashes, full commands and raw outputs,
checks scoped no-emit types, and verifies owned fixture cleanup. It uses apply_patch
to create classified data captures. It does not build, install dependencies, touch
private checkouts, or run the whole gate. Existing captures are immutable; a new
capture is not independent acceptance unless a different reviewer provides it.
