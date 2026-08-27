# Packaging setup correction, not an expectation change

The first baseline attempt stopped before executing any matrix row. The frozen
import-resolution assertion correctly rejected repository package self-resolution:
the scratch consumer was missing its own package.json boundary. Its raw build,
pack and execution logs remain in evidence/baseline-*.json. No row was scored.

The driver now creates a differently named private ESM consumer package, preventing
repository self-reference. It also applies the baseline source-manifest assertion
by candidate identity rather than the cosmetic phase label, so a new append-only
baseline phase retains the exact frozen-source gate. Neither matrix.mjs nor
vectors.mjs, their expectations, inputs, case count or loader changed. The original
driver remains preserved by freeze commit 07341c4751d776ee258bcea6086bb216216dd7c2.
