# Admit worker cleanup before acquisition

Task: qualify-lifecycle-and-retention. On Node 22.23.2 / ICU 78.2, reserve the
single realm cleanup slot in extension setup, then request an atomic wait.
Admission must fail without constructing an unowned worker. The deterministic
regression observed one worker after rejection, reproduced on isolated main
`d3acfb10092c3b4b39aa3f370464dee1a774da53` and the recorded local checkout.

`npx vitest run packages/safe-js/src/realm-resource-ownership.test.ts`:
red 1 failed/2 passed, 198 ms tests, 2.22 s command. The repair registers the
cleanup before constructing the worker and detaches/clears its charge if
construction throws. Startup and post-message failures remain covered by
`packages/safe-js/src/interp/atomic-wait.test.ts`. Combined repaired run:
12 passed, 312 ms tests, 2.09 s command. An additional control confirms that a
termination exception is reported without skipping other disposers or retrying
termination on repeated close. No forced notification of shared buffers is used.

This repairs SafeJS host resource ownership. It cannot promise successful
backend termination when the backend rejects or leaves native registrations;
that limitation remains explicitly owned in the task qualification evidence.
