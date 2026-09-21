# Remote MCP artifact QA

Execute the following checks as an agent using the built `safe-bash-mcp`
workspace. Keep temporary host fixtures and outputs in
`out/remote-mcp-artifact-qa`, then purge them after inspection.

1. Register the management command in a real safe-bash Shell with a small static
   remote registry and supplied tool schema. Render `mcp generate --help` and
   `mcp generate --format config` with the maintained generic screenshot renderer
   (`scripts/screenshot.ts`). Inspect both images for clipping, readable command
   names, formats, credential guidance and schema indentation.
2. Generate the same registry twice. Compare JSON/module bytes and content
   digests. No timestamp, temporary output path or environment credential value
   may be introduced by generation.
3. Write the ESM data module to the temporary evidence directory. Change the
   invoking process working directory and import it by absolute path. It must
   require no runtime dependency imports or relative filesystem configuration.
4. Parse the imported data through the public artifact parser. Bind it to
   explicit runtime credentials and register its plugin in a safe-bash Shell.
   Help must work without network discovery. Use synthetic HTTP tool calls for
   functional validation; do not query a live third-party service.
5. Record the observed results in the main remote MCP progress ledger. Remove
   only this QA's fixture and output directory.
6. Repeat generation with external input/output references and a generation
   `schemaRegistry`. Run a local HTTP MCP endpoint, then load the written ESM
   module in a separate process from cwd `/` without supplying another registry.
   Verify schema-derived help, string identity preservation and structured
   output validation. Loading must not perform another tools/list request.
   Compare repeated JSON/module bytes, inspect the archived registry screenshot,
   and verify no synthetic runtime credential appears in the archive.
