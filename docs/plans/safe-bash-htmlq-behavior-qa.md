# htmlq behavior QA

Execute these steps as an agent; this document is the QA plan, not a new QA
script or runtime dependency. Use only the declared package/build/publication
routes. Do not launch a native htmlq executable from the product.

1. Run `npm run test:unit --workspace=safe-bash-command-htmlq` and package lint.
   Inspect the independent A01–A40 compatibility controls separately from the
   selector/projection and command-edge tests. Confirm cancellation, falsey
   cleanup failures, foreign-realm bytes, parent input budgets and late reads.
   Run the independent selector escape controls: quoted backslash + CRLF must
   concatenate `a` and `b`; hex `\\61` followed by CRLF and `b` must match `ab`.
   Literal/escaped NUL in selector names and strings must match U+FFFD, not NUL.
   Unescaped quoted newlines and escaped identifier newlines must fail. Compare
   the command and SDK byte output, diagnostics and status for the CRLF cases.
2. Run the maintained explicit `@poe-platform/safe-bash` build closure. Generate
   all public artifacts with `scripts/package-safe.mjs`, using an explicit local
   prerelease version and a unique temporary out directory. Never publish.
3. Create an outside-checkout consumer containing the three generated
   public artifacts and their already declared published dependencies, provisioned
   offline. The Node root entry needs those existing dependencies; the htmlq
   command/engine subpath adds none. Copy the maintained runtime/type fixtures there.
   Execute the runtime fixture and strict NodeNext declarations. Confirm opt-in
   registration, canonical runtime identity, lazy mutations, CLI/SDK equivalence
   and protected same-file output. Repeat runtime with browser/workerd resolution
   conditions where applicable. Ensure no private package is installed.
4. Independently inspect generated implementation/declarations for escaped
   unpublished specifiers and ensure the private command remains `private: true`
   with no external runtime dependencies. The packer performs maintained leak
   and private-workspace qualification checks; do not bypass them.
5. Capture and inspect an adhoc terminal screenshot of the generated-artifact
   virtual shell performing text/attribute/pretty HTML queries. Use the
   maintained screenshot runner with a literal Node command because htmlq is a
   virtual-shell plugin rather than a poe-code top-level command. Do not add a
   screenshot test. Keep the screenshot and temporary consumer in out, then
   purge only the temporary artifacts created for this task.
6. Run repository lint and the full maintained `npm test` route for shared
   composition/manifest changes. Diagnose failures without weakening assertions,
   raising timeouts or counting unavailable cases as passes. Report focused,
   full-suite and generated-artifact verification distinctly.
7. Keep full HTML5 recovery, full selector lexical grammar, Rust URL parity,
   every pretty/direct writer state and full Clap grammar open unless independent
   controls qualify them. No local check is remote-main or release evidence.

The filesystem's literal `/out` is read-only. Temporary artifact QA therefore
uses a unique `out` directory beside the checkout, which also prevents Node
resolution from falling back to checkout-private workspace dependencies.
