# N07 versioned fixture correction

Original main replay remains14/14new+3/3retained and11/12novel, exit1.
N07 supplied invocation events without the exactly-one terminal final record
required by the existing transport parser; it refused FINAL_ENVELOPE:4 before
count assertions. Parent exit/close were observed; all raw captures retained,
pre/post guards passed. This is an independent fixture error, not a candidate bug.

V2 adds only a synthetic final envelope; inputs, roles and expected counts remain
two semantic attempts/one fulfillment/one false rejection plus one empty setup.
It separately retains missing-final rejection. This is a version of the same
twelfth family, not a thirteenth family or historical reconstruction. Only the
actual invocation helper closure loads; no real engine/worker/script can run.
The original expectation/result files are unchanged. One capture parent and one
dispatch child, no descendants; same grant/capture totals, no budget reset.
