# Poe agent native shell QA

Run these scenarios against the maintained built shell plugin and real Node spawn. Unit fixtures cover lifecycle state and notification behavior with deterministic child streams.

1. Create the plugin with a disposable allowed working directory and a ToolContext with an AbortSignal. Capture notification events; dispose the plugin and kill every child even on failure.
2. Start a background Node command that writes ready plus a newline and then remains alive. Verify a string handle, buffered ready output, and a shell.stdout notification containing background true, the command, cwd, handle, and stdout stream. Kill the handle, verify the exact Killed background command response, then verify read_background reports Status: exited.
3. Run a foreground command that writes 140,000 x characters followed by tail-marker. Verify an output-truncated marker, the tail-marker, and retained output shorter than 132,000 characters.
4. Repeat that output in a live background command. Verify the truncation marker, tail-marker, and retained output shorter than 132,500 characters, then kill and dispose the job.
5. Run a foreground command producing partial stdout and partial stderr before staying alive. After both streams have been observed, exercise its 0.5-second timeout and verify the timeout diagnostic retains both streams. Abort and clean up the command afterward.
6. Run a foreground command producing ready on stdout and warn on stderr. Verify ordered shell.stdout and shell.stderr notifications with background false, command, cwd, stream, and the exact newline-terminated messages.
7. Repeat foreground ready output with a notify callback returning a promise that never settles. Verify the command still completes with ready output and the callback was invoked; its unresolved result must not block completion.
8. Measure active lifecycle deadlines after child readiness, so native process startup is separate from the behavior being exercised. Store evidence under out, inspect it, then purge only that temporary evidence.
