export const defaultRunYaml = `# Default experiment context template.
# Override by placing a project run.yaml in .poe-code/experiments/.
# Add extends: true there to inherit from ~/.poe-code/experiments/run.yaml or this bundled default.
#
# Available variables:
#   {{body}}                 — experiment doc body (markdown below the frontmatter)
#   {{journal}}              — formatted journal of prior attempts
#   {{metrics}}              — metric definitions with direction and baseline scores
#   {{experiment_index}}     — current experiment number (1-based)

prompt: |
  {{body}}

  ## Metrics

  {{metrics}}

  ## Journal

  {{journal}}
`;

export const defaultInstructions = `You are autonomous, do not stop or ask for input.

When done making changes:

- Commit: \`{{commit_command}}\`
- Log: \`poe-code experiment journal log "{{doc_path}}" --status keep --commit "$(git rev-parse --short HEAD)" --output "<summary>" --duration-ms <ms>\`

If you cannot make progress, log a discard entry:

- \`poe-code experiment journal log "{{doc_path}}" --status discard --commit "$(git rev-parse --short HEAD)" --output "<reason>" --duration-ms <ms>\`
`;
