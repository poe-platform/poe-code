# Dry-run tasks comment posts a GitHub issue comment

## Summary

Running `tasks comment` against a `gh-issues` task backend with root `--dry-run` still issues the GraphQL `AddComment` mutation.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable workflow and local HTTPS GraphQL recorder

## Reproduction

From the repository root, run a disposable HTTPS server that returns enough mock GitHub GraphQL data for one issue and records each operation, then target it through `GH_HOST`:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/project"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$probe/key.pem" -out "$probe/cert.pem" \
  -days 1 -subj '/CN=127.0.0.1' >/dev/null 2>&1
cat > "$probe/server.mjs" <<'EOF'
import { createServer } from 'node:https';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
const server = createServer({ key: readFileSync(process.env.KEY), cert: readFileSync(process.env.CERT) }, (req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const payload = JSON.parse(body);
    appendFileSync(process.env.MARKER, `${payload.query.split('\n')[0]} ${JSON.stringify(payload.variables)}\n`);
    let data;
    if (payload.query.includes('query Project(')) {
      data = { organization: { projectV2: { id: 'project-id', title: 'Roadmap', field: { id: 'status-field', options: [{ id: 'status-todo', name: 'Todo' }, { id: 'status-done', name: 'Done' }] } } } };
    } else if (payload.query.includes('query Issue(')) {
      data = { repository: { issue: { number: 42, title: 'Probe issue', body: 'Body', url: 'https://example.invalid/42', createdAt: '2026-01-01T00:00:00Z', labels: { nodes: [] }, assignees: { nodes: [] }, milestone: null, projectItems: { nodes: [{ id: 'item-42', project: { id: 'project-id' }, fieldValueByName: { name: 'Todo' } }] } } } };
    } else if (payload.query.includes('query IssueId(')) {
      data = { repository: { issue: { id: 'issue-node-42' } } };
    } else if (payload.query.includes('mutation AddComment(')) {
      data = { addComment: { commentEdge: { node: { id: 'comment-probe' } } } };
    } else {
      data = {};
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data }));
  });
});
server.listen(0, '127.0.0.1', () => writeFileSync(process.env.PORT_FILE, String(server.address().port)));
EOF
KEY="$probe/key.pem" CERT="$probe/cert.pem" MARKER="$probe/graphql.log" PORT_FILE="$probe/port" node "$probe/server.mjs" &
server_pid=$!
while [ ! -s "$probe/port" ]; do sleep 0.05; done

cat > "$probe/project/WORKFLOW.md" <<'EOF'
---
tasks:
  type: gh-issues
  repo: octo/repo
  project:
    owner: octo-org
    number: 7
  auth:
    token: probe-token
states:
  Todo:
    prompt: Run it
  Done:
    terminal: true
---
# Workflow
EOF

(
  cd "$probe/project"
  NODE_TLS_REJECT_UNAUTHORIZED=0 GH_HOST="127.0.0.1:$(cat "$probe/port")" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run tasks comment 'octo-org/7#42' --message 'Ship under dry run'
)

cat "$probe/graphql.log"
kill "$server_pid"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command prints `[info] Commented on task octo-org/7#42.` while root `--dry-run` is active.
- The local GraphQL recorder receives `mutation AddComment($input: AddCommentInput!)` with body `Ship under dry run`.

## Expected Behavior

With root `--dry-run`, `tasks comment` must not post a GitHub comment or make any other mutation request. It should report the comment it would submit and target issue only.

## Impact

- A simulated task action posts externally visible comments to GitHub issues.
- Dry-run automation can generate notifications and irreversible discussion noise.
- Users cannot safely validate task-comment routing and payloads before sending them.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/tasks.ts`, `mergeCommandOptions(...)` propagates only `yes`, not root `dryRun`, and `runComment(...)` unconditionally calls the backend comment method. In `packages/task-list/src/backends/gh-issues.ts`, `comment(...)` sends the `ADD_COMMENT_MUTATION` GraphQL request.

## Suspected Area

Task mutating commands must accept root dry-run flags and short-circuit before backend mutation methods are invoked.
