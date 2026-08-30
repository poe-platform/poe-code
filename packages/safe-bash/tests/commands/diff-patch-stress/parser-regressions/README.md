# Independent normal/context parser regressions

Owned leaf scope: only this directory. Product sources, existing tests and benchmarks
are read-only. This is a bounded adversarial supplement, not a repeat of the existing
128-pair format corpus or evidence of utility-wide compatibility/superiority.

## Reproduce

```sh
node tests/commands/diff-patch-stress/parser-regressions/run.mjs
```

The runner preserves timestamped raw TAP, per-case product/native results and
before/after SHA-256 snapshots. It runs only these tests and their strict TypeScript
dependency closure. A changed source snapshot invalidates a single-version claim.
Every failure remains an assertion failure; no skip, TODO or known-failure exemption.
Normal patches use the explicit absolute VFS target `/work/target`.

The suite contains 76 product cases (54 handcrafted grammar cases, eight bounded
deterministic invalid-prefix mutations, 14 budget/cancellation probes), plus four
version-specific GNU diff-to-patch controls. Valid expected bytes are handcrafted,
never inferred from product roundtrips. Native observations accompany all 62 grammar
and mutation cases. GNU's permissive handling of malformed input is recorded, not
automatically adopted as the product's strict acceptance policy. For invalid input,
both original bytes and a filesystem mutation log are checked: a write followed by
rollback is not a successful preflight rejection. The untouched second target and
stdout are checked as well. Cancellation includes input and parser-checkpoint aborts.

The eight mutations use a fixed LCG seed `0x73a5c91d`, alternate normal/context seeds,
and replace a required body prefix with a non-grammar prefix or NUL. They do not
mistake arbitrary semantically valid mutations for malformed inputs.

## Independent references

- GNU Diffutils 3.12 manual, section 2.4.2, Detailed Normal: original-file coordinates,
  `a/c/d` ranges and body prefixes.
- GNU Diffutils 3.12 manual, section 2.2.1.3, Detailed Context: empty-side coordinates,
  corresponding changed groups, omitted old/new bodies for pure insertion/deletion.
- GNU Diffutils 3.12 manual, section 3, Incomplete Lines: newline marker semantics.
- GNU Diffutils 3.12 manual, sections 5.2 and 10.3: suppressed blank-empty prefixes
  and context CRLF transport are accepted GNU extensions, not malformed input.

References consulted via web.run on 2026-08-26:
`https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Normal.html`
`https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Context.html`
`https://www.gnu.org/software/diffutils/manual/html_node/Incomplete-Lines.html`
`https://www.gnu.org/software/diffutils/manual/diffutils.html`

Native executables are the user-specified GNU patch 2.8 and GNU diffutils 3.12 builds
under `/tmp/safe-bash-gnu-oracle.Yg2F0W/`. Each run requires their precise version
banners and records binary hashes. No system-native fallback is allowed. Literal
argv, `shell: false`, fixed safe filenames, a fresh directory under this owned scope,
three-second subprocess timeouts, 256-KiB output caps and a fixed C locale isolate
the oracle. No host process/evaluation is added to the product.

## Findings

Initial capture `evidence-2026-08-26T20-51-07-530Z` records **78 tests: 67 pass,
11 fail, zero skipped/TODO/cancelled**. Owned strict TypeScript passes. All captured
dependency hashes match before/after. Nearby HEAD was
`41a26006d97894d068f59b594fb6639e554d0a55`; parser SHA-256 was
`ef67097df66662e6b0ed74d707e2c75332b434464e7aafb9bd0164be40c37c6c`.
The JSON contains exact repros and all dependency hashes, not only the parser hash.

**Root-routed product findings: seven failing product cases, three categories.**

1. Suppressed blank-empty bodies: normal `1c1\n< old\n---\n>\n` and context
   `*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n!\n`
   should replace `old\n` with `\n`; both reject `malformed patch body prefix`.
   GNU diff 3.12 emits these exact patches with `--suppress-blank-empty`. GNU patch
   2.8 accepts context but also rejects normal; the normal finding is independently
   specified/generated, not falsely called a live-native pass.
2. CRLF transport: replace every LF of
   `*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n`
   with CRLF. On LF source `old\n`, GNU patch strips transport CRs and writes
   `new\n`; product rejects `malformed context hunk separator`. Distinct tests
   verify that CRLF *file data* inside an LF-structured patch remains CRLF.
3. Mixed-format sections: four valid sequences (normal/context, context/unified,
   unified/normal, context/normal/unified) reject at the second format boundary.
   Each has GNU 2.8 exit 0 and exact expected final bytes. Minimal first pair:
   `1c1\n< old\n---\n> new\n*** target\n--- target\n***************\n*** 1 ****\n! new\n--- 1 ----\n! final\n`
   should change `old\n` to `final\n`; product rejects `malformed normal patch command`.

**No silent replacement/truncation or attempted preflight write was observed.**
All 32 malformed/mutation cases and all 14 budget/cancellation probes pass; valid
empty-file insertion/deletion, omitted context halves, incomplete lines, literal
patch-looking data and ordinary CRLF data also pass. These are bounded observations,
not claims that cancellation can undo host side effects or guarantee atomic commits.

**Version-specific native controls remain explicit failures.** Of 28 valid
handcrafted native patch controls, 26 pass and two fail: autodetection of a normal
tab-prefixed body, and normal suppressed blank-empty body. Of four independent GNU
diff-to-patch controls, two pass and two fail: normal suppressed blank-empty and
zero-context middle deletion. The latter emits
`*** target\n--- target\n***************\n*** 2 ****\n- removed\n--- 1 ----\n`
for `left\nremoved\nright\n` to `left\nright\n`, but GNU patch 2.8 rejects it.
One additional native probe, `9007199254740993a1\n> new\n`, reaches the three-second
timeout in GNU patch 2.8 and is killed. The initial raw TAP preserves that failure;
its original JSON has 77 records because the oracle exception escaped before record
insertion. The harness now records native exceptions without hiding the independent
product result. Thus five failing native gates overlap one product failure, yielding
11 failing test cases rather than eleven product bugs. Of 32 invalid native probes,
31 completed and one timed out; completed results are descriptive, not acceptance
gates. GNU may skip malformed trailing material. Missing oracle results/timeouts are
failures, never passes or skipped tests.

Binary SHA-256 identities:
- GNU patch 2.8: `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`
- GNU diffutils 3.12: `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`

No product changes are owned or made by this verifier. The source author remains
active; follow-up captures must remain separate from this initial evidence.

## Final captured evidence

Final run `evidence-2026-08-26T20-54-00-971Z`: **80 tests, 69 pass, 11 fail,
zero skipped/TODO/cancelled**, 3.878 seconds; strict scoped TypeScript passes.
All 80 records are present. The runner exits 1, preserving every failure. Two
same-format late-truncation cases were added after the initial 78-case capture;
both pass without attempted writes. No expectation was weakened to obtain a pass.

| Independent gate | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| Product valid handcrafted grammar | 21 | 7 | 28 |
| Product malformed grammar plus deterministic mutations | 34 | 0 | 34 |
| Product budgets plus cancellation | 14 | 0 | 14 |
| **Product results, independent of native gates** | **69** | **7** | **76** |
| GNU patch valid handcrafted controls | 26 | 2 | 28 |
| GNU diff-to-patch controls | 2 | 2 | 4 |
| Invalid-native execution completion (not semantic acceptance) | 33 | 1 timeout | 34 |

There are **66 native patch invocations** (65 completed, one killed at three
seconds) and **five GNU diff invocations**, excluding two version-banner queries.
The extra diff invocation independently reproduces the normal tab-prefix golden
with `--normal --initial-tab`; GNU patch 2.8 autodetection rejects that valid
GNU diff 3.12 output. Native failures are four behavior categories represented by
five gates: tab-prefix autodetection, suppressed normal blank-empty data (two gates),
zero-context middle deletion, and huge-coordinate timeout. The separate native
gates must not be added to or confused with the seven product failures.

Final nearby HEAD: `07da9990c67d6578662b9911b9bd88964a58a96c`. All product dependency
hashes stayed identical across the three captures and within each before/after
snapshot even though concurrent commits moved HEAD. Full hashes are in each
`*-validation.json`; key parser dependencies are:

| File under `src/commands/diff-patch/` | SHA-256 |
| --- | --- |
| `patch-formats.ts` | `ef67097df66662e6b0ed74d707e2c75332b434464e7aafb9bd0164be40c37c6c` |
| `patch.ts` | `be1596cbafcb0cc0e6bf3d7d1a9b1b36871560a9d669097e823e8d7203c708ff` |
| `unified.ts` | `4c3bf3040184cc9566a8853796019b00abcb62388d11746a9e370fda18c9fd2c` |
| `patch-envelope.ts` | `64e853a01bacdf15c8fb32cee7073bff5d3ee6015d98a09bb7268cc12657250c` |
| `patch-path.ts` | `053f471db60b5a2878144451a821f8590415a85535cb86e5d9ee0367e257ef94` |

The intermediate `evidence-2026-08-26T20-53-08-818Z` is the corrected 78-record
capture, before the final two same-format probes and tab-generation corroboration.
Original evidence is retained, including the first recorder's missing timeout
record, rather than silently overwritten. No benchmark, full-repository validation,
source modification, format-policy change or further delegation was performed.
The staged whitespace check reports only indentation-only lines in verbatim Node
TAP failure diagnostics; those raw logs are preserved byte-for-byte. The check
passes for the source, documentation, configuration and JSON evidence files.
