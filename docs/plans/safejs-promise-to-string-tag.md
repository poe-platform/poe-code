# Promise toStringTag

The symbol-key descriptor audit found Promise.prototype lacks Symbol.toStringTag.
Five of seven native-comparison tests failed before editing: property value,
descriptor flags, prototype branding, deletion behavior and inherited branding.
String/non-string replacement controls already passed. A synthetic Promise
fallback in Object.prototype.toString masked the missing property for ordinary
instances, but incorrectly survived deletion.

Install the non-writable, non-enumerable, configurable Promise tag and remove
only the synthetic Promise fallback. Check native descriptor and inheritance
cases, deletion/replacement snapshot recovery, Promise history and accounting,
TypeScript and lint. Other brands and old fixtures remain unchanged. This is
outside the running frozen full candidate and is not a release claim.

Validation: 49 tag/snapshot/v6/v7-history cases and 53 data-budget/prototype/
own-property cases pass (102 tests across eight files). TypeScript passes.
Focused lint passes before the isolated local commit. The previously
started full candidate stays unchanged and cannot validate this later repair.
