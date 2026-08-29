const cohorts = [['public', './public.mjs', 45], ['apply', './apply-public.mjs', 28], ['redirections', './redirections.mjs', 48], ['strict', './strict.mjs', 50], ['arrays', './arrays.mjs', 12], ['coherence', './coherence/probe.mjs', 18]];
let failed = false;
for (const [name, specifier, expected] of cohorts) {
 console.log(JSON.stringify({ retainedBegin: name, expected }));
 process.exitCode = 0;
 await import(specifier);
 failed ||= process.exitCode !== 0;
 console.log(JSON.stringify({ retainedEnd: name, exitCode: process.exitCode ?? 0 }));
}
process.exitCode = failed ? 1 : 0;

