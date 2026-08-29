# Preserved edit transport rejection

The first implementation apply_patch request was rejected by the execution tool
before creating an OS process: `Failed to create unified exec process: nul byte
found in provided data`. A Git-blob delimiter had been transmitted as a literal
NUL in the request. No patch/helper/control ran and no process stdout/stderr was
generated. The tool transcript is the primary API-rejection record; a process
capture for that rejected request does not exist and is not reconstructed.

The successor edit spells the delimiter with String.fromCharCode(0). It is a
source-encoding correction, not a change to controls, profiles or native policy.
It has separate direct-file captures. No lost process bytes or process retirement
is inferred from the rejected request; no end-to-end API-error raw-file capture
claim is made.
