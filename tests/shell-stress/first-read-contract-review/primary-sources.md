# Primary documentation consulted (2026-08-27)

Documentation is distinct from executed native evidence. Required `web.run`
searches retrieved official GNU text; repeated full-page opens of GNU and the
exact Node 22.22.2 page did not return usable content. No secondary explanation
substitutes for GNU. URLs below are the official retrieval/search targets.
Clauses are paraphrased, not a new virtual-bash requirement.

| Source URL | Relevant clause and limit |
| --- | --- |
| https://www.gnu.org/software/bash/manual/html_node/index.html | Manual identifies itself as edition 5.3, dated May 18, 2025, for Bash 5.3. This is manual edition, not evidence of the installed executable's version; native-profile separately authenticates that. |
| https://www.gnu.org/software/bash/manual/html_node/Pipelines | Section 3.2.3 connects each command's output to the next command's input; synchronous pipelines wait for all component commands. Pipeline status is last stage by default, rightmost nonzero under pipefail. Official indexed page content retrieved with web.run; `.html` and `/s/bash/` aliases were also searched. No reader-demand JavaScript API or automatic pre-write upstream termination is specified. |
| https://www.gnu.org/s/bash/manual/html_node/Exit-Status.html | Section 3.7.5 uses 128 plus signal number for fatal-signal termination. Native profile records SIGPIPE=13; observed producer 141 is not an invented generic cancellation status. |
| https://nodejs.org/docs/latest-v22.x/api/webstreams.html | Retrieved documentation identifies itself as Node 22.23.2, not the executed Node 22.22.2. Web Streams distinguish sources, sinks, transforms, queue strategies and readers. Writer ready concerns readiness to use the writer; write appends to a queue. These are not a host promise that a command starts only after its downstream JavaScript consumer calls next. |
| https://nodejs.org/download/release/v22.20.0/docs/api/webstreams.html | Official indexed primary text corroborates writer ready, write queueing, abort, close, desiredSize and errors for this API generation. Not substituted as the executed runtime. |
| https://expressjs.com/en/guide/writing-middleware/ | The current middleware can perform work before passing control with next; without ending the response or passing control, request progress can stall. Its async cookie validation example waits before next. This supports the structural dependency analysis, not an Express execution claim or an Express Promise-returning-next guarantee. |

The exact package contracts, not Node or Express documentation, govern virtual
ByteSink and middleware. In this package Next returns a Promise and must be
awaited/returned. Express's next convention is not that promise contract.

Express runtime availability was checked via package resolution anchored at this
repository and its isolated benchmarks package: both MODULE_NOT_FOUND. Nothing
installed. C2 executes real Shell.use middleware plus a response-like byte sink;
it is **not** an executed Express server or Node HTTP middleware integration.
The original HTTP fixtures execute real Node loopback HTTP for the three HTTP
cases; those are likewise not Express.

Native pipelines use authenticated GNU Bash 5.3.0 on Darwin, explicit C locale,
umask 022, Bash builtins and authenticated Darwin /bin/sleep. GNU/Linux, Apple
Bash 3.2, GNU head, remote provider deployments and Express runtime behavior were
not executed. No all-Bash or cross-platform equivalence claim follows.
