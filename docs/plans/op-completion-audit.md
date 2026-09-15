# op: current requirement audit

## Current delivery contract: explicit command plugin

User direction supersedes standalone delivery: use `opCommands({ backend, ... })`
from `poe-code/safe-bash/commands/op` with `shell.use(...)`, like other optional
tools. The same subpath exports `createObjectBackend` and `createOpCommand`
(the composed shell `CommandDefinition`). There is no automatic registration,
native fallback, credential discovery or native config integration.
`packages/op` is now a private internal workspace, not a separate public npm
install/release target. Earlier standalone install, bin, publication and
no-safe-bash-integration statements are historical and superseded.

The adapter uses capability-checked virtual files and nested shell invocation;
policy and resolved object-binding requirements are preserved. Peirce reports
10 shell tests plus scoped types/lint/whitespace passing; Newton verified the
minimal public import/example. Peirce reports production frozen: 850 op tests,
seven crypto tests, 10 plugin tests and lint/types/build/whitespace checks pass.
The document handler now leaves omitted vault selection to the backend contract.
Core `#op-crypto` selects Node `node:crypto` Web Crypto or browser/workerd global
Web Crypto, failing closed when required browser primitives are absent. Actual
Node 18.18 source-loader checks without global crypto pass construction, IDs,
password generation and OTP. Planck reports seven browser checks and all 17
package-policy rules passing, superseding the earlier unresolved internal
import/global-crypto failures. Final integrated evidence is now inspected in
`out/op-root-final/VERIFICATION.md`: fresh maintained build, prebuilt smoke,
NodeNext/Bundler declarations, types/lint, workflow lint, all 17 policy rules
and isolated installed Node 18.18 proof pass. That consumer has no separately
resolvable op package or global crypto; IDs, password generation, independent
OTP, pipelines, denial and resolved approval pass. Root units finish with
11,528 passing tests and one skipped, not a rerun of all workspace unit tasks.
The README example was independently executed unchanged in the installed
consumer, returning `alice\n` with exit zero. Archive SHA-256 was independently
checked: `212749e9cd1ab218d7f571eba51fd264c4e95511deeb7810ab999600c18dd205`.
The public screenshot remains checkout evidence; installed proof is separate.
Local integration is verified; full native parity, commit, push and release
are not claimed. Older provisional packaging notes below are superseded.

## Current scope clarification: object seeds and recordings

The user authorized the package README; `packages/op/README.md` now exists.
Before the plugin packaging transition, `npm run lint:packages -- --json` passed: 72 packages, 17 rules,
zero violations and no skips. All five owned documentation files pass whitespace
checks. This is not fresh artifact, native-parity or release verification.
Earlier missing-README/permission and native-config-mapping gates below are
historical and superseded, not current requirements. No native 1Password config
integration is wanted: use `createObjectBackend(seed)` or Node's explicit
`OP_BACKEND_FILE` / trusted `OP_BACKEND_MODULE`. Built-in storage ignores
`--config`/`OP_CONFIG_DIR`; custom backends receive parsed interface metadata.
No backend means failure, not home/config discovery. Home-directory lookup is
plugin scope metadata only. No additional adapter API or native storage mapping
is required.

Current source exposes `OpObjectBackendOptions.defaultVault?: string`, an
existing vault ID stored canonically. Vault objects use `{ id, name }`; item
references use `vault: { id }`. Item creation precedence is explicit `--vault`,
then input `vault`, then configured default ID, then the sole vault in the
selected scope. Without a selector/default, zero or multiple eligible vaults
fail; an unavailable configured default also fails without fallback.
Snapshots retain the canonical default ID and its removal is rejected. No
Private vault is guessed. Peirce reports the source freeze with 842 passing
tests; this is not a fresh installed-artifact or native-parity checkpoint.

The user requested scenario recordings, not fixture submissions. Inspected
`out/op-native-recordings-uNuPJ6/summary.txt`: 13 scenarios use the verified
extracted official 2.39.0 oracle, explicitly labeled because no installed op
was found. Version/help/plugins/literal run succeed; template/item outputs and
piped literal inject stop at no accounts configured. No timestamp/schema output,
credentials or authenticated native behavior was obtained. The recording owner
reports inspected screenshots; casts are timed streams, not interactive TTY QA.
See [the recording workflow](op-native-fixtures.md).

The user subsequently authorized Ptolemy to verify authentication and synthetic
recordings in one explicitly designated agent vault. That bounded work is
pending evidence here; it does not retroactively change the 13 no-auth results
or authorize unrelated vault access. Real vault identifiers are not reproduced
in package examples. Generic backend storage still has no native config integration.

Native template/rendering evidence remains unavailable, not a user-fixture
submission gate. Lifecycle/provisioning, remaining output fidelity, unsupported
file-backed resolved approval and verified delivery/release remain separate.
Existing checkpoints/artifact hashes below retain their original dates and
scope; they do not prove the new README or default-vault changes were packaged.


Audit updated: 2026-09-08. This is the current-state decision matrix, not a replay of
historical checkpoints. The [compatibility inventory](op-compatibility.md)
remains the exhaustive upstream operand/type/default/source ledger. Every
command and flag in that ledger stays in scope, including beta discovery,
authentication, administration, plugins, completion, updates, release, and the
requested environment-snapshot extension. No safe-bash integration is intended.

**Latest finite typed-flag checkpoint: 835/835 tests pass.** Inspected
`out/op-typed-closure-summary.log`: lint/types, selected build, whitespace and
fresh installed CLI/root/Node SDK/declarations pass, including CSV/resolved
binding and native-valid LETTERS,+20 generation. All 70 saved native outcomes
match. Raw recipes/policy/prepared inputs and caller isolation are preserved;
97 package fingerprints unchanged. Workflow/package policy were not rerun;
That artifact predates README authorization and the object-default change; native fidelity, lifecycle and delivery gates remain.

**Previous typed-flag checkpoint: 829/829 tests pass.** Inspected
`out/op-static-five-checkpoint-summary.log`: lint/types, selected build,
whitespace and fresh installed CLI/root/Node SDK/declarations pass; independent
replay of 88 native grammar outcomes has zero mismatches. SSH case/hyphen variants
reach canonical generators with raw policy flags unchanged. Uint32 modes are
forwarded unchanged to injected host capabilities; native OS semantics remain
unverified. Screenshot inspected; all 95 package fingerprints unchanged.
Workflow/package-policy routes were not repeated; prior workflow lint is not
current evidence and missing README is not waived. No lifecycle or full parity claim.

**Previous duration checkpoint verified:** Ptolemy's fix
passes 799 unit tests, 17 targeted tests and 195 native comparisons with zero
mismatches. `duration.ts` now uses unsigned 64-bit accumulator wrapping while
retaining per-component and intermediate overflow checks; both signs and
nearby rejection controls are covered. Evidence: `out/op-duration-wrap-*.log`.
This closes the discovered two-component wrap mismatch within the tested matrix,
superseding its earlier failing status and the 796-test result. Newton's final
checks/repack now pass: 799 unit/17 focused tests, lint/types, selected build,
whitespace and fresh installed CLI/root/Node SDK/declarations. Both wrap signs
and neighboring rejection controls pass across installed surfaces; raw strings
remain unchanged. All 93 package fingerprints are unchanged. Summary:
`out/op-duration-fixed-checkpoint-summary.log`. Workflow/package-policy checks
were not repeated; prior workflow lint is not current checkpoint evidence and
the missing-README policy gap remains open. No universal duration/lifecycle parity.

**Previous artifact-verified role checkpoint: 782/782 tests pass.** Inspected
`out/op-role-fixed-checkpoint-summary.log`: lint/test types, selected build,
whitespace and fresh installed root/Node SDK/CLI/declaration checks pass.
Uppercase roles now execute and persist/output lowercase without changing raw
policy flags or caller arguments. Invalid roles fail before input/backend;
the normalized MANAGER screenshot was inspected. All 90 package fingerprints
remain unchanged. Workflow/package-policy routes were not repeated; prior
workflow success and README-only policy failure remain separate, not waived.

**Previous 778-test checkpoint:** inspected
`out/op-release-checkpoint-summary.log`: package lint/types, selected build,
workflow lint and fresh installed CLI/root/Node SDK/types pass. Installed plugin
list human/JSON bytes match pinned native captures; screenshot inspected.
All 89 package fingerprints were unchanged during verification. The summary's
initial whitespace failure at `packages/op/src/plugin-list-output.test.ts:37`
was subsequently corrected by Planck in the test only; whitespace now passes
by report and the production artifact is unchanged. Package policy **fails**
only for missing README. The earlier two plugin-selection failures are superseded by this
passing unit run, not carried forward as current defects.

**Previous 756-test checkpoint:** **756/756 maintained package tests pass**, zero
skips/failures, with lint/test typecheck, build, whitespace and fresh consumer
SDK/Node CLI/types checks passing. Original rename-during-approval regressions
through installed SDK, Node CLI and executable exit 1 with zero operation output
and no stale execution. The supported cooperative object-binding gate is verified.
The preceding independent 33/33 boundary checks close A12–A14; Node synchronous
cached-backend validation is verified in source and artifact. Approve/deny
screenshots were independently inspected. See the
[final evidence ledger](op-resolved-approval-verification.md#frozen-checkpoint-results)
and `out/op-resolved-final-node-validation-wiring.log`.
The previous summary is `out/op-combined-checkpoint-summary.log`: package
lint/types, selected build, workflow lint, whitespace and fresh installed
CLI/root SDK/Node SDK/types pass, including selector approval, timestamp-env,
batch and overwrite checks. All 82 package source/config/license fingerprints
are unchanged. This supersedes the 718-test artifact for current checks, not
native fidelity gaps. Exact artifact and delivery boundaries are recorded below.
The previous 594-test pack below predates these security changes. One independent
Mendel review attempt returned a terminal policy error; it did not complete and
is not restarted or credited. Ptolemy's unaffected ordinary verification continues.

**Previous frozen checkpoint:** root reports 594/594 local
tests passing, Planck's typecheck/scoped lint passing, and inspected root/item
help screenshots. The prior full report was 584 passing tests;
the backend wave previously reported 199 scoped tests, and its frozen follow-up
now reports 110 scoped tests plus typecheck/lint passing. Fresh audit probes now
pass bulk item creation, field-reference output (including a valueless field),
implicit-stdin item get, pre-leaf string flags, and missing-operand rejection
before policy. Backend copying/reference and CLI/help work are frozen as detailed
below. Ptolemy's final maintained checks now pass: 594/594 tests, zero skips,
package lint/test typecheck, build, and diff validation including 68 untracked
scope files. Policy exits 1 for README only. Mendel's fresh pack now passes the
isolated consumer checks recorded below; independent backend/reference review
also reports 85 tests passing. Neither result closes approval identity binding.
The profiled pre-leaf parser repair is included in the frozen report, not proof
of every native parser case.
The final logs below supersede the earlier 506/506 and 584-test checkpoints for
these maintained local checks. They do not establish native parity.

**Verified bounded gate; full completion still blocked:** the inventory's promised
resolved-identity approval binding is verified for the supported cooperative
object backend. Explicit resolved
`ask` is the default; direct `allow` remains direct, and explicit literal mode
does not satisfy or replace the promise. File-backed Node resolved approval
fails closed because cross-process persistent revision support is absent.
Unsupported capabilities and the remaining native matrix gaps block full-goal
completion independently of README. No arbitrary-backend, OS or remote atomicity
proof is inferred; the unavailable broader review is not counted as completed.

## Classification and evidence

**Functional wave verified:** code owners are frozen. Group/user batch registry,
the narrow invalid timestamp-env fallback and overwrite confirmation pass
Newton's final 756-test maintained checkpoint and fresh consumer checks. Ptolemy's manual overwrite
checks pass and allow/deny screenshots were inspected, as recorded below.
`OpConfirmOverwrite` is source-verified as a public type
export from both root and Node entries; root reports compile red/green coverage.
This supersedes earlier export/checkpoint-pending notes.
No external fixture delivery, native parity or README permission is inferred.

- **V — verified**, limited to the stated evidence: **native** means a pinned
  no-auth observation; **local** means source/tests or synthetic execution.
- **M — missing:** required implementation, artifact, verification, or delivery
  is absent. Missing native evidence is distinguished from missing code.
- **C — contradicted:** a current implementation/probe conflicts with a required
  behavior. This is not necessarily a defect in the package's documented local
  simulation contract, but it prevents the full compatibility claim.
- **I — indirect:** docs, a hook contract, a provisional model, or local tests
  support a direction without establishing the required native behavior.

Worker coordination: Newton's completion report, Planck's integration-mode
report, Peirce's authentication/security updates, and Ptolemy's final/fidelity
reports were relayed by root. No worker-messaging tool is exposed to this audit.
Newton now owns shared catalog/help/completion metadata, ordering and displayed
defaults; Planck owns leaf-local flag placement and common operand validation
before authorization/custom backends, with argument constraints grounded in
native evidence. Displayed defaults do not implement semantic defaults.
Peirce owns backend coordination for the assigned item/document/reference work.
The frozen reports above supersede those earlier assignments; the priority
queue below is a new read-only assessment, not reassignment or code work.
Source anchors are relative to
`packages/op/src/` unless a complete path is given.

Evidence: `out/op-final-verification-{unit,lint,build,diff,policy,signin,completion}.log`;
`out/op-fidelity-public-items.log`, `out/op-fidelity-public-metadata.log`,
`out/op-fidelity-native-noauth.log`, `out/op-fidelity-native-pipe.log`;
`out/op-oracle/evidence/native-command-tree.json`, `native-help-schema.json`,
`native-plugin-catalog.json`, and `provenance.json` in the same evidence directory;
`out/op-oracle/encoding/NEWTON-HANDOFF.md`. Fidelity logs were inspected, not
assumed to be passing tests. No real accounts or credentials were accessed.

## Command and local-flag coverage

Fresh catalog inspection counts **76 stable leaves, 159 stable local-flag
placements, ten inherited flags, one beta leaf, and five extension leaves**.
The five `native-interface.test.ts` tests were independently rerun: 5/5 pass.
That verifies stable leaf names, advertised flag kinds/aliases, and parser
acceptance against the pinned fixture, not operands, defaults, schemas, effects,
help prose, errors, or full native execution. Parent help nodes are included in
scope; generic generated parent help is not exact native help.

The following groups exhaust the current catalog. Braces expand to individual
command paths. Flags are the union within each row; exact command-to-flag
bindings/types remain in `catalog.ts`, `native-interface.test.ts`, and the
inventory's per-command tables. All inherited flags also apply. A flag being
listed here is not a claim that its behavior is complete.

| Commands | All local flag names, without `--` | Current behavior classification and remaining work |
| --- | --- | --- |
| `account {add,forget,get,list}` | address, all, email, raw, shorthand, signin | V(local) selection/forget/list and scoped records; I add/authentication via typed hooks. Native local-config schemas/migration intentionally excluded; M prompts and raw/shell-output fidelity. `admin.ts`, `auth*.test.ts`. |
| `connect group {grant,revoke}`; `connect server {create,delete,edit,get,list}`; `connect token {create,delete,edit,list}`; `connect vault {grant,revoke}` | all-servers, expires-in, force, group, name, server, vault, vaults | V(local) relations, CRUD, revoked-token metadata and account boundaries; I server/token issuance hooks. M real credentials-file generation, expiry/grant validation and remote revocation/provisioning parity. `admin.ts`, `admin.test.ts`. |
| `document {create,delete,edit,get,list}` | archive, file-mode, file-name, force, include-archive, out-file, tags, title, vault | V(local) byte IO, archive, TTY guard, mode/overwrite refusal, stdin-delete repair and final 594-test checkpoint. M authenticated metadata, prompts, byte-limit/native binary behavior. `documents.ts`, `node-output-file.test.ts`. |
| `environment read` (beta) | none | V(local) object variables and legacy dotenv composition; I serialization/reveal vs beta. M pinned beta oracle and authenticated Environment output. `environment-run.test.ts`. |
| `events-api create` | expires-in, features | I explicit host hook; M built-in issuance, supported features/tier/expiry/output validation and actual service behavior. |
| `group {create,delete,edit,get,list}`; `group user {grant,list,revoke}` | description, group, name, role, user, vault | V(local) CRUD, batches, membership roles/filters/cascades; I native record schemas, authorization model and account-tier restrictions. `admin.test.ts`, `account-scoping.test.ts`. |
| `item {create,delete,edit,get,list,move,share}` | archive, categories, category, current-vault, destination-vault, dry-run, emails, expires-in, favorite, fields, generate-password, include-archive, long, otp, reveal, share-link, ssh-generate-key, tags, template, title, url, vault, view-once | V(local) assignments/template merge, attachments, concealment, OTP/SSH, archive/move/batches, bulk arrays, derived field references and implicit-stdin get; V(reported frozen backend) explicit-destination single/array copies preserve source and enforce target/admission checks. I sharing hook and native copy remapping/output. C share-link projection; V(source/reported 842 tests) generic default-vault correction; M detailed list rendering, complete categories and authenticated lifecycle/schema/sharing-link semantics. |
| `item template {get,list}` | file-mode, force, out-file | V(local) Login and injected schemas/file output; M full built-in category templates. Default list contains only Login. `templates.ts`, `templates.test.ts`. |
| `plugin {clear,init,inspect,list,run}`; `plugin credential import` | all, force | V(local) configured inspection, metadata-only chooser and scoped clearing/confirmation. Built-in availability matches 90 native rows/89 executable entries; installed JSON/human output verified in the earlier 778-test checkpoint. I init/run/import hooks. M credential schemas/provisioners, native interactive unconfigured inspection and shell setup/artifacts; availability is not configuration. `plugin-catalog.ts`, `plugin-selection.ts`, `plugin-scopes.test.ts`, `admin.ts`. |
| `service-account {create,ratelimit}` | can-create-vaults, expires-in, raw, vault | I hooks only for issuance/rate usage. M local policy-complete grant/expiry/one-time-token models, native schemas and constrained execution mode. |
| `user {confirm,delete,edit,get,list,provision,reactivate,suspend}`; `user recovery begin` | all, deauthorize-devices-after, email, fingerprint, group, language, me, name, public-key, travel-mode, vault | V(local) transitions, key projection, filters, batches, suspension/session invalidation; I provisioning/recovery/device-deauthorization hooks. M remote invitations/recovery, device scheduling and native cardinality/output parity. `admin.test.ts`, `auth.test.ts`. |
| `vault {create,delete,edit,get,list}`; `vault group {grant,list,revoke}`; `vault user {grant,list,revoke}` | allow-admins-to-manage, description, group, icon, name, no-input, permission, permissions, travel-mode, user, vault | V(local) batches, icons, Travel Mode, grant dependency normalization and scoped ACLs; I native tier/policy/default behavior. M native prompt/results and complete account RBAC; refusal instead of automatic grants is not interactive parity. `vault-options.test.ts`, `permission-dependencies.test.ts`. |
| `read` | file-mode, force, no-newline, out-file | V(local) reference/attribute/OTP/SSH/text/binary paths; I exact native binary newline and numeric size formatting; M interactive overwrite confirmation. `read-values.test.ts`, `references.test.ts`, `ssh.test.ts`, `otp.test.ts`. |
| `inject` | file-mode, force, in-file, out-file | V(local) scanner/variables/file IO; I native successful scanner/encoding semantics because even literal-only native input requires auth. M interactive overwrite parity. `secrets.test.ts`, native-pipe log. |
| `run` | env-file, no-masking; environment (beta only) | V(local) precedence, streaming masking, explicit unmasking, child lifecycle and beta object composition; I native dotenv/masking/encoding behavior. No successful authenticated native differential fixture. `secrets.test.ts`, `lifecycle.test.ts`, `environment-run.test.ts`. |
| `signin` | force, raw | V(local) managed admission, hooks, reuse/persistence and app preference; C manual default output is a bare token, not shell setup. I provisional preference transitions; M real authentication/prompt/export fidelity. |
| `signout` | all, forget | V(local) local revocation/forget and app preference retention; I native retention and remote revocation semantics. |
| `whoami` | none | V(local) session-bound identity; M service-account/Connect mode support and native output schemas. |
| `update` | channel, directory | I explicit host hook; M implemented discovery/download/channel validation/artifact behavior and native output parity. No updater was executed. |
| `completion <shell>`; hidden `__complete`, `__completeNoDesc` | none local | V(local/native-bounded) Bash/Zsh/Fish/PowerShell resolver/callback grammar and no-backend security probes; M backend-derived arguments, exact vendor descriptions, Fish/Pwsh execution and interactive ZLE Tab QA. `completion*.ts`, completion log. |
| `environment snapshot {create,get,list,delete,restore}` (extension) | vars, shell, no-masking | V(local) complete/selected variable snapshots, explicit unsets, metadata-only capture/list, explicit disclosure/get/shell output, host restore, masked child, approvals/cancellation. Not upstream Environment parity or full shell-state capture. `environment*.test.ts`, `approvals.test.ts`. |

Alias coverage: `ls`, `remove`/`rm`, `mv`, `reset`, `info`, `ratelimits`, hidden
`--field` and `--expiry`, and short flag bindings match the pinned stable
fixture. This includes `document get --force` without `-f` and required-value
`--ssh-generate-key`. No unverified historical alias is silently restored.
Root `help [path...]`, bare parents and `-v`/`--version` are implemented locally;
their exact usage/diagnostic output remains incomplete.

## Globals, environments, formats, and artifacts

| Requirement group (all members remain required) | Status and current evidence / boundary |
| --- | --- |
| `--account`, `OP_ACCOUNT` | V(local) explicit flag over environment, account scoping and selectors. V(native docs/help) app-global versus manual-terminal selection. I provisional reuse/expiry/signout/forget/no-preference transitions; see inventory's app model. |
| `--session`, `OP_SESSION`, historical `OP_SESSION_<shorthand>` | V(local) explicit bearer admission and flag-over-env mapping; I exact native cross-token/account precedence. M current shell export bytes, suffixed-name support/normalization evidence; do not replace documented global variable with historical-only naming. |
| `OP_BIOMETRIC_UNLOCK_ENABLED`, `authentication.integration`, `authentication.terminalId` | V(local) pre-policy exact true/app, false/manual, otherwise trusted/manual; no mode inference or authorization transfer. I native aliases/empty values/validation order and host desktop-setting equivalence. Strict rejection is a package policy. |
| `--cache`, `OP_CACHE` | V(local) parser forwarding; M built-in native-like cache/daemon behavior, UNIX default/Windows constraints. Objects in memory are not proof of vendor cache semantics. |
| `--config`, `OP_CONFIG_DIR`, `XDG_CONFIG_HOME` | V(source/host audit) accepted config flag/environment metadata; built-in storage ignores it, custom modules receive it. Native config discovery/storage integration is intentionally excluded by user direction, not a missing implementation gate. |
| `--debug`, `OP_DEBUG` | V(local) parser forwarding; M corresponding built-in debug behavior; no logging of real secret material should be added to close this. |
| `--encoding` | V(native bounded) labels/case, argument-decoding and validation-order probes; V(local) codecs. I authenticated input/output transcoding, malformed input and binary/text boundaries; Node's decoded argv is a known limitation. |
| `--format`, `OP_FORMAT` | V(local) json/human dispatch and explicit raw-byte exceptions. C full human/table/JSON shape fidelity is not supplied by generic rendering. Per-command schemas remain I/M, not certified by valid JSON. |
| `--iso-timestamps`, `OP_ISO_TIMESTAMPS` | V(local) accepts/forwards; C numeric timestamp probe is unchanged. M timestamp-aware formatting. |
| `--no-color` | V(local) plain output contains no color; I native default color/TTY behavior. An accepted flag with always-plain output does not prove full terminal presentation parity. |
| `-h`/`--help`, `help`, `-v`/`--version` | V(local/native manifest) names/inheritance/scalar version; V(local/source and reported screenshot review) shared all-node metadata/help renderer with synopses, descriptions/examples, grouping/order and displayed defaults. I exact native prose/errors and unprofiled operand semantics; displayed defaults are not semantic implementation. Package version is independent of the upstream target. |
| `OP_INCLUDE_ARCHIVE`, `OP_RUN_NO_MASKING` | V(local) applicable flag defaults, explicit overrides and scoped behavior; I full native environment precedence/invalid-input matrix. |
| `OP_CONNECT_HOST`, `OP_CONNECT_TOKEN`, `OP_SERVICE_ACCOUNT_TOKEN` | M common execution-mode routing/restrictions and complete precedence; synthetic env-only probe leaves object-store account listing unchanged. I a future configured backend can supply authentication, not proof this interface exists now. |
| `OP_BACKEND_FILE`, `OP_BACKEND_MODULE`, `OP_COMPATIBILITY_CHANNEL`, `OP_PLUGIN_SESSION_ID` | V(local) explicit Node adapter configuration, persistence, channel and trusted plugin scope; package extensions, not native env-variable claims. No ambient credential discovery is added. |
| Human records/tables; JSON records/collections; field CSV/JSON/OTP/share links | V(local) concealment/projection/general serialization and derived field references; C share-link and long-list behavior; M native headers/order/enums/nullability/timestamps/TTY widths/version metadata. Valid ID-based references do not prove exact native names-versus-IDs serialization. |
| Raw text/bytes; tokens/URLs; shell source; child streams; diagnostics/prompts | V(local) separate output paths, file modes, force refusal, masking and exit/cancellation; I native successful byte/newline/size/encoding/dotenv/masking fixtures. C bare manual signin output; M interactive overwrite chooser/prompt fidelity and exact errors/status/partial-output matrix. |
| Item categories, fields, sections, dates/month-year, attachment/menu/reference types, passkeys | V(local) assignments/deep merge/attachments/OTP/SSH with tests; M complete native schemas/validation/aliases, category-specific defaults and lossless passkey handling. 20 native-help categories versus 22 docs categories remains unresolved, not a reason to invent templates. |
| Names/IDs/share links, duplicate/archive behavior, stdin lines/JSON streams/arrays, transactional batches | V(local) targeted selector/batch/scoping tests, document-delete line input, bulk item-create arrays and implicit-stdin item get; V(reported) frozen explicit-destination copy checks. I native copy remapping/output and remaining per-command stdin/cardinality/failure-order/link behavior. |
| File artifacts: document/read/inject/template output; `1password-credentials.json`; native config; plugin setup; update downloads | V(local) first four file-output paths and explicit host IO; I hooks for the latter vendor artifacts. M native schema/content/default-path/overwrite/prompt parity and remote validity. |
| Object snapshots and environment snapshots | V(local) detached backend serialization, versioned codec and variable-only complete/selected restore. M broader cwd/aliases/functions/shell-options scope decision; explicit shell emission is not an atomic parent-shell transaction. |

## Beta, historical, and remaining discovery

| Inventory discrepancy | Current classification |
| --- | --- |
| `provisioning configure`, `provisioning google sync`, beta `user create` | M catalog/operands/flags/artifacts and pinned beta evidence. Release notes are I availability evidence, not sufficient schemas. All stay in full scope. |
| `environment read`, `run --environment` versus `--environments` | V(local) singular beta gate, stable rejection; I complete beta spelling/alias/result matrix. No pinned beta binary is available in current evidence. |
| Historical `account use`; removed plugin/install/configure/get-started, user/invite, events/create/list forms | I historical-only evidence; not current stable catalog. Discovery/rejection fixtures remain distinct from reintroducing these commands. |
| `vault list --filter`, `user get --publickey`, `connect token create --vaults` | Stable fixture does not accept these obsolete/contradictory forms; V(native bounded) filter rejection. No guessed aliases. Preserve documented `--public-key` and repeated `--vault`. |
| `user recovery begin` cardinality; service-account command access; category-count mismatch | I primary-doc discrepancies; M native authorized fixtures. Not covered by generic hook acceptance. |
| Secret-reference scanner, dotenv, query attributes/SSH formats and substitutions | V(local) dedicated parsers/crypto/tests; I native authenticated oracle. The no-auth literal inject failure proves an evidence boundary, not parser equivalence. |
| Stable/beta release labels, 2.39.0 provenance, hidden commands, root/parent help | V(native) pinned stable origin/signature/hash and captured visible tree; I completeness beyond captured hidden callbacks and beta release-label discrepancies. |

## Architecture, approvals, packaging, and release gates

| Gate | Current classification |
| --- | --- |
| Explicit safe-bash `opCommands`, private `packages/op`, objects first, pluggable backends | V(source/scoped report) explicit public plugin subpath, VFS and nested invocation; 10 adapter tests reported. No autoregistration or separate public op install/release. Integrated packaging verification pending. |
| Every domain family modeled, not merely parsed | C full model coverage: external-command hooks and arbitrary seeded records do not implement native grants/expiry/provisioning/catalogs/output contracts by themselves. M complete object-backed semantics where still delegated. |
| Real crypto and deterministic/fast testing | V(local) valid SSH/PKCS/OTP/password implementations and injected clock/hooks; synthetic SSH oracle evidence is not vendor item-schema parity. No user SSH files are involved. |
| Authorization before effects; force/reveal/raw/no-masking/no-input do not bypass policy; denial/cancellation/concurrent state safety | V(frozen source/artifact and independent scoped tests) supported object-binding coordinator, private handles, actual bound auth context, synchronous validation/handoff and original public race rejection; 778-test maintained checkpoint passes. Direct allow/literal approval do not claim binding. File-backed Node resolved mode is unsupported, not silently downgraded; arbitrary adapters are not certified. |
| Redacted approval descriptions/audit, selected account/backend/IDs/output/child intent | V(source) frozen `OpResolvedApproval` projection; every child argv value becomes `[redacted]`, handles and raw values remain private. V(reported independent regression verification) preparation and malformed metadata getter error leaks closed (A12–A13). Literal intent/discovery callbacks still receive sensitive arguments/flags. M completed disclosure/race evidence across every nested path; no redacted universal audit-log service is implied. |
| Package README, docs, license, exports/bin, Node version, dependency declarations | V(source/policy) authorized package README exists with API/env/config boundaries; fresh package policy passes with zero violations/skips. Earlier packed artifacts predate README creation. |
| Unit/lint/typecheck/build/diff, workflow validation, screenshots, fresh packed consumer | V(local frozen evidence) 778/778, zero skips; lint/test typecheck/build/whitespace and fresh installed SDK/Node CLI/types pass. Original rename race rejects stale execution without operation output; approve/deny screenshots inspected. Package policy fails README only. No interactive ZLE/Fish/Pwsh completion QA. |
| Containing-package delivery | Separate op publication/workflow requirement superseded by user direction. Planck owns integrated poe-code packaging verification. Task commit, remote reconciliation/delivery and release verification remain distinct; old standalone packs do not validate this plugin artifact. |
| Full 1:1 completion acceptance | C premature despite 829 passing tests and the verified supported object-binding gate: file-backed resolved mode remains unsupported and native fidelity gaps remain. Release remains requested and README creation authorized; no narrowed parser-only or partial-security finish criterion is substituted. |

## Concrete current gaps and next ownership

### Next no-auth functional-parity priorities

**Finite typed-flag closure, not semantic completion:**
`out/op-typed-flag-inventory.json` enumerates 82 catalog commands and 174 flag
occurrences: 89 covered, 29 freeform, 56 `authdependent`, zero concrete parser
mismatches in that matrix. The labels classify syntax evidence, not native
execution. Freeform/backend-dependent flags are not waived, nor is CSV content
validity inferred from decoding. Missing captured native help is explicit for
`environment read` and the five environment snapshot extension commands.

Implemented lexical password recipes, standard CSV quoting/record handling and
repeatable CSV completion now have 70 matching bounded native cases. Installed
root/Node/CLI checks verify frozen decoded/repeated CSV values, real object
resolved binding, raw recipe preservation, caller argv isolation, early invalid
CSV/recipe rejection and lengths/classes for LETTERS,+20, DIGITS,+8 and repeated
letters. The inventory's saved downstream LETTERS,+20 gate is historical:
the final independent section of `out/op-typed-closure-summary.log` resolves it
with a fresh artifact; do not report it as still open or edit that captured
inventory silently. No further probe loop is planned. Full object schemas,
native output, expiry/device lifecycle, config storage and release are separate
unfinished requirements, not just tests remaining after parser closure.

**Five typed-flag contracts now in source:** shared `valueSyntax` distinguishes
Go-only device-deauthorization durations from expiry's day/week extensions.
Travel Mode accepts exact `on`/`off`. Allow-admins accepts Go boolean spellings
`true/false`, `TRUE/FALSE`, `True/False`, `t/f`, `T/F`, `1/0`. SSH syntax accepts
case-insensitive ed25519/rsa plus rsa2048/rsa3072/rsa4096 and rsa-2048/rsa-3072/
rsa-4096, without trimming. File mode requires at least three octal digits and
a uint32 value; host acceptance of all such modes is separate. Invalid values
fail before policy/input/backend; completion uses the same validators.
`out/op-static-five-*.log` records bounded native/source evidence. Lifecycle,
config storage and detailed output gaps remain. SSH downstream normalization and
Newton's independent functional/artifact checks now pass in the 829-test checkpoint;
synthetic generation and unchanged mode forwarding do not prove native OS effects.

**Role parser/backend verified; duration syntax frozen:** Ptolemy
completed declarative role validation after two red cases; 59 scoped tests,
types/lint/whitespace pass. The subsequent installed uppercase failure is resolved,
not waived: `admin.ts:375` lowercases without trimming, leaving input flags intact.
Peirce reports 85 scoped red/green backend checks. Newton's 782-test checkpoint
and installed portable/Node/CLI checks verify canonical stored/output values,
unchanged policy/caller inputs and early invalid-role rejection. Duration now has
separate syntax evidence below; these results do not prove remote RBAC or lifecycle.
This supersedes the earlier assessment that no implementation-ready discrepancy
was available; it does not change the external fixture/storage/README gates.

| New gap | Concrete evidence | Assigned boundary |
| --- | --- | --- |
| `group user grant --role` | Parser accepts case variants and rejects padded/empty/quoted/CSV/unknown values before policy/input/backend. Backend now lowercases without trimming for stored/output roles; original policy flags and caller argv remain unchanged. Invalid completion matches native parse failure. | V(parser/native-bounded plus corrected installed execution): 59 parser tests, 85 backend scoped checks and final 782-unit/installed SDK/Node/CLI checkpoint. Earlier uppercase failure resolved, not waived. No remote role-policy claim. |
| `--expires-in` | Implemented shared declarative duration validation for item share, Events API create, service-account create and Connect token create, including item `--expiry`. Go-style syntax plus native-evidenced day/week preprocessing and probed rounding/overflow/wrap checks; invalid values reject before policy/input/backend and completion matches bounded native cases. | V(799-unit/17-focused/195-native-comparison evidence plus fresh installed SDK/Node/CLI): both wrap signs accepted, neighboring overflows rejected; raw strings, omission and binding inputs preserved. No universal grammar equivalence, service lifetime, issuance or expiry enforcement claim. |

Evidence: `out/op-parser-remaining-{execution-oracle,public-repro,focused-oracle}.log`.
This audit inspected the public call-sequence reproductions and focused role
completion mismatch; additional acceptance details are root-relayed native
observations. Subsequent duration evidence is in `out/op-duration-parser-*.log`
and `out/op-duration-rounding-crosspath.log`; inspected unit/native logs confirm
796 tests and 176 comparisons passing. Types/scoped lint/whitespace and inspected
screenshot are reported. These supersede the earlier deferred 44-probe assessment.

**Lifecycle remains missing, not validated by hooks:** `admin.ts` still places
all four expiry-bearing operations behind hooks. Forwarding original `1h` cannot
prove expiration enforcement. `deauthorize-devices-after` now has Go-duration-only
syntax metadata (without day/week extensions): ordinary local user suspension works, but that flag explicitly
requires an admin hook and no delayed device-deauthorization lifecycle exists.
Track syntax, backend scheduling/expiry and remote native behavior separately.

#### Plugin selection and existing host UI: current recheck

**Post-756 availability addition:** Peirce implemented `plugin-catalog.ts`,
separate from parser metadata and configured plugin records. Inspected pinned
no-auth `out/op-oracle/plugin-availability-toNiXs/probe-0.json` (exit 0): 90 JSON
rows, 89 with executable names; the remaining row is registry `rediscloud`
without an executable. A fresh structured comparison of `availablePlugins([])`
matches all native rows and ordering exactly. Do not count the nonexecutable
row as a 90th executable or invent its missing fields.

`backend.ts` serves public availability plus account-scoped custom ID/name rows
without exposing configuration; configured built-in IDs do not replace the
public metadata. `plugin-selection.ts` offers only ID/name pairs and omits the
nonexecutable row. A valid offered choice still requires an account-scoped
configuration to inspect. Available-but-unconfigured selection or explicit
inspection fails `Plugin configuration is unavailable`; native interactive IO
is blocked/unimplemented, not proven by this catalog. Newton's final 778-test
run and installed ordinary SDK/CLI checks now pass, with the initial whitespace and
README failures distinguished above (whitespace subsequently corrected).
Ptolemy's permission parser is now frozen with scoped evidence below. This addition
does not certify provisioners, field schemas, arbitrary human rendering or TTY UI.

Planck additionally reports byte-identical JSON for all 90 ordered native rows.
The earlier human-output mismatch is repaired by `plugin-list-output.ts`, wired
through `cli.ts`: native `EXECUTABLE`, `NAME` and `REQUIRED FIELDS` columns replace
generic record fields. Frozen human and JSON captures are reported byte-exact;
`/tmp/op-plugin-list-native-columns.png` was inspected without clipping.
Peirce's `pluginRequiredFieldLabels` provides
90 native display strings only; these are not credential field schemas, types,
validators or provisioning requirements. JSON remains unchanged. Newton's
27 independent checks cover dedup/order/isolation/admission after fixing stale
chooser expectations. Updated Node tests pass 117/117 plus lint/types; assertions
were retained/strengthened. The final 778-test checkpoint and installed plugin-list
captures now pass. Bounded capture parity does not establish arbitrary-width, custom-row
or authenticated plugin-configuration parity.

**Original gap, now implemented as an injected host capability:** the official
[plugin inspect reference](https://www.1password.dev/cli/reference/management-commands/plugin#plugin-inspect)
and pinned `out/op-oracle/captures/plugin__inspect.stdout` describe selecting
from available plugins when no operand is supplied; an explicit executable
selects directly. Inspection should show configured credentials/default scopes
and alias details. The earlier no-operand path threw
`Plugin selection capability is unavailable`. Current object-backend preparation
now selects before dispatching to `admin.ts`; calling that admin helper directly
still does not provide the public host-selection route.

A fresh synthetic public SDK probe with one seeded plugin confirms no-argument
`plugin inspect` exits 1 with no stdout, while `plugin inspect synthetic-plugin`
exits 0 with its seeded record. The fixture supplies an empty stdin stream and
no authentication or private data. This establishes a local omission even for
one candidate; it does not authorize silently selecting that candidate.
An earlier malformed probe omitted the required stdin capability and failed
before command execution; that fixture error is not counted as a product defect.

**Implemented and locally verified host capability:** scope is only
`plugin inspect` without an operand. Peirce owns host contract/types/backend
binding, Planck common CLI/Node forwarding, and Newton root exports/tests.
The callback receives immutable account-scoped ID/name-only choices, never
credential/configuration records, and returns an exact offered ID synchronously
or through a promise; `undefined` cancels. Explicit operands bypass the chooser.
Never automatically select a singleton. Actual source-verified type is
`OpSelectPlugin`, exported from the portable root: `(candidates: readonly
Readonly<{ id: string; name: string }>[], context: Readonly<{ signal:
AbortSignal; accountId: string | null }>) => string | undefined |
Promise<string | undefined>`. `OpBackendContext.selectPlugin`,
`OpCommandContext.selectPlugin` and `NodeHostDependencies.selectPlugin` carry it.
Missing names fall back to IDs. `plugin-selection.ts` validates exact offered-ID
membership and sanitizes failures; `bindings.ts` scopes/pins the selection and
generation, and `backend.ts` internally prepares no-operand direct execution.
Explicit operands do not invoke the callback. Ptolemy's completion report is
recorded below; Newton's final 756-test checkpoint and fresh installed root/Node
SDK checks pass for scoped immutable metadata, exact selection, resolved target
approval ordering, invalid/foreign/cancelled choices and central denial.
Planck inspected `/tmp/op-plugin-inspect-{chosen,cancelled,explicit}.png` using
synthetic callback fixtures; these are host integration, not native UI evidence.

Resolved preparation may offer choices only after the resolution grant, pins
the selected target and generation, and must never reprompt during execution.
Direct allow may invoke the chooser inside its internal operation; it does not
become resolved approval. Unsupported hooks and file-backed resolved behavior
remain unchanged. Required evidence covers offered-ID membership, immutable
account-scoped metadata, explicit bypass, singleton nonselection, cancellation,
policy denial, stale generation/target rejection and no second chooser call.
No automatic TTY UI, new dependencies or `plugin init` behavior is approved.
No native authentication is needed for these synthetic host-capability tests;
their success will not establish upstream prompt fidelity.

**Existing design-system primitives are real, but not wired into op or approved
for this implementation slice.**
`packages/toolcraft-design/src/select.ts` and `src/confirm.ts` export existing
prompt primitives. Their options support `signal`, explicit Node input/output
streams, and selection values/labels; cancellation uses a distinct symbol.
`src/prompts/interactive/core.ts` otherwise defaults to process stdin/stdout.
`src/prompts/interactive/select.ts` returns its current value in non-TTY mode
when `POE_NO_PROMPT=1`. Therefore importing the primitive alone is not safe op
integration: a host adapter must deliberately choose a TTY input separate from
payload stdin, direct UI away from machine-output stdout, handle cancellation,
and prevent ambient default acceptance. Do not introduce `POE_NO_PROMPT` as
implicit op consent. Preserve the portable root/Node boundary and review package
dependency/export/packaging changes before wiring an adapter. No direct clack
or chalk integration is needed. Exact native prompt appearance remains unknown;
a functioning local design-system chooser is not native UI byte parity.

#### Remaining blockers versus work that can proceed

**Frozen completion-only follow-up:** Ptolemy verifies pinned native
`__completeNoDesc item move --` suggests only `--destination-vault`;
`__completeNoDesc user provision --email <synthetic-email> --` suggests only
`--name`. Once required flags are present, ordinary suggestions resume.
Cache/config flags are now visible locally to match native callbacks.
These are bounded native callback observations, not new parser constraints or
backend argument-value evidence. Root approved metadata-driven required-flag
suggestion, prefix fallback and visibility TDD only. Ptolemy reports types/lint
passing; inspected logs confirm 55/55 scoped tests and 218 native
candidate/directive comparisons with zero mismatches. Evidence:
`out/op-completion-required-{red,scoped-final,types-final,lint-final,native-valid-parity,manual}.log`.
Ptolemy inspected `screenshots/op-completion-required-native-parity.png`.
Parser constraints, execution semantics and backend-free callbacks are unchanged.
Permission-value parsing now has separate bounded evidence below; alternative
requirement groups remain unverified/incomplete. No all-case completion parity
is claimed. The earlier Newton
756-test maintained checkpoint/fresh artifact now passes, including installed
required-flag/cache completion without a backend.

**Permission parser frozen, not a green full run:** Ptolemy reports five initial
red cases, 125 scoped tests passing, scoped lint/types/whitespace passing and
163 native comparisons. Inspected `out/op-permission-parser-native-parity.log`
confirms 163 cases with zero mismatches; command evidence is
`out/op-permission-command-oracle.log`. Native rejects invalid permissions,
empty or quoted entries and trailing commas before account resolution, while
accepting supported aliases and case/whitespace variants. The screenshot
`screenshots/op-permission-parser.png` was reported inspected. This establishes
bounded syntax/validation behavior, not account-tier grants, authenticated
authorization semantics or all alternative requirement groups. The current
earlier full run predates Newton's chooser corrections; the latest unit run
passes 778 tests, with the whitespace correction and README failure separately reported above.

**Candidate future file-backed binding work, not current support:** feasibility
depends on an explicit cooperative-writer lock, mutation revision and effect
ownership contract. Snapshot envelope version 1 identifies a serialization
format, not a mutation revision. Neither that version nor in-process object
generation supplies cross-process proof. An owned storage contract must define
writer participation, lock lifetime, revision checks and host-effect handoff
before any implementation or support claim. Until that decision and its tests,
file-backed resolved approval stays unsupported; direct/literal support is
unchanged. This is future design work, not authorization to implement a storage
mapping, expand approval scope now, or claim OS/distributed atomicity.

| Class | Current requirement / next boundary |
| --- | --- |
| Actionable local behavior | The metadata-only `plugin inspect` chooser is implemented and verified in the final installed SDK checkpoint; evidence-backed operand profiles and approved completion metadata work remain actionable. Automatic TTY UI is explicitly outside this slice. Seeded plugin inspection rendering/default-scope/alias projection can improve against documented fields without real credentials. A chooser does not supply bundled plugin catalogs, credential schemas, provisioning, `plugin init` or shell artifacts. |
| Actionable bounded research/model work | Existing captured plugin list metadata can ground catalog entries; per-plugin provisioners and `plugin init/run/credential import` remain substantive hook-only behavior. Publicly documented local validation and host artifact contracts can be developed separately from remote success, subject to approved APIs. Debug/cache semantics, service-account/Connect routing and updater behavior also remain missing implementations, not automatically implemented by flags/hooks. Do not invent their unspecified contracts to avoid a blocker. |
| Native output evidence | Recordings, not submitted bundles, are requested. Complete templates and synthetic timestamp/long-list output remain unavailable at the no-account boundary. No private account access is authorized; no native parity is inferred. |
| Object storage contract | Settled: explicit generic seeds, object-form vault references, optional `defaultVault` ID and no native config integration. Source inspected; Peirce reports 842 tests at source freeze. Fresh installed-artifact verification remains separate. Output/link evidence remains distinct. |
| Host UI versus native evidence | Existing overwrite consent is implemented and verified, but no automatic TTY adapter is wired or approved in the chooser slice. Exact upstream wording/defaults and authenticated success remain unknown. Plugin selection is a separate locally verified callback, not supplied by overwrite consent. |
| Delivery dependency | Package README exists and fresh package policy passes all 17 rules across 72 packages with no violations/skips. Prior pack predates this README; commit, remote reconciliation/delivery, publication and release verification remain separate uncompleted requirements. |

These categories do not reduce the all-features goal to fixture collection or
testing. Preserve every command family, flag, artifact, environment snapshot
extension and release requirement in the inventory. Full native parity remains
open even after a local chooser/UI implementation. The unavailable Mendel review
stays stopped and is not treated as completed or retried.

Revalidated against the current source on 2026-09-08 after the 684-test frozen
checkpoint. These are bounded follow-up slices, not a reduced full-1:1 goal.
Prioritize native functional behavior over extending approval scope. Retain
the verified object-binding contract as a regression constraint, not a new
architecture project. No native executable, credentials or account discovery
was used in this recheck; probes used fresh synthetic in-memory SDK backends.

| Priority | Actionable slice and current evidence | Proof boundary / next acceptance evidence |
| --- | --- | --- |
| P1 | **Documented group/user batch repair ready.** Current registry includes nine added paths: `group {get,edit,delete}` and `user {get,edit,delete,confirm,reactivate,suspend}`. Peirce reports 18 new red/green tests and 166 scoped tests plus typecheck/lint passing for the singleton/array metadata and actual-ID scope/preflight repairs. | V(source/scoped/final 756-test checkpoint), including installed ordered-batch and rollback checks. Preserve singleton/array equivalence, actual selected-ID scoping and missing-target rejection before hooks. Filters work; zero-operand stdin equivalence remains unproven and outside this fix. Do not globally enable implicit stdin or reopen `item get`'s existing repair. |
| P2 | **Operand and local-flag profiles.** Current catalog has 76 stable leaves, only seven with explicit `args`: `read`, `run`, `whoami`, `document get`, `item get`, `vault list`, `item template list`; 69 remain unprofiled. This is missing common validation metadata, not proof all 69 execute incorrectly. | Use pinned per-command help and safe parser-only native captures to add min/max, stdin alternatives and flag-dependent constraints one family at a time. Test invalid operands before policy/custom backend dispatch, flag placements, optional-value boundaries and help/version bypass. If native reaches authentication before validating a case, label order unknown; do not guess from a synopsis. |
| P3 | **Timestamp rendering: native output evidence unavailable; narrow env acceptance fix frozen.** Planck reports 143 scoped tests plus typecheck/lint passing. Current parser supports per-flag invalid-env omission; this exception applies only to `OP_ISO_TIMESTAMPS`. Explicit flag strictness and precedence stay unchanged. | Omission is the chosen fallback, not proof of native effective true/false behavior for invalid labels. No rendering conversion is approved or claimed. Golden native command outputs must establish timestamp fields, units, human/JSON applicability, precision and timezone; the synthetic numeric seed supplies none of those facts. Other boolean environment variables are outside this exception. |
| P4 | **Item presentation and object defaults.** Source now implements generic `defaultVault`/sole-scope selection without Private assumptions. Detailed `--long` rendering and `--share-link` projection remain incomplete. | Verify the new object contract independently; obtain safe native output evidence before inventing columns or links. No native account-config modeling is requested. |
| P5 | **Object storage scope settled.** Generic seeds through existing SDK/file/module adapters; native config integration deliberately excluded. | No mapping decision, implicit home reads or new adapter API. Cache/debug fidelity and file-backed resolved approval remain distinct limitations. |
| P6 | **Complete templates: native evidence unavailable.** Only Login is bundled; recorded native list/get stops at no accounts configured. Public provider mappings are not CLI schemas. | No user fixture submission required. Use safe recordings when available; do not fabricate fields, ordering or defaults from labels or partial examples. |
| P7 | **Overwrite capability verified in the final checkpoint.** `OpConfirmOverwrite` is defined in `host-contracts.ts`, publicly exported by both root and Node entries, and accepted as `NodeHostDependencies.confirmOverwrite`. Ptolemy reports 113 scoped tests plus lint/typecheck passing; root reports public-export compile red/green coverage. | Explicit true precedes mode/truncate/write for nonempty files; false/error/EOF/cancel preserve bytes/mode. Reported tests cover retained handles across path replacement, shorter-output truncation and no effects from late post-abort consent. Force bypasses confirmation only, never policy. No data in callback, template-stdin consumption or new native flags. Missing callback fails closed. Automatic TTY UI, native prompt/default and authenticated native success remain unverified; manual signin is a separate gap. |

Primary sources re-opened for this prioritization:
[group commands](https://www.1password.dev/cli/reference/management-commands/group)
documents explicit-hyphen stdin and JSON object lists;
[item commands](https://www.1password.dev/cli/reference/management-commands/item)
documents template/assignment input and template enumeration;
[global reference](https://www.1password.dev/cli/reference)
defines ISO timestamps, config selection, debug and cache flags. Public item
documentation still says Private while captured 2.39.0 create help names
account-dependent defaults; preserve that discrepancy. Captured primary help is
under `out/op-oracle/captures/`, including `group__get.stdout` and
`item__create.stdout`. Existing help is evidence, not permission for native
authenticated execution.

P1's batch repair and P3's environment acceptance fix pass the final
718-test checkpoint; P2's evidence-backed parser profiles remain actionable.
P3 rendering/P6 are genuine external-fixture dependencies, and P5 requires a
local configuration decision; these are not implementation-ready tasks disguised
as research. No request to access private native state follows from those gaps.

Root has requested a safe blank native 2.39.0 template and synthetic timestamp
bundle asynchronously; no answer or evidence is inferred. The
[safe collection checklist](op-native-fixtures.md) specifies provenance,
category/field/section order/defaults, timestamp conditions and paired
`item list --long`/ordinary-list captures. Native authentication stays outside
agent tool scope. Config storage mapping remains decision-pending, not invented.

**External-fixture blocked, not reasons to idle:** exact authenticated output
schemas, full category templates, successful inject/run encoding/dotenv/masking
bytes, remote share/token issuance and revocation, service-account/Connect
execution restrictions, tier/RBAC behavior, and app recency/timeout transitions
still need authorized synthetic native fixtures or complete primary public
contracts. Local object models and public validation can improve independently,
but must retain I/M labels for unproven native results. A pinned beta oracle and
Fish/PowerShell runtime/interactive ZLE QA are tooling/evidence gaps rather than
private-credential requirements. No additional downloads or native account
operations are undertaken in this audit turn.

**Release gate rechecked:** `packages/op/README.md` is still absent. Fresh
`npm run lint:packages -- --json` exits 1: 72 packages, 17 rules, exactly one
violation, `package-readme-required` for `@poe-platform/op`, no skips. README
permission remains pending; no further permission prompt or README edit is
made. The stopped Mendel review is not rerun. The earlier 684-test checkpoint is retained
as prior evidence, superseded by 756 passing maintained tests, not native parity.

Fresh synthetic probes in this audit, through `createOp` and object backends,
returned the following. These are local observations, not authenticated native
runs. Fixes must use TDD and be independently rechecked after their owners report.

| ID | Reproduction / exact boundary | Next work |
| --- | --- | --- |
| A1 | The earlier generic help gap is repaired by shared catalog metadata and `help-renderer.ts`, now wired into the common CLI. Root/item screenshots are reported inspected. | Newton's all-node summaries/descriptions/synopses/examples/group order/default displays and shared completion metadata are V(local/reported). I exact native wording, complete parser semantics and defaults; no backend argument suggestions or semantic-default implementation is implied. |
| A2 | `item get item --share-link` returns ordinary item metadata; `--iso-timestamps` leaves `created_at: 1700000000` numeric. No built-in behavior consumes the share-link/long/cache/config/debug flags beyond forwarding where noted. | Item presentation needs backend coordination. Config host semantics, debug/cache and native timestamp formatting remain unsupported, not included in Planck's new parser assignment. Do not call them implemented because they forward. |
| A3 | Former hardcoded Private fallback is replaced in current source by explicit/default/sole-scope generic-object selection. | Source inspected; Peirce reports 842 passing tests at source freeze. Fresh installed-artifact verification remains separate. This is not native account-default inference. |
| A4 | Managed manual `signin --session=synthetic-token` and the same command with `--raw` both return `synthetic-token\n`. | Peirce/admin output coordination: implement default shell setup versus raw output; exact current native export naming remains unverified. |
| A5 | Default `item template list --format=json` returns only `["Login"]`; `get Password` fails. | Full authoritative category schemas and aliases; native enumeration is auth-blocked. Injection support does not make the bundled catalog complete. |
| A6 | Original name reassignment now fails closed through the installed SDK, Node CLI and executable: exit 1, zero operation output, no stale execution; unchanged/denied controls pass. | V(local frozen source/artifact evidence): supported cooperative object-binding gate closed without weakening the identity promise. Direct/literal contracts remain distinct. File-backed resolved mode remains unsupported; arbitrary adapters and post-handoff host effects are not certified. Broader review tool unavailable, not completed. |
| A7 | Earlier array creation failed first in the handler, then backend. Fresh audit probe creates two items successfully from a JSON array. Frozen tests cover explicit-destination single/array copies, source isolation and target/admission rejection. Actual cross-account CLI pipeline output references resolve copied values without changing source items. | V(local/log-inspected), including 26/26 bulk follow-up and the 594-test maintained checkpoint. Exact native ID remapping and output remain I, not closed by local round trips. |
| A8 | Registry includes `document delete`; fresh line-input deletion exits 0. Implicit-stdin `item get --format=json` with an ID object now also exits 0. | Peirce fixes V(local); maintain per-command input and atomicity evidence rather than generalizing to every native pipeline. |
| A9 | Fresh public item-get JSON contains derived references for every returned field, including a synthetic valueless field. The frozen backend discards supplied references on create/edit/move; get derives them from current IDs. | Mendel's `deriveItemFieldReferences` and Peirce wiring are V(local/reported). Raw IDs and optional sections are valid; unsupported names require IDs, not percent-encoding. Exact native names-versus-IDs serialization, copy remapping and output remain unverified. |
| A10 | Optional Node `confirmOverwrite({ path }, { signal })` implemented; 113 scoped tests plus lint/typecheck pass by report. Root/Node type exports present; manual host/CLI checks pass and allow/deny screenshots inspected. Final 756-test maintained checks and fresh consumer pack pass. | V(source/scoped/manual evidence) bounded host confirmation, explicit true only, preserved bytes/mode on refusal/cancel and retained handle across path replacement. Force does not bypass policy. Missing callback fails closed; no callback data, template-stdin consumption or new flags. M bundled/native TTY prompt parity: this host capability does not supply it. |
| A11 | Fresh `item --vault Work get <id>` succeeds. Missing `read` operand fails with zero policy calls. `OpCatalogCommand.args` is typed as `{ min, max?, stdinAlternative? }`; profiled constraints and conditional checks run in the common CLI before authorization/custom backend execution. | Planck's profiled string/bare-boolean/optional fixes pass the final maintained local checkpoint; unprofiled constraints intentionally remain unset. Do not claim all parser/native operand cases verified. Newton remains sole shared-catalog owner. |

| Boundary finding | Evidence | Closure requirement |
| --- | --- | --- |
| A12 | Synchronous preparation exception text leakage fixed. | V(reported independent verification), Ptolemy's 33/33 scoped tests plus typecheck/lint, followed by the 684-test frozen checkpoint. Preserve sanitized failures and protected-effect rejection. |
| A13 | Malformed metadata getter exception text leakage fixed. | V(reported independent verification), same 33/33 checkpoint. Preserve sanitized failure and frozen approval projection; not universal disclosure proof. |
| A14 | Queued invalidation/stdout guard defect fixed with synchronous validation/handoff ordering. | V(reported independent verification), same 33/33 checkpoint, including actual bound authentication context. This is bounded host-handoff evidence, not OS identity, remote consistency or distributed atomicity. |

### Current resolved-binding artifact evidence

**Latest finite typed-closure artifact:**
`out/op-typed-closure-checkpoint/poe-platform-op-0.0.1.tgz`, independently verified
SHA-256 `3c7446b1c2e0741d2dfa3a248e9cae9776ef84d1ad25986ad95154b762e31e76`.
Summary `out/op-typed-closure-summary.log` contains the final independent
835-test/lint/types/build/whitespace and installed CLI/root/Node SDK/declaration
results, superseding its earlier 834-test/handoff-blocker section. All 70 native
outcomes match. CSV binding/recipe generation pass, no new gap reproduced;
generated passwords were not logged. Screenshot inspected; 97 package
fingerprints unchanged. Archive has 76 entries and 79,143 packed bytes, executable
bin and public assets, no source/tests. Workflow/package-policy routes were not
repeated. README, external fixtures, config/lifecycle/output and reconciliation/
delivery gates remain open. No commit, push, publication or release occurred.

**Latest typed-flag artifact:**
`out/op-static-five-checkpoint/poe-platform-op-0.0.1.tgz`, independently verified
SHA-256 `b8facd60f4b1fc331a80764b0dee779a760c61597361645dcba0b321822e2e33`.
Summary `out/op-static-five-checkpoint-summary.log` records 829 passing tests,
zero failures/skips, lint/types/build/whitespace and fresh installed smokes/types.
The 88-case native grammar replay has zero mismatches. Installed read/inject/
document/template output checks cover five uint32 modes; Node passes them to
injected open/chmod unchanged, preserving binary document bytes. CLI verifies
local travel/admin metadata, raw deauthorization hooks, canonical SSH aliases
and ordinary `0600` output. Invalid values fail before backend/policy/input as
applicable. No native OS-mode equivalence, remote ACL enforcement or delayed
device lifecycle follows. Missing deauthorization capability fails unchanged.
All 95 package fingerprints remain unchanged; archive has 74 entries and 78,473
packed bytes, executable bin/root/Node assets and no source/tests. Owner screenshot
inspected. Unchanged workflow/package-policy checks were not rerun. README,
native fixture/config/output/lifecycle and full-goal delivery gates remain open.

**Latest duration-fixed artifact:**
`out/op-duration-fixed-checkpoint/poe-platform-op-0.0.1.tgz`, independently verified
SHA-256 `f674d7f559e865c0fed29ba3337555b83131e144d17af47a0d35a0018f87d022`.
Inspected `out/op-duration-fixed-checkpoint-summary.log`: 799 unit tests,
17 focused regressions, lint/types/build/whitespace and maintained pack/install/
strict declarations pass. Installed root SDK, Node SDK and CLI verify both wrap
signs, neighboring rejection controls and unchanged raw hook/policy strings.
All 93 package fingerprints are unchanged; archive has 72 entries and 78,192
packed bytes, executable bin and root/Node assets, no source/tests. The summary
names authoritative `out/op-duration-fixed-*` logs. Provisional failing duration
artifact evidence remains preserved. Workflow/package policy were not rerun;
no prior workflow lint is represented as a current check. Missing README,
duration lifecycle, native fixtures, config decisions and delivery gates remain.

**Latest role-fixed artifact:** `out/op-role-fixed-checkpoint/poe-platform-op-0.0.1.tgz`,
SHA-256 `b11a95a65a6123ad3cb55089ec16b065772a83c4e12f4e30ba69fb7c11d4e700`,
independently recomputed by this audit. Summary
`out/op-role-fixed-checkpoint-summary.log` records 782 passing tests with zero
failures/skips, lint/types/build/whitespace, fresh maintained pack/install and
strict installed root/Node declarations. Installed SDK/direct backend/Node/CLI
checks verify valid case variants, canonical stored/output roles, raw input
preservation and early invalid-role rejection. Screenshot inspected; 90 package
fingerprints unchanged. Archive has 70 entries and 77,098 packed bytes. This
supersedes the failing role artifact; original failure evidence is retained.
Workflow/package policy were not rerun; README-only policy failure, duration,
native fixtures, config decisions and reconciliation/delivery gates remain open.

**Previous 778-test artifact:** `out/op-release-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`f630326651829160b197851f1fe96ac1222e14e7790320406d63846511fab2a7`, independently
recomputed by this audit. The `release` prefix is a checkpoint label, not a release.
`out/op-release-checkpoint-summary.log` records 778 tests, zero failures/skips,
passing lint/types/build/workflow/installed consumer checks and 89 unchanged
package fingerprints. Installed CLI plugin-list human/JSON exactly match pinned
probe-0/probe-1; the installed screenshot was inspected. Pack has 70 entries,
77,026 packed bytes, executable bin and public JS/types/contracts; no source,
tests or node_modules are shipped. README is absent. The whitespace failure at
`plugin-list-output.test.ts:37` was corrected by Planck in the test only; whitespace
now passes by report and the production artifact is unchanged.
Named unit/lint/build/workflow/diff/policy/pack/consumer/fingerprint/screenshot
logs are listed in that summary. No commit, push, publication or native selection
UI success is claimed.

**Final combined artifact:** `out/op-combined-checkpoint/poe-platform-op-0.0.1.tgz`,
SHA-256 `8b484dbe025238c890ab1a5a3dfb4ddf2284b2599995b4ffb25bd225dd6f8ec2`
independently recomputed by this docs audit. Inspected
`out/op-combined-checkpoint-summary.log`: 756 tests, zero failures/skips,
package lint/test typecheck, selected build, workflow lint and whitespace pass.
Fresh installed CLI/root SDK/Node SDK/strict declarations pass, including
completion without backend, plugin selection/approval, batch/env and overwrite
checks. All 82 package fingerprints remain unchanged. Pack contains 64 entries,
73,010 packed bytes; executable bin and public JS/declaration/host-contract
entries are verified. Package policy still fails only for missing README.
The summary names authoritative `out/op-combined-*` logs; corrected fixture
attempts, not earlier harness errors, supply the successful smoke evidence.
No product changes, staging, commits, push or release occurred in this checkpoint.

**Previous 718-test artifact:** `out/op-final-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`7957abfd576803e84cceffb606d48edc73e1aa6fe4557609541f26634e9d39f6`.
Inspected `out/op-final-checkpoint-summary.log`: 718/718 unit tests, lint/types,
selected maintained build, workflow lint, tracked/untracked whitespace and
fresh maintained prepack/install/CLI/root SDK/Node SDK/declarations all pass.
Synthetic timestamp environment ingestion/precedence, resolved ordered batch,
invalid-batch rollback and overwrite allow/deny/mode/central-deny checks pass.
The summary names all unit/lint/build/workflow/policy/pack/consumer/fingerprint
and screenshot logs. Screenshots are reported inspected; 78 package
source/config/license fingerprints are unchanged. Package policy exits failure
for exactly one violation: missing README. No waiver, commit, push or release.
This is current local artifact proof; original name-reassignment evidence below
remains a separately identified earlier regression capture, not a new native run.

Latest overwrite manual evidence, separate from the earlier artifact:
inspected `out/op-overwrite-manual-host.log` and
`out/op-overwrite-manual-cli.log`. Allow saves shorter output at `0600`;
deny/throw/reject/no callback exit 1 with original bytes and `0640` preserved.
Force skips confirmation, while force plus policy denial still exits 1 without
replacement. Standalone CLI without a callback refuses nonempty output.
All cases record zero stdout bytes and no content disclosure; root reports
callback intent/diagnostics contain no file content. Ptolemy inspected
`screenshots/op-overwrite-host-allow.png` and
`screenshots/op-overwrite-host-deny.png`. Native upstream prompt parity remains
unverified; Newton's full checks/fresh pack now pass as recorded above.

The earlier [binding verification ledger](op-resolved-approval-verification.md#frozen-checkpoint-results)
records `out/op-resolved-final-{unit,lint,build,diff,policy,pack,install,artifact}.log`,
consumer smoke/types logs, executable race evidence and approve/deny transcripts.
Inspected unit and artifact logs confirm 684 passing tests and 58 matching dist
files with an executable bin. Archive `poe-platform-op-0.0.1.tgz` SHA-256:
`8c0f2aaf1a374094ba0322dc5b59ce838992c84cc92d754e6b324a06226bc245`.
`out/op-resolved-final-bin-race.log` records exit 1, zero operation-output bytes
and no stale execution. `out/op-resolved-final-node-validation-wiring.log`
shows synchronous cached-backend validation in source and installed artifact,
without a reload or added await. The ledger records installed file-backed
resolved denial without output or seed mutation. Policy still fails README only.
No commit, remote delivery, publication or universal adapter proof follows.

### Previous maintained and fresh-artifact evidence

Inspected `out/op-final-freeze-unit.log` (594/594, zero failures/skips),
`out/op-final-freeze-lint.log` (ESLint and test typecheck),
`out/op-final-freeze-build.log` (maintained selected-workspace build), and
`out/op-final-freeze-diff.log` (tracked/staged plus 68 untracked scope files,
exit 0). `out/op-final-freeze-policy.log` records the sole README violation;
its reported exit 1 is a failure, not a waived gate.
`out/op-final-freeze-help.log` reports help QA exit 0 and no loading of the
invalid synthetic backend module. Refreshed screenshots are reported inspected.

`out/op-items-bulk-frozen-backend.log` passes 26/26 with zero skips.
`out/op-bulk-cross-account-cli-frozen.log` records the actual pipeline,
unchanged source items, and resolution of copied-field references. These are
local SDK/CLI/backend checks, not authenticated native protocol fixtures.
This docs task inspected the logs rather than rerunning the complete suite.
Mendel's earlier fresh pack passed, as detailed below. At that checkpoint,
resolved-identity approval was still open; the current 684-test artifact evidence
above supersedes that status for supported object binding. Native fidelity,
README permission and verified delivery/release remain separate open gates.

Fresh artifact: `@poe-platform/op@0.0.1`, `poe-platform-op-0.0.1.tgz`, SHA-256
`0c5d6926778f4b3ccbed9b599662290d93ae5c51678b0b2b9f79d31ba5f7dbe7`.
Inspected `out/op-frozen-prepack.log`, `out/op-frozen-consumer-smoke.log`, and
`out/op-frozen-artifact-proof.log`. The proof records 61,529 bytes, 56 files,
executable bin, license present, and installed dist matching the current build.
The isolated ignore-scripts consumer passes bin/help, SDK, Node subpath, types,
completion without backend calls, bulk copies and derived references. README
remains absent in the artifact and is explicitly not waived. Independent
backend/reference review reports another 85 passing tests; it is not an
authenticated native protocol check or a replacement for the 594-test run.

The proposal was architecture-only at that earlier checkpoint; implementation
and verification now close the supported object-binding gate above without
weakening its invariant. Missing README permission and remaining native fidelity
still prevent a full-goal completion claim. Successful local packing is not npm
publication, verified remote-main delivery, or a successful GitHub release.

### Release audit relay

Latest root relay (separate from local test success): local/cached main is
`00bfb59310ce57c0156f362b4328bab076a75449`; live remote main is
`0511e60b374804d6aadf7800cefbf718336ae6d3`, reported 410 commits ahead.
No package/workflow is on that remote and nothing is staged. Reconciliation is
a delivery gate, not permission to alter unrelated changes or rebase/stash/push.
README is missing with permission unanswered; latest registry lookup is reported
404 and publication credentials remain unverified. These are separate gates
from native fixtures/config decisions and the passing local package artifact.
The shorter SHAs and registry observations below are historical, not current
remote verification. No stopped reviewer was restarted.

Mendel reports workflow/actionlint passed and the README is the only observed
package-policy violation. The registry lookup returned npm 404 at that check;
first publication therefore needs the initial token path. Token metadata exists,
but validity and publish scope are unknown; subsequent OIDC publication needs
configuration. No secret value was inspected by this audit, and metadata is not
proof of successful publication permissions.

The fresh frozen-tree pack above supersedes the earlier stale pack, which
predated authentication/completion work. The package remains untracked
with no task-owned commits. Local HEAD was independently read as `00bfb5931`;
Mendel reports remote main independently advanced to `3c5ed05b6`. These are
different delivery states, not a completed push. No rebase, stash, push, or other
delivery action is authorized before the release gates; this audit performs none.

### Current concrete binding API and verification boundary

Approved and now visible: `OpCommandOptions.approvalMode?: "resolved" | "literal"`,
`authorizeResolution?: OpCommandOptions["approve"]`, and
`approveResolved?: (approval: OpResolvedApproval, context) => boolean | Promise<boolean>`.
Resolved is the default for `ask`, not a conversion of direct `allow` into
resolved approval. Missing discovery/final callbacks, backend capabilities, or
handler preparation fail closed; no implicit literal fallback exists.
Denial precedes stdin/file acquisition and backend preparation. Missing resolved
capabilities or a denied resolution grant also precede input acquisition; an
omitted authorizer still means direct allow, not default denial. Trusted Node
module loading is bootstrap outside this command-effect gate.

`OpBackend` adds optional `prepareBinding`, `validateBinding`, `cancelBinding`;
resolved routing requires all three. `OpObjectBackend` implements them.
`OpBackendContext.binding` carries `OpBindingHandle` privately.
`OpPreparedBinding` is `{ backendId, accountId, handle, targets, metadata }`, not
the earlier proposal shorthand `{ handle, targets }`. Target fields are
`requestIndex`, `resource`, `kind`, `revision`, optional `id`, `account`,
`parentId`; kinds are object/collection/field/section. Request-aligned metadata
can carry environment names/unsets/scope/dependency completeness.

`OpResolvedApproval` exposes operation/backend/account/targets, option names,
mutation names and optional batch size, output kind/destination, and optional
child executable/redacted argv/environment names. The handle and raw values
are excluded. `authorize` and `authorizeResolution` still receive sensitive
literal arguments/flags, before input acquisition; they are not the sanitized
final manifest. No approval-mode environment variable or native flag is added.

`NodeHostDependencies` accepts the policy callbacks and approval mode; configured
modules may export `authorize`, `approve`, `authorizeResolution`, and
`approveResolved`, with dependency callbacks taking precedence. Module exports
do not select `approvalMode`. The file adapter explicitly throws
`Resolved file backend approval requires persistent revision support` from
preparation. Direct/literal file-backed paths remain available but do not meet
resolved approval guarantees. Cross-process persistence proof is M, not supplied
by the in-memory backend's generation counter.

The bounded implementation validates before backend execution/local commit/host
handoff. Actual filesystem/process/network effects remain host-owned: no inode
pinning, executable-content identity or distributed transaction guarantee is
claimed. Coarse generation invalidation is an approved provisional extra-abort
policy. Unknown/dynamic dependency graphs and unsupported hook/handler paths
must report capability failure rather than silently execute unbound.

One independent Mendel review invocation returned a terminal policy error.
It did not complete, is not counted as passed, and is not restarted. Ptolemy's
ordinary functional review remains active: 28 integration tests and typecheck/lint
were followed by 33/33 independent scoped verification plus typecheck/lint,
closing A12–A14. This is separate from the declined review invocation.
The current 778/778 maintained run supersedes earlier checkpoints without waivers.
Identity/environment security cases remain resolved; literal mode is restricted
to explicit legacy-callback tests, while direct allow serves functionality tests.
The original public race regression now passes through installed SDK, Node CLI
and executable, alongside fresh packaging proof. This verifies the supported
cooperative object-binding gate, not the unavailable broader review, arbitrary
adapters, native parity or release.

Meaningful work remains while README permission is pending: unresolved A2–A5
and A10, unsupported binding capabilities, global/native-format models, complete
domain schemas, beta help discovery when
separately authorized, and bounded no-auth parser probes. No live sign-in or
credential access is authorized by this audit. After owners finish, replace
individual rows only with actual evidence, rerun the maintained checkpoint,
and separately verify packaging, delivery, and release when authorized.
