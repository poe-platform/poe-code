# Joint iteration gap

Built isolated candidate probe 5dd944 returned `["undefined","undefined"]`
for `[typeof Iterator.zip, typeof Iterator.zipKeyed]`. A bounded search of
SafeJS source, tests and plans found no corresponding implementation. The
probe used the already-built prototype candidate without changing its inputs.

Both methods appear in the current
[ECMAScript 2027 draft](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.zip).
Record this separately from published-2026 compatibility, without dropping it
from the broader JavaScript-completeness objective.

Required semantic coverage includes shortest, longest and strict modes;
ordered option access; iterator acquisition; padding; early closure and error
precedence; lazy advancement; and helper return behavior. Keyed results require
null prototypes, enumerable own string/symbol keys, and omission of undefined
input values. Primitive inputs must follow the specified rejection rules.

Implementation also needs guest-call dispatch, retained-state accounting,
budget enforcement, originating realm identities and snapshot/replay support.
Use existing iterator infrastructure where its semantics fit; do not substitute
eager arrays or a host-native-only adapter. Before runtime changes, establish
failing regressions with independent expected values and observable call traces.
Native availability alone is not the oracle for a recently finished proposal.

This is a validated missing capability, not an implementation or conformance
claim. The ongoing full-suite candidate remains unchanged.
