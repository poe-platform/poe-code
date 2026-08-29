# PIPESTATUS: source findings and ROOT choices

Status: Proposed. Implemented Through: Not applicable.

Reference is authenticated GNU 5.3 plus patches 001–015, inventory
`75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e`.
This is source evidence, not an executed 5.3 oracle. The only retained native
PIPESTATUS observation is B30 on local Apple Bash 3.2.57: bytes `PDE+CjwwPgo=`
(base64), status 0, empty stderr. It establishes that one ordered [1,0] result,
not startup, readonly, local restoration, or cleanup policy. All new cases UNRUN.

| Decision | Exact source basis | Recommendation / remaining choice | Proof |
|---|---|---|---|
| Initial state | variables.c:6299–6303 creates an absent variable only when a setter actually runs; 6413–6419 delegates singleton publication. This alone does not prove startup calls that setter. | Keep fresh [0] a proposed project startup rule until P02 observation; do not infer it from B30. Existing cloned states inherit their snapshot, not fresh initialization. Environment-imported scalar is a separate M01 case. | P02, M01 |
| Simple / assignment / function | execute_cmd.c:4628–4640 publishes null-command completion; 4896–4904 maps function result then publishes. | Publish only after argument/redirect expansion has seen the prior vector. Function body's commands update during invocation; final function result replaces it. | P03, P11, P14 |
| Pipeline and negation | jobs.c:4464–4488 constructs ordered process statuses; execute_cmd.c:1203–1222 inverts aggregate then explicitly publishes only arithmetic/conditional compounds there. | Keep stage vector independent of pipefail/simple-pipeline !; do not generalize that rule to ! [[ ]] / ! (( )). Qualify local3.2 separately. | P04–P08 |
| Group / skipped branch | execute_cmd.c:1214–1225 selects arith/cond, not every compound wrapper. | No universal wrapper singleton; preserve last actually executed command updates in braces/lists. Skipped branches do not update. Native process completion for a parenthesized subshell is separate. | P09, P10, P12 |
| Substitution isolation | variables.c:6380–6408 defines save/restore; subst.c:6999–7002 is a particular command-substitution path, not proof that every ordinary `$()` follows that exact branch. | Preserve child/parent isolation using existing state-copy ownership. Do not cite the optimized-substitution helper as universal `$()` execution evidence. P13 is still UNRUN. | P13 |
| Readonly indexed binding | variables.c:6299–6377 finds the variable, rejects non-array, then mutates the array; no readonly check in this setter. | Ratify narrowly privileged internal updates of readonly indexed PIPESTATUS. User assignment/unset must retain readonly protection. Never reuse BASH_REMATCH's diagnostic policy blindly or bypass all readonly checks. | P16, M03 |
| Absent vs scalar | variables.c:6299–6303 recreates absent but returns on a present non-array; 6400–6403 similarly refuses restore into non-array. | Adopt these distinct branches. Do not turn an inherited exported scalar into an exported array. Qualify invisibility/local creation separately; presence is not equivalent to visible indexed-array identity. | P17, M01 |
| Visible local binding | variables.c:6299 uses find_variable, not a dedicated global-only accessor. The local declaration's resulting type is a separate prerequisite. | Target the current visible binding, preserve its type and local unwind ownership; do not assume `local PIPESTATUS` is always a newly empty scalar or always a cloned array. P18 observes that exact form only, not all local -a/export/unset combinations. | P18 |
| Errexit / numeric errors | execute_cmd.c:4639,4904 and subst.c:12444–12458 show numeric publication paths before returns/nonlocal error cleanup. | Publish qualifying numeric results before applicable existing Flow exits; status2 is not an escaping host exception. Do not convert arbitrary rejections into numeric vector elements. | M02, M03 |
| Host cancellation / cleanup / allocation | GNU has no direct equivalent of this project's Promise/sink/cleanup contract. | ROOT must select: retain the last **already successfully published** snapshot if later completion rejects; drain admitted cooperative work, preserve caller > escaping execution/control > cleanup selection, and admit the entire replacement before mutation. Do not roll back genuine inner-command publications or invent 128+signal from a host reason. | M01–M03 |

## Concrete decisions requested

1. Ratify provisional fresh [0] as project policy only, or await P02 before choosing.
2. Ratify internal-only readonly indexed mutation + absent recreation + non-array
   preservation, with current-visible/local restoration, not a global override.
3. Ratify atomic budgeted publication and rejected-completion preservation above;
   choose an accepted ERE/core composition before author runtime edits.
4. Separately permit or withhold the exact two failed native lookups `function`
   (F06) and `__surface_missing_command__` (P15), only in a fresh owned empty PATH.
   Prior cohorts' failed-lookup grants do not authorize these cases.

The literal F05 observes final stdout/file effects; it does **not** independently
prove that `out` did not briefly appear at definition time. That temporal claim
needs an additional separately frozen observer/program, not a stronger label on
unchanged F05. Likewise P18 cannot settle every scalar/export/local interaction.
M01–M04 remain product-only UNRUN, outside this native cohort.
