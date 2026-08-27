# Classification authority

Read through `web.run` on 2026-08-27, independently of author expected answers:

- Official GNU Coreutils **v9.7** source:
  `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/expr.c`.
  Source SHA256 is
  `c9dc5e04039505ab48a350e9407b1d83b2574fd7e2c31c9d23f4bf942d1b8af0`,
  authenticated against the frozen local release archive and executable receipt.
  `main`, `require_more_args`, and `eval7` establish the missing-operand,
  missing-argument, missing-close, and trailing-argument diagnostic distinctions.
  `docolon` identifies evaluated BRE behavior and invalid-pattern status 2;
  an implementation's pending-protocol status 3 is not equivalent.
- Official GNU Coreutils **v9.7** documentation source:
  `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/doc/coreutils.texi`.
  Sections `expr invocation`, `String expressions`, `Numeric expressions`, and
  `Relations for expr` specify argv-token expressions, result statuses, string
  operators, numeric conversion, short circuit, and locale-sensitive collation.
  This is pinned documentation, not a rolling newer manual called version 9.7.

The frozen GNU binary's exact Darwin/C and Darwin/en_US.UTF-8 observations remain
normative for their own rows. Apple observations stay separate. No Linux oracle,
alternate expr implementation, diagnostic normalization, replacement locale, or
substituted expected result is used.

The independently inspected **archived** candidate README/internal module declares
only C/POSIX byte operations and C.UTF-8/C.utf8 scalar operations, with byte
collation. Thus the original en_US.UTF-8 character-operation/collation refusals
are named unsupported-profile mismatches, not native matches. The separate frozen
Unicode control's C.UTF-8 execution measures that declared policy without changing
any original GNU tuple. Arithmetic remains locale-independent in this profile.

Classification counts are reported from actual observations, not inferred from
the author's checkpoint marker. The marker `d96f9ffe` supplies provenance only;
its result JSON is not an expected-answer source. An unchanged parser's shorter
diagnostic is still a strict diagnostic mismatch even when status, stdout bytes,
and diagnostic presence agree.
