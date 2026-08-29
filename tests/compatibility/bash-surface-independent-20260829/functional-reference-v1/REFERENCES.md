# Primary references and limits

Retrieved August29,2026 through web.run. These are source-family/normative references, not an authenticated reconstruction of the installed Apple binary. No native observations were made.

- Apple published Bash3.2 redirection source: https://raw.githubusercontent.com/apple-oss-distributions/bash/main/bash-3.2/redir.c — here_document_to_fd uses MT_USERANDOM and temporary-file creation/reopen/unlink for here-documents/strings (lines345–412,765–812).
- Apple published temp helper: https://raw.githubusercontent.com/apple-oss-distributions/bash/main/bash-3.2/lib/sh/tmpfile.c — get_tmpdir gates TMPDIR on MT_USETMPDIR; otherwise system temp selection (lines54–98,142–178). This is why B26/B27 are withheld; not attribution for any earlier SIGABRT.
- Apple read builtin: https://raw.githubusercontent.com/apple-oss-distributions/bash/main/bash-3.2/builtins/read.def — option grammar ersa:d:n:p:t:u:, no uppercase N in this source (lines20–43,168–239).
- Apple exec builtin: https://raw.githubusercontent.com/apple-oss-distributions/bash/main/bash-3.2/builtins/exec.def — no-argument exec preserves redirects; an argument enters command search/exec (lines114–135,181–201). Does not prove how the pinned parser tokenizes B28.
- Apple execution source: https://raw.githubusercontent.com/apple-oss-distributions/bash/main/bash-3.2/execute_cmd.c — pipeline/subshell/disk-command paths are distinct. Source-level fork reservations are not a runtime birth/exit census.
- Apple release NEWS: https://raw.githubusercontent.com/apple-oss-distributions/bash/main/bash-3.2/NEWS — earlier pipefail, here-string and append features; release-family history does not qualify all current-manual features on3.2.
- GNU current execution environment: https://www.gnu.org/software/bash/manual/html_node/Command-Execution-Environment.html — separate environments for pipelines/substitution/subshells; not a 3.2 binary observation.
- GNU redirection manual: https://www.gnu.org/software/bash/manual/html_node/Redirections.html — redirections can open paths and special network names; all literal paths were audited, none uses /dev/tcp or /dev/udp. Fresh env is not an OS filesystem/network fence.

No copied implementation, full external source archive, native probe, installation or private read is part of this packet.
