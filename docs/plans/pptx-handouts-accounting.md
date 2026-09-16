# Handout inventory accounting and bounded QA

Scope: F49 inventory/preservation and explicitly scoped supported master text. The
whole implementation pipeline, README updates, publication and rendering are excluded.
The accounting worker owns only this plan and new `docs/pptx/handouts-*` documents.
Domain and command workers own original memfs regression cases and implementation.

## Evidence procedure

1. Read root/scoped instructions, the pptx and shared Office contracts, both pinned
   upstream audits/inventories, existing notes/master/settings receipts and the
   disposable corpus manifest. Keep individual parameter variants and expanded BDD
   rows; do not mark adjacent live-model obligations implemented from byte operations.
2. Inspect only manifest-owned cached inputs; verify SHA-256 before use. Read bounded
   ZIP/XML entries independently to identify real handout, notes-size and print/view
   structures. Do not download, alter, redistribute or stage input bytes.
3. After domain changes and maintained build, admit the selected document bytes to
   the public SDK and inspect through the command engine with memfs capabilities.
   Compare returned resource identities/dimensions/attributes to independent ZIP/XML
   values. Reads must retain byte identity and must not create absent resources.
4. Make a supported slide-only edit in memory. Independently compare the handout
   part, its relationships/resources and print/view parts before/after. Confirm
   notes size remains unchanged. For explicitly scoped handout text, use a small
   original regression fixture so publisher content never enters permanent tests.
5. Reduce any mismatch into a small original memfs regression and rerun focused
   checks. Record actual outcomes separately from planned assertions. Inspect
   terminal help/error screenshots through the maintained route; no screenshot tests.

## Executed independent fixture census

On 2026-09-13, read-only Python standard-library ZIP/XML inspection covered the nine
manifest documents at most 15,000,000 bytes. All nine cached SHA-256 values matched
`docs/pptx/corpus-manifest.json`. No bytes changed and no downloads ran.

Eight lacked handout masters. `.cache/pptx-corpus/global-outlook-2026.pptx` contains
`ppt/handoutMasters/handoutMaster1.xml`, referenced by presentation `rId20`; its
notes size is 7,315,200 by 9,601,200 EMU. All nine selected documents contain notes
size and view properties. None contained a print `prnPr` element, so print
properties require original fixture coverage; absence is not a print test pass.

The fixture census is independent format evidence, not product execution or a
pagination/rendering claim. The later product execution receipt below is separate from this independent
census.

## Executed public SDK and command QA

After the maintained selected workspace build, the admitted cached document was
read with built public `readSelectionIndex` and `readPresentationSettings` exports.
Independent expected handout identity and both notes dimensions matched; print
properties were null and view properties identified `/ppt/viewProps.xml`.

The built command engine ran `inspect --json` and `settings get --json` against
memfs bytes, both exit 0 with successful envelopes. Neither read published output;
input bytes remained equal. This is command-engine evidence, with actual Shell
adapter tests owned by the command worker.

A public SDK rename of slide position 1 changed exactly `ppt/slides/slide1.xml`.
An independent central-directory ZIP reader using Node's raw inflater compared
all payloads: all 141 entry names matched; all other 140 payloads were byte equal.
That includes the entire handout dependency closure, property parts and
presentation XML holding notes size. A second settings read matched the first.
The mutation output stayed in memory and no fixture or QA output was written.
No meaningful product finding arose; no invented regression was added.
