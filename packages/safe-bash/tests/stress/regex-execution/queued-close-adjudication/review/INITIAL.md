# Frozen initial assessment

Expectations committed independently at `7151577`, before any adjudicator
findings. The first ready-note check found no note. Safe independent controls
against frozen `01aa1bffe0568cc6787d5ff8e0331e024a787385` pass **6/6 named
groups, 8/8 fixture variants**. Eight fake transports retire exactly once; no
transport/observed abort listeners remain. No native workers are constructed.
Strict-rejection child exits0, no signal/safety kill, both output streams close,
and no IPC is connected. `evidence.json` retains hashes and full output.

Initial adjudication: obsolete second-worker expectation, not a demonstrated
source regression. The normative callback closes acquisition admission even
for a previously queued request capable of acquiring later. Historical close
waited for that request, but current close is the invocation cleanup primitive.
The obsolete part is expecting a closed queued owner to acquire/complete after
the idle retirement gate opens; the requirement to await final retirement is
still valid. Reject with internal CLOSED, do not relabel success or PROTOCOL.

Positive unclosed queued progress passes after capacity releases. Queued close
leaves an active sibling usable and does not wait for that sibling's lease.
Duplicate idle messageerror triggers one termination. Repeated close shares its
promise; late run and synchronous registrar-close acquisition reject. Prior
caller reasons retain exact errno-shaped object/falsy0 identity. Already-selected
internal PROTOCOL survives a later abort; outer withRegexSession instead rejects
with that caller reason. Without abort, the same selected error object survives.
Direct executor errors have no command exitCode: no utility/Shell status proof.

Adjudicator proposal is NOT YET READ or approved. A valid test-only proposal must
preserve the historical fixture/evidence, exact rejection, pending close before
retirement, duplicate cleanup, a separate unclosed progress control and sibling
isolation. Merely changing workers2 to workers1 is inadequate.

Historical99/100, originalfive0/5 and110/111 remain unchanged, not rerun. No risky
probe, broad suite, source/canonical mutation, dependency, runtime/public/default
acceptance, or new regex exposure. Still awaiting USER/root-relayed Sagan commit;
livegit is not a handoff. Only this owned review tree and the requested /tmp
initial marker are written. Wait for adjudicator readiness is bounded.
