# Version2 bounded tool-copy correction

Version1 source/preseal e9a24c6e remains immutable. Its controller rejected already-authenticated typescript/lib/typescript.js at an inconsistent8MiB in-memory copy-helper bound. Zero compiler/DATA children, zero controls and zero Workers executed. RUN-v1/RESULT.json is retained, not rescored. No input growth, child-retirement or capture failure was observed.

Version2 changes only controller copy mechanics: same241 sealed development inputs; reauthenticate each row, copy exactly its known size in65536-byte chunks, complete every write, independently close both descriptors, preserve primary presence, hash/size verify output. No text decoding of tool bodies, no new tool/read root/permission/case. Original128MiB per-file authentication bound and256MiB work bound unchanged; no quota increase. Fresh RUN-v2 and PRESEAL-v2; same seven source rows/pinned b5/3compiler+1pure process/12cases. The original cohort is UNRUN, not0passes.
