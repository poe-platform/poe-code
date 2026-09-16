# Font fill namespace correction

## Validated defect

A public presentation workflow adds textbox run text, bold and size, then edits
its fill. Structured run-property edits establish an inherited default namespace;
FillFormat authored only a prefixed fragment without the destination's default
binding. XML splice admission correctly rejected that incomplete namespace
context. Original cases for solid, background, gradient and patterned fill all
failed with `invalid-value` before the correction.

## Implementation and verification

Carry the escaped owner's default namespace into those four standalone fragments.
Do not weaken XML admission or change the shared splice contract. Original tests
use newly created bytes, require no host filesystem, and verify live fill type
and save/reopen. No upstream binary fixture or reference runtime is used.

Executed red: four failures in `font-fill-namespace.test.ts`'s four scenarios
(before extraction from the original workflow suite). Executed green:
`npx vitest run packages/pptx/src/font-fill-namespace.test.ts` (4 cases passed).
The independent workflow suite additionally passed 11 cases. Root runs maintained
package checks after concurrent scoped work settles and commits only owned hunks.

## Agent QA

Create a fresh deck with a textbox; add a run, apply bold/size, and invoke each
fill mode. Save and reopen; verify unchanged text/font settings and expected fill
type. Repeat broader drawing tests for fill modes under ordinary and inherited
namespace contexts. This is a structural XML correction with no CLI visual change.
