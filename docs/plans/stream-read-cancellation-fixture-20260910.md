# Cancel the streamed-read fixture after actual pull admission

The first full maintained pr run reproduced an unhandled `late VFS rejection`
in the stream-inspection holdout. The fixture signaled entry from `readStream`,
before its iterator's `next` ran. The corrected DeviceFS admission guard can now
cancel before that pull; consequently the fixture rejected a promise that no
product code had ever received. Evidence is retained in
`/tmp/issue680-full-test-v1.log` and
`/tmp/issue680-full-regressions-red-v2.log`.

Move the fixture's entry signal to the actual `next` invocation and assert one
pull before cancellation and still one after late rejection. Preserve exact
forwarded cancellation identity, late-rejection observation and disposal. Do
not suppress the rejection with a catch, remove assertions, loosen timeouts or
restore canceled read admission in product code. This corrects the intended
in-flight cancellation scenario, not a product output behavior.

Both complete affected suites pass 135 cases without skips in
`/tmp/issue680-full-regressions-green-v1.log`. The initial root-CWD sandbox probe
is an invalid harness invocation and remains separately recorded as v1; v2 is
the genuine individual reproduction from the package's required working directory.
Repeat full maintained checks before delivery of the separate fixture fix.
