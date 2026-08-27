# S3 fixture binding correction

Before correction, r0 source/build/scoped typing and all six author controls passed.
Inspection of those controls found S3 exercised actual context.invoke with a custom
opt-in operation but not the curl binding of the same borrowed owner-live contract.
S3's frozen intention already covers this boundary; the correction adds curl as a
subrun, alongside the existing custom fulfillment/rejection subruns. It does not add
a logical case, alter acceptance, require handback or assert zero owner returns
after top-level exec. All r0 fixture bytes/results remain archived. This is a
coverage correction, not a product source fix and not independent evidence.
API S1 and source r0 stay byte-identical. The historical original5, adapted5 and
57+9 inputs/selectors/deadlines/barriers are unchanged.
