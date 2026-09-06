# For-in assignment targets: confirmed remaining gap

The parser currently rejects `for(target[yield 1] in {a:1,b:2})` inside a
generator, reporting that for-in keys must be destructured in the body.
The same construct is valid JavaScript. This was found while testing for-in
restoration, but requires its own parser, binding and continuation change.
Do not report member or destructuring targets as supported until those paths
have failing regressions, implementation and full scoped verification.
