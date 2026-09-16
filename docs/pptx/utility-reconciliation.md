# PPTX utility reconciliation evidence

This receipt reconciles package, OPC, URI, serialization, image-codec and generic
XML behavior against the pinned research inventories. It supplements historical
ledgers; baseline labels in those ledgers are not current implementation claims.
Domain-specific chart/table/shape XML remains with its respective feature ledger.
The source identities and mappings belong here in research, never in product
names, comments, test names or fixtures.

The governing contracts are [pptx](../specs/pptx.md), [office CLI](../specs/office-cli.md)
and [office SDK](../specs/office-sdk.md). Public neutral spellings, inherited
members and returned interfaces remain required; private descriptor machinery is
mapped to observable owner, value, byte and validation behavior. Undocumented
factory mocks do not require a new public factory API. Whole-public-API coverage
is distinct from utility-case coverage.

## Case accounting

| Family receipt                                              | Presentation unit rows | Shared unit rows | BDD rows |
| ----------------------------------------------------------- | ---------------------: | ---------------: | -------: |
| [OPC/package/URI/serializer](opc-utility-reconciliation.md) |                    178 |              169 |        9 |
| [XML utilities](xml-utility-reconciliation.md)              |                    106 |               84 |        0 |
| [Image codecs](image-codec-reconciliation.md)               |                     32 |              138 |       16 |

The union contains 731 distinct source identities: 316 presentation utility unit
variants, all 391 shared-package unit rows, and 24 BDD scenarios/examples. The
732 ledger entries intentionally share one BDD identity: imported `image/jpg`
package binding and public image access are complementary obligations. This
scenario is counted once in the union. Root checked exact unit identity-set
equality against the master ledger and verified referenced test paths and names.

Every selected row has a reasoned observable mapping or explicit validation,
security, language or preservation difference. This does not mean literal runtime
parity. In particular, two EMF insertion scenarios remain rejected under the
current format boundary, allocation uses safe deterministic free names, no-op
serialization sorts entries, and private factory/descriptor topology maps to
bounded owner/value/byte operations. No inherited public member is excluded by
its spelling. Exact Image and CoreProperties member mappings remain in the family
receipts, with shared owner views governed by the existing public-view contracts.

## Independent corpus observation

The first [manifest](corpus-manifest.json) fixture matched SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
The built public presentation factory read five slides and 23 ordinary parts.
Part-owned relationships numbered 30, with four additional package-root
relationships and zero external targets, matching the manifest census of 34.
The explicit QA profile used 16 MiB input/archive, 8 MiB member, 32 MiB expanded,
4,096 members, and the model default XML/relationship limits. No fixture or output was written.

A no-edit save retained all 38 member identities and every decoded member byte.
Both archives were 1,202,514 bytes. ZIP entry ordering changed because the writer
sorts entries deterministically. This is an explicit divergence from the spec's
SHOULD preference for original archive bytes on no-op saves, not loss of part
content or a claim of byte-identical archives. The MUST requirement for unchanged
part bytes passed. This is structural preservation QA, not visual fidelity.

## Verification boundary

The starting maintained package unit route passed 6,347 tests in 242 files.
Final `npm run test:unit --workspace=pptx` passed **6,654 tests in 250 files**:
307 new original tests across eight files. `npm run lint --workspace=pptx` and
`npm run build:workspaces -- --workspace=pptx` passed. Five focused actual
safe-bash package-safety/image-density tests passed against the final build.
Owned-file formatting and Git whitespace checks passed. The measured-coordinate
command screenshot was inspected; no new screenshot test was added.

TDD and review established two implementation corrections: typed XML scalar
reading (including XML whitespace, strict rotations and integer-only extents),
and safe public image access for the known imported JPEG MIME alias. Alias
normalization affects only the returned Image value; original declarations and
bytes stay intact, contradictory types still fail, and CLI extraction retains
its documented safe `.bin` name for that noncanonical declaration.

Historical broad pending statuses remain baseline snapshots. The three linked
family ledgers supply current, per-identity evidence and explicit differences. No overarching pipeline, push, release, README update, product network or
native document runtime is part of this task. Required standalone notices remain
in the package and research directory. Procedures and ownership are in the
[task plan](../plans/pptx-utility-reconciliation.md).
