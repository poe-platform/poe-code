# Pinned Node read permission path

Source authority: the public `fs.readSync` function of the admitted executable
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`, SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
The full bounded function text and its hash are in the preseal. No binary decoding,
external source download, private runtime or Node guest engine was used.

The function validates its buffer/offset, coerces length, and returns 0 immediately
when length is 0. Thus v1's zero-length call did not establish read permission.
For the new one-byte buffer, offset 0, length 1, position 0, the function passes
offset/length/position validation and returns `binding.read(fd, buffer, offset,
length, position)`. The early return is not taken. This is source-level evidence
for reaching Node's native read binding, not a native-binding implementation audit.

C07 supplies the runtime corroboration: both owned write-only descriptors reject
with `EBADF`, whereas empty readable descriptors return EOF and nonempty readable
descriptors return one byte. Wrong metadata refuses before the read. The positional
cursor check and byte-preservation checks pass. The read-only negative separately
confirms the retained write requirement. This combination establishes the intended
admission on this executable/platform without inferring access from mode bits.
