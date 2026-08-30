# Conditional one-admission interface — UNEXECUTED TEMPLATE ONLY

Not a review acceptance, grant, AUTH.json, launch permission or launch receipt.
Only root can decide readiness after resolving REVIEW.md findings and composing
the separate independent runtime review. No placeholders may be treated as issued
tokens. If executable inputs change, these bindings are obsolete: reseal/review.

## Immutable bindings

Repository: `/Users/kjopek/Workspace/safe-bash`.
R: repository + `/tests/comparison/breadth-continuation-20260828/executor-v7-r1`.
Candidate executor commit: `230ed3c6e15617b312760367adf9ede4e5c7ff6a`.
Recipe/SEAL bytes SHA256:
`05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d`.
INTERFACE bytes SHA256:
`913d051875c60492cce06937ff33b85bb4c9b36085b79169d5e51e87852880c4`.
Phase-plan SHA256:
`03463349729bdd298b0ff3ca8c1066c568daad4d5049532e957ce825374ce475`.
This hashes JSON.stringify({limits,command,phase:'admission',operations:plan.admission}),
not OPERATION-PLAN.json's raw SHA256
`4112bb1cf2da78344f8b20eef82e0709f95b33067d6e07b610d66a22a12c9ff4`.

Node `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`: 112989184 bytes,
0755, SHA256 `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
Git `/Applications/Xcode.app/Contents/Developer/usr/bin/git`: 3704880 bytes,
0755, SHA256 `10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9`.
Launch source: 2584 bytes, 0644,
`928900c9e495763a45ac2a9860aec6b3d3d82a679ea9649eb72a2c1481bf20ed`.
Coordinator source: 1769 bytes, 0644,
`92a63edc9bfd79daea0e5f3eef82f2e5c133affec8b7a4ea055a5f33cdd86074`.
Bootstrap source: 5261 bytes, 0644,
`5104b893860638beb026acac1526f677eb2861a6a2c354e58818cdf51bc04ffd`.
The other interface executable bindings and transitive source bodies/modes are
exactly those in authenticated INTERFACE/SEAL and AFTER.json, not ambient HEAD.

## Fields to be issued later, only by appropriate owners

AUTH is an absolute normalized `R/runs/<fresh-grant-namespace>/AUTH.json`,
regular 0644, 1..65536 bytes, exact raw SHA256 supplied as the final argument.
Its exact two keys are `review` and `grant`. Each has exact own primitive strings
`commit` (40 lowercase hex), `path` (repository-relative), `sha256` (64 lowercase
hex). They identify committed JSON bodies, not working-tree substitutes.

Different-review required fields (3): `role:"different-reviewer"`,
`verdict:"PREEXECUTION_ACCEPTED"`, `recipeSha256:<exact recipe above>`.
This leaf report intentionally does not provide that verdict. Authority currently
tests required review/grant values, not a closed-key schema for their entire bodies.

Root grant required fields (13), shown as inert text, not a minted grant:

```text
role = "root"
phase = "admission"
attempts = 1
runId = <FRESH_ROOT_RUN_ID matching [a-z0-9-]{1,64}>
outputRoot = R + "/runs/" + runId
recipeSha256 = 05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d
reviewSha256 = <EXACT_COMMITTED_POSITIVE_COMPOSED_REVIEW_BYTES_SHA256>
planSha256 = 03463349729bdd298b0ff3ca8c1066c568daad4d5049532e957ce825374ce475
bootstrapProfile = "JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1"
reportProtocol = "BOUNDED_TERMINAL_V2"
candidate = 67eab12e315054907ef4ef435c6bbca2f59e0c36
packSha256 = 6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06
command = {"entry":"coordinator.mjs","phase":"admission","runId":<same>,"nodeArgs":["--unhandled-rejections=strict","--max-old-space-size=256"]}
```

Command key insertion order and nodeArgs sequence must match bindGrantPlan's
serialized comparison. Comparator remains pinned just-bash 3.4.2, not latest.
Root records a fresh grant/AUTH identity and consumption once; old V4/V6 consumed
tokens and V5 history confer no authority. Exclusive run directory, AUTHORITY.lock
and operation claims enforce reuse refusal while preserved; they are not a durable
global token service against deletion/host mutation. Preserve failed attempts.

## Literal command shape — NOT RUN

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --max-old-space-size=256 /Users/kjopek/Workspace/safe-bash/tests/comparison/breadth-continuation-20260828/executor-v7-r1/launch.mjs admission <FRESH_ROOT_RUN_ID> <ABSOLUTE_AUTH_JSON> <EXACT_AUTH_JSON_SHA256>
```

Outer launches coordinator with the same ordered flags/four arguments, cwd at
repository, stdio `[ignore,pipe,pipe,pipe]`; workers remain serial and hash-bound.
Outputs are `R/runs/<runId>` and `R/runs/<runId>-supervision`, both fresh.
Metadata Git children are separately receipted, not hidden inside worker counts.

## Limits and required receipts

- Body 260046848 bytes (248 MiB) + collector 8388608 (8 MiB) = 268435456 total.
  Evidence reservations include direct claims/locks/control fixtures; declared
  staged payload bytes are separately authenticated, not evidence-budget credit.
- Every physical evidence record <=262144; logical multipart document <=33554432;
  configuration/staged document <=2097152. Engine worker config reader currently
  uses **2097151**, one byte below the advertised config ceiling; avoid claiming
  uniform exact-ceiling acceptance without resolving this source mismatch.
- stdout/stderr <=65536 each; FD3 metadata <=262144. Observed overflow fails even
  if retained output is capped and process later exits zero. Legacy cohort 8 MiB
  branches are out of this admission scope, not a relaxed admission limit.
- 14 planned workers, cap27, concurrency1; two C11 empty setups only if later
  granted as part of real admission; zero semantic calls, no 99-case permission.
  Child 30000ms; TERM grace2000ms; KILL grace1000ms; outer checked4500000ms;
  old-space256MiB per child, not RSS and not hard preemption.
- Supervisor receipt: `pid,exit,close,reaped,failures,signals,records,captureBytes,
  stdout,stderr,rawRecords,natural`. Outer must exit/close0 naturally with exact
  captures and no failures/signals/truncation; every actual PID/group must close.
- Launcher writes LAUNCH.json before acquisition; collector preserves
  COORDINATOR-RECEIPT.json and OUTER.json references. Public BREADTH_V7_LAUNCH keys:
  `schema,qualified,unsafe,reference,summaryReference,children,actualRawRetainedOnly`.
  This line does not itself witness launcher reaping; root must preserve its actual
  tool/outer disposition, bytes and receipt references, including failure outcomes.
- Acceptance additionally requires default non-synthetic assessTerminal, all
  planned operation predicates, postintegrity and registered evidence census.
  Resolve REVIEW.md schema gaps first. Observer qualifications remain explicit:
  W07 comparator nonexecution UNQUALIFIED, dispatch UNOBSERVABLE, semanticCredit
  false; no caller authentication, stock-Node equivalence or full-gate claim.
