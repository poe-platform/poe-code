# For-in assignment targets: validated fix

The parser previously rejected `for(target[yield 1] in {a:1,b:2})` inside a
generator, reporting that for-in keys must be destructured in the body.
The same construct is valid JavaScript. This was found while testing for-in
restoration, but requires its own parser, binding and continuation change.
Failing regressions now cover member, array and object targets. The fix uses
the shared iteration binding path and preserves left/body phases. Array
destructuring additionally needs partial binding state to avoid repeated
effects after yielding; see `safejs-array-pattern-continuations.md` for the
implementation and verification record.
