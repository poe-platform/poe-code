# Bounded public-system startup reference check

One source/DATA Node helper, no child processes. Read only two explicit public
system manual paths, `/usr/share/man/man1/zsh.1` and
`/usr/share/man/man1/zshfiles.1`, after regular-file metadata admission; at most
1MiB each. Do not resolve or read user startup files, private paths, binary
tools as text, network references or crash logs. Retain complete admitted
manual bytes as DATA and only relevant startup excerpts for source inspection.

Purpose: the actual approval invokes the tool's `/bin/zsh` with login=false,
whereas our controlled derivative invokes zsh with an explicit owned HOME.
Determine from available public local documentation whether non-login alone
establishes no ambient startup. This is not another runtime control, probe or
claim that any user's startup file exists/ran. Missing manuals remain unknown.
