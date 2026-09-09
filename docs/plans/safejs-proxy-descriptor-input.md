# Proxy inputs to property descriptor conversion

On e03e5bbc8, the native-comparison selection produced nine failures and one
passing control (79450). Descriptor conversion skipped Proxy HasProperty and
therefore skipped field reads, inherited fields, abrupt completions, virtual
accessors and conflicting virtual fields.

Use the shared HasProperty operation for each descriptor field before reading
it. Await only asynchronous presence results, preserving the synchronous prefix
of ordinary checks. Retain the existing enumerable/configurable/value/writable/
get/set order, accessor validation and retention. Guest Get dispatch already
handles Proxy reads and original receiver forwarding.

Tests cover Object.defineProperty, Reflect.defineProperty, Object.defineProperties,
Object.create, inherited descriptor fields and Proxy descriptor trap results.
Expected values and complete has/get event sequences are computed with native
Proxy execution before guest assertions.

Reference: [ECMA-262 ToPropertyDescriptor](https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-topropertydescriptor).

The focused descriptor, Reflect and accessor selection (92045) completed with
306 passing tests across five files, followed by successful TypeScript and lint.
This change does not implement Proxy definition targets,
enumeration, snapshots or public Proxy construction. Publication remains paused.
