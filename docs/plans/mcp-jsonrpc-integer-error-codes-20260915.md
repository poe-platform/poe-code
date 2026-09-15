# Reject non-integer JSON-RPC error codes

Concrete wire regressions showed the client accepts fractional error codes and overflowing numeric literals that parse as Infinity. JSON-RPC requires integer error codes.

Use Number.isInteger in the shared error-object validator. Preserve finite application-defined integer codes. Two regression tests failed before the fix; focused error-code and utility checks passed afterward.

Modern client negotiation and cancellation changes remain separate from this atomic fix. No public configuration or README addition is introduced.
