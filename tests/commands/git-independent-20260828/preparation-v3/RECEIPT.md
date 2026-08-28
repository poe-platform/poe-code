# Preparation receipt — Friday, 2026-08-28

**PREPARED / HOLD; bounded preparation complete, real verification not begun.**

## Artifact and timing identity

- Pre-execution artifact commit: `4dadc2a0a33bee1ce1d2daea99678e2a8a6ffa1a`.
- PRESEAL raw SHA256:
  `b9abb288b3b83c7edb230c48001a1e71e3062e04f707126f018be990d30d2f46`.
- Thirteen preparation input-file records, closure SHA256:
  `e4c1da789e633f4b244b1e41ff9a372ab73bf8def0482bbb54827a45d654a317`.
- Immutable-data capture: 2026-08-28T17:17:28.240Z. Preseal:
  2026-08-28T17:29:48.879Z. Checks followed the preseal commit; receipt metadata
  observed at 2026-08-28T17:30:59Z. These are actual timestamps, not a 72-hour claim.
- Timing is post-design/post-ratification and pre-candidate-implementation
  inspection. No Curie candidate implementation inspected, including git-show.

## Per-attempt results, separated from real acceptance

| Check | Actual result | Preserved evidence |
| --- | --- | --- |
| Syntax only | 9/9 exit0 | `syntax-01.stdout.txt`, empty `syntax-01.stderr.txt` |
| Data/mock positive controls | 2/2 | S01/S02 in `synthetic-01.stdout.json` |
| Negative binding/observation controls | 18/18 | N01–N18 in same receipt |
| Synthetic process | exit0, stderr empty | `synthetic-01.status.txt`, `synthetic-01.stderr.txt` |
| Native Git reference workflows | **0 executed / six UNRUN** | A01–A06 remain predictions |
| Actual source/module/installed/moved/type | **UNRUN** | no candidate packet/GO |
| Build/pack/compiler/H11 children/current gate | **0** | no execution grant |

Nine syntax checks used the explicit existing development executable
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`; this is a path observation,
not a fresh version/binary hash qualification or the historically bound native
Node. The synthetic script imported only new preparation modules/builtins and
read sealed owned data. No VM candidate code was compiled/linked/evaluated.
The successful fake namespace is deliberately a literal-output mock, not Git.
N01/N03/N18 prove refusal before mock import/dispatch; N12 enters only an inert
injected loader. No synthetic ROOT-shaped memory object is a real authorization.

| Raw evidence | SHA256 |
| --- | --- |
| syntax stdout | `0fda09a4259e42d56db0fa254667a1b2794a7018cfa62324f941e40f10c77b58` |
| synthetic stdout | `f8da84bc7410858fb11d7c5e671d776a825129db6f9b0d7514de3e77bb7a583f` |
| synthetic status | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| either empty stderr | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

All twenty controls ran once. No review harness failure or retry occurred.
The initial unavailable bare `cat` metadata command and subsequent `/bin/cat`
instruction read remain disclosed in README; neither was an oracle invocation.

## Concrete handoff

The exact six-row argv/cwd/status/stdout/stderr/effect observation table is in
README, with machine-readable original argv and base64 in `records.json.workflows`.
`nativeRecipe` builds the separately disclosed common config/security argv/env;
it does not silently call a seventh/version workflow. `records.json.files` binds
all eighteen regular stage files, each mode/length/SHA256/base64. Fixture/index/
full relative tree hashes are in README and verified as inert data in S01.

`module-adapter` contains real direct-host byte/FS assertions; `package-adapter`
prepares exact installed/moved resolver consumers; `type-adapter` prepares the
strict noEmit consumer; `native-adapter` contains exclusive staging and full
append-aware before/after comparisons. No adapters were tried against live product.
The frozen matrix stays 60 M1A/12 M1B, all historically unrun; partial A52/A58/A60
obligations mapped here are not newly scored rows or all-matrix implementation.

**Still required from ROOT before candidate work:** exact frozen candidate/hash,
proposed module API reconciliation, source/emitted/package/declaration files,
relative imports and builtin/Node/compiler/tool closures, authenticated build and
installed/moved resolution receipts, then distinct fresh source/installed/moved/
type authorization for the exact packet and preseal. Public exports are not
invented or assumed present. There is no valid candidate/GO template or live alias.

**Still required before native work:** distinct fresh native-six GO, exact version
and fresh tool bindings, finite bridge source/function/import hashes, root-specific
read/exec/network-denial fence, own-data role dispatch and collector qualification.
The historical tool record short reference resolves to
`97c081ec7c7f180889d3640c29d1cd5fd1b10752`. Exact Git/core/otool/Node/ps routes and
H11 source/proof scopes are in NATIVE-RECIPE. They are historical, not fresh passes.
The existing write-only instruction fence is explicitly insufficient. No new
generic supervisor, native inspector, actual H11 child or library closure probe.

## Ownership and limits

All edits/outputs are inside preparation-v3. The preseal commit used explicit
individual paths with `git commit --only`, hooks disabled, signing disabled.
Foreign index stage-entry serialization SHA256 before and after that commit was
identical: `3693cff736ddb59c6af2099b209afa0427bbb2d7007681f2c19f0e9e0e79bb74`.
This measures foreign index entries for that operation, not unchanged raw index
bytes (owned entries necessarily change) or an absence of concurrent worker edits.

No instructions copied; no runtime dependencies installed; no author/product/
package/config/root-export/default integration writes; no other fixtures/private
or foreign repository content opened. Development-repository Git usage was
metadata and owned commits only, never an oracle. No native fixture materialized,
no native temporary root created, no active worker/subagent/session retained.
Owned evidence is preserved, not temporary debris. No full Git parity, gate,
deployed backend, hostile-host sandbox, universal process/fd cleanup, or superiority
claim follows from these preparation checks. Stop after this bounded handoff.
