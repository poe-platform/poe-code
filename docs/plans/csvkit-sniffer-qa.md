# CSV sniffer QA

1. Reproduce the original no-inference `in2csv -f csv` semicolon regression:
   before implementation status 78 blocked dialect sniffing; afterwards require
   comma CSV, empty stderr and status zero. Compare SDK `filetype`/`no_inference`
   settings with the original executable argv through the same engine.
2. Run the maintained csvkit workspace unit route uncached. Check delimiter
   preferences, empty/no-delimiter samples, LF/multiline quote matches,
   Unicode classification, default/zero/full sniff limits, explicit overrides,
   warning text/suppression and independent sample bounds. Keep TODO encoding
   cohorts explicitly separate from passes.
3. Run the actual-shell csvkit family tests, including the independent agent's
   sniffer stress file. Verify exact stdout/stderr/status and retained prefix,
   raw option rejection, NDJSON table streaming and warning-before-output order.
4. Build the selected csvkit and safe-bash workspace closures through the root
   maintained uncached runner. Run csvkit maintained lint/typechecks and
   safe-bash maintained discovery/build-runner checks; do not replace maintained
   task dependency declarations with hardcoded counts.
5. Render actual compiled public Shell output for inferred semicolon NDJSON and
   failed-sniff warning/fallback with terminal-png into `out`. Inspect the image,
   check Unicode and diagnostic wrapping, then purge only the generated owned
   temporary evidence. No screenshot tests or script-only QA procedure.
6. Record the measured scope and remaining blockers in `docs/csvkit`. Do not
   interpret frozen oracle acquisition or unmeasured SQL/TTY/encoding profiles
   as product acceptance. Do not stage, commit, push or publish this work.
