# Authorized settlement correction — preparation, not acceptance

Only candidate `0123c83d3aae72a15621acbb29a165b97b2c6ab6` and package
`62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6`
are authorized. This is fixture authorship; a different reviewer must inspect
the closed result. Root public integration remains HOLD.

## Actual boundary at the exact candidate

- `src/shell/input.ts:61`: InputCursor.close calls producer return once; lines
  68–70 await a settled-read return and rethrow its exact reason when no prior
  read failure exists. `src/shell/input.ts:238` routes owned ShellInput close
  to that cursor. Blob: `3eec71b72f87dd48ddac572d6e7feb9097d32be4`.
  SHA-256: `4214a448a1a076acb297c3ba6a02d72482d488cf8b6df4549498148a012e5c32`.
- `src/shell/shell.ts:172`: after the command handler returns, the outer finally
  awaits stdin.close; lines 174–175 propagate its rejection on normal execution.
  ShellResult construction starts only at line 177. Public exec at lines 96–105
  drains its scope and rethrows the selected failure unchanged. Blob:
  `9d535825bce412d86c4dee587c59142bcf86944d`; SHA-256:
  `538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c`.
- `src/contracts/command.md:84` requires registered cleanup before settlement;
  lines 99–108 preserve selected execution rejection without wrapping. This
  supports the outer public-exec boundary, not a universal promise to wait for
  opaque unregistered work. Blob: `16371126acaccd07a8db2505b53a0625eb9b4592`;
  SHA-256: `8a5426b1e7a30a03dc62f74b28c6eb7bf9b008b78cb7b521eb7de0bc5c59a3f8`.
- `src/commands/grep.ts:77` and `src/commands/grep.ts:85` handle errors inside
  the grep definition and may emit diagnostics/status 2. That is a different
  boundary, and those direct-handler/owned-file expectations are unchanged.
  Blob: `68ebe72c37722cddb5f939be13653115b883429e`; SHA-256:
  `a5e93d8dd97c35f1a1530792b38478942647e6e66ac01fcd44fbea05fbfa78d1`.

The two authorized cases stop after one matching stdin chunk and reject return
with a sentinel Error. They are public Shell normal-completion close failures,
outside the handler; requiring a fulfilled status-2 result was incorrect at this
boundary. This correction follows the inspected source/contract and explicit
root authorization, not a newly invented compatibility profile.

## Frozen, narrow delta

`fixture.patch` changes exactly the try/finally bodies of S07's
`borrowed-external-Shell-stdin-return-rejection-not-waived` and ROOT-CONTROL's
`public-registered-grep-reproduces-external-return-failure`. Both now require
rejected settlement, strict identical sentinel identity, no fulfilled result,
and the existing one-return count. Commands, inputs, labels, limits, disposal,
global worker retirement and unhandled-rejection assertions remain unchanged.

The only observation adjustment records settlement and the rejection's
name/message/stack/identity. An unexpected fulfilled result is still retained
whole, including its bytes/status. A rejection has no ShellResult: no empty
stdout/stderr/status is invented. No extra middleware or byte observer is added;
the public API exposes no returned result bytes at that boundary. Existing
return/next counts and alias-registration observations remain. All other byte,
VFS-effect and backpressure observations remain byte-for-byte unchanged.

`fixture.mjs` authenticates the original complete fixture SHA-256, applies the
patch only to a new temporary copy using apply_patch, reverses both changes
back to the exact original, and hashes the unchanged remainder. The other
75 base cases plus five supplemental cases are not edited. Original inputs,
native captures and the historical 154a8d22 80/82 evidence remain immutable.
Negative controls will execute the exact patched try/finally bodies with stub
settlements, never modified product source. They are assertion controls, not
product passes or product mutants.
