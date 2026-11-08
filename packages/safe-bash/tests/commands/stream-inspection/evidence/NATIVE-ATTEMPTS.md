# Native author attempts

`native.json` is the untouched initial39-call capture (36 common controls plus
3 deliberate Apple differences). Its Apple strings minimum/invalidUTF8 cases
and tab/offset difference cases used attached `-n2` (also `-tx` for offset),
which Apple rejects. Those four captures are native parser failures, not product
semantic mismatches or evidence of tab/offset differences. The initial38-test run
reported35 passes,2 failures,1 live-oracle skip; the Apple-difference grouped test
then lacked native status validation and its first two comparisons were invalid.
Do not count that initial grouped test as difference proof.

The corrected fixture uses separated `-n 2` and `-t x` only for those four Apple
calls. The positive fixture definitions and their hashes explicitly changed;
this is not an unchanged-corpus replay. `native-corrected.json` retains the
corrected39-call capture, and the test now verifies native success, empty stderr,
fixture hash and the exact selected product output before asserting a difference.
The other35 native calls were repeated unchanged during corrected publication.
All original failed native bytes and hashes remain in `native.json`.

GNU9.7 reference is on Darwin, not GNU/Linux. The original three selected GNU
commands supply31 controls; Apple strings supplies5 raw common controls and2
deliberate differences; Apple expand supplies1 deliberate difference. GNU strings
runtime is unavailable in inspected legitimate locations. GNU manual-based
selected strings behavior is not claimed as live GNU-tested compatibility.

## Later GNU strings availability and genuine product fix

The separately authorized provider subsequently built GNU Binutils2.44 strings
from the official unmodified release in an isolated reference directory. Its
executable SHA256 is90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f;
the source archive and build provenance are in `gnu-strings.json`. It is GNU on
Darwin configured default-all, not a Linux or object-section profile. Earlier
unavailability remains a historical fact, not the final availability claim.

The supplemental13-case cohort reuses5 corrected Apple-common inputs unchanged
and adds8 selected GNU profiles. Original raw captures remain `gnu-strings.json`.
Twelve are positive workflows; one is a native usage-negative. The initial author
test assumed all13 were positive, failed on that native status assertion before
calling the product, and reported12 pass,1 fail,1 optional live skip.

`gnu-strings-lone-dash-regression.json` preserves that original fixture, native
usage bytes, pre-fix source hash, and an explicit pre-fix product call. The product
incorrectly treated a lone `-` with no files as stdin. It now rejects that operand
list with status1 and no stdout, matching native namespace/byte effects. Its
short diagnostic differs from native full usage and is asserted exactly, not
erased by a blanket diagnostic relaxation. The original fixture identifier and
input stay unchanged; the test's incorrect positive-only assertion is corrected
to the precise native-negative behavior. No valid missing feature was relabeled
unsupported. All other12 GNU strings observations match status/stdout/stderr.
