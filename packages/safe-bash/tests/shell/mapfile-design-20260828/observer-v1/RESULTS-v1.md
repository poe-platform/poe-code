# Initial whole-module synthetic execution

Candidate `9418c3cf`, precode `cc471485`. All 28 frozen synthetic controls
passed on their first execution. No actual children, native scripts, product
imports, or real Node driver instantiations occurred. Each finite model drained
its timers, then discarded its own in-memory entries. This does not prove OS
cleanup, spawn ordering, or Bash semantics.

Capture: `captures/synthetic-1787922803956-8488.json.gz.base64`

- Encoded SHA256: `5d54aaa4ab488871f6cb6c0af42f7e5ea62fd5b0bf4600bfed3440b3cc705c37`
- Decoded JSON SHA256: `67908391fc0f6ec720da3c275ea2152f56fa0b6b2bc3e588f405b6312271aa8f`
- Decoded bytes: 1558593.
- Executed module seal: `e2b58d8bf09d93b38f90d1b75902a9b78cbc937f3a137e63cc4a690f96f77934`.
- Parent invocation: `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/shell/mapfile-design-20260828/observer-v1/modules/synthetic.mjs`.

An earlier shell invocation of the same command using bare `node` failed with
`zsh:1: command not found: node` (exit127), before any executor/module/child ran.
The explicit existing parent binary resolved that launch-path issue; no install
or environment configuration was changed.

Before handing off, static review identified three additional hardening needs:
explicit parent-Node identity authentication in prospective native admission;
receipt/new-entry checks after final persistence; and one escalation timer per
faulted child rather than one timer per repeated output fault. These are not
failures of the executed 28 frozen expectations. The additive PRECODE-v2 controls
will be sealed before their implementation/execution. Original results remain.
