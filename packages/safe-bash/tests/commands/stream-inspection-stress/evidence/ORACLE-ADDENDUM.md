# Oracle review before product execution

Original frozen artifacts remain unchanged. GNU native status overrides the
tentative `negative` annotation: two expand syntax probes native-accept and
must be checked as successful exact-output cases, not reclassified as failure.
The harness already uses captured native status rather than `negative`.

On 2026-08-27, after freeze but before any module execution, the primary GNU
binutils source was obtained from GNU's googlesource mirror. SHA256:
af7fa2fbda1a3c2384a583e65a8696b345878111ee996acf66274826b46bc764.
It confirms tab printable, filename prefix, seven-column numeric offsets and
`{standard input}` label. This is source evidence, not a GNU runtime capture.

Root's profile coordination and this source distinguish strings' lone `-`
as raw-selection option from a generic stdin operand. The original private
`strings-dash-stdin-extension` fixture encodes the initial batch-wide stdin
interpretation, not GNU behavior. Preserve it as a historical contract probe;
do not report its discrepancy as GNU parity failure. The corrected GNU
expectation for the same arguments is only `FILE\n`, without stdin bytes.
This correction is made before observing product execution, not to fit it.

Apple Xcode `strings -a` means all sections, not guaranteed raw whole-file.
`-` selects physical raw scanning; stdin differs in printable classification
and offset formatting. Apple captures stay separate and do not set GNU
expectations. No native strings parity claim is supportable without a GNU
runtime. No object parser or Unicode encoding parity is inferred.
