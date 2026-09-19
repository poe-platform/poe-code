# csvpy independent stress QA

Execute the actual registered `csvpy` command through safe-bash `Shell`, using
the injected JavaScript PythonSession interpreter and in-memory filesystem only.
No native Python, subprocess, file fixture writes, network, or LLM is permitted.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvpy-stress.test.ts`
   after the maintained csvkit workspace build refreshes engine declarations and
   JavaScript outputs. Capture failures before fixes and rerun after fixes.
2. Compare exact console banner, stdout prompts/displayhook values, stderr EOF
   message, exit status, and exactly-once interpreter close.
3. Check raw reader keeps its header, physical skip-lines precedes CSV parsing,
   DictReader consumes headers on access, `--dict` wins over `--agate`, and
   surplus/missing columns use None keys/values as appropriate.
   Raw `-H` retains the first reader record. Dict mode `-H` reproduces its source
   constructor TypeError because csv.DictReader forwards an unsupported keyword.
   Assign fieldnames before first iteration and verify that the original first
   row becomes data under those names. Verify initialized None restkey/restval
   attributes and their effects after guest assignment.
4. Check an unread oversized later field cannot fail reader construction. This
   is an original regression for eager row parsing before welcome/prompt.
5. Check executable-specific inherited omissions reject argv before missing-file
   or interpreter acquisition. Check absent FILE and literal `-` reject stdin
   without consuming its borrowed stream or acquiring a console.
6. Abort while the injected terminal read is pending; verify exact false abort
   reason preservation and exactly-once guest close. Run an empty-message builtin
   StopIteration followed by another expression; verify exception formatting and
   console continuation with exact stdout/stderr/status.
   Hold an admitted cooperative read on a release barrier after it observes
   abort. Verify Shell exec and dispose remain pending until that read settles;
   after release verify the original false reason and exactly-once guest close.
7. Separately qualify multiline parser interaction, guest object/module identity, table Decimal and
   temporal objects, and the exact CPython code.interact/IPython reference
   profiles. Cases not tested remain explicit qualification blockers.

Initial inspection found the adapter eagerly consumes `input.records` in reader
and dict modes. The first run could not qualify this specific defect because the
built workspace engine still called only legacy `provider.load`; it must be
rebuilt before testing the new maintained converted-reader path.

After rebuilding and correcting test instrumentation to subclass the frozen
PythonSession instead of assigning its close method, seven original stress cases
passed. The eighth reproduced a concrete empty-message exception formatting
defect: actual `StopIteration: ` included a trailing colon/space; the expected
CPython builtin exception line is `StopIteration`. This case must pass after the
root owner's formatter fix. These console observations qualify the named cases
only; they do not establish the complete code.interact or optional IPython profile.

Two further original regressions reproduced missing DictReader compatibility:
fieldnames assignment raised a property-without-setter AttributeError; restkey
and restval were absent and row conversion hardcoded None after their assignment.
Both use direct native csv.DictReader properties and require the library bridge
fixes followed by the complete ten-case stress rerun.

The complete ten-case rerun passed after the root owner rebuilt the formatter,
fieldnames setter, and restkey/restval library fixes. All case bodies completed
in under 100ms in that run. The tests import maintained public csvkit/safe-python
APIs and run the actual registered safe-bash command, with exact shell output
channels instead of a terminal-output bypass.

An eleventh original cancellation regression reproduced premature public
settlement. The injected read observed abort but deliberately waited for its
cooperative release barrier; after one event-loop turn the exact observed state
was terminalSettled=false, executionSettled=true, disposalSettled=true. Both exec
and dispose must instead remain pending until the registered guest cleanup drains
that admitted read. Run the narrow regression with
`node --import tsx --test --test-name-pattern='drain an admitted cooperative terminal' packages/safe-bash/tests/commands/csvpy-stress.test.ts`
after the root owner rebuilds the adapter fix. The barrier releases in finally,
so failure evidence does not leave a hanging terminal or shell invocation.

The complete eleven-case rerun passed after the final maintained build included
guest retirement, admission closure, tracking/draining cooperative terminal reads,
and the combined invocation/retirement/interaction terminal signal. The cleanup
regression verified that neither exec nor dispose settled before release, then
verified exact false abort reason preservation and exactly-once guest close.
