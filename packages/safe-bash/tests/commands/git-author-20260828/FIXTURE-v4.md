# Author registry assertion correction

QeOTUt source and compiled both ended139/140. The single failure expected
Shell.use(plugin) to synchronously register/reject a duplicate. Selected coherent78
shell.ts109–134 explicitly queues setup on #ready; this author assertion targeted
the wrong boundary. No product change addresses this failure.

V4 calls the same plugin.setup against the actual exported CommandRegistry and
requires duplicate rejection, then requires explicit replace to work. Separately,
actual Shell.use + replacement is awaited through exec. The other139 cases are
unchanged. Original failure and source evidence remain retained, not rescored.
