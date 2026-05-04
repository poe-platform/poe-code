# Braintrust Integration QA

Execute this checklist against a real Braintrust workspace from a test checkout of `poe-code`.

1. [ ] Install the Braintrust SDK in the test workspace.
   ```sh
   npm i braintrust
   ```

2. [ ] Set a real Braintrust API key in the shell.
   ```sh
   export BRAINTRUST_API_KEY=...
   ```

3. [ ] Add this config fragment to `poe-code.config.json`.
   ```json
   {
     "integrations": {
       "braintrust": {
         "enabled": true,
         "apiKey": "${BRAINTRUST_API_KEY}",
         "project": "poe-code-qa"
       }
     }
   }
   ```

4. [ ] Run a spawn command and verify spawn tracing.
   ```sh
   npm run dev -- spawn --agent claude-code --prompt "say hi"
   ```
   Verify a single agent span appears in the Braintrust project's logs view, with tool-call children nested under it.

5. [ ] Run a pipeline and verify pipeline tracing.
   ```sh
   npm run dev -- pipeline run <demo-plan>
   ```
   Verify a root pipeline span appears with one child span per step. Verify each step contains a subagent span and tool calls. Verify token usage appears as numeric metrics in sortable columns, not as text in metadata.

6. [ ] Run an experiment and verify experiment tracing.
   ```sh
   npm run dev -- experiment run <demo-experiment>
   ```
   Verify one root span appears per run, with one iteration child span each. Verify the Braintrust experiments view includes a row per iteration, including discarded iterations with `kept=false`.

7. [ ] Run a superintendent plan and verify superintendent tracing.
   ```sh
   npm run dev -- superintendent run <demo-plan>
   ```
   Verify the span hierarchy is root -> round -> role -> agent -> tool.

8. [ ] Verify enabled-but-unconfigured bootstrap failure.
   Unset the API key while leaving `integrations.braintrust.enabled` as `true`.
   ```sh
   unset BRAINTRUST_API_KEY
   npm run dev -- spawn --agent claude-code --prompt "say hi"
   ```
   Expect the bootstrap error to include `missing apiKey`.

9. [ ] Verify missing SDK guidance.
   Remove or hide the `braintrust` package while leaving `integrations.braintrust.enabled` as `true`.
   ```sh
   npm uninstall braintrust
   npm run dev -- spawn --agent claude-code --prompt "say hi"
   ```
   Expect the error message to include `Run: npm i braintrust`.

10. [ ] Verify disabled mode emits no Braintrust traffic.
    Set `integrations.braintrust.enabled` to `false` and set `apiUrl` to an unreachable host.
    ```json
    {
      "integrations": {
        "braintrust": {
          "enabled": false,
          "apiKey": "${BRAINTRUST_API_KEY}",
          "apiUrl": "http://127.0.0.1:9",
          "project": "poe-code-qa"
        }
      }
    }
    ```
    Run a representative command and verify it completes without attempting Braintrust traffic.

11. [ ] Verify Braintrust status output in all supported states.
    ```sh
    poe-code braintrust status
    ```
    Run the status command with Braintrust disabled, enabled but unconfigured, and enabled healthy. Verify each state prints the expected status output.
