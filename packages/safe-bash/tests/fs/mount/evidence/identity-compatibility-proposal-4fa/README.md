# Historical compatibility proposal and bounded observation

This is an evidence-only publication of the prior read-only handoff. Neither
`guardedCopy` nor `compareEntry` is an approved contract. Curie/root retain
contract and source-change authority. Production remains at the five-backend
source checkpoint `4fa4ba9502dac843bd13aa5031d128a3171f597d`.

- `historical-proposal.txt` preserves the /tmp proposal verbatim, including its
  historical observed HEAD and proposed API options, not current approval.
- `bounded-move-probe.mjs.txt` and `bounded-move-invocation.txt` reproduce the
  exact earlier inline Node probe. Run the invocation from the repository root.
  No probe or acceptance suite was rerun for this publication.
- `bounded-move-probe.stdout.json` is the exact JSON stdout portion copied from
  the earlier tool transcript, not a newly generated test result or a claimed
  original on-disk log. The earlier command exited 0 with no probe stderr.
- `manifest.json` records provenance, source hashes and artifact hashes.

The bounded probe asserted physical source/target bytes and backing names for
four memory/overlay hardlink rename cases. Same-mount and overlay-upper returned
success; repeated mounts returned EXDEV; overlay-lower returned ENOTSUP. These
are observations, not four successful compatibility cases. The probe did not
assert overlay-visible namespace state or arbitrary remote MOVE behavior.

Remote existing-target overwrite failure details remain attributed to the
positive verifier's preliminary message: “Existing remote overwrites appear
blocked, even within one mount. I’ll test the exact workflows against direct
backend operations.” No remote acceptance counts, new remote reproductions or
independent-review conclusions are supplied here. The two reviewers retain
separate scopes; no positive-verifier files or existing evidence were changed.
