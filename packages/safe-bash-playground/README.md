# Safe Bash playground

Private, plain HTML/CSS/TypeScript playground with zero UI libraries, not zero
dependencies. The build-time alias `safe-bash-engine` pins `poe-code@14.0.4`;
its real shell is adapted and bundled into the site using the repository's
Vite/esbuild tooling. No engine or UI library is loaded from a CDN at runtime.

## Development

Use the repository's installed dependencies and build tools. From its root:

```sh
npm run dev --workspace packages/safe-bash-playground
npm run build --workspace packages/safe-bash-playground
npm run build:site --workspace packages/safe-bash-playground
npm run test:unit --workspace packages/safe-bash-playground
```

`dev` serves source files with Vite live reload at `http://127.0.0.1:5173/`,
using the same browser-engine plugin as the production build. If that port is
busy, Vite selects the next available port and prints its URL. `build` typechecks
and builds, while `build:site` only produces the static site. Serve `dist/site`
over HTTP rather than opening `index.html` through `file://`.

Application HTML, CSS, and TypeScript changes reload live. The engine plugin
also watches its browser shims and invalidates the compiled kernel when they
change. Changing the pinned engine dependency requires reinstalling it and
restarting `dev`.

Relative assets let the same output run beneath `/poe-code/safe-bash/` or another
static-host prefix. The existing Pages workflow stages it at `safe-bash/` in the
same artifact as the schemas and Toolcraft landing page.

## Configuration and environment

- Application environment variables: none.
- Runtime configuration files or required credentials: none.
- Production output: `dist/site`, rebuilt with relative assets and an ES2022
  target; keep the output location aligned with Pages staging.
- Development binds to `127.0.0.1` and requests port `5173`. Override CLI options
  after `--`, for example `npm run dev --workspace packages/safe-bash-playground -- --port 5174`.
- `vite.config.mjs` registers the browser-engine plugin for live development;
  production build configuration remains in `scripts/build.mjs`.
- Engine version: pinned by the package manifest, not selected at runtime.
- Session creation accepts no configuration options. Resource budgets are
  fixed in `src/session.ts` and `src/engine/index.ts`, as listed below.

## Sessions and uploads

Files, shell state, and command history live only in the current tab's memory.
Refreshing or closing the page loses the session. Reset asks for confirmation,
then restores the sample files and `/home` working directory, clears history,
and discards uploads, generated files, and unsaved edits. Download files first
if you want to keep them. There is no server-side storage or browser persistence.
Files and the working directory persist between submitted commands; variables
and function definitions do not persist across separate submissions.

- Uploads and editor saves are limited to **2 MiB per file**, measured in bytes;
  text edits use UTF-8 byte counts.
- The virtual workspace has a **16 MiB total budget**, including sample files.
  Shell writes are subject to this total budget, but may create files larger
  than the upload/editor per-file limit.
- There is no separate file-count limit; byte limits do not bound empty files.
- Uploads stay in memory under `/home/uploads`. Names are sanitized, collisions
  receive numeric suffixes, and a batch is size-checked before files are added.
  Binary uploads retain their bytes; the text editor does not edit binary data.

## Supported shell subset

This is the real Safe Bash interpreter, not native Bash or a host terminal.
It supports shell pipelines, redirection, variables, functions, loops, command
substitution, and shell scripts. Alongside shell builtins such as `cd` and `sh`,
`supportedCommands` exports these 28 registered browser commands:

```text
[ basename cat cp cut dirname echo false head ln ls mkdir mv printf pwd
readlink realpath rm rmdir sort tail tee test touch tr true uniq wc
```

The playground also registers `help`, which prints its current command list,
examples, and limits and works in pipelines. `clear` is a UI-only action when
entered alone, not a shell pipeline command.

There is no host-filesystem access, OS process spawning, or network-command
support. `curl`, `node`, `python`, `safejs`, `grep`, `rg`, `sed`, `awk`, and `jq`
are unavailable; the worker-backed `[[ ... =~ ... ]]` regular-expression
operation is also unavailable. Brace sequences such as `{1..10}` stay literal
rather than expanding. Python and JavaScript samples are editable source, not
executable runtimes. This subset is not fully Bash-compatible.

| Engine budget              | Limit  |
| -------------------------- | ------ |
| Captured output            | 64 KiB |
| Internal command buffer    | 2 MiB  |
| Commands per execution     | 1,000  |
| Loop iterations            | 1,000  |
| Command-substitution depth | 16     |
| Source text                | 16 KiB |
| Expansion fields           | 1,000  |
| Expansion bytes            | 64 KiB |
| Pipe high-water mark       | 16 KiB |

The session requests cooperative cancellation after **5 seconds**; this is not
an OS-enforced wall-clock deadline. A timeout reports exit status `124`. These
budgets do not provide a hard CPU or heap sandbox.
