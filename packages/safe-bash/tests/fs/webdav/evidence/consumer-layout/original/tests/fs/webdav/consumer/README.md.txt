# Public constructor comparison example

`example.ts` imports only public `virtual-bash` exports. `applicationWebDav`
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

Validation builds an isolated package archive before compiling these files
against its public declarations. From that isolated package directory:

```sh
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node node_modules/typescript/bin/tsc --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node --rootDir tests/fs/webdav/consumer --outDir consumer-out tests/fs/webdav/consumer/example.ts tests/fs/webdav/consumer/provider.ts tests/fs/webdav/consumer/consumer.test.ts
node --unhandled-rejections=strict --test consumer-out/consumer.test.js
```

The tests use plain Node, not a source loader, and assert the public entrypoint
resolves to `dist/index.js`. They cover existing-target cp/mv in both directions,
exact binary/namespace effects, aliases, absent authority, errors/cancellation,
built-in alias contradictions and complete-identity precedence.

`provider.ts` is a bounded Node loopback fixture, not a production WebDAV server.
It supports the request subset needed here, conditional PUT and the adapter's
timestamp property for move preservation. It does not implement LOCK, COPY,
MOVE, arbitrary SDK authentication, durable resource-ID persistence or concurrent
ABA protection. The example's explicit `overwritePolicy: "etag"` does not add
those guarantees. No dependency or SDK installation is required.
