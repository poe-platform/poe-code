# Decoder successor: preserved prelaunch admission stop

The versioned decoder passed245/245 DATA checks; it did not execute the
product. All140 IDs/274 calls, including21 S01 calls, retain their inputs
and expectations. Prior be69c4d8 remains unchanged.

## New source admission

Preseal f2d4a49950063d8e3315775805ebc60fe2ac0dd5 was checked once by
committed source60c1fd88. It stopped in20.599917ms before any Git metadata
child, compiler, package install, or product import. The controller exited1
and retired; there are no active children, actual-run root, or root route.
All274 actual calls remain UNRUN, including21 S01. This is not a product finding.

The file decoder-v3/DATA-01/492.json is22044 bytes with SHA256
ea3ad544c34d02c7f68cffc04af54d47236ba7990e7d00918e4a0a50b6a1af7c.
Its current POSIX mode is0600, already recorded as384 by decoder-v3/SEAL.json.
The v3 final seal incorrectly declares0644 (420). The byte hash and size
match exactly. build-preseal.mjs identity() hard-codes420 for generated
control identities, conflating a Git regular-file mode with POSIX capture
permissions. No evidence supports calling this a byte mutation.

## Disposition and resume boundary

The source-admission stop is preserved, not retried. No chmod, seal rewrite,
expectation change, product change, or new runtime authorization receipt was
performed. A future narrow successor must distinguish authenticated capture
mode0600 from source-file0644; it must not weaken mode checks or mutate the
original evidence. Another admission/run requires root disposition of this
stop. The current conditional actual review was never launched.

DATA evidence is9273c71437a36be97bc4eb5db5640131cd9543b4; decoder source
5b7290ff14dec6af96bcdbde25d6c73ec8da8500. DATA and source checking together
used two controller processes, no subprocesses. Source check captured194
bytes before its final receipt; exact receipt size/hash are in STOP.json.
All raw receipts remain in this owned scope, with original permissions.

S02 and H09 remain source-only/unqualified as previously documented. No
M1A, native-allocation, codec-retirement, or mapped-resource acceptance is
inherited. There is no additional author/product correction request.
