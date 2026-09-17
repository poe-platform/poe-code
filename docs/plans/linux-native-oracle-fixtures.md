# Native oracle fixture corrections

The parser release is blocked by three native-oracle assertions on remote main
19b1a1ebb. Release run 35113605890 reproduces the GNU yes signal assertion and
the completed/trailing escape timeout projections. Earlier run 35107984512
records the same failures before the parser work.

1. Finish the maintained local test route before changing its admitted inputs.
2. Make the short-consumer yes probe use a real kernel pipe and a bounded head
   consumer. Restore inherited SIGPIPE on Linux. Assert the pipeline's 141 status
   and exact output, distinguishing it from a direct child signal observation.
3. Preserve the existing virtual timeout byte contract and fixture inputs. Admit
   only the two explicitly observed native projections for the two affected
   inputs, and report which projection the authenticated Bash build exhibits.
   Bash read's saw_escape flag is not volatile across its timeout setjmp path;
   version alone does not establish one compiler-independent byte projection.
4. Run the maintained affected native shards, repository ESLint, and package
   typechecks. Commit these fixture corrections separately, rebase onto remote
   main, push, and monitor GitHub validation through stable publication.

## Evidence

- CI uses authenticated GNU Bash 5.2.37. The completed escape projection is
  3134320061202062206300; the trailing escape projection is 313432006100.
- The same source archive built on macOS with the maintained configure flags
  retains control markers: 313432006120012062206300 and 31343200610100. All 46
  focused deadline tests pass with this authenticated executable, SHA256
  34fa228bce64547fd516957ccc0553d382540d10a526b106a8f30c77450edf2b.
- A Node-launched real-pipe yes/head probe on macOS returns status 141, null
  direct-child signal, exact y-newline output and empty stderr. Linux publication
  must independently validate its GNU environment/signal profile.
- These are fixture/helper changes, not a claim of uniform Bash timeout byte
  behavior across compiler profiles. Preserve the native and virtual distinction.


## Local qualification

The affected maintained shards pass when executed sequentially: shard 1 has
8,212 passes and 284 skips; shard 2 has 9,092 passes and 74 skips. Both have zero
failures and zero cancellations. Earlier overlapping runs cancelled unrelated
pattern/public-cleanup parent tests at their existing deadlines; these cases
pass on the sequential maintained reruns without changing assertions or limits.
Maintained package typechecks and root ESLint pass. Linux profile qualification
remains the GitHub release gate.
