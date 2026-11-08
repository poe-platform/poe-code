# Post-run DATA-only audit correction

Original reporting-script SHA256:
`9869b3a2b1fe0adc6bd23652adf4756512d9e309bee2d3cdfeb3b9d50a9cb470`.

The first reporting audit exited1 before archive or audit-result publication.
It tried to read the admitted112,989,184-byte Node binary with its local64MiB
evidence-file read helper and failed `assert.ok(stat.size <= 64 * 1024 * 1024)`
at audit-capture.mjs:22:10, caller:72:21. No candidate was imported or rerun;
the actual coordinator had already exited0 with all22 children retired.

The reporting-only correction streams the exact same authenticated binary with
64KiB chunks, checks its exact112,989,184-byte length and existing sealed hash,
and leaves the64MiB evidence-file read bound unchanged. No frozen dispatcher,
policy, grant, seal, source, package, child count or capture limit changes.
The original script is recoverable by removing the added toolStat/toolHash/
toolBytes/toolChunk block and replacing it with its original single line:

```js
assert.equal(digest(read(scope.tools.node.path)), scope.tools.node.sha256);
```

This is a post-run reporting defect, not a candidate failure, retry, or new
product execution. The original actual receipts remain byte-identical.
