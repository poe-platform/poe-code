# V2 bounded owner review, not CORE70 activation

The ROOT grant on 2026-08-29 permits PURE controller checks and at most four
harmless Node children. This version does not import product, parser, matcher,
transport or Worker modules. Existing aa23f3fa/9b483bf2 remains 16 PURE controls,
189 authored bodies and 21 gated cells, all runtime UNRUN.

Only `controls.mjs` may be executed in this revision. Its imports are Node
builtins and the new `owner.mjs`. `harmless.mjs` is the only executable child,
with either no argument or the literal `nonzero`. Both runs use the pinned
Node22.22.2 binary; they make no imports and write exactly OUT/LF and ERR/LF.
No other executable is permitted by that controller. Before importing owner,
the controller authenticates the files against a separately persisted seal.
It authenticates Node by bounded binary streaming before either child.

The declared external collector is an exclusive regular stdout/stderr pair
opened by the launching shell before Node preauthentication. START.json bounds
the entire phase including publication; typed finite deadlines are checked
before acquisition. Every real child is enrolled immediately after spawn,
before receipt publication. Synthetic event emitters are not OS children or
Workers. A simulated unknown-retirement control must report unknown and must
never become an actual-child success claim.

Controls: NaN deadline; nonfinite case time; partial FD acquisition; raw falsy
publication rejection (false/0/empty/null); short and zero write; capture cap;
publication deadline; spawn error; missing close; actual two-channel capture;
actual nonzero exit preserved. Exact syntax diagnostics are recorded per owned
module using a PURE parser (`vm.SourceTextModule`); no module evaluation, product
loading, Worker, compiler or loader is authorized.

Phase caps remain 20min, 48 known OS starts, peak3, 64MiB capture and 384MiB
work. This controller gets 60s, two sequential harmless children, each 2s plus
500ms retirement within its total deadline, 64KiB capture combined, and 1MiB
scratch. It is not a grant for the separate 210 product cells. All malformed
Worker, in-flight matcher and private-array instruments remain unexecuted and
require the specific capability decision in HANDOFF.md.
