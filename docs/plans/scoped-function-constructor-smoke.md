# Scoped package Function constructor smoke check

Release run 34617544814 failed installed-tarball verification: the function
prototype smoke case expected Counter.constructor and Array.constructor to be
undefined. SafeJS now supports guest Function constructors, and both values
correctly resolve to the guest constructor.

Assert identity against guest Function inside the executed source instead of
exporting internal function representations. Preserve all other constructor,
bound-function, prototype, and nonconstructable-arrow assertions. Verify the
packaged consumer fixture on Node and Bun before pushing this test correction.
