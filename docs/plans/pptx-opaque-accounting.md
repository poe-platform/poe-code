# Opaque object accounting and disposable QA

Scope: F53 inventory/extraction/preservation, F54 font parts, active payload observations and unsupported import references. The domain owner edits `packages/pptx`; the adapter owner edits its safe-bash command area. This accounting owner edits only the four opaque research/usage receipts and this plan. No README changes, push, release, downloaded fixture commits or whole-pipeline execution.

## Accounting procedure and result

Read root AGENTS.md, the PPTX specification, shared office CLI/SDK contracts, both pinned audits and both inventories. Resolve source variants through `test-case-map.json` and public declarations through `public-api-map.json`. Retain source identities only in research. Do not edit existing untracked audit files.

The focused ledger records 60 unit variants and eight expanded BDD scenarios. Selection includes every `DescribeProgId` variant (including the integer and string nonmembers), all embedded-package factory cases, all OLE object creator cases, returned-format cases, graphic-frame type/has-chart/has-table cases with OLE content, and the three creation BDD examples. The API ledger records 25 direct and inherited obligations including all `_OleFormat` members and all `PROG_ID` records. No model row is claimed complete merely because byte extraction exists.

## Disposable QA procedure

1. Select the existing manifested `.cache/pptx-corpus/20120418_Jedlovec_SuomiNPP.pptx`; admit bytes through an explicit QA host read and compare its SHA-256 to the manifest before product execution.
2. Call the original TypeScript `readObjects` and `extractObject` APIs with explicit 32 MiB input/member limits, 64 MiB expanded ceiling, 1,000 members, and bounded XML/relationship limits.
3. Independently stream each selected ZIP member with `/usr/bin/unzip -p`; compare all bytes and a Node crypto SHA-256 to the SDK result. Do not interpret the embedded compound containers, activate objects or follow external targets.
4. Keep output in memory. Preserve the existing cache; write no QA script or binary fixture. Reduce any meaningful failure into an original memfs regression before repair.

## Executed QA receipt

2026-09-13: the procedure passed using the on-disk TypeScript domain API, in about 3.8 seconds including process startup. Input SHA-256 `884611296fe0c5f36b2e4e3abf0ae7b16124879434834c45dadb457bdf8d9a01` matched the manifest.

| Part | Bytes | Independent SHA-256 |
| --- | ---: | --- |
| `/ppt/embeddings/oleObject1.bin` | 1107456 | `ce3d706753bab92be61f03c613026e14e5e95d60cbb16fa26482e7eb0b7a1489` |
| `/ppt/embeddings/oleObject2.bin` | 896000 | `a7e9ce015cce02dcd9ac437b89d09423ecbc4dd562857cfef15577997227f1d7` |

Both returned `kind: ole`, active reasons `compound-container` and `potentially-active-ole`, zero outgoing dependencies, and exact independent ZIP bytes. Inventory returned `activationPerformed: false` and `recursiveParsingPerformed: false`. No meaningful failure arose. This receipt proves these two opaque extractions; it does not prove editing, activation safety of the payload itself, live object parity, rendering or coverage of all corpus content.

Maintained checks and local commits are recorded by the coordinating owner after all owned code is integrated. No push or release is authorized.
