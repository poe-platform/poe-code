# Pure source-reader role

Only read.mjs may execute for source inspection. Builtins fs/path/crypto only;
no product import, parser, engine, Worker, compiler or subprocess. Exact retained
SEAL and COMPILED hashes are literal admission inputs. Text reads are regular,
no-link and <=2MiB each. Reads are explicit below retained candidate, contracts,
CASEMAP and v1 harness; no instruction files are copied into captures. The
reader records source hashes and reports whether each source member was directly
matched to the admitted source manifest, rather than assuming that fact.

Entry is copied byte-exact to /private/tmp/safe-bash-core70-v3-20260829/read.mjs;
shell shasum admits that copy against the same source before execution. External
read.stdout/read.stderr are connected before Node startup. Deadline is START's
finite 20-minute total. This role cannot launch children and is PURE role1 of4.
