# Published-edition exclusions — 2026-09-13

Nine previously unresolved variants target semantics outside ECMA-262 edition 16.
Their raw upstream results remain failed. They are exclusions, never passes or repairs.

Seven function-call assignment-target variants expect the newer optional Runtime Errors
for Function Call Assignment Targets semantics. The published edition's section 8.6.4
returns invalid for those CallExpression forms. Its HTML does not contain the newer esid.
The recorded primary source was independently rehashed against its earlier receipt:
6a28f9423133ed7b7c59a40baf620c2740f12f0bc9c251042f2a85b9cc5ed713. Exact clause text,
fixture metadata and earlier outcomes are in call-assignment-targets.json. Built sloppy
Script parser controls reject all seven forms with SyntaxError as the edition requires.
No runtime-error compatibility extension was added to the target.

Two private-field cases carry nonextensible-applies-to-private, a historical proposal.
Published PrivateFieldAdd does not forbid additions to non-extensible ordinary objects;
HostEnsureCanAddPrivateElement applies only to browser host-defined exotic objects and
must allow ordinary objects. The exact primary clauses and fixture metadata are saved.
Native and built SafeJS ordinary-object controls both return 7. The implementation files
classes.ts/private-state.ts are unchanged since the integrated 884ead8b7 report; their
recorded original failed outcomes remain evidence, not a passing claim for these fixtures.

Every original fixture hash was independently checked against the clean pinned Test262
checkout 419d3e0a2273ba01a3bfcbec423f2801425b8e93. All nine match. Commands, Node22.23.2 /
ICU78.2, source SHA and results are retained in the JSON control receipts. No production
source, limits, assertions, timeout, host authority or compatibility target changed.

The 38 decorators-proposal rows retain their existing outside-edition status, and the
[two legacy caller fixtures](../caller-disposition.md) retain their already-verified
extension/oracle disposition. The 20 explicit-resource-management rows remain required
under the separately pinned extension; they are not excluded by this edition audit.
