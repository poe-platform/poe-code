# First S06 baseline attempt — fixture import failure

Preseal 105a2c92, no product writes. Exact c7 composed source tree
d6c17f62d2d3062b5ab074044a86b8a455820373 / 269 selected inputs.
Selected production build exits 0. Strict fixture check exits 2 with TS2307:
the new regression fixture incorrectly imports `src/fs/memory.js` rather than
the existing `src/fs/memory/index.js`. This is an author fixture transport error,
not product behavior or a semantic assertion/expectation failure.

Runtime tests executed: zero. Original foundation/syntax assertions remain
unchanged. Two child process groups are settled and absent. Original raw attempt
and `baseline-capture-01.json.gz.base64` preserve diagnostics and inputs. No
integrity/safety/cleanup assertion failed. Correction is versioned in s06-v2;
v1 test, driver, manifest and all expectations remain immutable.
