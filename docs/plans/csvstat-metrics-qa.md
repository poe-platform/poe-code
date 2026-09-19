# csvstat Decimal metrics QA

1. Read the released Agate 1.14.2 Percentiles, Median, Variance, StDev and
   Number sources against the frozen reference profile. Keep acquisitions in out.
2. Reproduce missing CDF quantile/sample-variance primitives with failing
   in-memory tests. Check extrema, integer-rank averages, exact fractional
   increments above binary64 resolution, empty/singleton data and NaN traps.
3. Wire median to the complete source percentile calculation and standard
   deviation to ordered Decimal sample variance. Preserve type filters and
   serializer behavior. Admit retained quantile storage and cooperative work.
4. Have a different agent execute the frozen numerical original observations
   through registered safe-bash commands, comparing stdout/stderr/status and
   filesystem effects. Investigate nonfinite percentile calculations independently.
5. Run uncached domain test/lint/build and focused safe-bash command/discovery
   checks. Inspect a screenshot of the actual built registered command report.
6. Record measured results and explicit blockers in docs/csvkit. No README,
   staging, commit, push or release changes. Purge only newly acquired evidence.
