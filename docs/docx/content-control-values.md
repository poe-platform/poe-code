# Bounded content control utility

Task 63 is verified locally. These usage drafts describe the current utility
surface, not published availability or completed model/corpus parity.
The sole format contract remains [docx](../specs/docx.md); the procedure and
owned paths are in [the task plan](../plans/docx-content-control-values.md).

```bash
docx controls list form.docx --json
docx controls set form.docx --control 1 --text 'Harbor' --output filled.docx
docx controls set form.docx --control 2 --checked false --output filled.docx
docx controls set form.docx --control 3 --choice stored-value --output filled.docx
docx controls set form.docx --control 4 --date 2025-02-03 --output filled.docx
docx controls set form.docx --control 5 --file badge.png --output filled.docx
```

Exactly one typed value must match the selected kind. Text may be empty;
choice uses the declared stored value and displays its label. Dates use explicit
calendar days and bounded numeric Gregorian display formats. Picture filling
replaces one admitted existing occurrence with validated RGB/RGBA PNG bytes;
it does not insert arbitrary images. List emits typed values, lock/placeholder
state, properties, binding descriptors and picture relationship metadata.

Simple ordinals or emitted whole-owner tokens select controls. Multiple edits
require explicit all-selection within scope. Parent overwrites that would erase
nested controls, selected or ancestor locks, bound controls, affected opaque
content, fields and review history reject. Unselected controls and shared old
media must remain intact. No binding synchronization is implied.

The public utility functions are `inspectDocumentControls` and
`editDocumentControls`; their typed operation arguments match the command
schema. Embedded picture input uses a canonical base64 BinaryInput descriptor.
VFS picture input requires an explicitly matching `binaryResolver` capability,
whose `open(path, {signal, maxBytes})` supplies byte fragments. Command acquisition
uses only the injected command filesystem/stdin. There are no environment
variables, implicit host filesystem access or automatic network capabilities.

Pinned upstream test/API inventories contain no cases assigned specifically to
this utility task. Original additive F28 tests provide separate evidence;
historical inventories, model interfaces and F29 synchronization remain pending.
Downloaded corpus acquisition and independent reference execution remain
preparation and are not product control qualification.

Maintained uncached DOCX unit passed 83 files/2,007 tests, lint and the selected
build closure passed, and 11 portable export/existing engine tests passed.
Independent corrected-source review approved the bounded implementation;
88 focused tests and all 57 DOCX Shell tests passed with zero skips. Literal
integration registration passed 515 runner tests; this proves membership rather
than product behavior. Actual help/list/fill/dry-run/error and a VFS `.sh` binary
pipeline were executed. Both reviewer and root inspected the rendered terminal
capture; help wraps at 100 columns and output remains readable and unclipped.
This is terminal evidence, not Word rendering or downloaded corpus qualification.

Actual reds exposed exact checkbox admission mutation/attribute leakage,
unsupported metadata/type inventory, inherited XML context loss, formatting loss,
raw terminal tags, MCE cached-text/ancestor admission, delayed media collection,
trailing PNG stream bytes, unsupported DrawingML paths and global sibling-lock
refusal. Corrected original tests qualify those cases. The optional control-source
publication route compares unchanged locked owner/properties and namespace/XML/MC
context; default publication stays closed to locks. Package protection and
signature guards remain unconditional. Initial all-kind tests followed the
plain-engine red and scaffold; the reconstructed baseline is expressly
retrospective. Historical failed runs are preserved beside final passing evidence.
No README edits, downloaded input cleanup, push or release occurred.
