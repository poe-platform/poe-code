# Independent M1B Format Review Specification

Status: Proposed review conclusions — ROOT decisions pending

Implemented Through: Not applicable

Purpose: Identify finite format/compatibility obligations and actionable design gaps without implementing or executing Git products.

## Normative Language

MUST and MUST NOT describe this review's evidence and classification requirements, not new product policy. MAY identifies permitted future evidence only after separate authorization. Proposed author requirements remain proposals until ROOT resolves them.

## Problem Statement

Author packet `63d811bf1a809b467f47f309f41b1445486e71db` proposes M1B pack-backed reads. Its thirteen packs,106 reconstructed entries and18 rejections are same-author DATA evidence, not product or native proof. This review independently inspects primary official format/source facts and the exact frozen author inputs. It does not re-score or replay that cohort.

## Goals and Non-Goals

The reviewer MUST preserve B01–B12, the six unchanged workflow mappings, all24 literal limits, metadata-v1 failure and corrected-v2 authority. It MUST separate malformed representations, valid format outside project limits, pinned-reader compatibility restrictions, and pending ROOT policy. It MUST NOT choose D1, alter D2/D3, implement product code, audit M1A correctness, or resume paused YQ work.

## Sources and Authority

`AUTHOR-INPUTS.json` binds25 exact Git inputs. Only M1A's fixed-limit declaration is inspected as a necessary seam; the remaining M1A implementation is outside this review. `OFFICIAL-SOURCES.json` binds eight official pages/source bodies by URL, fetched bytes and SHA256. Current documentation is observed on2026-08-28; tagged Git2.54.0 source is a read-only compatibility reference, not an installed native-version claim. No third-party implementation or copied Git source is introduced.

`FORMAT-FACTS.json` contains concise source-backed rules. `CASE-COVERAGE.json` is a finite future case definition, not executable tests or a passing denominator. Byte fragments are minimal discriminants; where full packs/checksum resealing are needed, the rows say so explicitly rather than pretending these fragments alone are authenticated whole packs.

## Findings and Required Decisions

### F01: short delta-program compatibility

The author's delta requirements and checker loop do not impose a four-byte program minimum. With base byte41 and program0100, both size headers decode, no instruction runs, and the stated algorithm yields an empty result. Official `patch_delta` first rejects program lengths below `DELTA_SIZE_MIN`; the pinned `delta.h` value is4. This is a concrete source-level reader-compatibility gap, not an observed product defect or a claim that the prose manual universally bans every empty-result delta.

Before implementing this branch, the author/ROOT MUST explicitly classify programs of lengths0–3 against the intended compatibility reference and preserve a short-header control. Recommended narrow correction: match the pinned reader's minimum program-size rejection, while retaining valid empty direct bodies and separating zero reconstructed length from opcode0. No resource limit changes are needed. The counterexample81008000 expresses the same base/result sizes with four encoded header bytes; the inspected patch path passes its minimum-length condition. This review does not claim whole-pack or native acceptance of that encoding, and does not invent a canonical-varint restriction.

### F02: all-indirect idx2 extent compatibility

Author SPEC Pack/Index rules2/4 and checker lines39–42 allow an8-byte large-offset slot for every indexed object. Official `load_idx` bounds nonempty idx2 extent at `1072+28*N+8*(N-1)` for SHA1. Thus N1/L1 is1108 bytes, beyond its1100-byte maximum, even when the decoded offset is12. This does not invalidate author P11, which has N2/L1. The official writer's small-offset anomaly/threshold paths also show why a blanket ban on small indirect offsets would be wrong.

Before implementing this boundary, the author/ROOT MUST choose and document either the pinned reader-compatible extent or an explicitly broader format-profile interpretation, with the corresponding future control. This review does not label all such encodings universally malformed. Existing slot-bijection restrictions remain proposed project policy, not a newly discovered Git-format mandate.

### D1: eager versus selected verification

`CASE-COVERAGE.json` freezes separate pending outcomes for unselected bad delta payloads, checksum-correct mismatched object IDs, and loose-shadowed corruption. Eager admission entails refusal before success; selected verification needs an exact declared global-envelope/CRC and selected-closure boundary. The reviewer MUST NOT fill the latter branch with presumed PASS. Already observed corruption MUST NOT become success through fallback. ROOT's final D1 outcome belongs in the author contract before implementation.

## Verification Domains

Packed size, compressed span, reconstructed size and object hash domain are distinct. Index/OID ordering is not physical pack order. A complete check needs exact packed-record spans, local base graph/type/depth, framing consumption and object identity, not one checksum reused as proof of everything. `FORMAT-FACTS.json` records the independently reviewed details without introducing another product contract.

The fixed24 numeric values in `LIMITS.json` MUST remain byte-for-byte literal equivalents of the author values. Format-valid depth33, SHA256/idx1/thin packs and genuinely large offsets must be classified against the proposed profile rather than described as inherently malformed. Combined read/work/resident/cache/cleanup costs and D2/D3 belong to the resource reviewer.

## Static-Only Execution Boundary

This review deliberately runs **zero format probes, synthetic parser checks, author tools, zlib inflations, product commands, native Git/version/oracles, compilers or builds**. Source/data reads, hashes and metadata-only Git operations authenticate inputs; they are not format-execution evidence. `TOOL-BINDING.json` records the actual Node executable path/hash/metadata used for static authentication, without a version command.

No executable probe or execution recipe is shipped. This avoids duplicating a pack parser or spending implementation effort before F01/F02/D1 are resolved. Exact consumed-input framing, truncated streams, dictionaries, appended members and streaming lifecycle remain future proof. A later reviewer wishing to run even tiny DATA probes MUST first seal a finite source/tool/import/capture/cleanup recipe and obtain the applicable authorization. This packet itself grants no execution authority.

## Test and Validation Matrix

| Review obligation | Current evidence role | Remaining proof |
| --- | --- | --- |
| Official format and pinned source behavior | Eight primary-source content bindings; source-only reasoning | Native/product compatibility not executed |
| F01/F02 | Exact discriminating bytes, line references and arithmetic | Author/ROOT classification and future controlled acceptance/refusal |
| B01–B12 | Original rows preserved plus finite independent neighbors | All future product cases UNRUN |
| Six workflow mappings | Exact bound expected data unchanged | Six source/package/native workflows UNRUN |
| Fixed24 limits | Static literal comparison only | Combined resource semantics with resource peer |
| Prior metadata failure | Original empty binding and failure hashes retained | No replay/relabeling |
| Framing and consumption | Official source/API requirements only | Actual bounded codec/frame tests after preseal |

## Conformance Criteria

The review packet is complete when its sources, findings, case definitions, count roles, unresolved decisions and limitations are sealed under the owned path. That is design/data-review completion only. It is not implementation GO, acceptance of the author protocol, M1A approval, full Git compatibility, a pass rate, or proof that any product command executed.
