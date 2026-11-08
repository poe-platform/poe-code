# Narrow primary-source checks

Consulted August 27, 2026, independently of source assertions and local execution.

- Node.js v22.15.0 Worker threads documentation, worker.terminate section:
  `https://nodejs.org/download/release/v22.15.0/docs/api/worker_threads.html`
  documents asynchronous termination with its promise resolving at the exit
  event. Thus unref or starting termination is not equivalent to awaited exit.
  Runtime here is v22.22.2; fetching that exact documentation URL failed, so the
  cited documentation minor is explicitly qualified. Actual lifecycle evidence
  comes from exact Worker observers running the installed runtime, not docs alone.
- ripgrep 15.2.0 upstream GUIDE, automatic/manual filtering:
  `https://github.com/BurntSushi/ripgrep/blob/15.2.0/GUIDE.md`
  explains .ignore precedence, negation and -g filename overrides. Actual frozen
  oracle is local ripgrep 15.2.0 (rev e89fff89ac), with --no-config, --sort path,
  --color never and isolated fixture cwd/HOME. Seven declared byte/status cases
  pass; broader semantic coverage is not inferred from this small cohort.

Neither reference is evidence of a hard real-time guarantee, total process
memory containment, deployed backend behavior or product acceptance.
