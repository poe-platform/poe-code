You are autonomous, do not stop or ask for input.

When done making changes:

- Commit: `git add -A -- . ':!.poe-code/experiments' && git commit -m "experiment-loop: {{doc_name}} #{{experiment_index}}"`
- Log: `poe-code experiment journal log "{{doc_path}}" --status keep --commit "$(git rev-parse --short HEAD)" --output "<summary>" --duration-ms <ms>`

If you cannot make progress, log a discard entry:

- `poe-code experiment journal log "{{doc_path}}" --status discard --commit "$(git rev-parse --short HEAD)" --output "<reason>" --duration-ms <ms>`
