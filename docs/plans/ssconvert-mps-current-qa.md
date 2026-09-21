# Current MPS and model export candidate QA

Root owns export integration and Git; a different agent independently probes
and repairs model algorithms. Preserve existing edits and README files. Do not
push, publish, or introduce native product dependencies.

1. Authenticate the existing official archive under `out` against the task's
   Gnumeric 1.12.61 SHA-256. Use the captured dependency/plugin/locale profile in
   `docs/ssconvert/mps-model-reference-profile.json` for the separate native oracle.
2. Create original CR-only and CRLF MPS fixtures under task-owned
   `out/ssconvert-mps-current`. Export through the native oracle, recording exit
   status, stdout, stderr and exact model bytes. Before changing the importer,
   reproduce CR-only objective loss with an in-memory SDK regression. Fix only
   validated differences; retain CRLF as a negative control.
3. Have the independent agent probe malformed/missing/valid solver targets with
   both native exporters. Require failing in-memory regressions before repair,
   and recheck valid targets/input-cell allocation after repair.
4. Verify virtual CLI, SDK, original input, XML checkpoint and replay model bytes
   with memfs. Check unchanged inputs/neighbors and exact namespace effects.
   Exercise the existing budget, cancellation and diagnostic regressions.
5. After the final algorithm edit, run the maintained uncached ssconvert build
   closure, full ssconvert workspace test/lint routes, and focused safe-bash
   ssconvert integration checks. Run cross-workspace type checks. Execute checks
   sequentially to avoid numerical test interference. Record failures/timeouts
   separately, including any incomplete broader gate.
6. Capture and inspect the virtual command output using the repository screenshot
   runner. The virtual tool is invoked in an explicitly injected memory shell;
   native execution is only a QA oracle. Reduce results into a verification
   document and remove task-owned scratch only.

No native solver result establishes exporter parity. Unavailable realms, optional
solver processes, unmeasured locales and bounded large-model performance are
unverified; retain all known mismatches from the existing verification report.
