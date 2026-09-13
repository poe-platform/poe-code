# Isolated delivery reconciliation — 2026-09-13

At source3f965448db2dfd5c36e944bcc074a7ba00470416, the same312 original/neighbor files
produce531 variants:407 passed,124 failed, zero unsupported, metadata or execution errors.
The maintained command exits1 because unresolved failures remain. Exact command, source
fingerprint, Node22.23.2/ICU78.2, fixture hashes/modes and unchanged3000ms/10000ms deadlines
are retained in isolated-primary.jsonl and isolated-category-reconciliation.json.

This rerun addresses an explicit dependency-resolution concern. The earlier node_modules
symlink resolved sibling workspaces through the original dirty checkout. It has been
replaced with per-entry links: sibling packages resolve within the delivery checkout;
external dependencies remain shared. All external node_modules lock entries match exactly.
The dependency-link-isolation.json receipt records every link and both lockfile hashes.
It is not a fresh npm ci. The selected SafeJS and terminal-png workspace build closures
pass with the corrected links. Prior reports remain qualified by their earlier setup.

Compared with the integrated884ead8b7 report,37 originally failing variants now pass;
no previously passing variant regresses. The generator allocation repair affects eight
upstream variants, including both async-generator statement variants. Its initial prose
mistakenly counted six. The original raw selection already included all eight. This
receipt corrects subsequent arithmetic:130 after generator allocation,126 after Symbol,
and124 after Script declaration errors. Independent regression-test counts do not change.

The [edition exclusions](../edition-exclusions/audit.md) newly qualify nine failed rows:
seven newer optional call-assignment-target semantics and two historical non-extensible
private-field proposal cases. They remain failed/excluded, never passes. Together with
38 decorators-proposal rows and the two previously qualified legacy-caller cases,49 of
124 nonpasses are outside the target or optional-extension oracle mismatches.75 target
nonpasses remain, including20 separately pinned resource-management cases. Full language
acceptance is not met. The published edition and explicitly tracked extensions are unchanged.

Delivery and publication are separate:

- 22 atomic code commits exist locally in the detached delivery checkout and are ancestors
 of verified remote main3f965448db2dfd5c36e944bcc074a7ba00470416. The exact local SHAs and
 ancestry exits are in delivery-through-script-errors.json. The original workspace and
 staged changes are preserved. Commits/pushes used normal hooks, with no force push.
- [Root run34766290651](https://github.com/poe-platform/poe-code/actions/runs/34766290651)
 completed successfully at e9f684c8, including fresh unit checks, but semantic-release
 explicitly skipped publication because that commit was behind remote main. This is an
 unresolved code-publication gate, not a successful publication or docs-only exemption.
 Root registry evidence still reports poe-code15.0.33 at the earlierf7b7552 commit.
- [Scoped run34766290514](https://github.com/poe-platform/poe-code/actions/runs/34766290514)
 published SafeFS/SafeBash0.1.571; independently installed smoke checks and signatures pass,
 and registry attestations identifye9f684c8. The initial Bash smoke used the wrong method;
 its failure and corrected shell.exec smoke are both retained.
- [Scoped run34767386023](https://github.com/poe-platform/poe-code/actions/runs/34767386023)
 has independently installed SafeJS0.1.575 smoke/signature/provenance evidence identifying
 f3862ac25. [Scoped run34767982229](https://github.com/poe-platform/poe-code/actions/runs/34767982229)
 has equivalent SafeJS0.1.577 evidence identifyingc2389e9ad, including loop/replay/source/
 authority checks. Each installed SafeJS audit verifies15 registry signatures and10
 attestations. These versions certify only their recorded ancestry, not later fixes.
- Required successor root/scoped/schema workflows are still being monitored. Workflow
 IDs, URLs, exact heads, conclusions and ancestry checks are in the snapshot receipts.
 Cancelled/pending/superseded runs are not counted as successes. No issue was supplied
 for closure. No package was published locally.

Registry propagation initially left SafeJS at0.1.570 while workflows reported newer
versions. Repeated independent endpoints were retained in the original workspace;
subsequent575/577 artifact and attestation checks resolved those observed versions.
Later fixes still need their own final containing-successor receipts, independent
SafeJS/SafeFS/SafeBash artifact checks, and actual poe-code publication provenance.
Recovery: keep the latest containing GitHub run under observation, diagnose any failed
required job with a separate tested repair, retry registry/attestation reads after
propagation, and use normal GitHub publication. Never infer publication from a green
no-release job, locally publish, force-push, unpublish or roll back concurrent work.
