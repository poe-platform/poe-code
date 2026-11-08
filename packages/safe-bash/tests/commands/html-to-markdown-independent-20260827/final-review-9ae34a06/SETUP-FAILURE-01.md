# Capture-parent setup failure

The first command was `node final-review-9ae34a06/setup.mjs node_modules/run01`
(with the full repository-relative driver path). It exited 1 before any capture
directory, PRE-RUN, compilation, npm operation or product child existed:

```text
Error: ENOENT: no such file or directory, mkdir '/Users/kjopek/Workspace/safe-bash/tests/commands/html-to-markdown-independent-20260827/final-review-9ae34a06/node_modules/run01'
    at mkdirSync (node:fs:1370:26)
    at file:///Users/kjopek/Workspace/safe-bash/tests/commands/html-to-markdown-independent-20260827/final-review-9ae34a06/setup.mjs:11:31
```

This transcribes the tool-returned exception; no separate raw redirected log was
created by that command. The driver remains unchanged. Explicit narrow setup
correction: create the missing owned ignored `node_modules` parent and use a new
run02 capture, logging subsequent top-level output. This is not a product retry
or passing observation. No expectation, candidate or tool bytes are changed.
