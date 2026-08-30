# Frozen P03 oracle defect — independently resolved

The frozen P03 expected q after scanning p from `['-pqr']` and explicitly setting
the private index to 2. That expectation was wrong: index2 is beyond the current
one-element argument vector. Candidate source lines191–193 return EOF at
`args.length+1` before continuing an active cursor. Actual authenticated Darwin
Bash5.3 and Bash3.2 BOTH return status1, option?, OPTIND2, unset OPTARG for this
case. There is no candidate-native discrepancy here.

The initial historical REPORT had already documented positive out-of-range
indices normalizing to EOF. The independent freeze overgeneralized the separate
retained-cluster rule; the error is owned by this reviewer, not by the candidate.
`withGetoptsIndex` still copies/retains the active cursor, while a subsequent scan
may end because the visible index exceeds the current vector. When a second unused
operand keeps index2 in range, both native profiles and the candidate return q at
index2. Shortening the vector to one argument yields EOF in both implementations.
See all raw native and source/moved transcripts in capture-followup-02.

Preservation and accounting:

- Frozen P03 remains unchanged and remains failed in all four original runs.
  Original runtime denominator stays 237/238, not silently changed to 238/238.
- The three source-informed followup scenarios retain their initial assumptions:
  F01/F03 fail those assumptions on BOTH native profiles and both candidate modes;
  F02 passes. Those original 1/3 results are not overwritten.
- A separate comparison of their actual complete transcripts establishes 3/3
  scenario agreement (six records) per native profile against each candidate mode.
  These are not additional frozen native holdouts or newly rerun native scripts.
- Corrected controls R01–R03 explicitly test in-range clone isolation, preserved
  cursor before out-of-range EOF, and shortened-vector EOF. They are supplemental
  post-inspection controls and never replace the frozen P03 expectation.
- No product patch is warranted by this false positive. A future wording
  clarification of the API profile should distinguish primitive cursor retention
  from the scanner's out-of-range EOF check. Such author-document edits are outside
  this reviewer's ownership and are not performed here.
