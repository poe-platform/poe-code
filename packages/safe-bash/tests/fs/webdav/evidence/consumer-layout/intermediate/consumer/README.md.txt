# Public constructor comparison example

`example.mts` imports only public `virtual-bash` exports. `applicationWebDav`
accepts a truthful application backing resolver and configures the constructor
`compareEntry` callback. The resolver returns the actual backing filesystem/path
for recognized views, or `undefined` for unknown views. It must not infer storage
separation from endpoints, credentials, client objects, protocol names or ETags.
It uses genuine complete scoped stat identities, not manufactured identity tokens.

The consumer fixture deliberately exposes one actual Memory backing filesystem
through HTTP and directly. The application owns both mappings. This proves both
overlap protection and useful distinct-entry transfers, not arbitrary remote/local
disjointness. Serialized HTTP responses carry no private mock observations.
The callback performs metadata operations only and forwards cancellation.
Unrecognized views and incomplete identities remain unknown; existing-target
overwrites are then refused rather than truncated. Identity is not a lease or
protection against an unrelated concurrent pathname replacement.

This built-package consumer is a separate `.mts` compilation target, not a
source-tree `.ts` test. Root typechecking intentionally checks source adapters
without requiring a previously built shared `dist`. Package-name imports instead
must be validated against freshly built public declarations, not whatever stale
declarations happen to exist in that shared directory. No cast, ignored error or
weakened callback type substitutes for the separate strict validation.

Run the isolated build, scoped source types, strict public consumer compilation,
and all thirteen runtime checks from the repository root:

```sh
node tests/fs/webdav/consumer/run.mjs
```

The runner archives the recorded committed source, copies current owned backend
tests, and uses development tools already installed in the repository. It writes
only to a fresh `/tmp` directory and prints its path. It never builds shared
`dist`. The public declaration checks in `types.mts` assert callback optionality,
the exact receiver/arguments/result, bidirectional contract assignability and
rejection of an incompatible receiver. Under its isolated package directory the
equivalent explicit build/consumer commands are:

```sh
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node node_modules/typescript/bin/tsc --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node --rootDir tests/fs/webdav/consumer --outDir consumer-out tests/fs/webdav/consumer/example.mts tests/fs/webdav/consumer/provider.mts tests/fs/webdav/consumer/consumer.test.mts tests/fs/webdav/consumer/types.mts
node --unhandled-rejections=strict --test consumer-out/consumer.test.mjs
```

The tests use plain Node, not a source loader, and assert the public entrypoint
resolves to `dist/index.js`. They cover existing-target cp/mv in both directions,
exact binary/namespace effects, aliases, absent authority, errors/cancellation,
built-in alias contradictions and complete-identity precedence.

`provider.mts` is a bounded Node loopback fixture, not a production WebDAV server.
It supports the request subset needed here, conditional PUT and the adapter's
timestamp property for move preservation. It does not implement LOCK, COPY,
MOVE, arbitrary SDK authentication, durable resource-ID persistence or concurrent
ABA protection. The example's explicit `overwritePolicy: "etag"` does not add
those guarantees. No dependency or SDK installation is required.
