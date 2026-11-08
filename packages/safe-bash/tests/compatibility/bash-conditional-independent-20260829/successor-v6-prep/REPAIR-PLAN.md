# Exact-byte staging repair preseal

Original ca670096 failed copies remain untouched. Six harmless controls: terminal LF, no LF, repeated blank lines, UTF-8 BOM, empty bytes, and BOM/Unicode/NUL without terminal LF. B06 also rejects a wrong digest before file creation. No byte trimming or text newline reconstruction is performed by staging: authenticated Git blob or presealed base64 payload bytes are written and byte-compared directly.

Nineteen fixture hashes remain exactly those in the original PRESEAL. Sixteen input sources are stored immutable Git blobs (15 author fixtures and original independent NOVEL-CASES). Three reviewer-created payloads are preserved as base64 byte seeds authenticated by the original committed intended SHA256; they are not read/trimmed from failed copies. The one-line fallback seed is the original source byte payload, not a new expected output.

Run --controls first, then --stage once only if controls close cleanly. Each stage has outer raw shell capture before Node startup; source helper owns/reaps its sole Git metadata child. No product imports/build/compiler/npm/Worker/native/private/network. Any new integrity/capture/retirement failure stops dependent work. Root authorizes completion of a separate executable preseal after these pass; this repair seal itself does not activate product testing.

