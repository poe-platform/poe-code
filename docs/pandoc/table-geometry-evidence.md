# Original table geometry verification

The original new cases reproduced incomplete rows reaching a trusted writer and
cells crossing a row-header boundary. Before implementation: 4 failures, 511
passes. After implementation: all 515 package tests passed (13 files).

The existing span checks already rejected nonpositive/oversized spans, overlaps
and section crossing; their original cases remain regression coverage, not newly
discovered defects. Sparse occupied-column storage is charged through existing
logical-cell/reference admission, and cooperative iteration yields during index
operations. No rectangular grid is allocated. Normalization preserves admitted
data exactly, with bounded generated idempotence and text/order cases.

Package lint/typecheck and selected workspace build both passed.
