# Preinspection capture HOLD

2026-08-29. This review attempt stopped before candidate inspection or control
presealing. It does not establish a defect in Faraday's mechanism and does not
accept it.

Requested source: `464666830d16016ca7a7bf9ef466aa6dc764e2d3`.
Requested evidence: `12cb7a0032f581e45402399d5ef0da1ec2d700f9`.
Requested seal: `99586c8ec062b54f41430facf9a388bd68c450db44c08d65cc98b07036dc5198`.
These are request identities, not independently authenticated bindings here.

## Actual failure

The outer owner created exclusive raw capture files before its first Git
metadata helper. That helper used `spawnSync` with a 2MiB `maxBuffer` for an
unscoped `git status --porcelain=v1 --untracked-files=all`. It returned
`ENOBUFS`, null status and `SIGTERM`. The owner preserved the returned partial
stdout/stderr and the exception, but its buffer limit prevented complete raw
capture of that metadata command. Existing capture files are not a complete
repository-status inventory.

`capture/initial-events.json` binds the exact argv, error and observed signal.
`capture/initial.stdout.raw` preserves the returned bytes;
`capture/initial.stderr.raw` preserves the primary owner failure. No output was
recreated. The direct Git helper terminated and its owner returned exit 1;
this does not prove process-group absence or a transitive descendant census.

The next action only read the small captured error records to classify the
stop. Candidate handoff reading, Git binding checks and all subsequent actions
inside the initial helper were unreached. No candidate, loader, product,
compiler, native oracle, Worker, permission-control fixture or comparison ran.

## Disposition

Capture loss is an explicit STOP condition. No corrected metadata retry or
control execution is authorized by this report. The planned six DATA and four
harmless author controls, plus independent controls, remain unexecuted. No
mechanism ACCEPT/HOLD inference about the candidate itself is available.

A prospective successor needs a fresh grant and versioned capture dispatch:
stream child stdout/stderr directly into outer-owned descriptors before launch,
retain byte accounting and explicit overflow handling, and scope initial
status inventory to owned paths. Do not buffer an unbounded repository-wide
status listing or equate a partial listing with complete input admission.
Then authenticate the immutable packet and freeze controls before execution.

Original M08's EPERM cause and process-group absence remain unknown. This
failed preinspection does not change that history, authorize 111 product calls,
or establish the proposed final supervisor's wiring.

Only this independent review directory is published. Existing source, author
evidence, prior source-locator handoff and product files remain untouched.
