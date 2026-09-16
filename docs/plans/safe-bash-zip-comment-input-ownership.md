# ZIP comment input ownership

Release 35017363897 failed with TS2322: a general Uint8Array input chunk cannot
be assigned to the cursor's ArrayBuffer-backed storage. A failing memory test also
shows borrowed unread bytes can change when the host reuses a chunk between
entry-comment reads.

Admit the entire acquired chunk against the remaining comment input byte budget,
then copy it into owned ArrayBuffer-backed cursor storage before retaining it.
Preserve the shared cursor, line grammar, cancellation drainage and prepublication
failure behavior. Validate with focused ZIP/unzip tests, lint and GitHub build;
local success does not establish release publication.
