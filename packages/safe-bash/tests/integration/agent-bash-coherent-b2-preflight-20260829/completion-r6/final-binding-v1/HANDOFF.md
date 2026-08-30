# B2-r6 final binding v1 — pending final review and ROOT actual GO

The frozen runtime code, schema, 30 packet members and 41-role recipe are unchanged.
The exact reviewed loader/static-builtin boundary is approved by ROOT, not expanded
to arbitrary guest effects, host containment or general network/subprocess use.

## Exact materialized slot

- Accepted review: `bab8cae4da9bdb780ad26c4123451df2549cc1c6`.
- Review receipt SHA256:
  `7d4e01900cd8630d2331a237283c7e6e43bfad5e00080d8099f3cbddca67a897`.
- Runtime grant: `/private/tmp/B2-R6-ROOT-GO.json`, exclusive regular file, mode0600,
  **1,009 bytes**, SHA256
  `c002da2a04caa6486b7c60fe4ece42a81fe9b28115ef35585ab19d3e998bd7b7`.
- Packet: 6,222 bytes, SHA256
  `a2a5a6a23f4c30bd490b3a1db29f0cdc6e4e57a4f179ba0368489af7652fb554`.
- A byte-exact grant copy and `BINDING.json` are committed here.

## Validator-compatible scheduled window

All times are August 29, 2026 UTC, with no renewal:

| Field | Value |
| --- | --- |
| issuedAt | 14:55:12.109 |
| notBefore / scheduled full-budget anchor | 15:15:12.109 |
| activeDeadline | 15:42:12.109 |
| deadline | 15:45:12.109 |

The unmodified validator permits `issuedAt <= notBefore`. This binding places
the anchor twenty minutes after issuance. It is **not** an anytime-start grace
window: earlier launches reject; later launches consume the already-running fixed
budget. Latest start retaining the full 1,800 seconds is precisely `notBefore`.
If ROOT instead requires an immediate launch with a fresh full budget, it needs a
separately bound grant near that actual launch; this artifact must not be silently
renewed or its dates changed. The PURE validator was evaluated at the scheduled
anchor; it rejected anchor-minus-one and the active-deadline boundary. B2 was not
activated and the current host clock was not changed.

Exact future command, from `/Users/kjopek/Workspace/safe-bash`, login=false:

```sh
/bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r6/staged/new/launch.sh /private/tmp/B2-R6-ROOT-GO.json 6222
```

No tool approval or actual execution is requested by this handoff. Initial trusted
host/tool-shell startup remains outside the generated direct-file capture;
login=false does not imply that `.zshenv` is suppressed. Generated Node startup
uses the launcher's actual fd1/fd2 redirection, not dummy descriptors.

## Fresh evidence and remaining admission

The DATA-only helper authenticated the accepted review receipt, all 30 packet
files, ten consumed source/emission/archive pin entries, Node, `/bin/zsh`, and
the pinned compiler/npm entry files. It did not execute compiler/npm, decode the
package, recensus the entire source/tool tree, import product, or create Workers.
The fixed work root `/private/tmp/safe-bash-b2-runtime-r6` and its `.outer.raw`
capture were absent. They remain uncreated by preparation. Their absence and all
runtime-consumed identities must be checked again before actual admission.

Prospective runtime remains 64 known OS starts, peak3: one exec-replaced launcher/
owner, 41 sequential children, at most22 administration/publication starts.
34 main async-loader admissions are approved, not guest or Regex Workers;
individual loader exits and native helper-thread totals are unobserved. Regex0 is
the qualified fixed source profile, not a new runtime observation. Budget remains
1,800 seconds inclusive / 1,620 active / 180 publication reserve, 96MiB raw capture,
512MiB logical work. No prior preparation or review administration census is reused
as an actual-runtime count.

Different final-binding review and fresh ROOT actual GO are still required. All
672 retained calls, type processes, loaded mutations/restores and runtime bindings
remain UNRUN. Historical STOPs and qualifications are unchanged.
