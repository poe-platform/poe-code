# Preserved metadata-only locator error

m04 queried a presumed v3/PUBLIC-ENGINE-RECEIPT.json location before checking
the author inventory. The Git batch naturally closed0 with four complete blobs
and an explicit missing-path line; the helper exited1 at that fifth record.
All36738 raw bytes, empty stderr and retirement are retained. This is an ordinary
captured helper locator mistake, not a missing accepted engine proof or product
failure. No target was admitted. A separate DATA decoder authenticates the four
already captured blobs without rerunning them; m05's immutable inventory supplies
the actual receipt location. No original result is rescored.
