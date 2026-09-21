# Remote MCP command contract QA

Execute as an agent against built safe-bash-mcp and native client packages.
Use a synthetic local HTTP MCP endpoint and keep fixtures under
out/remote-mcp-output-qa. Purge only this directory after recording results.

1. Supply schemas for a large-result tool, an isError result, a JSON-RPC error,
   an echo tool and a tool whose literal name includes the configured server
   prefix and a dot. Make schema discovery fail if attempted.
2. Run generated commands in a real safe-bash Shell. For a response larger than
   two MB containing multibyte UTF-8 text, compare complete stdout bytes,
   redirected virtual-file bytes and a pipeline through the standard cat command.
   Preserve content, structuredContent and metadata without rewriting fields.
3. Start the same built host in a child process with stdout connected to a real
   native pipe. The host's output sink must await process.stdout.write callbacks.
   Delay consuming the pipe for 500 ms; after resuming, compare every UTF-8 byte
   with the expected serialized result. No forced process exit belongs in this
   library; native hosts own their process lifecycle and pipe policy.
4. Write a complete JSON argument object to the shell's virtual filesystem with
   a string over 140 KB containing newlines, quotes, Unicode and literal shell
   syntax. Invoke --raw - with input redirection and output redirection. Verify
   exact server-received and echoed values, bounded input and no shell expansion.
   The @path named-string convention is intentionally not interpreted; @literal
   must stay literal and host filesystem reads must never be introduced.
5. Verify unknown tool arguments return 2 before connecting, isError and protocol
   failures return 1, and actual shell &&/|| conditions select the recovery branch.
   Preserve the full tool error result and protocol diagnostic code/data.
6. Invoke both a plain tool and a literal server-prefixed dotted tool. Generate
   an artifact, recreate a Shell, load its public plugin and verify the exact
   dotted name reaches the endpoint without rediscovery or name splitting.
7. Supply integer, boolean, object and item-enum arrays. Verify actual HTTP calls
   retain arrays and their item types, while invalid integer/enum values return
   2 before network access. Check archived schemas keep all item constraints;
   this CLI exposes schema-derived flags rather than synthetic TypeScript
   signatures or generated examples.
8. Record observations in docs/plans/remote-mcp-safe-bash.md and remove only the
   QA-owned fixtures and generated evidence.
