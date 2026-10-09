use crate::backend::{CommandContext, CommandResult, RustCommand};
use crate::budget::ExecutionBudget;
use crate::commands::try_run_command;
use crate::shell::builtins::{
    BuiltinOutcome, eval_ere_match, eval_test_unary_predicate, is_test_unary_op,
    resolve_physical_path, try_run_builtin,
};
use crate::shell::expand::{
    bash_quote_double, decode_ansi_c_escapes, eval_arith, expand_double_quoted_at_expr,
    expand_globs_in_word_with_projection, expand_parameter_expr, expand_tilde_prefix,
    get_var_meta_info, glob_match_ext, has_glob_meta, resolve_nameref_base, resolve_var_key_mut,
    sync_array_metadata, try_resolve_unquoted_alternate_operand, write_dynamic_variable,
};
use crate::shell::parser::{
    AndOrList, CaseTerminator, CommandNode, ListOp, Pipeline, Redirect, RedirectKind, Script,
    SimpleCommand, is_incomplete_shell_unit, parse_script, parse_script_with_aliases,
    validate_basic_syntax,
};
use crate::vfs::{SafeBashFs, bytes_to_stream_string, resolve_posix_path, stream_string_to_bytes};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub enum EvalError {
    Syntax(String),
    Budget(String),
    UnportedCommand(String),
}

#[derive(Debug, Clone)]
pub enum FdTarget {
    Stdout,
    Stderr,
    File { path: String },
    Closed,
}

#[derive(Debug, Clone)]
pub struct CallerFrame {
    pub line: usize,
    pub name: Option<String>,
    pub file: String,
    pub routine: String,
}

pub struct EvalState<'a> {
    pub cwd: &'a mut String,
    pub env: &'a mut BTreeMap<String, String>,
    pub fs: &'a dyn SafeBashFs,
    pub budget: &'a ExecutionBudget,
    pub custom_commands: &'a BTreeMap<String, RustCommand>,
    pub functions: BTreeMap<String, Script>,
    pub exported_functions: BTreeSet<String>,
    pub func_stack: Vec<String>,
    pub caller_frames: Vec<CallerFrame>,
    pub caller_top_level: bool,
    pub script_name: Option<String>,
    pub current_line: usize,
    pub local_scopes: Vec<BTreeMap<String, Option<String>>>,
    pub fd_table: BTreeMap<u32, FdTarget>,
    pub in_fds: BTreeMap<u32, String>,
    pub traps: BTreeMap<String, String>,
    pub inactive_traps: BTreeMap<String, String>,
    pub trap_versions: BTreeMap<String, u64>,
    pub next_trap_version: u64,
    pub func_trap_snapshots: Vec<BTreeMap<String, u64>>,
    pub source_debug_snapshots: Vec<(Option<String>, Option<u64>)>,
    pub source_depth: usize,
    pub exit_trap_status: Option<i32>,
    pub exit_trap_ran: bool,
    pub explicit_exit: bool,
    pub sub_exit: Option<i32>,
    pub pos_args: Vec<String>,
    pub last_exit: i32,
    pub errexit: bool,
    pub nounset: bool,
    pub pipefail: bool,
    pub noclobber: bool,
    pub noexec: bool,
    pub xtrace: bool,
    pub in_condition: bool,
    pub in_trap: bool,
    pub in_pipeline_producer: bool,
    pub procsub_seq: usize,
    pub in_prefix_assignment: bool,
    pub pending_out_procsubs: Vec<(String, String)>,
    pub pending_stdout: String,
    pub pending_stderr: String,
    pub exit_requested: Option<i32>,
    pub return_requested: Option<i32>,
    pub break_count: usize,
    pub continue_count: usize,
    pub loop_depth: usize,
    pub active_aliases: BTreeSet<String>,
    pub allow_unported_fallback: bool,
}

impl<'a> EvalState<'a> {
    pub fn new(
        cwd: &'a mut String,
        env: &'a mut BTreeMap<String, String>,
        fs: &'a dyn SafeBashFs,
        budget: &'a ExecutionBudget,
        custom_commands: &'a BTreeMap<String, RustCommand>,
        allow_unported_fallback: bool,
    ) -> Self {
        let mut fd_table = BTreeMap::new();
        fd_table.insert(1, FdTarget::Stdout);
        fd_table.insert(2, FdTarget::Stderr);
        if !env.contains_key("PWD") {
            env.insert("PWD".to_string(), cwd.clone());
        }
        let errexit = env.get("__set_errexit").map(|v| v == "1").unwrap_or(false);
        let nounset = env.get("__set_nounset").map(|v| v == "1").unwrap_or(false);
        let pipefail = env.get("__set_pipefail").map(|v| v == "1").unwrap_or(false);
        let noclobber = env.get("__set_noclobber").map(|v| v == "1").unwrap_or(false);
        let last_exit = env
            .get("__last_exit")
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(0);
        let mut traps = BTreeMap::new();
        for (k, v) in env.iter() {
            if let Some(sig) = k.strip_prefix("__trap_inherited_ignored__")
                && v == "1"
            {
                traps.insert(sig.to_string(), String::new());
            }
        }
        Self {
            cwd,
            env,
            fs,
            budget,
            custom_commands,
            functions: BTreeMap::new(),
            exported_functions: BTreeSet::new(),
            func_stack: Vec::new(),
            caller_frames: Vec::new(),
            caller_top_level: false,
            script_name: None,
            current_line: 1,
            local_scopes: Vec::new(),
            fd_table,
            in_fds: BTreeMap::new(),
            traps,
            inactive_traps: BTreeMap::new(),
            trap_versions: BTreeMap::new(),
            next_trap_version: 1,
            func_trap_snapshots: Vec::new(),
            source_debug_snapshots: Vec::new(),
            source_depth: 0,
            exit_trap_status: None,
            exit_trap_ran: false,
            explicit_exit: false,
            sub_exit: None,
            pos_args: Vec::new(),
            last_exit,
            errexit,
            nounset,
            pipefail,
            noclobber,
            noexec: false,
            xtrace: false,
            in_condition: false,
            in_trap: false,
            in_pipeline_producer: false,
            procsub_seq: 0,
            in_prefix_assignment: false,
            pending_out_procsubs: Vec::new(),
            pending_stdout: String::new(),
            pending_stderr: String::new(),
            exit_requested: None,
            return_requested: None,
            break_count: 0,
            continue_count: 0,
            loop_depth: 0,
            active_aliases: BTreeSet::new(),
            allow_unported_fallback,
        }
    }

    fn make_child<'b>(
        &self,
        cwd: &'b mut String,
        env: &'b mut BTreeMap<String, String>,
    ) -> EvalState<'b>
    where
        'a: 'b,
    {
        let errtrace = self
            .env
            .get("__set_errtrace")
            .map(|v| v == "1")
            .unwrap_or(false)
            || self
                .env
                .get("__shopt_extdebug")
                .map(|v| v == "1")
                .unwrap_or(false);
        let functrace = self
            .env
            .get("__set_functrace")
            .map(|v| v == "1")
            .unwrap_or(false)
            || self
                .env
                .get("__shopt_extdebug")
                .map(|v| v == "1")
                .unwrap_or(false);
        let mut child_traps = BTreeMap::new();
        let mut child_inactive = self.inactive_traps.clone();
        for (k, v) in &self.traps {
            child_inactive.insert(k.clone(), v.clone());
            let keep_active = v.is_empty()
                || (k == "ERR" && errtrace)
                || ((k == "DEBUG" || k == "RETURN") && functrace);
            if keep_active {
                child_traps.insert(k.clone(), v.clone());
            }
        }
        let cur_subshell = env
            .get("BASH_SUBSHELL")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        env.insert("BASH_SUBSHELL".to_string(), (cur_subshell + 1).to_string());
        env.insert("__unexported__BASH_SUBSHELL".to_string(), "1".to_string());
        EvalState {
            cwd,
            env,
            fs: self.fs,
            budget: self.budget,
            custom_commands: self.custom_commands,
            functions: self.functions.clone(),
            exported_functions: self.exported_functions.clone(),
            func_stack: self.func_stack.clone(),
            caller_frames: self.caller_frames.clone(),
            caller_top_level: self.caller_top_level,
            script_name: self.script_name.clone(),
            current_line: self.current_line,
            local_scopes: Vec::new(),
            fd_table: self.fd_table.clone(),
            in_fds: self.in_fds.clone(),
            traps: child_traps,
            inactive_traps: child_inactive,
            trap_versions: self.trap_versions.clone(),
            next_trap_version: self.next_trap_version,
            func_trap_snapshots: self.func_trap_snapshots.clone(),
            source_debug_snapshots: self.source_debug_snapshots.clone(),
            source_depth: self.source_depth,
            exit_trap_status: None,
            exit_trap_ran: false,
            explicit_exit: false,
            sub_exit: None,
            pos_args: self.pos_args.clone(),
            last_exit: self.last_exit,
            errexit: if self.in_condition { false } else { self.errexit },
            nounset: self.nounset,
            pipefail: self.pipefail,
            noclobber: self.noclobber,
            noexec: self.noexec,
            xtrace: self.xtrace,
            in_condition: self.in_condition,
            in_trap: self.in_trap,
            in_pipeline_producer: self.in_pipeline_producer,
            procsub_seq: self.procsub_seq,
            in_prefix_assignment: false,
            pending_out_procsubs: Vec::new(),
            pending_stdout: String::new(),
            pending_stderr: String::new(),
            exit_requested: None,
            return_requested: None,
            break_count: 0,
            continue_count: 0,
            loop_depth: 0,
            active_aliases: self.active_aliases.clone(),
            allow_unported_fallback: self.allow_unported_fallback,
        }
    }

    pub fn eval_script_str(&mut self, script: &str, stdin: &str) -> Result<CommandResult, EvalError> {
        let mut stdin_buf = stdin.to_string();
        let mut out = self.eval_script_units(script, &mut stdin_buf)?;
        out.exit_code = self.exit_requested.unwrap_or(out.exit_code);
        self.last_exit = out.exit_code;
        self.run_exit_trap_if_needed(&mut out);
        let final_code = out.exit_code;
        Ok(CommandResult {
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: self.exit_requested.unwrap_or(final_code),
            cwd: self.cwd.clone(),
            env: self.env.clone(),
        })
    }

    fn active_alias_map(&self) -> BTreeMap<String, String> {
        let mut map = BTreeMap::new();
        if !self
            .env
            .get("__shopt_expand_aliases")
            .map(|v| v == "1")
            .unwrap_or(false)
        {
            return map;
        }
        for (k, v) in self.env.iter() {
            if let Some(name) = k.strip_prefix("__alias__") {
                map.insert(name.to_string(), v.clone());
            }
        }
        map
    }

    fn parse_with_current_aliases(&self, text: &str, line_offset: usize) -> Result<Script, String> {
        let aliases = self.active_alias_map();
        parse_script_with_aliases(text, &aliases, line_offset)
    }

    fn eval_script_units(
        &mut self,
        script_text: &str,
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        let needs_unit_loop = !self.active_alias_map().is_empty()
            || script_text.contains("alias")
            || script_text.contains("shopt");
        if !needs_unit_loop {
            if let Err(syn_err) = validate_basic_syntax(script_text) {
                return Err(EvalError::Syntax(syn_err));
            }
            let ast = parse_script(script_text).map_err(EvalError::Syntax)?;
            let parse_units: usize = ast.lists.iter().map(|l| 1 + l.rest.len()).sum();
            if parse_units > self.budget.limits.max_parse_units {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxParseUnits ({})",
                    self.budget.limits.max_parse_units
                )));
            }
            return self.eval_script(&ast, stdin);
        }

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut last_code = self.last_exit;
        let lines: Vec<&str> = script_text.split_inclusive('\n').collect();
        if lines.is_empty() {
            return Ok(BuiltinOutcome {
                stdout,
                stderr,
                exit_code: last_code,
            });
        }
        let mut unit_buf = String::new();
        let mut unit_start_line = 0usize;
        let mut total_parse_units = 0usize;
        for (idx, line) in lines.iter().enumerate() {
            if unit_buf.is_empty() {
                unit_start_line = idx;
            }
            unit_buf.push_str(line);
            let is_last = idx + 1 == lines.len();
            let aliases = self.active_alias_map();
            if !is_last && is_incomplete_shell_unit(&unit_buf, &aliases) {
                continue;
            }
            let ast = self
                .parse_with_current_aliases(&unit_buf, unit_start_line)
                .map_err(EvalError::Syntax)?;
            unit_buf.clear();
            let parse_units: usize = ast.lists.iter().map(|l| 1 + l.rest.len()).sum();
            total_parse_units += parse_units;
            if total_parse_units > self.budget.limits.max_parse_units {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxParseUnits ({})",
                    self.budget.limits.max_parse_units
                )));
            }
            let unit_out = self.eval_script(&ast, stdin)?;
            stdout.push_str(&unit_out.stdout);
            stderr.push_str(&unit_out.stderr);
            last_code = unit_out.exit_code;
            if self.exit_requested.is_some()
                || self.return_requested.is_some()
                || self.break_count > 0
                || self.continue_count > 0
                || crate::commands::is_timeout_expired()
                || (self.errexit && !self.in_condition && last_code != 0)
            {
                break;
            }
        }
        if !unit_buf.trim().is_empty() {
            let ast = self
                .parse_with_current_aliases(&unit_buf, unit_start_line)
                .map_err(EvalError::Syntax)?;
            let unit_out = self.eval_script(&ast, stdin)?;
            stdout.push_str(&unit_out.stdout);
            stderr.push_str(&unit_out.stderr);
            last_code = unit_out.exit_code;
        }
        Ok(BuiltinOutcome {
            stdout,
            stderr,
            exit_code: last_code,
        })
    }

    fn run_exit_trap_if_needed(&mut self, out: &mut BuiltinOutcome) {
        if self.exit_trap_ran || self.in_trap {
            return;
        }
        self.exit_trap_ran = true;
        if let Some(exit_handler) = self.traps.get("EXIT").cloned() {
            self.traps.remove("EXIT");
            self.inactive_traps.remove("EXIT");
            if exit_handler.is_empty() {
                return;
            }
            let orig_status = self.exit_requested.unwrap_or(out.exit_code);
            out.exit_code = orig_status;
            self.last_exit = orig_status;
            self.exit_trap_status = Some(orig_status);
            let prev_explicit = self.explicit_exit;
            self.exit_requested = None;
            self.in_trap = true;
            let mut empty_in = String::new();
            if let Ok(trap_out) = self.eval_script_units(&exit_handler, &mut empty_in) {
                out.stdout.push_str(&trap_out.stdout);
                out.stderr.push_str(&trap_out.stderr);
            }
            self.in_trap = false;
            self.exit_trap_status = None;
            if let Some(override_code) = self.exit_requested {
                out.exit_code = override_code;
            }
            self.last_exit = out.exit_code;
            self.exit_requested = Some(out.exit_code);
            self.explicit_exit = prev_explicit;
        }
    }

    fn fire_debug_trap(&mut self, bash_command: &str) -> (BuiltinOutcome, bool) {
        let mut debug_out = BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        };
        if self.in_trap {
            return (debug_out, false);
        }
        self.env
            .insert("BASH_COMMAND".to_string(), bash_command.to_string());
        let Some(dbg_handler) = self.traps.get("DEBUG").cloned() else {
            return (debug_out, false);
        };
        if dbg_handler.is_empty() {
            return (debug_out, false);
        }
        let functrace = self
            .env
            .get("__set_functrace")
            .map(|v| v == "1")
            .unwrap_or(false)
            || self
                .env
                .get("__shopt_extdebug")
                .map(|v| v == "1")
                .unwrap_or(false);
        let cur_ver = self.trap_versions.get("DEBUG").copied();
        if self.source_depth > 0
            && !functrace
            && self
                .source_debug_snapshots
                .last()
                .and_then(|(_, v)| *v)
                == cur_ver
        {
            return (debug_out, false);
        }
        if !self.func_stack.is_empty()
            && !functrace
            && self
                .func_trap_snapshots
                .last()
                .and_then(|m| m.get("DEBUG").copied())
                == cur_ver
        {
            return (debug_out, false);
        }
        let saved_exit = self.last_exit;
        self.in_trap = true;
        let mut empty_in = String::new();
        if let Ok(t_out) = self.eval_script_units(&dbg_handler, &mut empty_in) {
            debug_out.stdout.push_str(&t_out.stdout);
            debug_out.stderr.push_str(&t_out.stderr);
            debug_out.exit_code = t_out.exit_code;
        }
        self.in_trap = false;
        self.last_exit = saved_exit;
        let extdebug = self
            .env
            .get("__shopt_extdebug")
            .map(|v| v == "1")
            .unwrap_or(false);
        if extdebug && debug_out.exit_code != 0 {
            if debug_out.exit_code == 2 && (!self.func_stack.is_empty() || self.source_depth > 0) {
                self.return_requested = Some(2);
                debug_out.exit_code = 2;
                self.last_exit = 2;
            } else {
                debug_out.exit_code = self.last_exit;
            }
            return (debug_out, true);
        }
        (debug_out, false)
    }

    fn fire_err_trap(&mut self, out: &mut BuiltinOutcome) {
        if self.in_trap {
            return;
        }
        let Some(err_handler) = self.traps.get("ERR").cloned() else {
            return;
        };
        if err_handler.is_empty() {
            return;
        }
        let errtrace = self
            .env
            .get("__set_errtrace")
            .map(|v| v == "1")
            .unwrap_or(false)
            || self
                .env
                .get("__shopt_extdebug")
                .map(|v| v == "1")
                .unwrap_or(false);
        let cur_ver = self.trap_versions.get("ERR").copied();
        if !self.func_stack.is_empty()
            && !errtrace
            && self
                .func_trap_snapshots
                .last()
                .and_then(|m| m.get("ERR").copied())
                == cur_ver
        {
            return;
        }
        let saved_exit = self.last_exit;
        self.in_trap = true;
        let mut empty_in = String::new();
        if let Ok(trap_out) = self.eval_script_units(&err_handler, &mut empty_in) {
            out.stdout.push_str(&trap_out.stdout);
            out.stderr.push_str(&trap_out.stderr);
        }
        self.in_trap = false;
        if let Some(code) = self.exit_requested {
            out.exit_code = code;
            self.last_exit = code;
        } else {
            self.last_exit = saved_exit;
        }
    }

    fn eval_script(&mut self, script: &Script, stdin: &mut String) -> Result<BuiltinOutcome, EvalError> {
        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut last_code = self.last_exit;

        for list in &script.lists {
            if self.noexec || crate::commands::is_timeout_expired() {
                break;
            }
            self.budget.check_cancelled().map_err(EvalError::Budget)?;
            if list.background {
                let next_pid = self
                    .env
                    .get("__job_next_pid")
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(1001);
                self.env
                    .insert("__job_next_pid".to_string(), (next_pid + 1).to_string());
                let next_job_id = self
                    .env
                    .get("__job_next_id")
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(1);
                self.env
                    .insert("__job_next_id".to_string(), (next_job_id + 1).to_string());
                let pid_str = next_pid.to_string();
                self.env.insert("!".to_string(), pid_str.clone());

                let mut sub_cwd = self.cwd.clone();
                let mut sub_env = self.env.clone();
                let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
                sub.errexit = self.errexit;
                let mut fg_list = list.clone();
                fg_list.background = false;
                let cmd_display = format!(
                    "{} &",
                    format_script_node(
                        &Script {
                            lists: vec![fg_list.clone()],
                        },
                        "",
                        false
                    )
                );
                let mut empty_in = String::new();
                let bg_out = match sub.eval_and_or_list(&fg_list, &mut empty_in) {
                    Ok(mut o) => {
                        if let Some(code) = sub.exit_requested {
                            o.exit_code = code;
                        }
                        o
                    }
                    Err(EvalError::Syntax(msg)) => BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{}\n", msg.strip_prefix("__param_err__").unwrap_or(&msg)),
                        exit_code: 1,
                    },
                    Err(e) => return Err(e),
                };
                stdout.push_str(&bg_out.stdout);
                stderr.push_str(&bg_out.stderr);
                self.env
                    .insert(format!("__job_status__{pid_str}"), bg_out.exit_code.to_string());
                self.env
                    .insert(format!("__job_active__{pid_str}"), "1".to_string());
                self.env
                    .insert(format!("__job_id__{pid_str}"), next_job_id.to_string());
                self.env
                    .insert(format!("__job_cmd__{pid_str}"), cmd_display);
                last_code = 0;
                self.last_exit = 0;
                continue;
            }
            let out = match self.eval_and_or_list(list, stdin) {
                Ok(o) => o,
                Err(EvalError::Syntax(msg)) => {
                    let is_param_err = msg.starts_with("__param_err__");
                    let clean_msg = msg.strip_prefix("__param_err__").unwrap_or(&msg);
                    stderr.push_str(&format!("{clean_msg}\n"));
                    let is_subshell = self
                        .env
                        .get("BASH_SUBSHELL")
                        .and_then(|s| s.parse::<u32>().ok())
                        .unwrap_or(0)
                        > 0;
                    let code = if is_param_err && !is_subshell { 127 } else { 1 };
                    last_code = code;
                    self.last_exit = code;
                    self.exit_requested = Some(code);
                    break;
                }
                Err(e) => return Err(e),
            };
            self.budget
                .record_stdout(out.stdout.len())
                .map_err(EvalError::Budget)?;
            self.budget
                .record_stderr(out.stderr.len())
                .map_err(EvalError::Budget)?;
            if !self.pending_stdout.is_empty() {
                stdout.push_str(&std::mem::take(&mut self.pending_stdout));
            }
            if !self.pending_stderr.is_empty() {
                stderr.push_str(&std::mem::take(&mut self.pending_stderr));
            }
            stdout.push_str(&out.stdout);
            stderr.push_str(&out.stderr);
            last_code = out.exit_code;
            self.last_exit = last_code;

            if self.exit_requested.is_some()
                || self.return_requested.is_some()
                || self.break_count > 0
                || self.continue_count > 0
                || crate::commands::is_timeout_expired()
            {
                break;
            }
            if self.errexit && !self.in_condition && last_code != 0 {
                self.exit_requested = Some(last_code);
                break;
            }
        }

        Ok(BuiltinOutcome {
            stdout,
            stderr,
            exit_code: last_code,
        })
    }

    fn eval_and_or_list(
        &mut self,
        list: &AndOrList,
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        let has_rest = !list.rest.is_empty();
        let prev_cond = self.in_condition;
        if has_rest {
            self.in_condition = true;
        }
        let mut first_out = self.eval_pipeline(&list.first, stdin)?;
        self.in_condition = prev_cond;
        self.last_exit = first_out.exit_code;
        let mut ran_final = list.rest.is_empty();
        let mut last_negated = list.first.negated;
        let mut final_publishes_err = list.first.commands.len() > 1
            || list.first.commands.first().is_some_and(|c| {
                matches!(
                    c,
                    CommandNode::Simple(_)
                        | CommandNode::Subshell { .. }
                        | CommandNode::ArithCommand(_)
                )
            });

        for (idx, (op, pipe)) in list.rest.iter().enumerate() {
            if self.exit_requested.is_some()
                || self.return_requested.is_some()
                || self.break_count > 0
                || self.continue_count > 0
                || crate::commands::is_timeout_expired()
            {
                break;
            }
            let should_run = match op {
                ListOp::And => first_out.exit_code == 0,
                ListOp::Or => first_out.exit_code != 0,
            };
            if should_run {
                let is_last = idx + 1 == list.rest.len();
                ran_final = is_last;
                last_negated = pipe.negated;
                final_publishes_err = pipe.commands.len() > 1
                    || pipe.commands.first().is_some_and(|c| {
                        matches!(
                            c,
                            CommandNode::Simple(_)
                                | CommandNode::Subshell { .. }
                                | CommandNode::ArithCommand(_)
                        )
                    });
                let prev_c = self.in_condition;
                if !is_last {
                    self.in_condition = true;
                }
                let next_out = self.eval_pipeline(pipe, stdin)?;
                self.in_condition = prev_c;
                first_out.stdout.push_str(&next_out.stdout);
                first_out.stderr.push_str(&next_out.stderr);
                first_out.exit_code = next_out.exit_code;
                self.last_exit = next_out.exit_code;
            }
        }

        if first_out.exit_code != 0
            && ran_final
            && final_publishes_err
            && !self.in_condition
            && !last_negated
            && !self.in_trap
            && self.exit_requested.is_none()
            && self.return_requested.is_none()
        {
            self.fire_err_trap(&mut first_out);
        }

        Ok(first_out)
    }

    fn set_pipestatus(&mut self, codes: &[i32]) {
        let old_keys: Vec<String> = self
            .env
            .keys()
            .filter(|k| k.starts_with("PIPESTATUS["))
            .cloned()
            .collect();
        for k in old_keys {
            self.env.remove(&k);
        }
        for (i, c) in codes.iter().enumerate() {
            self.env.insert(format!("PIPESTATUS[{i}]"), c.to_string());
        }
        sync_array_metadata("PIPESTATUS", self.env);
    }

    fn sync_funcname(&mut self) {
        let old_keys: Vec<String> = self
            .env
            .keys()
            .filter(|k| k.starts_with("FUNCNAME["))
            .cloned()
            .collect();
        for k in old_keys {
            self.env.remove(&k);
        }
        if self.func_stack.is_empty() {
            self.env.remove("FUNCNAME[#]");
            self.env.remove("FUNCNAME[*]");
            self.env.remove("FUNCNAME[@]");
            self.env.remove("__keys__FUNCNAME");
        } else {
            for (i, f) in self.func_stack.iter().enumerate() {
                self.env.insert(format!("FUNCNAME[{i}]"), f.clone());
            }
            sync_array_metadata("FUNCNAME", self.env);
        }
    }

    fn eval_pipeline(&mut self, pipe: &Pipeline, stdin: &mut String) -> Result<BuiltinOutcome, EvalError> {
        if pipe.commands.is_empty() {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            });
        }

        if pipe.commands.len() > self.budget.limits.max_pipeline_stages {
            return Err(EvalError::Budget(format!(
                "Execution aborted: Shell limit exceeded: maxPipelineStages ({})",
                self.budget.limits.max_pipeline_stages
            )));
        }

        let prev_cond = self.in_condition;
        if pipe.negated {
            self.in_condition = true;
        }

        if pipe.commands.len() == 1 {
            let res = self.eval_command_node(&pipe.commands[0], stdin);
            self.in_condition = prev_cond;
            let mut out = res?;
            let raw_code = out.exit_code;
            self.set_pipestatus(&[raw_code]);
            if pipe.negated {
                out.exit_code = if out.exit_code == 0 { 1 } else { 0 };
            }
            self.last_exit = out.exit_code;
            return Ok(out);
        }

        let mut cur_stdin = std::mem::take(stdin);
        let mut combined_stderr = String::new();
        let mut stage_codes = Vec::with_capacity(pipe.commands.len());

        if !self.in_trap {
            for cmd_node in &pipe.commands {
                match cmd_node {
                    CommandNode::Simple(s) => {
                        let mut parts = Vec::new();
                        for (k, v, app) in &s.assignments {
                            parts.push(format!("{k}{}{v}", if *app { "+=" } else { "=" }));
                        }
                        parts.extend(s.words.iter().cloned());
                        self.env.insert("BASH_COMMAND".to_string(), parts.join(" "));
                    }
                    CommandNode::ArithCommand(expr) => {
                        self.env
                            .insert("BASH_COMMAND".to_string(), format!("(({expr}))"));
                    }
                    _ => {}
                }
            }
        }

        for (idx, cmd_node) in pipe.commands.iter().enumerate() {
            let is_last = idx + 1 == pipe.commands.len();
            let mut sub_cwd = self.cwd.clone();
            let mut sub_env = self.env.clone();
            let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
            sub.fd_table.insert(1, FdTarget::Stdout);
            if !is_last {
                sub.in_pipeline_producer = true;
            }
            let stage_res = sub.eval_command_node(cmd_node, &mut cur_stdin);
            let mut stage_out = match stage_res {
                Ok(o) => o,
                Err(e) => {
                    self.in_condition = prev_cond;
                    return Err(e);
                }
            };
            if let Some(code) = sub.exit_requested {
                stage_out.exit_code = code;
            }
            sub.run_exit_trap_if_needed(&mut stage_out);
            combined_stderr.push_str(&stage_out.stderr);
            stage_codes.push(stage_out.exit_code);
            cur_stdin = stage_out.stdout;
        }
        self.in_condition = prev_cond;

        self.set_pipestatus(&stage_codes);

        let mut final_code = if self.pipefail {
            stage_codes
                .iter()
                .rev()
                .copied()
                .find(|&c| c != 0)
                .unwrap_or(0)
        } else {
            *stage_codes.last().unwrap_or(&0)
        };

        if pipe.negated {
            final_code = if final_code == 0 { 1 } else { 0 };
        }
        self.last_exit = final_code;

        Ok(BuiltinOutcome {
            stdout: cur_stdin,
            stderr: combined_stderr,
            exit_code: final_code,
        })
    }

    fn eval_command_node(
        &mut self,
        node: &CommandNode,
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        self.budget.check_cancelled().map_err(EvalError::Budget)?;
        self.budget.tick_command().map_err(EvalError::Budget)?;
        match node {
            CommandNode::Simple(simple) => self.eval_simple_command(simple, stdin),
            CommandNode::Subshell { body, redirects } => {
                self.budget.enter_recursion().map_err(EvalError::Budget)?;
                let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    self.budget.leave_recursion();
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let mut sub_cwd = self.cwd.clone();
                let mut sub_env = self.env.clone();
                let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
                sub.fd_table.insert(1, FdTarget::Stdout);
                sub.fd_table.insert(2, FdTarget::Stderr);
                let res = sub.eval_script(body, eff_stdin);
                self.budget.leave_recursion();
                let mut out = match res {
                    Ok(o) => o,
                    Err(EvalError::Syntax(msg)) => {
                        let is_syn = msg.starts_with("Syntax error:");
                        BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{}\n", msg.strip_prefix("__param_err__").unwrap_or(&msg)),
                            exit_code: if is_syn { 2 } else { 1 },
                        }
                    }
                    Err(e) => return Err(e),
                };
                if let Some(code) = sub.exit_requested {
                    out.exit_code = code;
                }
                sub.run_exit_trap_if_needed(&mut out);
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                self.route_outcome(&mut out);
                self.restore_redirects(saved_fds, saved_in);
                Ok(out)
            }
            CommandNode::Group { body, redirects } => {
                let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
                let body_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
                let mut out = self.eval_script(body, eff_stdin)?;
                self.fd_table.insert(1, body_fd1);
                self.fd_table.insert(2, body_fd2);
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                self.route_outcome(&mut out);
                self.restore_redirects(saved_fds, saved_in);
                Ok(out)
            }
            CommandNode::If {
                branches,
                else_branch,
                redirects,
            } => {
                let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
                let body_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut executed = false;
                let mut code = 0;

                for (cond, body) in branches {
                    let prev_errexit = self.errexit;
                    let prev_cond = self.in_condition;
                    self.errexit = false;
                    self.in_condition = true;
                    let cond_out = self.eval_script(cond, eff_stdin)?;
                    self.errexit = prev_errexit;
                    self.in_condition = prev_cond;
                    stdout.push_str(&cond_out.stdout);
                    stderr.push_str(&cond_out.stderr);
                    if cond_out.exit_code == 0 {
                        let body_out = self.eval_script(body, eff_stdin)?;
                        stdout.push_str(&body_out.stdout);
                        stderr.push_str(&body_out.stderr);
                        code = body_out.exit_code;
                        executed = true;
                        break;
                    }
                }

                if !executed
                    && let Some(eb) = else_branch
                {
                    let eb_out = self.eval_script(eb, eff_stdin)?;
                    stdout.push_str(&eb_out.stdout);
                    stderr.push_str(&eb_out.stderr);
                    code = eb_out.exit_code;
                }

                self.fd_table.insert(1, body_fd1);
                self.fd_table.insert(2, body_fd2);
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.route_outcome(&mut out);
                self.restore_redirects(saved_fds, saved_in);
                Ok(out)
            }
            CommandNode::ForIn {
                var,
                items,
                body,
                redirects,
            } => {
                let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
                let body_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
                let mut expanded_items = Vec::new();
                for raw in items {
                    match self.expand_word_to_fields(raw) {
                        Ok(fields) => {
                            expanded_items.extend(fields);
                            if expanded_items.len() > self.budget.limits.max_expansion_fields {
                                self.fd_table.insert(1, body_fd1);
                                self.fd_table.insert(2, body_fd2);
                                self.restore_redirects(saved_fds, saved_in);
                                return Err(EvalError::Budget(format!(
                                    "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                                    self.budget.limits.max_expansion_fields
                                )));
                            }
                        }
                        Err(EvalError::Syntax(msg)) if msg.starts_with("bash: no match:") => {
                            self.fd_table.insert(1, body_fd1);
                            self.fd_table.insert(2, body_fd2);
                            let mut out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{msg}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut out);
                            self.restore_redirects(saved_fds, saved_in);
                            return Ok(out);
                        }
                        Err(e) => return Err(e),
                    }
                }
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;

                self.loop_depth += 1;
                let for_desc = format!("for {var} in {}", items.join(" "));
                for val in expanded_items {
                    crate::commands::tick_virtual_loop(self.env);
                    if crate::commands::is_timeout_expired() {
                        break;
                    }
                    self.budget.tick_iteration().map_err(EvalError::Budget)?;
                    if let Err(e) = self.assign_variable(var, &val, false) {
                        match e {
                            EvalError::Syntax(msg) if msg.contains("readonly variable") => {
                                stderr.push_str(&format!("{msg}\n"));
                                code = 1;
                                break;
                            }
                            other => {
                                self.loop_depth -= 1;
                                return Err(other);
                            }
                        }
                    }
                    let (dbg_out, skip_iter) = self.fire_debug_trap(&for_desc);
                    stdout.push_str(&dbg_out.stdout);
                    stderr.push_str(&dbg_out.stderr);
                    if self.exit_requested.is_some() || self.return_requested.is_some() {
                        code = dbg_out.exit_code;
                        break;
                    }
                    if skip_iter {
                        continue;
                    }
                    let step = self.eval_script(body, eff_stdin)?;
                    stdout.push_str(&step.stdout);
                    stderr.push_str(&step.stderr);
                    code = step.exit_code;
                    if self.exit_requested.is_some() || self.return_requested.is_some() {
                        break;
                    }
                    if self.break_count > 0 {
                        self.break_count -= 1;
                        break;
                    }
                    if self.continue_count > 0 {
                        self.continue_count -= 1;
                        if self.continue_count > 0 {
                            break;
                        }
                    }
                    if self.errexit && !self.in_condition && code != 0 {
                        break;
                    }
                }
                self.loop_depth -= 1;

                self.fd_table.insert(1, body_fd1);
                self.fd_table.insert(2, body_fd2);
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.route_outcome(&mut out);
                self.restore_redirects(saved_fds, saved_in);
                Ok(out)
            }
            CommandNode::Select {
                var,
                items,
                body,
                redirects,
            } => {
                let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
                let body_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
                let mut expanded_items = Vec::new();
                for raw in items {
                    match self.expand_word_to_fields(raw) {
                        Ok(fields) => {
                            expanded_items.extend(fields);
                            if expanded_items.len() > self.budget.limits.max_expansion_fields {
                                self.fd_table.insert(1, body_fd1);
                                self.fd_table.insert(2, body_fd2);
                                self.restore_redirects(saved_fds, saved_in);
                                return Err(EvalError::Budget(format!(
                                    "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                                    self.budget.limits.max_expansion_fields
                                )));
                            }
                        }
                        Err(EvalError::Syntax(msg)) if msg.starts_with("bash: no match:") => {
                            self.fd_table.insert(1, body_fd1);
                            self.fd_table.insert(2, body_fd2);
                            let mut out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{msg}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut out);
                            self.restore_redirects(saved_fds, saved_in);
                            return Ok(out);
                        }
                        Err(e) => {
                            self.fd_table.insert(1, body_fd1);
                            self.fd_table.insert(2, body_fd2);
                            self.restore_redirects(saved_fds, saved_in);
                            return Err(e);
                        }
                    }
                }
                if expanded_items.is_empty() {
                    self.fd_table.insert(1, body_fd1);
                    self.fd_table.insert(2, body_fd2);
                    if let Some(dfd) = dup_fd {
                        self.in_fds.insert(dfd, local_stdin);
                    }
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 0,
                    });
                }
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;
                let mut show_menu = true;

                self.loop_depth += 1;
                loop {
                    crate::commands::tick_virtual_loop(self.env);
                    if crate::commands::is_timeout_expired() {
                        break;
                    }
                    self.budget.tick_iteration().map_err(EvalError::Budget)?;
                    if show_menu {
                        stderr.push_str(&format_select_menu(&expanded_items, self.env));
                    }
                    let ps3 = self
                        .env
                        .get("PS3")
                        .cloned()
                        .unwrap_or_else(|| "#? ".to_string());
                    stderr.push_str(&ps3);
                    if stream_string_to_bytes(&stderr).len() + stream_string_to_bytes(&stdout).len()
                        > self.budget.limits.max_output_bytes
                    {
                        self.loop_depth -= 1;
                        self.fd_table.insert(1, body_fd1);
                        self.fd_table.insert(2, body_fd2);
                        self.restore_redirects(saved_fds, saved_in);
                        return Err(EvalError::Budget(format!(
                            "Execution aborted: Shell limit exceeded: maxOutputBytes ({})",
                            self.budget.limits.max_output_bytes
                        )));
                    }

                    let (line_bytes, terminated) =
                        select_read_line(eff_stdin, self.budget.limits.max_output_bytes)?;
                    let line_str = bytes_to_stream_string(&line_bytes);
                    if let Err(e) = self.assign_variable("REPLY", &line_str, false) {
                        match e {
                            EvalError::Syntax(msg) if msg.contains("readonly variable") => {
                                stderr.push_str(&format!("{msg}\n"));
                                stdout.push('\n');
                                code = 1;
                                break;
                            }
                            other => {
                                self.loop_depth -= 1;
                                self.fd_table.insert(1, body_fd1);
                                self.fd_table.insert(2, body_fd2);
                                self.restore_redirects(saved_fds, saved_in);
                                return Err(other);
                            }
                        }
                    }
                    if !terminated {
                        stdout.push('\n');
                        code = 1;
                        break;
                    }
                    if line_bytes.is_empty() {
                        show_menu = true;
                        continue;
                    }

                    let selected = match parse_select_choice(&line_bytes) {
                        Some(choice) if choice >= 1 && choice <= expanded_items.len() => {
                            expanded_items[choice - 1].clone()
                        }
                        _ => String::new(),
                    };
                    if let Err(e) = self.assign_variable(var, &selected, false) {
                        match e {
                            EvalError::Syntax(msg) if msg.contains("readonly variable") => {
                                stderr.push_str(&format!("{msg}\n"));
                                code = 1;
                                break;
                            }
                            other => {
                                self.loop_depth -= 1;
                                self.fd_table.insert(1, body_fd1);
                                self.fd_table.insert(2, body_fd2);
                                self.restore_redirects(saved_fds, saved_in);
                                return Err(other);
                            }
                        }
                    }

                    let step = self.eval_script(body, eff_stdin)?;
                    stdout.push_str(&step.stdout);
                    stderr.push_str(&step.stderr);
                    code = step.exit_code;

                    if self.exit_requested.is_some() || self.return_requested.is_some() {
                        break;
                    }
                    if self.break_count > 0 {
                        self.break_count -= 1;
                        break;
                    }
                    if self.continue_count > 0 {
                        self.continue_count -= 1;
                        if self.continue_count > 0 {
                            break;
                        }
                        show_menu = self
                            .env
                            .get("REPLY")
                            .map(|v| stream_string_to_bytes(v).is_empty())
                            .unwrap_or(true);
                        continue;
                    }
                    if self.errexit && !self.in_condition && code != 0 {
                        break;
                    }
                    show_menu = self
                        .env
                        .get("REPLY")
                        .map(|v| stream_string_to_bytes(v).is_empty())
                        .unwrap_or(true);
                }
                self.loop_depth -= 1;

                self.fd_table.insert(1, body_fd1);
                self.fd_table.insert(2, body_fd2);
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.route_outcome(&mut out);
                self.restore_redirects(saved_fds, saved_in);
                Ok(out)
            }
            CommandNode::ForArith {
                init,
                cond,
                step,
                body,
                redirects,
            } => {
                let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
                let body_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;

                if !init.trim().is_empty() {
                    let exp_init = self.expand_word_to_string(init)?;
                    let _ = eval_arith(&exp_init, self.env);
                }

                self.loop_depth += 1;
                loop {
                    crate::commands::tick_virtual_loop(self.env);
                    if crate::commands::is_timeout_expired() {
                        break;
                    }
                    if !cond.trim().is_empty() {
                        let exp_cond = self.expand_word_to_string(cond)?;
                        let cval = eval_arith(&exp_cond, self.env).unwrap_or(0);
                        if cval == 0 {
                            break;
                        }
                    }
                    self.budget.tick_iteration().map_err(EvalError::Budget)?;
                    let body_out = self.eval_script(body, eff_stdin)?;
                    stdout.push_str(&body_out.stdout);
                    stderr.push_str(&body_out.stderr);
                    code = body_out.exit_code;

                    if self.exit_requested.is_some() || self.return_requested.is_some() {
                        break;
                    }
                    if self.break_count > 0 {
                        self.break_count -= 1;
                        break;
                    }
                    if self.continue_count > 0 {
                        self.continue_count -= 1;
                        if self.continue_count > 0 {
                            break;
                        }
                    }
                    if self.errexit && !self.in_condition && code != 0 {
                        break;
                    }
                    if !step.trim().is_empty() {
                        let exp_step = self.expand_word_to_string(step)?;
                        let _ = eval_arith(&exp_step, self.env);
                    }
                }
                self.loop_depth -= 1;

                self.fd_table.insert(1, body_fd1);
                self.fd_table.insert(2, body_fd2);
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.route_outcome(&mut out);
                self.restore_redirects(saved_fds, saved_in);
                Ok(out)
            }
            CommandNode::While {
                until,
                cond,
                body,
                redirects,
            } => {
                let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
                let body_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;
                let mut iter_count = 0usize;

                self.loop_depth += 1;
                loop {
                    crate::commands::tick_virtual_loop(self.env);
                    if crate::commands::is_timeout_expired() {
                        break;
                    }
                    iter_count += 1;
                    if self.in_pipeline_producer && iter_count > 1024 {
                        break;
                    }
                    let prev_errexit = self.errexit;
                    let prev_cond = self.in_condition;
                    self.errexit = false;
                    self.in_condition = true;
                    let cond_out = self.eval_script(cond, eff_stdin)?;
                    self.errexit = prev_errexit;
                    self.in_condition = prev_cond;
                    stdout.push_str(&cond_out.stdout);
                    stderr.push_str(&cond_out.stderr);

                    let cond_ok = if *until {
                        cond_out.exit_code != 0
                    } else {
                        cond_out.exit_code == 0
                    };
                    if !cond_ok {
                        break;
                    }
                    self.budget.tick_iteration().map_err(EvalError::Budget)?;

                    let body_out = self.eval_script(body, eff_stdin)?;
                    stdout.push_str(&body_out.stdout);
                    stderr.push_str(&body_out.stderr);
                    code = body_out.exit_code;

                    if self.exit_requested.is_some() || self.return_requested.is_some() {
                        break;
                    }
                    if self.break_count > 0 {
                        self.break_count -= 1;
                        break;
                    }
                    if self.continue_count > 0 {
                        self.continue_count -= 1;
                        if self.continue_count > 0 {
                            break;
                        }
                    }
                    if self.errexit && !self.in_condition && code != 0 {
                        break;
                    }
                }
                self.loop_depth -= 1;

                self.fd_table.insert(1, body_fd1);
                self.fd_table.insert(2, body_fd2);
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.route_outcome(&mut out);
                self.restore_redirects(saved_fds, saved_in);
                Ok(out)
            }
            CommandNode::Case {
                word,
                arms,
                redirects,
            } => {
                let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
                let body_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
                let case_desc = format!("case {word} in ");
                let (dbg_out, skip_case) = self.fire_debug_trap(&case_desc);
                let mut stdout = dbg_out.stdout;
                let mut stderr = dbg_out.stderr;
                let mut code = if skip_case { dbg_out.exit_code } else { 0 };
                if !skip_case {
                    let target = self.expand_word_to_string(word)?;
                    let nocase = self
                        .env
                        .get("__shopt_nocasematch")
                        .map(|v| v == "1")
                        .unwrap_or(false);
                    let mut force_exec = false;

                    for (pats, body, term) in arms {
                        let mut matched = force_exec;
                        force_exec = false;
                        if !matched {
                            for p in pats {
                                let exp_p = self.expand_word_for_pattern(p)?;
                                if glob_match_ext(&exp_p, &target, nocase) {
                                    matched = true;
                                    break;
                                }
                            }
                        }
                        if matched {
                            let arm_out = self.eval_script(body, eff_stdin)?;
                            stdout.push_str(&arm_out.stdout);
                            stderr.push_str(&arm_out.stderr);
                            code = arm_out.exit_code;
                            match term {
                                CaseTerminator::Break => break,
                                CaseTerminator::Fallthrough => {
                                    force_exec = true;
                                }
                                CaseTerminator::ContinueTesting => {}
                            }
                        }
                    }
                }

                self.fd_table.insert(1, body_fd1);
                self.fd_table.insert(2, body_fd2);
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.route_outcome(&mut out);
                self.restore_redirects(saved_fds, saved_in);
                Ok(out)
            }
            CommandNode::ArithCommand(expr) => {
                let arith_desc = format!("(({expr}))");
                let (dbg_out, skip_cmd) = self.fire_debug_trap(&arith_desc);
                if skip_cmd {
                    return Ok(dbg_out);
                }
                let exp = self.expand_heredoc_text(expr)?;
                match eval_arith(&exp, self.env) {
                    Ok(val) => Ok(BuiltinOutcome {
                        stdout: dbg_out.stdout,
                        stderr: dbg_out.stderr,
                        exit_code: if val != 0 { 0 } else { 1 },
                    }),
                    Err(e) => Ok(BuiltinOutcome {
                        stdout: dbg_out.stdout,
                        stderr: format!("{}((: {e}\n", dbg_out.stderr),
                        exit_code: 1,
                    }),
                }
            }
            CommandNode::FuncDef { name, body } => {
                if self
                    .env
                    .get(&format!("__readonly_fn__{name}"))
                    .is_some_and(|v| v == "1")
                {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{name}: readonly function\n"),
                        exit_code: 1,
                    });
                }
                self.functions.insert(name.clone(), body.clone());
                Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                })
            }
        }
    }

    pub fn assign_variable(&mut self, lhs: &str, raw_val: &str, append: bool) -> Result<(), EvalError> {
        if let Some((base, sub_rest)) = lhs.split_once('[')
            && let Some(raw_sub) = sub_rest.strip_suffix(']')
        {
            let resolved_base = resolve_nameref_base(base, self.env).to_string();
            if self
                .env
                .get(&format!("__attr__{resolved_base}"))
                .is_some_and(|a| a.contains('r'))
            {
                return Err(EvalError::Syntax(format!("{resolved_base}: readonly variable")));
            }
            let sub_expanded = self.expand_word_to_string(raw_sub)?;
            let clean_sub = sub_expanded.trim_matches('"').trim_matches('\'');
            let is_assoc = self
                .env
                .get(&format!("__assoc__{resolved_base}"))
                .map(|v| v == "1")
                .unwrap_or(false);
            let final_sub = if is_assoc {
                clean_sub.to_string()
            } else {
                let idx = eval_arith(clean_sub, self.env).unwrap_or(0);
                if idx < 0 {
                    let prefix = format!("{resolved_base}[");
                    let max_idx = self
                        .env
                        .keys()
                        .filter_map(|k| {
                            k.strip_prefix(&prefix)
                                .and_then(|s| s.strip_suffix(']'))
                                .and_then(|sub| sub.parse::<i64>().ok())
                        })
                        .max()
                        .unwrap_or(-1);
                    (max_idx + 1 + idx).to_string()
                } else {
                    idx.to_string()
                }
            };
            let key = format!("{resolved_base}[{final_sub}]");
            let val = if append {
                let cur = self.env.get(&key).cloned().unwrap_or_default();
                format!("{cur}{raw_val}")
            } else {
                raw_val.to_string()
            };
            self.env.insert(key, val);
            sync_array_metadata(&resolved_base, self.env);
            return Ok(());
        }

        let resolved = resolve_nameref_base(lhs, self.env).to_string();

        if self
            .env
            .get(&format!("__attr__{resolved}"))
            .is_some_and(|a| a.contains('r'))
        {
            return Err(EvalError::Syntax(format!("{resolved}: readonly variable")));
        }

        if let Some(arr_lit) = raw_val.strip_prefix("\x00__ARRAY_LITERAL__")
            && arr_lit.starts_with('(')
            && arr_lit.ends_with(')')
        {
            let is_assoc = self
                .env
                .get(&format!("__assoc__{resolved}"))
                .map(|v| v == "1")
                .unwrap_or(false);
            let inner = &arr_lit[1..arr_lit.len() - 1];
            let items = self.expand_array_literal_items(inner, is_assoc)?;
            if !append {
                let prefix = format!("{resolved}[");
                let old_keys: Vec<String> = self
                    .env
                    .keys()
                    .filter(|k| k.starts_with(&prefix))
                    .cloned()
                    .collect();
                for k in old_keys {
                    self.env.remove(&k);
                }
            }
            let mut next_idx: i64 = if append {
                let prefix = format!("{resolved}[");
                self.env
                    .keys()
                    .filter_map(|k| {
                        k.strip_prefix(&prefix)
                            .and_then(|s| s.strip_suffix(']'))
                            .and_then(|sub| sub.parse::<i64>().ok())
                    })
                    .max()
                    .map(|m| m + 1)
                    .unwrap_or(0)
            } else {
                0
            };

            for (explicit_sub, item_val) in items {
                if let Some(sub_k) = explicit_sub {
                    let final_k = if is_assoc {
                        sub_k
                    } else {
                        let idx = eval_arith(&sub_k, self.env).unwrap_or(0);
                        next_idx = idx + 1;
                        idx.to_string()
                    };
                    self.env
                        .insert(format!("{resolved}[{final_k}]"), item_val);
                } else {
                    self.env
                        .insert(format!("{resolved}[{next_idx}]"), item_val);
                    next_idx += 1;
                }
            }
            sync_array_metadata(&resolved, self.env);
            if let Some(first) = self.env.get(&format!("{resolved}[0]")).cloned() {
                self.env.insert(resolved, first);
            }
            return Ok(());
        }

        let attr = self
            .env
            .get(&format!("__attr__{resolved}"))
            .cloned()
            .unwrap_or_default();
        let final_val = if attr.contains('i') {
            let rhs_num = eval_arith(raw_val, self.env).unwrap_or(0);
            let num = if append {
                let cur = self
                    .env
                    .get(&resolved)
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(0);
                cur + rhs_num
            } else {
                rhs_num
            };
            num.to_string()
        } else {
            let mut s = if append {
                let cur = self.env.get(&resolved).cloned().unwrap_or_default();
                format!("{cur}{raw_val}")
            } else {
                raw_val.to_string()
            };
            if attr.contains('l') {
                s = s.to_lowercase();
            } else if attr.contains('u') {
                s = s.to_uppercase();
            }
            s
        };

        let allexport = self
            .env
            .get("__set_allexport")
            .map(|v| v == "1")
            .unwrap_or(false);
        let already_existed = self.env.contains_key(&resolved);
        let was_unexported = self
            .env
            .contains_key(&format!("__unexported__{resolved}"));
        if allexport || self.in_prefix_assignment || attr.contains('x') {
            self.env.remove(&format!("__unexported__{resolved}"));
            if allexport && !attr.contains('x') {
                let mut new_attr = attr.clone();
                new_attr.push('x');
                self.env.insert(format!("__attr__{resolved}"), new_attr);
            }
        } else if !already_existed || was_unexported {
            self.env
                .insert(format!("__unexported__{resolved}"), "1".to_string());
        }
        if resolved == "OPTIND"
            && final_val
                .trim()
                .parse::<i64>()
                .map(|v| v <= 1)
                .unwrap_or(false)
        {
            self.env.remove("__getopts_sub");
            self.env.remove("__getopts_ind");
        }
        if write_dynamic_variable(&resolved, &final_val, self.env) {
            return Ok(());
        }
        self.env.insert(resolved, final_val);
        Ok(())
    }

    fn expand_array_literal_items(
        &mut self,
        inner: &str,
        is_assoc: bool,
    ) -> Result<Vec<(Option<String>, String)>, EvalError> {
        let mut raw_tokens = Vec::new();
        let chars: Vec<char> = inner.chars().collect();
        let mut i = 0usize;
        let mut cur = String::new();
        while i < chars.len() {
            let c = chars[i];
            if c.is_whitespace() {
                if !cur.is_empty() {
                    raw_tokens.push(std::mem::take(&mut cur));
                }
                i += 1;
                continue;
            }
            if c == '\'' {
                cur.push(c);
                i += 1;
                while i < chars.len() {
                    let sc = chars[i];
                    cur.push(sc);
                    i += 1;
                    if sc == '\'' {
                        break;
                    }
                }
                continue;
            }
            if c == '"' {
                cur.push(c);
                i += 1;
                while i < chars.len() {
                    let dc = chars[i];
                    cur.push(dc);
                    i += 1;
                    if dc == '\\' && i < chars.len() {
                        cur.push(chars[i]);
                        i += 1;
                    } else if dc == '"' {
                        break;
                    }
                }
                continue;
            }
            if c == '[' {
                cur.push(c);
                i += 1;
                while i < chars.len() && chars[i] != ']' {
                    cur.push(chars[i]);
                    i += 1;
                }
                if i < chars.len() {
                    cur.push(chars[i]);
                    i += 1;
                }
                continue;
            }
            cur.push(c);
            i += 1;
        }
        if !cur.is_empty() {
            raw_tokens.push(cur);
        }

        let mut out = Vec::new();
        for tok in raw_tokens {
            if let Some(rest) = tok.strip_prefix('[')
                && let Some((sub_k, sub_v)) = rest.split_once("]=")
            {
                if !is_assoc && self.is_braceexpand_enabled() {
                    let (brace_words, changed) = expand_braces_with_limits(
                        &tok,
                        self.budget.limits.max_expansion_fields,
                        self.budget.limits.max_expansion_bytes,
                    )?;
                    if changed {
                        for bw in brace_words {
                            let tilded = self.expand_tilde_in_word(&bw, false);
                            let fields = self.expand_word_internal(&tilded, true, false)?;
                            for f in fields {
                                out.push((None, f));
                            }
                            if out.len() > self.budget.limits.max_expansion_fields {
                                return Err(EvalError::Budget(format!(
                                    "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                                    self.budget.limits.max_expansion_fields
                                )));
                            }
                        }
                        continue;
                    }
                }
                let exp_k = self.expand_word_to_string(sub_k)?;
                let exp_v = self.expand_assignment_rhs(sub_v)?;
                out.push((Some(exp_k), exp_v));
            } else {
                let fields = self.expand_word_to_fields(&tok)?;
                for f in fields {
                    out.push((None, f));
                }
                if out.len() > self.budget.limits.max_expansion_fields {
                    return Err(EvalError::Budget(format!(
                        "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                        self.budget.limits.max_expansion_fields
                    )));
                }
            }
        }
        Ok(out)
    }
    fn eval_simple_command(
        &mut self,
        simple: &SimpleCommand,
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        if simple.line > 0 {
            self.current_line = simple.line;
            self.env.insert("__lineno".to_string(), simple.line.to_string());
        }
        let mut cmd_parts = Vec::new();
        for (k, v, app) in &simple.assignments {
            if *app {
                cmd_parts.push(format!("{k}+={v}"));
            } else {
                cmd_parts.push(format!("{k}={v}"));
            }
        }
        cmd_parts.extend(simple.words.iter().cloned());
        let (mut debug_out, skip_cmd) = self.fire_debug_trap(&cmd_parts.join(" "));
        if skip_cmd {
            return Ok(debug_out);
        }

        let is_double_bracket = simple.words.first().map(|s| s.as_str()) == Some("[[");
        let synced_fd0 = if !stdin.is_empty() && !self.in_fds.contains_key(&0) {
            self.in_fds.insert(0, std::mem::take(stdin));
            true
        } else {
            false
        };
        let mut expanded_words = Vec::new();
        if is_double_bracket {
            let (saved_fds, saved_in, local_stdin, _use_local, dup_fd, redir_err) =
                match self.setup_redirects(&simple.redirects, stdin) {
                    Ok(r) => r,
                    Err(e) => {
                        if synced_fd0 {
                            *stdin = self.in_fds.remove(&0).unwrap_or_default();
                        }
                        return Err(e);
                    }
                };
            if let Some(err_out) = redir_err {
                if synced_fd0 {
                    *stdin = self.in_fds.remove(&0).unwrap_or_default();
                }
                self.restore_redirects(saved_fds, saved_in);
                return Ok(err_out);
            }
            let cmd_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
            let cmd_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
            let db_res = self.eval_double_bracket_words(&simple.words);
            self.fd_table.insert(1, cmd_fd1);
            self.fd_table.insert(2, cmd_fd2);
            if synced_fd0 {
                *stdin = self.in_fds.remove(&0).unwrap_or_default();
            }
            let mut out = match db_res {
                Ok((exit_code, db_stderr)) => {
                    let mut sub_out = std::mem::take(&mut self.pending_stdout);
                    let mut sub_err = std::mem::take(&mut self.pending_stderr);
                    sub_err.push_str(&db_stderr);
                    if !debug_out.stdout.is_empty() {
                        sub_out = format!("{}{sub_out}", debug_out.stdout);
                    }
                    if !debug_out.stderr.is_empty() {
                        sub_err = format!("{}{sub_err}", debug_out.stderr);
                    }
                    BuiltinOutcome {
                        stdout: sub_out,
                        stderr: sub_err,
                        exit_code,
                    }
                }
                Err(EvalError::Syntax(msg)) if msg.starts_with("__param_ro__") => {
                    let clean_msg = msg.strip_prefix("__param_ro__").unwrap_or(&msg);
                    let mut out = BuiltinOutcome {
                        stdout: debug_out.stdout,
                        stderr: format!("{}{clean_msg}\n", debug_out.stderr),
                        exit_code: 1,
                    };
                    self.route_outcome(&mut out);
                    self.restore_redirects(saved_fds, saved_in);
                    if self.errexit && !self.in_condition {
                        self.exit_requested = Some(1);
                    }
                    return Ok(out);
                }
                Err(e) => {
                    self.restore_redirects(saved_fds, saved_in);
                    return Err(e);
                }
            };
            if let Some(dfd) = dup_fd {
                self.in_fds.insert(dfd, local_stdin);
            }
            self.route_outcome(&mut out);
            self.restore_redirects(saved_fds, saved_in);
            return Ok(out);
        } else {
            let decl_idx = {
                let mut i = 0usize;
                while i < simple.words.len() {
                    let sw = simple.words[i].as_str();
                    if sw == "command" || sw == "builtin" {
                        i += 1;
                        if simple.words.get(i).map(|s| s.as_str()) == Some("--") {
                            i += 1;
                        }
                        continue;
                    }
                    break;
                }
                simple.words.get(i).and_then(|sw| {
                    if matches!(
                        sw.as_str(),
                        "declare" | "typeset" | "local" | "export" | "readonly"
                    ) {
                        Some(i)
                    } else {
                        None
                    }
                })
            };
            for (idx, w) in simple.words.iter().enumerate() {
                if decl_idx.is_some_and(|di| idx > di)
                    && let Some((lhs, rhs, append)) = parse_assignment_lhs_rhs(w)
                    && rhs.starts_with('(')
                    && rhs.ends_with(')')
                {
                    expanded_words.push(format!(
                        "{lhs}{}\x00__ARRAY_LITERAL__{rhs}",
                        if append { "+=" } else { "=" }
                    ));
                } else if decl_idx.is_some_and(|di| idx > di)
                    && (w.contains("=(") || parse_assignment_lhs_rhs(w).is_some())
                {
                    let brace_words = if self.is_braceexpand_enabled() {
                        match expand_braces_with_limits(
                            w,
                            self.budget.limits.max_expansion_fields,
                            self.budget.limits.max_expansion_bytes,
                        ) {
                            Ok((bw, _)) => bw,
                            Err(e) => {
                                if synced_fd0 {
                                    *stdin = self.in_fds.remove(&0).unwrap_or_default();
                                }
                                return Err(e);
                            }
                        }
                    } else {
                        vec![w.clone()]
                    };
                    for bw in brace_words {
                        if let Some((lhs, rhs, append)) = parse_assignment_lhs_rhs(&bw) {
                            if rhs.starts_with('(') && rhs.ends_with(')') {
                                expanded_words.push(format!(
                                    "{lhs}{}\x00__ARRAY_LITERAL__{rhs}",
                                    if append { "+=" } else { "=" }
                                ));
                            } else {
                                let exp_rhs = match self.expand_assignment_rhs(rhs) {
                                    Ok(v) => v,
                                    Err(e) => {
                                        if synced_fd0 {
                                            *stdin = self.in_fds.remove(&0).unwrap_or_default();
                                        }
                                        return Err(e);
                                    }
                                };
                                expanded_words.push(format!(
                                    "{lhs}{}{exp_rhs}",
                                    if append { "+=" } else { "=" }
                                ));
                            }
                        } else {
                            let exp_w = match self.expand_word_to_string(&bw) {
                                Ok(v) => v,
                                Err(e) => {
                                    if synced_fd0 {
                                        *stdin = self.in_fds.remove(&0).unwrap_or_default();
                                    }
                                    return Err(e);
                                }
                            };
                            expanded_words.push(exp_w);
                        }
                        if expanded_words.len() > self.budget.limits.max_expansion_fields {
                            if synced_fd0 {
                                *stdin = self.in_fds.remove(&0).unwrap_or_default();
                            }
                            return Err(EvalError::Budget(format!(
                                "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                                self.budget.limits.max_expansion_fields
                            )));
                        }
                    }
                } else {
                    match self.expand_word_to_fields(w) {
                        Ok(fields) => {
                            expanded_words.extend(fields);
                            if expanded_words.len() > self.budget.limits.max_expansion_fields {
                                if synced_fd0 {
                                    *stdin = self.in_fds.remove(&0).unwrap_or_default();
                                }
                                return Err(EvalError::Budget(format!(
                                    "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                                    self.budget.limits.max_expansion_fields
                                )));
                            }
                        }
                        Err(EvalError::Syntax(msg))
                            if msg.starts_with("bash: no match:")
                                || msg.starts_with("__param_ro__") =>
                        {
                            if synced_fd0 {
                                *stdin = self.in_fds.remove(&0).unwrap_or_default();
                            }
                            let clean_msg = msg.strip_prefix("__param_ro__").unwrap_or(&msg);
                            let mut out = BuiltinOutcome {
                                stdout: debug_out.stdout,
                                stderr: format!("{}{clean_msg}\n", debug_out.stderr),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut out);
                            if self.errexit && !self.in_condition {
                                self.exit_requested = Some(1);
                            }
                            return Ok(out);
                        }
                        Err(e) => {
                            if synced_fd0 {
                                *stdin = self.in_fds.remove(&0).unwrap_or_default();
                            }
                            return Err(e);
                        }
                    }
                }
            }
        }
        if synced_fd0 {
            *stdin = self.in_fds.remove(&0).unwrap_or_default();
        }

        // Handle permanent FD changes via `exec` with no command words
        if expanded_words.len() == 1 && expanded_words[0] == "exec" {
            let (_saved_fds, _saved_in, _local_stdin, _use_local, _dup_fd, redir_err) =
                self.setup_redirects(&simple.redirects, stdin)?;
            if let Some(err_out) = redir_err {
                return Ok(err_out);
            }
            return Ok(BuiltinOutcome {
                stdout: debug_out.stdout,
                stderr: debug_out.stderr,
                exit_code: 0,
            });
        }

        let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
            self.setup_redirects(&simple.redirects, stdin)?;
        if let Some(err_out) = redir_err {
            self.restore_redirects(saved_fds, saved_in);
            return Ok(err_out);
        }
        let eff_stdin = if use_local { &mut local_stdin } else { stdin };

        if expanded_words.is_empty() {
            self.sub_exit = None;
            for (k, v, append) in &simple.assignments {
                let val = if v.starts_with('(') && v.ends_with(')') {
                    format!("\x00__ARRAY_LITERAL__{v}")
                } else {
                    self.expand_assignment_rhs(v)?
                };
                if let Err(e) = self.assign_variable(k, &val, *append) {
                    match e {
                        EvalError::Syntax(msg) if msg.contains("readonly variable") => {
                            let mut err_out = BuiltinOutcome {
                                stdout: debug_out.stdout,
                                stderr: format!("{}{msg}\n", debug_out.stderr),
                                exit_code: 1,
                            };
                            self.last_exit = 1;
                            self.exit_requested = Some(1);
                            self.route_outcome(&mut err_out);
                            self.restore_redirects(saved_fds, saved_in);
                            return Ok(err_out);
                        }
                        other => return Err(other),
                    }
                }
            }
            self.last_exit = self.sub_exit.take().unwrap_or(0);
            if !simple.assignments.iter().any(|(k, _, _)| k == "_") {
                self.env.remove("_");
            }
            self.env.insert("__last_arg".to_string(), String::new());
            if let Some(dfd) = dup_fd {
                self.in_fds.insert(dfd, local_stdin);
            }
            let mut out = BuiltinOutcome {
                stdout: debug_out.stdout,
                stderr: debug_out.stderr,
                exit_code: self.last_exit,
            };
            self.route_outcome(&mut out);
            self.restore_redirects(saved_fds, saved_in);
            return Ok(out);
        }

        let mut temp_saved: Vec<(String, Option<String>, bool)> = Vec::new();
        self.in_prefix_assignment = true;
        for (k, v, append) in &simple.assignments {
            let prev_val = self.env.get(k).cloned();
            let was_unexp = self.env.contains_key(&format!("__unexported__{k}"));
            let val = self.expand_assignment_rhs(v)?;
            match self.assign_variable(k, &val, *append) {
                Ok(()) => {
                    temp_saved.push((k.clone(), prev_val, was_unexp));
                }
                Err(EvalError::Syntax(msg)) if msg.contains("readonly variable") => {
                    debug_out.stderr.push_str(&format!("{msg}\n"));
                }
                Err(e) => {
                    self.in_prefix_assignment = false;
                    return Err(e);
                }
            }
        }
        self.in_prefix_assignment = false;

        if !simple.assignments.iter().any(|(k, _, _)| k == "_") {
            self.env.remove("_");
        }
        if !self.functions.contains_key(&expanded_words[0])
            && !matches!(expanded_words[0].as_str(), "eval" | "." | "source")
        {
            self.env.insert(
                "__last_arg".to_string(),
                expanded_words.last().cloned().unwrap_or_default(),
            );
        }

        let cmd_fd1 = self.fd_table.insert(1, FdTarget::Stdout).unwrap_or(FdTarget::Stdout);
        let cmd_fd2 = self.fd_table.insert(2, FdTarget::Stderr).unwrap_or(FdTarget::Stderr);
        let mut out = self.dispatch_words(&expanded_words, eff_stdin, false)?;
        if !debug_out.stdout.is_empty() || !debug_out.stderr.is_empty() {
            out.stdout = format!("{}{}", debug_out.stdout, out.stdout);
            out.stderr = format!("{}{}", debug_out.stderr, out.stderr);
        }
        self.fd_table.insert(1, cmd_fd1);
        self.fd_table.insert(2, cmd_fd2);

        let is_posix = self
            .env
            .get("__set_posix")
            .map(|v| v == "1")
            .unwrap_or(false);
        let keep_prefix_assigns = matches!(
            expanded_words[0].as_str(),
            "export" | "readonly" | "declare" | "typeset" | "local" | "eval" | "source" | "."
        ) || (is_posix
            && !self.functions.contains_key(&expanded_words[0])
            && matches!(
                expanded_words[0].as_str(),
                ":"
                    | "break"
                    | "continue"
                    | "exec"
                    | "exit"
                    | "return"
                    | "set"
                    | "shift"
                    | "times"
                    | "trap"
                    | "unset"
            ));
        if !keep_prefix_assigns {
            for (k, prev, was_unexp) in temp_saved.into_iter().rev() {
                if was_unexp {
                    self.env
                        .insert(format!("__unexported__{k}"), "1".to_string());
                } else {
                    self.env.remove(&format!("__unexported__{k}"));
                }
                match prev {
                    Some(v) => {
                        self.env.insert(k, v);
                    }
                    None => {
                        self.env.remove(&k);
                    }
                }
            }
        }

        if let Some(dfd) = dup_fd {
            self.in_fds.insert(dfd, local_stdin);
        }
        self.route_outcome(&mut out);
        self.restore_redirects(saved_fds, saved_in);

        if !self.pending_out_procsubs.is_empty() {
            let pending = std::mem::take(&mut self.pending_out_procsubs);
            for (proc_path, sub_cmd) in pending {
                let bytes = self.fs.read_file(&proc_path).unwrap_or_default();
                let mut proc_stdin = bytes_to_stream_string(&bytes);
                let mut sub_cwd = self.cwd.clone();
                let mut sub_env = self.env.clone();
                let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
                if let Ok(ast) = parse_script(&sub_cmd)
                    && let Ok(sub_out) = sub.eval_script(&ast, &mut proc_stdin)
                {
                    out.stdout.push_str(&sub_out.stdout);
                    out.stderr.push_str(&sub_out.stderr);
                }
            }
        }
        Ok(out)
    }

    fn dispatch_words(
        &mut self,
        words: &[String],
        stdin: &mut String,
        bypass_functions: bool,
    ) -> Result<BuiltinOutcome, EvalError> {
        let Some(cmd) = words.first() else {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            });
        };
        let args = &words[1..];

        if !bypass_functions && let Some(func_body) = self.functions.get(cmd).cloned() {
            self.budget.enter_recursion().map_err(EvalError::Budget)?;
            let prev_args = std::mem::replace(&mut self.pos_args, args.to_vec());
            let caller_frame = self.capture_caller_frame(cmd);
            self.caller_frames.insert(0, caller_frame);
            self.func_stack.insert(0, cmd.to_string());
            self.sync_funcname();
            self.local_scopes.push(BTreeMap::new());
            let mut snap = BTreeMap::new();
            if let Some(&v) = self.trap_versions.get("ERR") {
                snap.insert("ERR".to_string(), v);
            }
            if let Some(&v) = self.trap_versions.get("DEBUG") {
                snap.insert("DEBUG".to_string(), v);
            }
            if let Some(&v) = self.trap_versions.get("RETURN") {
                snap.insert("RETURN".to_string(), v);
            }
            self.func_trap_snapshots.push(snap);
            let cur_cmd = self
                .env
                .get("BASH_COMMAND")
                .cloned()
                .unwrap_or_else(|| cmd.to_string());
            let (fn_dbg_out, skip_fn) = self.fire_debug_trap(&cur_cmd);
            let res = if skip_fn {
                let _ = self.return_requested.take();
                Ok(fn_dbg_out)
            } else {
                let mut r = self.eval_script(&func_body, stdin);
                if let Ok(ref mut o) = r {
                    if !fn_dbg_out.stdout.is_empty() || !fn_dbg_out.stderr.is_empty() {
                        o.stdout = format!("{}{}", fn_dbg_out.stdout, o.stdout);
                        o.stderr = format!("{}{}", fn_dbg_out.stderr, o.stderr);
                    }
                    self.last_exit = o.exit_code;
                    if self.exit_requested.is_none() {
                        self.fire_return_trap(o);
                        if let Some(ret_code) = self.return_requested.take() {
                            o.exit_code = ret_code;
                        }
                        self.last_exit = o.exit_code;
                    } else if self.explicit_exit {
                        self.run_exit_trap_if_needed(o);
                    }
                }
                r
            };
            let _ = self.func_trap_snapshots.pop();
            let local_frame = self.local_scopes.pop().unwrap_or_default();
            for (k, orig) in &local_frame {
                if k.starts_with("__") || k.contains('[') {
                    continue;
                }
                let prefix = format!("{k}[");
                let arr_keys: Vec<String> = self
                    .env
                    .keys()
                    .filter(|ek| ek.starts_with(&prefix))
                    .cloned()
                    .collect();
                for ak in arr_keys {
                    self.env.remove(&ak);
                }
                self.env.remove(&format!("__attr__{k}"));
                self.env.remove(&format!("__assoc__{k}"));
                self.env.remove(&format!("__nameref__{k}"));
                self.env.remove(&format!("__declared__{k}"));
                self.env.remove(&format!("__keys__{k}"));
                match orig {
                    Some(v) => {
                        self.env.insert(k.clone(), v.clone());
                    }
                    None => {
                        self.env.remove(k);
                    }
                }
            }
            for (k, orig) in local_frame {
                if !k.starts_with("__") && !k.contains('[') {
                    continue;
                }
                match orig {
                    Some(v) => {
                        self.env.insert(k, v);
                    }
                    None => {
                        self.env.remove(&k);
                    }
                }
            }
            let mut out = res;
            if let Ok(ref mut o) = out
                && self.exit_requested.is_some()
                && !self.explicit_exit
            {
                self.run_exit_trap_if_needed(o);
            }
            self.pos_args = prev_args;
            if !self.caller_frames.is_empty() {
                self.caller_frames.remove(0);
            }
            if !self.func_stack.is_empty() {
                self.func_stack.remove(0);
            }
            self.sync_funcname();
            self.budget.leave_recursion();
            let out = out?;
            self.env.insert(
                "__last_arg".to_string(),
                args.last().unwrap_or(cmd).clone(),
            );
            return Ok(out);
        }

        match cmd.as_str() {
            "exit" => {
                let offset = if args.first().map(String::as_str) == Some("--") {
                    1
                } else {
                    0
                };
                if args.len() - offset > 1 {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "exit: too many arguments\n".to_string(),
                        exit_code: 1,
                    });
                }
                let code = if let Some(s) = args.get(offset) {
                    match s.trim().parse::<i64>() {
                        Ok(v) => ((v % 256 + 256) % 256) as i32,
                        Err(_) => {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("exit: {s}: numeric argument required\n"),
                                exit_code: 2,
                            });
                        }
                    }
                } else {
                    self.exit_trap_status.unwrap_or(self.last_exit)
                };
                self.explicit_exit = true;
                self.exit_requested = Some(code);
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: code,
                });
            }
            "return" => {
                if self.func_stack.is_empty() && self.caller_frames.is_empty() {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "return: can only `return' from a function or sourced script\n"
                            .to_string(),
                        exit_code: 2,
                    });
                }
                let offset = if args.first().map(String::as_str) == Some("--") {
                    1
                } else {
                    0
                };
                if args.len() - offset > 1 {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "return: too many arguments\n".to_string(),
                        exit_code: 1,
                    });
                }
                let (code, err_msg) = if let Some(s) = args.get(offset) {
                    match s.trim().parse::<i64>() {
                        Ok(v) => (((v % 256 + 256) % 256) as i32, String::new()),
                        Err(_) => (2, format!("return: {s}: numeric argument required\n")),
                    }
                } else {
                    (self.last_exit, String::new())
                };
                let prev_exit = self.last_exit;
                self.return_requested = Some(code);
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: err_msg,
                    exit_code: prev_exit,
                });
            }
            "break" | "continue" => {
                if self.loop_depth == 0 {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{cmd}: only meaningful in a loop\n"),
                        exit_code: 0,
                    });
                }
                let offset = if args.first().map(String::as_str) == Some("--") {
                    1
                } else {
                    0
                };
                let count = if let Some(s) = args.get(offset) {
                    match s.trim().parse::<i64>() {
                        Ok(v) => v,
                        Err(_) => {
                            self.exit_requested = Some(2);
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{cmd}: {s}: numeric argument required\n"),
                                exit_code: 2,
                            });
                        }
                    }
                } else {
                    1
                };
                if args.len() - offset > 1 {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{cmd}: invalid loop count\n"),
                        exit_code: 1,
                    });
                }
                if count < 1 {
                    self.break_count = self.loop_depth;
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{cmd}: invalid loop count\n"),
                        exit_code: 1,
                    });
                }
                let levels = (count as usize).min(self.loop_depth);
                if cmd == "break" {
                    self.break_count = levels;
                } else {
                    self.continue_count = levels;
                }
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            "shift" => {
                let offset = if args.first().map(String::as_str) == Some("--") {
                    1
                } else {
                    0
                };
                let n_signed = if let Some(s) = args.get(offset) {
                    match s.trim().parse::<i64>() {
                        Ok(v) => v,
                        Err(_) => {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("shift: {s}: numeric argument required\n"),
                                exit_code: 2,
                            });
                        }
                    }
                } else {
                    1
                };
                if args.len() - offset > 1 || n_signed < 0 {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 1,
                    });
                }
                let n = n_signed as usize;
                if n <= self.pos_args.len() {
                    self.pos_args.drain(0..n);
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 0,
                    });
                } else {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 1,
                    });
                }
            }
            "set" => {
                return Ok(self.builtin_set(args));
            }
            "shopt" => {
                return Ok(self.builtin_shopt(args));
            }
            "alias" => {
                return Ok(self.builtin_alias(args));
            }
            "unalias" => {
                return Ok(self.builtin_unalias(args));
            }
            "trap" => {
                return Ok(self.builtin_trap(args));
            }
            "export" | "local" | "readonly" | "declare" | "typeset" => {
                return self.builtin_declare(cmd, args);
            }
            "unset" => {
                return Ok(self.builtin_unset(args));
            }
            "read" => {
                return Ok(self.builtin_read(args, stdin));
            }
            "mapfile" | "readarray" => {
                return Ok(self.builtin_mapfile(args, stdin));
            }
            "getopts" => {
                return Ok(self.builtin_getopts(args));
            }
            "eval" => {
                let eval_args = if args.first().map(|s| s.as_str()) == Some("--") {
                    &args[1..]
                } else if let Some(first) = args.first()
                    && first.starts_with('-')
                    && first != "-"
                {
                    let flag = first.chars().nth(1).unwrap_or('-');
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("eval: -{flag}: invalid option\neval: usage: eval [arg ...]\n"),
                        exit_code: 2,
                    });
                } else {
                    args
                };
                if eval_args.is_empty() {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 0,
                    });
                }
                let joined = eval_args.join(" ");
                if joined.bytes().any(|b| {
                    (b <= 0x08) || b == 0x0b || b == 0x0c || (0x0e..=0x1f).contains(&b) || b == 0x7f
                }) {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "eval: cannot execute binary script\n".to_string(),
                        exit_code: 126,
                    });
                }
                let out = self.eval_script_units(&joined, stdin);
                self.env.insert(
                    "__last_arg".to_string(),
                    args.last().unwrap_or(cmd).clone(),
                );
                return out;
            }
            "source" | "." => {
                let src_args = if args.first().map(|s| s.as_str()) == Some("--") {
                    &args[1..]
                } else if let Some(first) = args.first()
                    && first.starts_with('-')
                    && first != "-"
                {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{cmd}: {first}: unsupported option\n"),
                        exit_code: 2,
                    });
                } else {
                    args
                };
                let Some(target) = src_args.first() else {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!(
                            "{cmd}: filename argument required\n{cmd}: usage: {cmd} [-p path] filename [arguments]\n"
                        ),
                        exit_code: 2,
                    });
                };
                {
                    let full = if !target.contains('/') {
                        let path_env = self
                            .env
                            .get("PATH")
                            .cloned()
                            .unwrap_or_else(|| "/usr/local/bin:/usr/bin:/bin".to_string());
                        let mut found = None;
                        for dir in path_env.split(':').filter(|d| !d.is_empty()) {
                            let cand = resolve_posix_path(self.cwd, &format!("{dir}/{target}"));
                            if self.fs.exists(&cand) && !self.fs.is_dir(&cand) {
                                found = Some(cand);
                                break;
                            }
                        }
                        found.unwrap_or_else(|| resolve_posix_path(self.cwd, target))
                    } else {
                        resolve_posix_path(self.cwd, target)
                    };
                    if self.fs.is_dir(&full) {
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{cmd}: {target}: is a directory\n"),
                            exit_code: 1,
                        });
                    }
                    match self.fs.read_file(&full) {
                        Ok(bytes) => {
                            if bytes.len() > self.budget.limits.max_source_bytes {
                                return Err(EvalError::Budget(format!(
                                    "Execution aborted: Shell limit exceeded: maxSourceBytes ({})",
                                    self.budget.limits.max_source_bytes
                                )));
                            }
                            let script_str = String::from_utf8_lossy(&bytes);
                            let saved_args = if src_args.len() > 1 {
                                Some(std::mem::replace(&mut self.pos_args, src_args[1..].to_vec()))
                            } else {
                                None
                            };
                            let caller_frame = self.capture_caller_frame("source");
                            self.caller_frames.insert(0, caller_frame);
                            let prev_script_name = self.script_name.replace(target.clone());
                            let prev_line = self.current_line;
                            self.current_line = 1;
                            self.env.insert("__lineno".to_string(), "1".to_string());
                            self.source_depth += 1;
                            self.source_debug_snapshots.push((
                                self.traps.get("DEBUG").cloned(),
                                self.trap_versions.get("DEBUG").copied(),
                            ));
                            let eval_res = self.eval_script_units(&script_str, stdin);
                            if let Some((prev_dbg, prev_ver)) = self.source_debug_snapshots.pop()
                                && let Some(handler) = prev_dbg
                                && !self.traps.contains_key("DEBUG")
                            {
                                self.traps.insert("DEBUG".to_string(), handler);
                                if let Some(v) = prev_ver {
                                    self.trap_versions.insert("DEBUG".to_string(), v);
                                }
                            }
                            self.source_depth = self.source_depth.saturating_sub(1);
                            self.current_line = prev_line;
                            self.env.insert("__lineno".to_string(), prev_line.to_string());
                            self.script_name = prev_script_name;
                            if !self.caller_frames.is_empty() {
                                self.caller_frames.remove(0);
                            }
                            let mut out = match eval_res {
                                Ok(o) => o,
                                Err(e) => {
                                    if let Some(prev) = saved_args {
                                        self.pos_args = prev;
                                    }
                                    return Err(e);
                                }
                            };
                            self.last_exit = out.exit_code;
                            if self.exit_requested.is_none() {
                                self.fire_return_trap(&mut out);
                                if let Some(ret_code) = self.return_requested.take() {
                                    out.exit_code = ret_code;
                                }
                                self.last_exit = out.exit_code;
                            }
                            if let Some(prev) = saved_args {
                                self.pos_args = prev;
                            }
                            self.env.insert(
                                "__last_arg".to_string(),
                                args.last().unwrap_or(cmd).clone(),
                            );
                            return Ok(out);
                        }
                        Err(_) => {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{cmd}: {target}: No such file or directory\n"),
                                exit_code: 1,
                            });
                        }
                    }
                }
            }
            "exec" => {
                let mut exec_idx = 0usize;
                let mut clear_env = false;
                let mut login = false;
                let mut argv0: Option<String> = None;
                while exec_idx < args.len() {
                    let f = &args[exec_idx];
                    if f == "--" {
                        exec_idx += 1;
                        break;
                    }
                    if !f.starts_with('-') || f == "-" {
                        break;
                    }
                    exec_idx += 1;
                    let chars: Vec<char> = f.chars().collect();
                    let mut i = 1usize;
                    while i < chars.len() {
                        let flag = chars[i];
                        match flag {
                            'c' => clear_env = true,
                            'l' => login = true,
                            'a' => {
                                let rest: String = chars[i + 1..].iter().collect();
                                let val = if !rest.is_empty() {
                                    Some(rest)
                                } else if exec_idx < args.len() {
                                    let v = args[exec_idx].clone();
                                    exec_idx += 1;
                                    Some(v)
                                } else {
                                    None
                                };
                                let Some(a0) = val else {
                                    return Ok(BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: "exec: -a: option requires an argument\n".to_string(),
                                        exit_code: 2,
                                    });
                                };
                                argv0 = Some(a0);
                                break;
                            }
                            _ => {
                                return Ok(BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!("exec: -{flag}: invalid option\n"),
                                    exit_code: 2,
                                });
                            }
                        }
                        i += 1;
                    }
                }
                if exec_idx >= args.len() {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 0,
                    });
                }
                if clear_env {
                    let keys: Vec<String> = self
                        .env
                        .keys()
                        .filter(|k| !k.starts_with("__"))
                        .cloned()
                        .collect();
                    for k in keys {
                        self.env.remove(&k);
                    }
                }
                let exec_cmd = &args[exec_idx];
                if login || argv0.is_some() {
                    let base = argv0.unwrap_or_else(|| exec_cmd.clone());
                    let a0 = if login { format!("-{base}") } else { base };
                    self.env.insert("0".to_string(), a0);
                }
                let out = self.dispatch_words(&args[exec_idx..], stdin, bypass_functions)?;
                self.exit_requested = Some(out.exit_code);
                return Ok(out);
            }
            "builtin" => {
                let mut idx = 0usize;
                if idx < args.len() && args[idx].starts_with('-') && args[idx] != "-" {
                    if args[idx] == "--" {
                        idx += 1;
                    } else {
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("builtin: {}: invalid option\n", args[idx]),
                            exit_code: 2,
                        });
                    }
                }
                if idx >= args.len() {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 0,
                    });
                }
                let target = &args[idx];
                if !Self::is_shell_builtin_name(target) {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("builtin: {target}: not a shell builtin\n"),
                        exit_code: 1,
                    });
                }
                if let Some(b_out) =
                    try_run_builtin(target, &args[idx + 1..], stdin, self.cwd, self.env, self.fs)
                {
                    return Ok(b_out);
                }
                return self.dispatch_words(&args[idx..], stdin, true);
            }
            "command" => {
                let mut discover = false;
                let mut mode = "describe";
                let mut default_path = false;
                let mut idx = 0usize;
                while idx < args.len() && args[idx].starts_with('-') && args[idx] != "-" {
                    let a = &args[idx];
                    if a == "--" {
                        idx += 1;
                        break;
                    }
                    for ch in a[1..].chars() {
                        match ch {
                            'v' => {
                                discover = true;
                                mode = "name";
                            }
                            'V' => {
                                discover = true;
                                mode = "describe";
                            }
                            'p' => {
                                default_path = true;
                            }
                            _ => {
                                return Ok(BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!(
                                        "command: -{ch}: invalid option\ncommand: usage: command [-pVv] command [arg ...]\n"
                                    ),
                                    exit_code: 2,
                                });
                            }
                        }
                    }
                    idx += 1;
                }
                if discover {
                    return Ok(self.run_discovery(
                        "command",
                        &args[idx..],
                        mode,
                        false,
                        false,
                        false,
                        default_path,
                    ));
                }
                if idx >= args.len() {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 0,
                    });
                }
                return self.dispatch_words(&args[idx..], stdin, true);
            }
            "caller" => {
                return Ok(self.builtin_caller(args));
            }
            "print" => {
                let mut no_newline = false;
                let mut i = 0usize;
                while i < args.len() && args[i].starts_with('-') && args[i] != "-" {
                    let opt = &args[i];
                    if opt == "--" {
                        i += 1;
                        break;
                    }
                    for ch in opt[1..].chars() {
                        if ch == 'n' {
                            no_newline = true;
                        }
                    }
                    i += 1;
                }
                let mut out = args[i..].join(" ");
                if !no_newline {
                    out.push('\n');
                }
                return Ok(BuiltinOutcome {
                    stdout: out,
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            "functions" => {
                let mut out = String::new();
                for (fn_name, fn_body) in &self.functions {
                    out.push_str(&format_function_display(fn_name, fn_body));
                }
                return Ok(BuiltinOutcome {
                    stdout: out,
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            "setopt" | "unsetopt" => {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            "type" => {
                return Ok(self.builtin_type(cmd, args));
            }
            "which" if args.iter().any(|a| self.custom_commands.contains_key(a.as_str())) => {
                return Ok(self.builtin_type(cmd, args));
            }
            "wait" => {
                return Ok(self.builtin_wait(args));
            }
            "jobs" => {
                return Ok(self.builtin_jobs(args));
            }
            "kill" => {
                return Ok(self.builtin_kill(args));
            }
            "disown" => {
                return Ok(self.builtin_disown(args));
            }
            "bash" | "sh" => {
                return self.run_sub_shell_command(cmd, args, stdin);
            }
            _ => {}
        }

        if let Some(custom) = self.custom_commands.get(cmd) {
            let mut ctx = CommandContext {
                args,
                stdin,
                cwd: self.cwd,
                env: self.env,
                fs: self.fs,
            };
            return match custom(&mut ctx) {
                Ok(res) => {
                    *self.cwd = res.cwd;
                    *self.env = res.env;
                    Ok(BuiltinOutcome {
                        stdout: res.stdout,
                        stderr: res.stderr,
                        exit_code: res.exit_code,
                    })
                }
                Err(msg) => Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{msg}\n"),
                    exit_code: 1,
                }),
            };
        }

        if let Some(b_out) = try_run_builtin(cmd, args, stdin, self.cwd, self.env, self.fs) {
            return Ok(b_out);
        }

        let fs_ref = self.fs;
        let budget_ref = self.budget;
        let custom_ref = self.custom_commands;
        let funcs_clone = self.functions.clone();
        let exported_clone = self.exported_functions.clone();
        let allow_fallback = self.allow_unported_fallback;

        if let Some(c_out) = try_run_command(
            cmd,
            args,
            stdin,
            self.cwd,
            self.env,
            fs_ref,
            |sub_words, sub_stdin, sub_cwd, sub_env| {
                let mut fd_table = BTreeMap::new();
                fd_table.insert(1, FdTarget::Stdout);
                fd_table.insert(2, FdTarget::Stderr);
                let mut sub_eval = EvalState {
                    cwd: sub_cwd,
                    env: sub_env,
                    fs: fs_ref,
                    budget: budget_ref,
                    custom_commands: custom_ref,
                    functions: funcs_clone.clone(),
                    exported_functions: exported_clone.clone(),
                    func_stack: Vec::new(),
                    caller_frames: Vec::new(),
                    caller_top_level: false,
                    script_name: None,
                    current_line: 1,
                    local_scopes: Vec::new(),
                    fd_table,
                    in_fds: BTreeMap::new(),
                    traps: BTreeMap::new(),
                    inactive_traps: BTreeMap::new(),
                    trap_versions: BTreeMap::new(),
                    next_trap_version: 1,
                    func_trap_snapshots: Vec::new(),
                    source_debug_snapshots: Vec::new(),
                    source_depth: 0,
                    exit_trap_status: None,
                    exit_trap_ran: false,
                    explicit_exit: false,
                    sub_exit: None,
                    pos_args: Vec::new(),
                    last_exit: 0,
                    errexit: false,
                    nounset: false,
                    pipefail: false,
                    noclobber: false,
                    noexec: false,
                    xtrace: false,
                    in_condition: false,
                    in_trap: false,
                    in_pipeline_producer: false,
                    procsub_seq: 0,
                    in_prefix_assignment: false,
                    pending_out_procsubs: Vec::new(),
            pending_stdout: String::new(),
            pending_stderr: String::new(),
                    exit_requested: None,
                    return_requested: None,
                    break_count: 0,
                    continue_count: 0,
                    loop_depth: 0,
                    active_aliases: BTreeSet::new(),
                    allow_unported_fallback: allow_fallback,
                };
                let mut sub_in = sub_stdin.to_string();
                sub_eval
                    .dispatch_words(sub_words, &mut sub_in, false)
                    .unwrap_or(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 1,
                    })
            },
        ) {
            return Ok(c_out);
        }

        // Check hashed or executable script in VFS (e.g. /usr/local/bin/custom_tool or ./script.sh)
        if let Some(script_path) = self.resolve_vfs_executable(cmd)
            && let Ok(bytes) = self.fs.read_file(&script_path)
        {
            let script_str = String::from_utf8_lossy(&bytes);
            let mut sub_cwd = self.cwd.clone();
            let mut sub_env = self.env.clone();
            sub_env.insert("0".to_string(), cmd.clone());
            sub_env.remove("__set_errtrace");
            sub_env.remove("__set_functrace");
            sub_env.remove("__shopt_extdebug");
            for (k, v) in &self.traps {
                if v.is_empty() && !matches!(k.as_str(), "EXIT" | "ERR" | "DEBUG" | "RETURN") {
                    sub_env.insert(format!("__trap_inherited_ignored__{k}"), "1".to_string());
                }
            }
            let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
            sub.traps
                .retain(|k, v| v.is_empty() && !matches!(k.as_str(), "EXIT" | "ERR" | "DEBUG" | "RETURN"));
            sub.inactive_traps.clear();
            sub.func_trap_snapshots.clear();
            sub.source_debug_snapshots.clear();
            sub.source_depth = 0;
            sub.pos_args = args.to_vec();
            sub.caller_frames.clear();
            sub.caller_top_level = true;
            sub.script_name = Some(cmd.clone());
            sub.current_line = 1;
            sub.func_stack.clear();
            sub.sync_funcname();
            sub.env.remove("BASH_SUBSHELL");
            sub.env.remove("__unexported__BASH_SUBSHELL");
            sub.env.remove("__set_braceexpand");
            let res = sub.eval_script_str(&script_str, stdin)?;
            *stdin = String::new();
            return Ok(BuiltinOutcome {
                stdout: res.stdout,
                stderr: res.stderr,
                exit_code: res.exit_code,
            });
        }

        if self.allow_unported_fallback {
            return Err(EvalError::UnportedCommand(cmd.clone()));
        }

        Ok(BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("{cmd}: command not found\n"),
            exit_code: 127,
        })
    }

    fn resolve_vfs_executable(&self, cmd: &str) -> Option<String> {
        if let Some(hashed) = self.env.get(&format!("__hash__{cmd}"))
            && self.fs.exists(hashed)
            && !self.fs.is_dir(hashed)
        {
            return Some(hashed.clone());
        }
        if cmd.contains('/') {
            let full = resolve_posix_path(self.cwd, cmd);
            if self.fs.exists(&full) && !self.fs.is_dir(&full) {
                return Some(full);
            }
            return None;
        }
        let path_env = self
            .env
            .get("PATH")
            .cloned()
            .unwrap_or_else(|| "/usr/local/bin:/usr/bin:/bin".to_string());
        for dir in path_env.split(':') {
            if dir.is_empty() {
                continue;
            }
            let cand = resolve_posix_path(self.cwd, &format!("{dir}/{cmd}"));
            if self.fs.exists(&cand) && !self.fs.is_dir(&cand) {
                return Some(cand);
            }
        }
        None
    }


    fn capture_caller_frame(&self, routine: &str) -> CallerFrame {
        let name = self
            .caller_frames
            .first()
            .map(|f| f.routine.clone())
            .or_else(|| {
                if self.caller_top_level {
                    Some("main".to_string())
                } else {
                    None
                }
            });
        let file = if name.is_none() {
            "NULL".to_string()
        } else {
            self.script_name
                .clone()
                .unwrap_or_else(|| "shell".to_string())
        };
        CallerFrame {
            line: self.current_line.max(1),
            name,
            file,
            routine: routine.to_string(),
        }
    }

    fn builtin_caller(&self, args: &[String]) -> BuiltinOutcome {
        let terminated = args.first().map(|s| s.as_str()) == Some("--");
        let operand = args.get(if terminated { 1 } else { 0 });
        let invalid = |value: &str, reason: &str| BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("caller: {value}: {reason}\ncaller: usage: caller [expr]\n"),
            exit_code: 2,
        };
        let mut index = 0usize;
        if let Some(op) = operand {
            if !terminated && op.starts_with('-') && op != "-" {
                let prefix: String = op.chars().take(2).collect();
                return invalid(&prefix, "invalid option");
            }
            let text = op.trim();
            let negative = text.starts_with('-');
            let offset = if negative || text.starts_with('+') { 1 } else { 0 };
            let maximum: u128 = if negative {
                9223372036854775808u128
            } else {
                9223372036854775807u128
            };
            if offset == text.len() {
                return invalid(op, "invalid number");
            }
            let mut value: u128 = 0;
            for b in text[offset..].bytes() {
                if !b.is_ascii_digit() {
                    let reason = if op.starts_with("0x") {
                        "invalid hex number"
                    } else if op.len() > 1 && op.as_bytes()[0] == b'0' && op.as_bytes()[1].is_ascii_digit() {
                        "invalid octal number"
                    } else {
                        "invalid number"
                    };
                    return invalid(op, reason);
                }
                value = value.saturating_mul(10).saturating_add((b - b'0') as u128);
                if value > maximum {
                    return invalid(op, "invalid number");
                }
            }
            if (negative && value != 0) || value > 9007199254740991u128 {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 1,
                };
            }
            index = value as usize;
        }
        let Some(frame) = self.caller_frames.get(index) else {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 1,
            };
        };
        if operand.is_some() && frame.name.is_none() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 1,
            };
        }
        let output = if operand.is_none() {
            format!("{} {}\n", frame.line, frame.file)
        } else {
            format!(
                "{} {} {}\n",
                frame.line,
                frame.name.as_deref().unwrap_or(""),
                frame.file
            )
        };
        BuiltinOutcome {
            stdout: output,
            stderr: String::new(),
            exit_code: 0,
        }
    }

    fn is_shell_builtin_name(target: &str) -> bool {
        matches!(
            target,
            ":" | "true"
                | "false"
                | "cd"
                | "pwd"
                | "pushd"
                | "popd"
                | "dirs"
                | "echo"
                | "printf"
                | "test"
                | "["
                | "read"
                | "mapfile"
                | "readarray"
                | "getopts"
                | "set"
                | "shopt"
                | "shift"
                | "export"
                | "local"
                | "readonly"
                | "declare"
                | "typeset"
                | "unset"
                | "trap"
                | "eval"
                | "source"
                | "."
                | "exec"
                | "command"
                | "builtin"
                | "type"
                | "hash"
                | "umask"
                | "ulimit"
                | "let"
                | "exit"
                | "return"
                | "break"
                | "continue"
                | "wait"
                | "kill"
                | "jobs"
                | "disown"
                | "alias"
                | "unalias"
                | "caller"
                | "print"
                | "functions"
                | "setopt"
                | "unsetopt"
        )
    }

    fn is_shell_keyword(target: &str) -> bool {
        matches!(
            target,
            "if" | "then"
                | "else"
                | "elif"
                | "fi"
                | "for"
                | "while"
                | "until"
                | "do"
                | "done"
                | "case"
                | "esac"
                | "in"
                | "function"
                | "{"
                | "}"
                | "!"
                | "[["
                | "]]"
                | "time"
                | "select"
                | "coproc"
        )
    }

    fn is_implemented_builtin_name(target: &str) -> bool {
        Self::is_shell_builtin_name(target)
            && !matches!(target, "echo" | "printf" | "test" | "[")
    }

    fn is_registered_command_name(&self, target: &str) -> bool {
        matches!(target, "echo" | "printf" | "test" | "[")
            || crate::commands::search::is_known_command(target)
            || self.custom_commands.contains_key(target)
    }

    fn is_virtual_executable_path(&self, resolved_path: &str) -> bool {
        if resolved_path.ends_with('/')
            || resolved_path.ends_with("/.")
            || resolved_path.ends_with("/..")
        {
            return false;
        }
        let norm = resolve_posix_path("/", resolved_path);
        let Some(slash) = norm.rfind('/') else {
            return false;
        };
        let dir = &norm[..slash];
        let name = &norm[slash + 1..];
        if matches!(name, "zsh" | "bash" | "sh") && matches!(dir, "/bin" | "/usr/bin" | "/tmp") {
            return true;
        }
        if dir != "/bin" && dir != "/usr/bin" {
            return false;
        }
        self.is_registered_command_name(name)
            || matches!(name, "true" | "false" | "pwd" | "kill" | "bash" | "sh" | "zsh")
    }

    fn search_discovery_paths(
        &self,
        name: &str,
        show_all: bool,
        default_path: bool,
    ) -> Vec<String> {
        if name.is_empty() {
            return Vec::new();
        }
        let mut matches = Vec::new();
        if name.contains('/') {
            let resolved = resolve_posix_path(self.cwd, name);
            if self.is_virtual_executable_path(&resolved)
                || (self.fs.exists(&resolved) && !self.fs.is_dir(&resolved))
            {
                matches.push(name.to_string());
            }
            return matches;
        }
        let path_val = if default_path {
            Some("/bin:/usr/bin".to_string())
        } else if let Some(p) = self.env.get("PATH") {
            Some(p.clone())
        } else if self.env.contains_key("__path_unset__") {
            None
        } else {
            Some("/bin:/usr/bin".to_string())
        };
        let Some(path_str) = path_val else {
            return matches;
        };
        if path_str.is_empty() {
            return matches;
        }
        for seg in path_str.split(':') {
            let dir = if seg.is_empty() { "." } else { seg };
            let target = if dir == "/" {
                format!("/{name}")
            } else {
                format!("{}/{name}", dir.trim_end_matches('/'))
            };
            let resolved = resolve_posix_path(self.cwd, &target);
            if self.is_virtual_executable_path(&resolved)
                || (self.fs.exists(&resolved) && !self.fs.is_dir(&resolved))
            {
                matches.push(target);
                if !show_all {
                    break;
                }
            }
        }
        matches
    }

    #[allow(clippy::too_many_arguments)]
    fn run_discovery(
        &self,
        invoked: &str,
        targets: &[String],
        mode: &str,
        show_all: bool,
        skip_functions: bool,
        force_path: bool,
        default_path: bool,
    ) -> BuiltinOutcome {
        let is_command = invoked == "command";
        let mut found = 0usize;
        let mut out = String::new();
        let mut stderr = String::new();

        for name in targets {
            let mut matches: Vec<(&'static str, String)> = Vec::new();
            if !force_path && !(show_all && mode == "path") {
                if Self::is_shell_keyword(name) {
                    matches.push(("keyword", name.clone()));
                }
                if !skip_functions && self.functions.contains_key(name) {
                    matches.push(("function", name.clone()));
                }
                if Self::is_implemented_builtin_name(name) {
                    matches.push(("builtin", name.clone()));
                } else if self.is_registered_command_name(name) {
                    matches.push(("command", name.clone()));
                } else if matches!(name.as_str(), "bash" | "sh" | "zsh") {
                    matches.push(("interpreter", name.clone()));
                }
            }
            if !show_all && matches.len() > 1 {
                matches.truncate(1);
            }
            if mode == "path"
                && matches.first().is_some_and(|(k, _)| {
                    (*k == "command" && !Self::is_shell_builtin_name(name)) || *k == "interpreter"
                })
            {
                matches.clear();
            }
            if show_all || matches.is_empty() {
                for mut path in self.search_discovery_paths(name, show_all, default_path) {
                    if is_command
                        && mode == "describe"
                        && !name.contains('/')
                        && !path.starts_with('/')
                    {
                        let rel = path.strip_prefix("./").unwrap_or(&path);
                        path = if self.cwd == "/" {
                            format!("/{rel}")
                        } else {
                            format!("{}/{rel}", self.cwd)
                        };
                    }
                    matches.push(("file", path));
                }
            }
            if matches.is_empty() {
                if mode == "describe" {
                    stderr.push_str(&format!("{invoked}: {name}: not found\n"));
                }
                continue;
            }
            found += 1;
            for (kind, m_name) in matches {
                if mode == "path" && kind != "file" {
                    continue;
                }
                if mode == "kind" {
                    let k = if kind == "command" {
                        if Self::is_shell_builtin_name(name) {
                            "builtin"
                        } else {
                            "file"
                        }
                    } else if kind == "interpreter" {
                        "file"
                    } else {
                        kind
                    };
                    out.push_str(&format!("{k}\n"));
                } else if mode == "name" || mode == "path" {
                    out.push_str(&format!("{m_name}\n"));
                } else if kind == "function" {
                    if let Some(body) = self.functions.get(name) {
                        out.push_str(&format!(
                            "{name} is a function\n{}",
                            format_function_display(name, body)
                        ));
                    }
                } else {
                    let desc = match kind {
                        "keyword" => "a shell keyword",
                        "builtin" => "a shell builtin",
                        "command" => "a registered command",
                        "interpreter" => "a virtual shell interpreter",
                        _ => m_name.as_str(),
                    };
                    out.push_str(&format!("{name} is {desc}\n"));
                }
            }
        }

        let ok = if is_command {
            found > 0 || targets.is_empty()
        } else {
            found == targets.len()
        };
        BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code: if ok { 0 } else { 1 },
        }
    }

    fn builtin_type(&self, invoked: &str, args: &[String]) -> BuiltinOutcome {
        if invoked == "which" {
            let mut silent = false;
            let mut show_all = false;
            let mut targets = Vec::new();
            for a in args {
                if a.starts_with('-') && a.len() > 1 {
                    for ch in a[1..].chars() {
                        match ch {
                            's' => silent = true,
                            'a' => show_all = true,
                            _ => {}
                        }
                    }
                } else {
                    targets.push(a.as_str());
                }
            }
            let mut out = String::new();
            let mut all_found = !targets.is_empty();
            for t in targets {
                if show_all && !t.contains('/') {
                    let matches = self.search_discovery_paths(t, true, false);
                    if matches.is_empty() {
                        all_found = false;
                    } else if !silent {
                        for m in matches {
                            out.push_str(&format!("{m}\n"));
                        }
                    }
                    continue;
                }
                if let Some(vfs_p) = self.resolve_vfs_executable(t) {
                    if !silent {
                        out.push_str(&format!("{vfs_p}\n"));
                    }
                } else if crate::commands::search::is_known_command(t)
                    || self.custom_commands.contains_key(t)
                {
                    if !silent {
                        out.push_str(&format!("/usr/bin/{t}\n"));
                    }
                } else {
                    all_found = false;
                }
            }
            return BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: if all_found { 0 } else { 1 },
            };
        }

        let mut mode = "describe";
        let mut show_all = false;
        let mut skip_functions = false;
        let mut force_path = false;
        let mut idx = 0usize;
        while idx < args.len() && args[idx].starts_with('-') && args[idx] != "-" {
            let opt = &args[idx];
            if opt == "--" {
                idx += 1;
                break;
            }
            for ch in opt[1..].chars() {
                match ch {
                    'a' => show_all = true,
                    'f' => skip_functions = true,
                    't' => mode = "kind",
                    'p' => mode = "path",
                    'P' => {
                        mode = "path";
                        force_path = true;
                    }
                    _ => {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("type: {opt}: unsupported option\n"),
                            exit_code: 2,
                        };
                    }
                }
            }
            idx += 1;
        }
        self.run_discovery(
            "type",
            &args[idx..],
            mode,
            show_all,
            skip_functions,
            force_path,
            false,
        )
    }

    fn run_sub_shell_command(
        &mut self,
        invoked_cmd: &str,
        args: &[String],
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        let mut idx = 0usize;
        let mut errexit = false;
        let mut nounset = false;
        let mut pipefail = false;
        let mut noexec = false;
        let mut braceexpand: Option<bool> = None;
        let mut cmd_str: Option<String> = None;

        while idx < args.len() {
            let a = &args[idx];
            if a == "-c" {
                cmd_str = args.get(idx + 1).cloned();
                idx += 2;
                break;
            } else if (a == "-o" || a == "+o") && idx + 1 < args.len() {
                let on = a.starts_with('-');
                match args[idx + 1].as_str() {
                    "errexit" => errexit = on,
                    "nounset" => nounset = on,
                    "pipefail" => pipefail = on,
                    "noexec" => noexec = on,
                    "braceexpand" => braceexpand = Some(on),
                    _ => {}
                }
                idx += 2;
            } else if (a.starts_with('-') || a.starts_with('+')) && a.len() > 1 && a != "--" {
                let on = a.starts_with('-');
                let mut saw_c = false;
                for ch in a[1..].chars() {
                    match ch {
                        'e' => errexit = on,
                        'u' => nounset = on,
                        'n' => noexec = on,
                        'B' => braceexpand = Some(on),
                        'c' if on => saw_c = true,
                        _ => {}
                    }
                }
                idx += 1;
                if saw_c {
                    cmd_str = args.get(idx).cloned();
                    idx += 1;
                    break;
                }
            } else {
                break;
            }
        }

        let script_source = if let Some(cs) = cmd_str {
            cs
        } else if let Some(file_arg) = args.get(idx) {
            idx += 1;
            let full = resolve_posix_path(self.cwd, file_arg);
            match self.fs.read_file(&full) {
                Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                Err(_) => {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("bash: {file_arg}: No such file or directory\n"),
                        exit_code: 127,
                    });
                }
            }
        } else {
            std::mem::take(stdin)
        };

        if noexec {
            return match validate_basic_syntax(&script_source) {
                Ok(()) => Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                }),
                Err(e) => Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("bash: {e}\n"),
                    exit_code: 2,
                }),
            };
        }

        let mut sub_cwd = self.cwd.clone();
        let mut sub_env = self.env.clone();
        if invoked_cmd == "sh" {
            sub_env.insert("__set_posix".to_string(), "1".to_string());
        } else {
            sub_env.remove("__set_posix");
        }
        sub_env.remove("__set_errtrace");
        sub_env.remove("__set_functrace");
        sub_env.remove("__shopt_extdebug");
        match braceexpand {
            Some(false) => {
                sub_env.insert("__set_braceexpand".to_string(), "0".to_string());
            }
            _ => {
                sub_env.remove("__set_braceexpand");
            }
        }
        for (k, v) in &self.traps {
            if v.is_empty() && !matches!(k.as_str(), "EXIT" | "ERR" | "DEBUG" | "RETURN") {
                sub_env.insert(format!("__trap_inherited_ignored__{k}"), "1".to_string());
            }
        }
        let unexp_vars: Vec<String> = sub_env
            .keys()
            .filter_map(|k| k.strip_prefix("__unexported__").map(|v| v.to_string()))
            .collect();
        for v in unexp_vars {
            sub_env.remove(&v);
            sub_env.remove(&format!("__unexported__{v}"));
        }
        if let Some(arg0) = args.get(idx) {
            sub_env.insert("0".to_string(), arg0.clone());
            idx += 1;
        }
        let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
        sub.traps
            .retain(|k, v| v.is_empty() && !matches!(k.as_str(), "EXIT" | "ERR" | "DEBUG" | "RETURN"));
        sub.inactive_traps.clear();
        sub.func_trap_snapshots.clear();
        sub.source_debug_snapshots.clear();
        sub.source_depth = 0;
        sub.func_stack.clear();
        sub.sync_funcname();
        sub.env.remove("BASH_SUBSHELL");
        sub.env.remove("__unexported__BASH_SUBSHELL");
        sub.errexit = errexit;
        sub.nounset = nounset;
        sub.pipefail = pipefail;
        sub.pos_args = args[idx..].to_vec();
        sub.functions = self
            .functions
            .iter()
            .filter(|(k, _)| self.exported_functions.contains(*k))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        match sub.eval_script_str(&script_source, stdin) {
            Ok(res) => Ok(BuiltinOutcome {
                stdout: res.stdout,
                stderr: res.stderr,
                exit_code: res.exit_code,
            }),
            Err(EvalError::Syntax(msg)) => Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("bash: {msg}\n"),
                exit_code: 2,
            }),
            Err(other) => Err(other),
        }
    }

    fn fire_return_trap(&mut self, out: &mut BuiltinOutcome) {
        if self.in_trap {
            return;
        }
        let Some(ret_handler) = self.traps.get("RETURN").cloned() else {
            return;
        };
        if ret_handler.is_empty() {
            return;
        }
        let functrace = self
            .env
            .get("__set_functrace")
            .map(|v| v == "1")
            .unwrap_or(false)
            || self
                .env
                .get("__shopt_extdebug")
                .map(|v| v == "1")
                .unwrap_or(false);
        let cur_ver = self.trap_versions.get("RETURN").copied();
        if !self.func_stack.is_empty()
            && !functrace
            && self
                .func_trap_snapshots
                .last()
                .and_then(|m| m.get("RETURN").copied())
                == cur_ver
        {
            return;
        }
        let saved_exit = out.exit_code;
        let orig_return = self.return_requested.take();
        self.last_exit = saved_exit;
        self.in_trap = true;
        let mut empty_in = String::new();
        if let Ok(trap_out) = self.eval_script_units(&ret_handler, &mut empty_in) {
            out.stdout.push_str(&trap_out.stdout);
            out.stderr.push_str(&trap_out.stderr);
        }
        self.in_trap = false;
        if let Some(exit_code) = self.exit_requested {
            out.exit_code = exit_code;
            self.last_exit = exit_code;
        } else if self.return_requested.is_some() {
            self.last_exit = saved_exit;
        } else {
            self.return_requested = orig_return;
            out.exit_code = saved_exit;
            self.last_exit = saved_exit;
        }
    }

    fn apply_set_option(&mut self, opt: &str, enable: bool) {
        let val = if enable { "1" } else { "0" };
        match opt {
            "errexit" => {
                self.errexit = enable;
                self.env.insert("__set_errexit".to_string(), val.to_string());
            }
            "nounset" => {
                self.nounset = enable;
                self.env.insert("__set_nounset".to_string(), val.to_string());
            }
            "pipefail" => {
                self.pipefail = enable;
                self.env
                    .insert("__set_pipefail".to_string(), val.to_string());
            }
            "noclobber" => {
                self.noclobber = enable;
                self.env
                    .insert("__set_noclobber".to_string(), val.to_string());
            }
            "noexec" => {
                self.noexec = enable;
                self.env.insert("__set_noexec".to_string(), val.to_string());
            }
            "xtrace" => {
                self.xtrace = enable;
                self.env.insert("__set_xtrace".to_string(), val.to_string());
            }
            other => {
                self.env
                    .insert(format!("__set_{other}"), val.to_string());
            }
        }
    }

    fn builtin_set(&mut self, args: &[String]) -> BuiltinOutcome {
        const SET_OPTIONS: &[&str] = &[
            "allexport",
            "braceexpand",
            "errexit",
            "noclobber",
            "noexec",
            "noglob",
            "nounset",
            "pipefail",
            "errtrace",
            "functrace",
        ];
        const UNSUPPORTED_SET_OPTIONS: &[&str] = &[
            "emacs",
            "hashall",
            "histexpand",
            "history",
            "ignoreeof",
            "interactive-comments",
            "keyword",
            "monitor",
            "nolog",
            "notify",
            "onecmd",
            "physical",
            "posix",
            "privileged",
            "verbose",
            "vi",
        ];
        let mut stdout = String::new();
        if args.is_empty() {
            let mut candidate_names: BTreeSet<String> = BTreeSet::new();
            for k in self.env.keys() {
                if let Some(n) = k.strip_prefix("__attr__") {
                    if is_valid_shell_ident(n) && !n.starts_with("__") {
                        candidate_names.insert(n.to_string());
                    }
                } else if let Some(n) = k.strip_prefix("__declared__") {
                    if is_valid_shell_ident(n) && !n.starts_with("__") {
                        candidate_names.insert(n.to_string());
                    }
                } else if let Some(n) = k.strip_prefix("__assoc__") {
                    if is_valid_shell_ident(n) && !n.starts_with("__") {
                        candidate_names.insert(n.to_string());
                    }
                } else if let Some((b, _)) = k.split_once('[') {
                    if is_valid_shell_ident(b) && !b.starts_with("__") {
                        candidate_names.insert(b.to_string());
                    }
                } else if is_valid_shell_ident(k) && !k.starts_with("__") {
                    candidate_names.insert(k.clone());
                }
            }
            for name in candidate_names {
                let (has_var, is_arr_assoc, is_arr, entries, _) =
                    get_var_meta_info(&name, self.env);
                if !has_var {
                    continue;
                }
                if is_arr {
                    let mut pairs = Vec::new();
                    for (k, v) in entries {
                        let qk = if is_arr_assoc {
                            bash_quote_double(&k)
                        } else {
                            k
                        };
                        pairs.push(format!("[{qk}]={}", bash_quote_double(&v)));
                    }
                    stdout.push_str(&format!("{name}=({})\n", pairs.join(" ")));
                } else if let Some(val) = self.env.get(&name) {
                    if val
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_./:@%+=,-".contains(c))
                    {
                        stdout.push_str(&format!("{name}={val}\n"));
                    } else {
                        stdout.push_str(&format!("{name}={}\n", bash_quote_double(val)));
                    }
                }
            }
            for (fn_name, fn_body) in &self.functions {
                stdout.push_str(&format_function_display(fn_name, fn_body));
            }
            return BuiltinOutcome {
                stdout,
                stderr: String::new(),
                exit_code: 0,
            };
        }
        let mut i = 0usize;
        while i < args.len() {
            let a = &args[i];
            if a == "--" {
                self.pos_args = args[i + 1..].to_vec();
                break;
            } else if a == "-" {
                if i + 1 < args.len() {
                    self.pos_args = args[i + 1..].to_vec();
                }
                break;
            } else if (a.starts_with('-') || a.starts_with('+')) && a.len() > 1 {
                let enable = a.starts_with('-');
                let chars: Vec<char> = a[1..].chars().collect();
                for (pos, &ch) in chars.iter().enumerate() {
                    match ch {
                        'e' => self.apply_set_option("errexit", enable),
                        'u' => self.apply_set_option("nounset", enable),
                        'a' => self.apply_set_option("allexport", enable),
                        'f' => self.apply_set_option("noglob", enable),
                        'C' => self.apply_set_option("noclobber", enable),
                        'n' => self.apply_set_option("noexec", enable),
                        'x' => self.apply_set_option("xtrace", enable),
                        'T' => self.apply_set_option("functrace", enable),
                        'E' => self.apply_set_option("errtrace", enable),
                        'B' => self.apply_set_option("braceexpand", enable),
                        'o' if pos + 1 == chars.len() => {
                            if i + 1 < args.len() {
                                i += 1;
                                let opt_name = args[i].clone();
                                if SET_OPTIONS.contains(&opt_name.as_str()) || opt_name == "xtrace"
                                {
                                    self.apply_set_option(&opt_name, enable);
                                } else if UNSUPPORTED_SET_OPTIONS.contains(&opt_name.as_str()) {
                                    return BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format!(
                                            "set: {opt_name}: unsupported shell option\n"
                                        ),
                                        exit_code: 1,
                                    };
                                } else {
                                    return BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format!("set: {opt_name}: invalid option name\n"),
                                        exit_code: 2,
                                    };
                                }
                            } else {
                                for &name in SET_OPTIONS {
                                    let active = self.get_shopt_enabled(name, true);
                                    if enable {
                                        stdout.push_str(&format!(
                                            "{name}\t{}\n",
                                            if active { "on" } else { "off" }
                                        ));
                                    } else {
                                        stdout.push_str(&format!(
                                            "set {}o {name}\n",
                                            if active { "-" } else { "+" }
                                        ));
                                    }
                                }
                            }
                        }
                        _ => {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "set: unsupported shell option; supported forms are +/- a/e/u/f/n/B/C clusters, -- arguments and terminal o with allexport, braceexpand, noclobber, noexec, noglob, pipefail, errexit or nounset\n".to_string(),
                                exit_code: 1,
                            };
                        }
                    }
                }
            } else {
                self.pos_args = args[i..].to_vec();
                break;
            }
            i += 1;
        }
        BuiltinOutcome {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        }
    }

    fn builtin_alias(&mut self, raw_args: &[String]) -> BuiltinOutcome {
        let mut args: Vec<String> = raw_args.to_vec();
        if args.first().map(|s| s.as_str()) == Some("-L") {
            args[0] = "-p".to_string();
        }
        let mut index = 0usize;
        let mut print = false;
        while index < args.len() {
            let arg = &args[index];
            if arg == "--" {
                index += 1;
                break;
            }
            if !arg.starts_with('-') || arg == "-" {
                break;
            }
            if arg[1..].chars().all(|c| c == 'p') {
                print = true;
            } else {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("alias: {arg}: invalid option\n"),
                    exit_code: 2,
                };
            }
            index += 1;
        }

        let mut stdout = String::new();
        let mut stderr = String::new();
        let format_entry = |name: &str, val: &str| -> String {
            format!("alias {name}='{}'\n", val.replace('\'', "'\\''"))
        };

        if print || index == args.len() {
            for (k, v) in self.env.iter() {
                if let Some(name) = k.strip_prefix("__alias__") {
                    stdout.push_str(&format_entry(name, v));
                }
            }
        }

        let mut exit_code = 0;
        for arg in &args[index..] {
            if let Some(eq) = arg.find('=') {
                let name = &arg[..eq];
                let val = &arg[eq + 1..];
                if name.is_empty()
                    || name
                        .chars()
                        .any(|c| " /$`=;|&()<>'\"\\\t\r\n".contains(c))
                {
                    stderr.push_str(&format!("alias: {name}: invalid alias name\n"));
                    exit_code = 1;
                    continue;
                }
                self.env
                    .insert(format!("__alias__{name}"), val.to_string());
            } else if let Some(val) = self.env.get(&format!("__alias__{arg}")) {
                stdout.push_str(&format_entry(arg, val));
            } else {
                stderr.push_str(&format!("alias: {arg}: not found\n"));
                exit_code = 1;
            }
        }

        BuiltinOutcome {
            stdout,
            stderr,
            exit_code,
        }
    }

    fn builtin_unalias(&mut self, args: &[String]) -> BuiltinOutcome {
        let mut index = 0usize;
        let mut all = false;
        while index < args.len() {
            let arg = &args[index];
            if arg == "--" {
                index += 1;
                break;
            }
            if !arg.starts_with('-') || arg == "-" {
                break;
            }
            if arg[1..].chars().all(|c| c == 'a') {
                all = true;
            } else {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("unalias: {arg}: invalid option\n"),
                    exit_code: 2,
                };
            }
            index += 1;
        }

        if all {
            let keys: Vec<String> = self
                .env
                .keys()
                .filter(|k| k.starts_with("__alias__"))
                .cloned()
                .collect();
            for k in keys {
                self.env.remove(&k);
            }
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            };
        }

        if index == args.len() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "unalias: usage: unalias [-a] name [name ...]\n".to_string(),
                exit_code: 2,
            };
        }

        let mut stderr = String::new();
        let mut exit_code = 0;
        for name in &args[index..] {
            if self.env.remove(&format!("__alias__{name}")).is_none() {
                stderr.push_str(&format!("unalias: {name}: not found\n"));
                exit_code = 1;
            }
        }

        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code,
        }
    }

    fn get_shopt_enabled(&self, name: &str, opt_mode: bool) -> bool {
        if opt_mode {
            match name {
                "errexit" => self.errexit,
                "nounset" => self.nounset,
                "pipefail" => self.pipefail,
                "noclobber" => self.noclobber,
                "noexec" => self.noexec,
                "xtrace" => self.xtrace,
                "braceexpand" => self
                    .env
                    .get("__set_braceexpand")
                    .map(|v| v != "0")
                    .unwrap_or(true),
                other => self
                    .env
                    .get(&format!("__set_{other}"))
                    .map(|v| v == "1")
                    .unwrap_or(false),
            }
        } else {
            self.env
                .get(&format!("__shopt_{name}"))
                .map(|v| v == "1")
                .unwrap_or(false)
        }
    }

    fn builtin_shopt(&mut self, args: &[String]) -> BuiltinOutcome {
        let mut set_flag = false;
        let mut unset_flag = false;
        let mut quiet = false;
        let mut print_flag = false;
        let mut opt_mode = false;
        let mut index = 0usize;

        while index < args.len() {
            let option = &args[index];
            if option == "--" {
                index += 1;
                break;
            }
            if !option.starts_with('-') || option == "-" {
                break;
            }
            for flag in option[1..].chars() {
                match flag {
                    'p' => print_flag = true,
                    'q' => quiet = true,
                    's' => set_flag = true,
                    'u' => unset_flag = true,
                    'o' => opt_mode = true,
                    _ => {
                        let bad = if option.starts_with("--") {
                            option.clone()
                        } else {
                            format!("-{flag}")
                        };
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!(
                                "shopt: {bad}: unsupported option\nshopt: usage: shopt [-opqsu] [--] [option ...]\n"
                            ),
                            exit_code: 2,
                        };
                    }
                }
            }
            index += 1;
        }

        if set_flag && unset_flag {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "shopt: cannot set and unset shell options simultaneously\n".to_string(),
                exit_code: 1,
            };
        }

        const SET_OPTIONS: &[&str] = &[
            "allexport",
            "braceexpand",
            "errexit",
            "noclobber",
            "noexec",
            "noglob",
            "nounset",
            "pipefail",
            "errtrace",
            "functrace",
        ];
        const SHOPT_OPTIONS: &[&str] = &[
            "dotglob",
            "expand_aliases",
            "extglob",
            "failglob",
            "globstar",
            "inherit_errexit",
            "lastpipe",
            "nocaseglob",
            "nocasematch",
            "nullglob",
            "xpg_echo",
            "extdebug",
        ];
        let known = if opt_mode { SET_OPTIONS } else { SHOPT_OPTIONS };

        let emit = |out: &mut String, name: &str, enabled: bool| {
            if !quiet {
                if print_flag {
                    if opt_mode {
                        let sign = if enabled { "-" } else { "+" };
                        out.push_str(&format!("set {sign}o {name}\n"));
                    } else {
                        let flag = if enabled { "s" } else { "u" };
                        out.push_str(&format!("shopt -{flag} {name}\n"));
                    }
                } else {
                    let status = if enabled { "on" } else { "off" };
                    out.push_str(&format!("{name:<20}\t{status}\n"));
                }
            }
        };

        let mut out = String::new();
        let mut stderr = String::new();
        if index == args.len() {
            for &name in known {
                let enabled = self.get_shopt_enabled(name, opt_mode);
                if (!set_flag || enabled) && (!unset_flag || !enabled) {
                    emit(&mut out, name, enabled);
                }
            }
            return BuiltinOutcome {
                stdout: out,
                stderr,
                exit_code: 0,
            };
        }

        let mut status = 0;
        for name in &args[index..] {
            let valid = known.contains(&name.as_str()) || (opt_mode && name == "xtrace");
            if !valid {
                stderr.push_str(&format!(
                    "shopt: {name}: unsupported shell option name (supported: {})\n",
                    known.join(", ")
                ));
                status = 1;
            } else if set_flag || unset_flag {
                if opt_mode {
                    self.apply_set_option(name, set_flag);
                } else {
                    self.env.insert(
                        format!("__shopt_{name}"),
                        if set_flag { "1" } else { "0" }.to_string(),
                    );
                    if name == "extdebug" {
                        self.apply_set_option("errtrace", set_flag);
                        self.apply_set_option("functrace", set_flag);
                    }
                }
            } else {
                let enabled = self.get_shopt_enabled(name, opt_mode);
                emit(&mut out, name, enabled);
                if !enabled {
                    status = 1;
                }
            }
        }

        BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code: status,
        }
    }

    fn trap_signal_catalog() -> &'static [(u32, &'static str)] {
        &[
            (1, "SIGHUP"),
            (2, "SIGINT"),
            (3, "SIGQUIT"),
            (4, "SIGILL"),
            (5, "SIGTRAP"),
            (6, "SIGABRT"),
            (7, "SIGBUS"),
            (8, "SIGFPE"),
            (9, "SIGKILL"),
            (10, "SIGUSR1"),
            (11, "SIGSEGV"),
            (12, "SIGUSR2"),
            (13, "SIGPIPE"),
            (14, "SIGALRM"),
            (15, "SIGTERM"),
            (16, "SIGSTKFLT"),
            (17, "SIGCHLD"),
            (18, "SIGCONT"),
            (19, "SIGSTOP"),
            (20, "SIGTSTP"),
            (21, "SIGTTIN"),
            (22, "SIGTTOU"),
            (23, "SIGURG"),
            (24, "SIGXCPU"),
            (25, "SIGXFSZ"),
            (26, "SIGVTALRM"),
            (27, "SIGPROF"),
            (28, "SIGWINCH"),
            (29, "SIGIO"),
            (30, "SIGPWR"),
            (31, "SIGSYS"),
        ]
    }

    fn resolve_trap_signal(sig: &str) -> Option<(u32, &'static str)> {
        let up = sig.trim().to_uppercase();
        let stripped = up.strip_prefix("SIG").unwrap_or(&up);
        match stripped {
            "0" | "EXIT" => return Some((0, "EXIT")),
            "DEBUG" => return Some((32, "DEBUG")),
            "ERR" => return Some((33, "ERR")),
            "RETURN" => return Some((34, "RETURN")),
            _ => {}
        }
        let digits = up.strip_prefix('+').unwrap_or(&up);
        if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
            let num = digits.parse::<u32>().ok()?;
            if num == 0 {
                return Some((0, "EXIT"));
            }
            return Self::trap_signal_catalog()
                .iter()
                .find(|(n, _)| *n == num)
                .copied();
        }
        Self::trap_signal_catalog()
            .iter()
            .find(|(_, name)| name.strip_prefix("SIG").unwrap_or(name) == stripped)
            .copied()
    }

    fn builtin_trap(&mut self, args: &[String]) -> BuiltinOutcome {
        let mut idx = 0usize;
        let mut print = false;
        let mut list = false;
        while idx < args.len() && args[idx].starts_with('-') && args[idx] != "-" {
            let option = &args[idx];
            idx += 1;
            if option == "--" {
                break;
            }
            for flag in option[1..].chars() {
                if flag == 'p' {
                    print = true;
                } else if flag == 'l' {
                    list = true;
                } else {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!(
                            "trap: -{flag}: invalid option\ntrap: usage: trap [-lp] [arg signal_spec ...]\n"
                        ),
                        exit_code: 2,
                    };
                }
            }
        }
        if list {
            let mut output = String::new();
            for (index, (number, name)) in Self::trap_signal_catalog().iter().enumerate() {
                let sep = if index % 4 == 3 { '\n' } else { '\t' };
                output.push_str(&format!("{number:>2}) {name}{sep}"));
            }
            if !output.ends_with('\n') {
                output.push('\n');
            }
            return BuiltinOutcome {
                stdout: output,
                stderr: String::new(),
                exit_code: 0,
            };
        }
        let rest = &args[idx..];
        if rest.is_empty() {
            print = true;
        }
        if !print && rest.len() == 1 && rest[0] == "-" {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "trap: usage: trap [-lp] [arg signal_spec ...]\n".to_string(),
                exit_code: 2,
            };
        }
        let numeric_reset = rest
            .first()
            .is_some_and(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()));
        let (action_opt, targets): (Option<&str>, &[String]) =
            if !print && rest.len() > 1 && !numeric_reset {
                (Some(rest[0].as_str()), &rest[1..])
            } else {
                (None, rest)
            };

        let mut out = String::new();
        let mut stderr = String::new();
        let mut status = 0;
        if print && targets.is_empty() {
            let mut entries: Vec<(u32, String, String)> = self
                .traps
                .iter()
                .chain(
                    self.inactive_traps
                        .iter()
                        .filter(|(k, _)| !self.traps.contains_key(*k)),
                )
                .map(|(k, v)| {
                    let ord = Self::resolve_trap_signal(k).map(|(n, _)| n).unwrap_or(999);
                    (ord, k.clone(), v.clone())
                })
                .collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
            for (_, sig, cmd) in entries {
                out.push_str(&format!(
                    "trap -- '{}' {sig}\n",
                    cmd.replace('\'', "'\\''")
                ));
            }
            return BuiltinOutcome {
                stdout: out,
                stderr,
                exit_code: 0,
            };
        }
        for target in targets {
            let Some((_, norm_name)) = Self::resolve_trap_signal(target) else {
                stderr.push_str(&format!("trap: {target}: invalid signal specification\n"));
                status = 1;
                continue;
            };
            let norm = norm_name.to_string();
            if print {
                if let Some(cmd) = self
                    .traps
                    .get(&norm)
                    .or_else(|| self.inactive_traps.get(&norm))
                {
                    out.push_str(&format!(
                        "trap -- '{}' {norm}\n",
                        cmd.replace('\'', "'\\''")
                    ));
                }
            } else if action_opt.is_none() || action_opt == Some("-") {
                if self
                    .env
                    .get(&format!("__trap_inherited_ignored__{norm}"))
                    .is_some_and(|v| v == "1")
                {
                    continue;
                }
                self.env.remove(&format!("__trap_ignored__{norm}"));
                self.traps.remove(&norm);
                self.inactive_traps.remove(&norm);
                self.trap_versions.remove(&norm);
            } else if let Some(action) = action_opt {
                if self
                    .env
                    .get(&format!("__trap_inherited_ignored__{norm}"))
                    .is_some_and(|v| v == "1")
                {
                    continue;
                }
                if action.is_empty() {
                    self.env.insert(format!("__trap_ignored__{norm}"), "1".to_string());
                } else {
                    self.env.remove(&format!("__trap_ignored__{norm}"));
                }
                let ver = self.next_trap_version;
                self.next_trap_version += 1;
                self.inactive_traps.remove(&norm);
                self.trap_versions.insert(norm.clone(), ver);
                self.traps.insert(norm, action.to_string());
            }
        }
        BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code: status,
        }
    }

    fn builtin_declare(
        &mut self,
        cmd: &str,
        args: &[String],
    ) -> Result<BuiltinOutcome, EvalError> {
        let mut enabled: BTreeSet<char> = BTreeSet::new();
        let mut disabled: BTreeSet<char> = BTreeSet::new();
        if cmd == "readonly" {
            enabled.insert('r');
        }
        if cmd == "export" {
            enabled.insert('x');
        }
        let mut is_global = false;
        let mut func_names_only = false;
        let mut func_mode = false;
        let mut print_mode = false;
        let mut operands = Vec::new();
        let mut end_of_opts = false;

        for arg in args {
            if !end_of_opts && arg == "--" {
                end_of_opts = true;
                continue;
            }
            if !end_of_opts
                && (arg.starts_with('-') || (cmd != "export" && cmd != "readonly" && arg.starts_with('+')))
                && arg.len() > 1
                && !arg.contains('=')
            {
                let is_plus = arg.starts_with('+');
                for ch in arg[1..].chars() {
                    if cmd == "export" {
                        if is_plus || !"fnp".contains(ch) {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!(
                                    "export: -{ch}: invalid option\nexport: usage: export [-fn] [name[=value] ...] or export -p\n"
                                ),
                                exit_code: 2,
                            });
                        }
                    } else if cmd == "readonly" {
                        if is_plus || !"afp".contains(ch) {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("readonly: {arg}: unsupported option\n"),
                                exit_code: 2,
                            });
                        }
                    } else {
                        let allowed = if cmd == "local" {
                            "AailunxrIp"
                        } else {
                            "AailunxrgIfFtp"
                        };
                        if !allowed.contains(ch) {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{cmd}: {arg}: invalid option\n"),
                                exit_code: 2,
                            });
                        }
                    }
                    if cmd == "export" && ch == 'n' {
                        enabled.remove(&'x');
                        disabled.insert('x');
                        continue;
                    }
                    match ch {
                        'n' | 'A' | 'a' | 'i' | 'l' | 'u' | 'r' | 'x' => {
                            if is_plus {
                                enabled.remove(&ch);
                                disabled.insert(ch);
                            } else {
                                disabled.remove(&ch);
                                if ch == 'l' {
                                    enabled.remove(&'u');
                                    disabled.insert('u');
                                } else if ch == 'u' {
                                    enabled.remove(&'l');
                                    disabled.insert('l');
                                }
                                enabled.insert(ch);
                            }
                        }
                        'g' => is_global = !is_plus,
                        'F' => func_names_only = true,
                        'f' => func_mode = true,
                        'p' => print_mode = true,
                        _ => {}
                    }
                }
            } else {
                operands.push(arg.clone());
            }
        }

        let is_nameref = enabled.contains(&'n');
        let is_assoc = enabled.contains(&'A');
        let is_indexed = enabled.contains(&'a');
        let is_readonly = enabled.contains(&'r');
        let is_export = enabled.contains(&'x');
        let is_local = cmd == "local"
            || ((cmd == "declare" || cmd == "typeset") && !is_global && !self.local_scopes.is_empty());

        if func_names_only {
            let mut out = String::new();
            let mut all_ok = true;
            if operands.is_empty() {
                for name in self.functions.keys() {
                    out.push_str(&format!("{name}\n"));
                }
            } else {
                for name in &operands {
                    if self.functions.contains_key(name) {
                        out.push_str(&format!("{name}\n"));
                    } else {
                        all_ok = false;
                    }
                }
            }
            return Ok(BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: if all_ok { 0 } else { 1 },
            });
        }

        if func_mode && (is_export || disabled.contains(&'x')) {
            let mut out = String::new();
            let mut stderr = String::new();
            let mut status = 0;
            if operands.is_empty() {
                let mut sorted_exported: Vec<String> =
                    self.exported_functions.iter().cloned().collect();
                sorted_exported.sort();
                for name in sorted_exported {
                    if let Some(body) = self.functions.get(&name) {
                        out.push_str(&format_function_display(&name, body));
                        out.push_str(&format!("declare -fx {name}\n"));
                    }
                }
            } else {
                for name in &operands {
                    if !self.functions.contains_key(name) {
                        stderr.push_str(&format!("{cmd}: {name}: not a function\n"));
                        status = 1;
                    } else if disabled.contains(&'x') {
                        self.exported_functions.remove(name);
                    } else {
                        self.exported_functions.insert(name.clone());
                    }
                }
            }
            return Ok(BuiltinOutcome {
                stdout: out,
                stderr,
                exit_code: status,
            });
        }
        if func_mode && is_readonly {
            let mut out = String::new();
            let mut stderr = String::new();
            let mut status = 0;
            if operands.is_empty() {
                for (name, body) in &self.functions {
                    if self
                        .env
                        .get(&format!("__readonly_fn__{name}"))
                        .is_some_and(|v| v == "1")
                    {
                        out.push_str(&format_function_display(name, body));
                        out.push_str(&format!("declare -fr {name}\n"));
                    }
                }
            } else {
                for name in &operands {
                    if !self.functions.contains_key(name) {
                        stderr.push_str(&format!("readonly: {name}: not a function\n"));
                        status = 1;
                    } else {
                        self.env
                            .insert(format!("__readonly_fn__{name}"), "1".to_string());
                    }
                }
            }
            return Ok(BuiltinOutcome {
                stdout: out,
                stderr,
                exit_code: status,
            });
        }

        if func_mode {
            let mut out = String::new();
            let mut status = 0;
            if operands.is_empty() {
                for (name, body) in &self.functions {
                    out.push_str(&format_function_display(name, body));
                }
            } else {
                for name in &operands {
                    if let Some(body) = self.functions.get(name) {
                        out.push_str(&format_function_display(name, body));
                    } else {
                        status = 1;
                    }
                }
            }
            return Ok(BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: status,
            });
        }

        if cmd == "local" && self.local_scopes.is_empty() {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: "local: not in a function\n".to_string(),
                exit_code: 1,
            });
        }

        if (cmd == "readonly" || cmd == "export") && operands.is_empty() {
            let mut out = String::new();
            let mut candidate_names: BTreeSet<String> = BTreeSet::new();
            for k in self.env.keys() {
                if let Some(n) = k.strip_prefix("__attr__") {
                    candidate_names.insert(n.to_string());
                } else if !k.starts_with("__") && !k.contains('[') {
                    candidate_names.insert(k.clone());
                }
            }
            for name in candidate_names {
                let (has_var, is_arr_assoc, is_arr, entries, flags) = get_var_meta_info(&name, self.env);
                if !has_var {
                    continue;
                }
                if cmd == "readonly" {
                    if !flags.contains('r') {
                        continue;
                    }
                    if is_arr {
                        let mut pairs = Vec::new();
                        for (k, v) in entries {
                            let qk = if is_arr_assoc { bash_quote_double(&k) } else { k };
                            pairs.push(format!("[{qk}]={}", bash_quote_double(&v)));
                        }
                        let prefix_fl = if is_arr_assoc { "Ar" } else { "ar" };
                        out.push_str(&format!("declare -{prefix_fl} {name}=({})\n", pairs.join(" ")));
                    } else if let Some(val) = self.env.get(&name) {
                        out.push_str(&format!("declare -r {name}={}\n", bash_quote_double(val)));
                    } else {
                        out.push_str(&format!("declare -r {name}\n"));
                    }
                } else {
                    if !flags.contains('x') {
                        continue;
                    }
                    if let Some(val) = self.env.get(&name) {
                        out.push_str(&format!("declare -x {name}={}\n", bash_quote_double(val)));
                    } else {
                        out.push_str(&format!("declare -x {name}\n"));
                    }
                }
            }
            return Ok(BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: 0,
            });
        }

        if print_mode {
            let mut out = String::new();
            let mut stderr = String::new();
            let mut status = 0;
            let names: Vec<String> = if !operands.is_empty() {
                operands
            } else {
                let mut set = BTreeSet::new();
                for k in self.env.keys() {
                    if let Some(n) = k.strip_prefix("__attr__") {
                        set.insert(n.to_string());
                    } else if let Some(n) = k.strip_prefix("__declared__") {
                        set.insert(n.to_string());
                    } else if let Some(n) = k.strip_prefix("__assoc__") {
                        set.insert(n.to_string());
                    } else if let Some((b, _)) = k.split_once('[') {
                        if !b.starts_with("__") {
                            set.insert(b.to_string());
                        }
                    } else if !k.starts_with("__") {
                        set.insert(k.clone());
                    }
                }
                set.into_iter().collect()
            };
            for name in &names {
                let (has_var, is_arr_assoc, is_arr, entries, flags) = get_var_meta_info(name, self.env);
                if !has_var {
                    stderr.push_str(&format!("{cmd}: {name}: not found\n"));
                    status = 1;
                    continue;
                }
                let flag_str = if flags.is_empty() {
                    "--".to_string()
                } else {
                    format!("-{flags}")
                };
                if is_arr {
                    let mut pairs = Vec::with_capacity(entries.len());
                    for (k, v) in entries {
                        let qk = if is_arr_assoc { bash_quote_double(&k) } else { k };
                        let qv = bash_quote_double(&v);
                        pairs.push(format!("[{qk}]={qv}"));
                    }
                    out.push_str(&format!("declare {flag_str} {name}=({})\n", pairs.join(" ")));
                } else if let Some(val) = self.env.get(name) {
                    out.push_str(&format!("declare {flag_str} {name}={}\n", bash_quote_double(val)));
                } else {
                    out.push_str(&format!("declare {flag_str} {name}\n"));
                }
            }
            return Ok(BuiltinOutcome {
                stdout: out,
                stderr,
                exit_code: status,
            });
        }

        let mut decl_stderr = String::new();
        let mut decl_status = 0;
        for op in operands {
            let (var_name, val_opt, append) = match parse_assignment_lhs_rhs(&op) {
                Some((k, v, app)) => (k.to_string(), Some(v.to_string()), app),
                None => (op.clone(), None, false),
            };
            let base_name = var_name
                .split_once('[')
                .map(|(b, _)| b)
                .unwrap_or(&var_name)
                .to_string();

            if !is_valid_shell_ident(&base_name) {
                decl_stderr.push_str(&format!("{cmd}: `{op}': not a valid identifier\n"));
                decl_status = 1;
                continue;
            }

            if self
                .env
                .get(&format!("__attr__{base_name}"))
                .is_some_and(|a| a.contains('r'))
                && (val_opt.is_some() || is_local)
            {
                decl_stderr.push_str(&format!("{cmd}: {base_name}: readonly variable\n"));
                decl_status = 1;
                continue;
            }

            if is_local
                && let Some(frame) = self.local_scopes.last_mut()
                && !frame.contains_key(&base_name)
            {
                frame.insert(base_name.clone(), self.env.get(&base_name).cloned());
                for meta_prefix in ["__attr__", "__assoc__", "__nameref__", "__declared__", "__keys__"] {
                    let mk = format!("{meta_prefix}{base_name}");
                    frame.insert(mk.clone(), self.env.get(&mk).cloned());
                }
                let arr_prefix = format!("{base_name}[");
                let existing_arr_keys: Vec<(String, String)> = self
                    .env
                    .iter()
                    .filter(|(ek, _)| ek.starts_with(&arr_prefix))
                    .map(|(ek, ev)| (ek.clone(), ev.clone()))
                    .collect();
                for (ak, av) in existing_arr_keys {
                    frame.insert(ak.clone(), Some(av));
                    if val_opt.is_none() || !append {
                        self.env.remove(&ak);
                    }
                }
                self.env.remove(&format!("__attr__{base_name}"));
                self.env.remove(&format!("__assoc__{base_name}"));
                self.env.remove(&format!("__nameref__{base_name}"));
                self.env.remove(&format!("__declared__{base_name}"));
                self.env.remove(&format!("__keys__{base_name}"));
                if val_opt.is_none() || !append {
                    self.env.remove(&base_name);
                }
            }

            if is_assoc {
                self.env
                    .insert(format!("__assoc__{base_name}"), "1".to_string());
            }
            if is_export {
                self.env.remove(&format!("__unexported__{base_name}"));
            }
            if disabled.contains(&'x') {
                self.env
                    .insert(format!("__unexported__{base_name}"), "1".to_string());
            }
            if disabled.contains(&'n') {
                self.env.remove(&format!("__nameref__{base_name}"));
            }

            if is_nameref {
                if let Some(target) = val_opt {
                    let target_base = target
                        .split_once('[')
                        .map(|(b, _)| b)
                        .unwrap_or(&target);
                    if target == base_name || !is_valid_shell_ident(target_base) {
                        decl_stderr.push_str(&format!("{cmd}: {target}: invalid name reference\n"));
                        decl_status = 1;
                        continue;
                    }
                    self.env
                        .insert(format!("__nameref__{base_name}"), target);
                }
                continue;
            }

            let mut cur_attr = self
                .env
                .get(&format!("__attr__{base_name}"))
                .cloned()
                .unwrap_or_default();
            for &d in &disabled {
                cur_attr = cur_attr.chars().filter(|&c| c != d).collect();
            }
            for &e in &enabled {
                if "aAilnrux".contains(e) && !cur_attr.contains(e) {
                    cur_attr.push(e);
                }
            }
            let pre_attr: String = cur_attr.chars().filter(|&c| c != 'r').collect();
            if pre_attr.is_empty() {
                self.env.remove(&format!("__attr__{base_name}"));
            } else {
                self.env
                    .insert(format!("__attr__{base_name}"), pre_attr);
            }

            if let Some(v) = val_opt {
                self.assign_variable(&var_name, &v, append)?;
            } else if is_indexed || is_assoc {
                sync_array_metadata(&base_name, self.env);
            } else if is_local && !self.env.contains_key(&base_name) && enabled.is_empty() && disabled.is_empty() {
                self.env.insert(base_name.clone(), String::new());
            } else if !self.env.contains_key(&base_name) {
                self.env
                    .insert(format!("__declared__{base_name}"), "1".to_string());
            }

            if cur_attr.is_empty() {
                self.env.remove(&format!("__attr__{base_name}"));
            } else {
                self.env.insert(format!("__attr__{base_name}"), cur_attr);
            }
        }

        Ok(BuiltinOutcome {
            stdout: String::new(),
            stderr: decl_stderr,
            exit_code: decl_status,
        })
    }

    fn builtin_unset(&mut self, args: &[String]) -> BuiltinOutcome {
        let mut unset_var = false;
        let mut unset_nameref = false;
        let mut unset_func = false;
        let mut idx = 0usize;
        while idx < args.len() && args[idx].starts_with('-') && args[idx] != "-" {
            let opt = &args[idx];
            if opt == "--" {
                idx += 1;
                break;
            }
            for ch in opt[1..].chars() {
                match ch {
                    'v' => unset_var = true,
                    'f' => unset_func = true,
                    'n' => unset_nameref = true,
                    _ => {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("unset: -{ch}: invalid option\n"),
                            exit_code: 2,
                        };
                    }
                }
            }
            idx += 1;
        }
        if unset_var && unset_func {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "unset: cannot simultaneously unset a function and a variable\n"
                    .to_string(),
                exit_code: 1,
            };
        }

        let mut stderr = String::new();
        let mut status = 0;
        for arg in &args[idx..] {
            let has_var_binding = self.env.contains_key(arg)
                || self.env.contains_key(&format!("__attr__{arg}"))
                || self.env.contains_key(&format!("__declared__{arg}"))
                || self.env.contains_key(&format!("__assoc__{arg}"))
                || self.env.contains_key(&format!("__nameref__{arg}"))
                || self.env.keys().any(|k| k.starts_with(&format!("{arg}[")))
                || self.local_scopes.iter().any(|f| f.contains_key(arg));
            let fallback_func =
                !unset_var && !unset_nameref && !has_var_binding && self.functions.contains_key(arg);
            if unset_func || fallback_func {
                if self
                    .env
                    .get(&format!("__readonly_fn__{arg}"))
                    .is_some_and(|v| v == "1")
                {
                    stderr.push_str(&format!("unset: {arg}: cannot unset: readonly function\n"));
                    status = 1;
                    continue;
                }
                self.functions.remove(arg);
                self.exported_functions.remove(arg);
                continue;
            }
            if unset_nameref {
                self.env.remove(&format!("__nameref__{arg}"));
                continue;
            }
            if let Some((base, sub_rest)) = arg.split_once('[')
                && let Some(raw_sub) = sub_rest.strip_suffix(']')
            {
                let resolved = resolve_nameref_base(base, self.env).to_string();
                if self
                    .env
                    .get(&format!("__attr__{resolved}"))
                    .is_some_and(|a| a.contains('r'))
                {
                    stderr.push_str(&format!(
                        "unset: {resolved}: cannot unset: readonly variable\n"
                    ));
                    status = 1;
                    continue;
                }
                let clean_sub = raw_sub.trim_matches('"').trim_matches('\'');
                if clean_sub != "@" && clean_sub != "*" {
                    let elem_key = resolve_var_key_mut(&format!("{resolved}[{clean_sub}]"), self.env);
                    self.env.remove(&elem_key);
                    sync_array_metadata(&resolved, self.env);
                    continue;
                }
            }
            let base_arg = arg.split_once('[').map(|(b, _)| b).unwrap_or(arg);
            let resolved = resolve_nameref_base(base_arg, self.env).to_string();
            if self
                .env
                .get(&format!("__attr__{resolved}"))
                .is_some_and(|a| a.contains('r'))
            {
                stderr.push_str(&format!(
                    "unset: {resolved}: cannot unset: readonly variable\n"
                ));
                status = 1;
                continue;
            }
            self.env.remove(&resolved);
            if resolved == "PATH" {
                self.env.insert("__path_unset__".to_string(), "1".to_string());
            }
            if resolved == "RANDOM" {
                self.env.insert("__random_disabled".to_string(), "1".to_string());
            }
            if resolved == "SECONDS" {
                self.env.insert("__seconds_disabled".to_string(), "1".to_string());
            }
            if resolved == "OPTIND" {
                self.env.remove("__getopts_sub");
                self.env.remove("__getopts_ind");
            }
            self.env.remove(&format!("__attr__{resolved}"));
            self.env.remove(&format!("__declared__{resolved}"));
            self.env.remove(&format!("__assoc__{resolved}"));
            self.env.remove(&format!("__keys__{resolved}"));
            let prefix = format!("{resolved}[");
            let arr_keys: Vec<String> = self
                .env
                .keys()
                .filter(|k| k.starts_with(&prefix))
                .cloned()
                .collect();
            for k in arr_keys {
                self.env.remove(&k);
            }
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code: status,
        }
    }

    fn builtin_read(&mut self, args: &[String], stdin: &mut String) -> BuiltinOutcome {
        let mut raw_mode = false;
        let mut delim = '\n';
        let mut nchars: Option<usize> = None;
        let mut exact_chars = false;
        let mut array_name: Option<String> = None;
        let mut fd_num: u32 = 0;
        let mut vars = Vec::new();

        let mut idx = 0usize;
        while idx < args.len() {
            let a = &args[idx];
            if a == "-r" {
                raw_mode = true;
                idx += 1;
            } else if a == "-s" {
                idx += 1;
            } else if a == "-d" && idx + 1 < args.len() {
                delim = args[idx + 1].chars().next().unwrap_or('\0');
                idx += 2;
            } else if (a == "-n" || a == "-N") && idx + 1 < args.len() {
                exact_chars = a == "-N";
                nchars = args[idx + 1].parse::<usize>().ok();
                idx += 2;
            } else if a == "-a" && idx + 1 < args.len() {
                array_name = Some(args[idx + 1].clone());
                idx += 2;
            } else if a == "-u" && idx + 1 < args.len() {
                fd_num = args[idx + 1].parse::<u32>().unwrap_or(0);
                idx += 2;
            } else if (a == "-p" || a == "-t") && idx + 1 < args.len() {
                idx += 2;
            } else if a.starts_with('-') && a.len() > 1 {
                for ch in a[1..].chars() {
                    if ch == 'r' {
                        raw_mode = true;
                    }
                }
                idx += 1;
            } else {
                vars.push(a.clone());
                idx += 1;
            }
        }

        let default_reply = vars.is_empty() && array_name.is_none();
        if default_reply {
            vars.push("REPLY".to_string());
        }

        let mut fd_buf = if fd_num >= 3 {
            self.in_fds.remove(&fd_num).unwrap_or_default()
        } else {
            String::new()
        };
        let stream: &mut String = if fd_num >= 3 { &mut fd_buf } else { stdin };

        if stream.is_empty() {
            if let Some(ref arr) = array_name {
                let resolved = resolve_nameref_base(arr, self.env).to_string();
                if self
                    .env
                    .get(&format!("__attr__{resolved}"))
                    .is_some_and(|a| a.contains('r'))
                {
                    if fd_num >= 3 {
                        self.in_fds.insert(fd_num, fd_buf);
                    }
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{resolved}: readonly variable\n"),
                        exit_code: 1,
                    };
                }
            } else {
                for (i, v) in vars.iter().enumerate() {
                    let resolved = resolve_nameref_base(v, self.env).to_string();
                    let base = resolved.split_once('[').map(|(b, _)| b).unwrap_or(&resolved);
                    if self
                        .env
                        .get(&format!("__attr__{base}"))
                        .is_some_and(|a| a.contains('r'))
                    {
                        if fd_num >= 3 {
                            self.in_fds.insert(fd_num, fd_buf);
                        }
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{base}: readonly variable\n"),
                            exit_code: if default_reply || i + 1 < vars.len() {
                                2
                            } else {
                                1
                            },
                        };
                    }
                }
            }
            for v in vars {
                self.env.insert(v, String::new());
            }
            if let Some(arr) = array_name {
                let prefix = format!("{arr}[");
                let old: Vec<String> = self
                    .env
                    .keys()
                    .filter(|k| k.starts_with(&prefix))
                    .cloned()
                    .collect();
                for k in old {
                    self.env.remove(&k);
                }
                sync_array_metadata(&arr, self.env);
            }
            if fd_num >= 3 {
                self.in_fds.insert(fd_num, fd_buf);
            }
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 1,
            };
        }

        let mut hit_delim = false;
        let line_owned = if let Some(limit) = nchars {
            let mut taken = String::new();
            let mut consumed_bytes = 0usize;
            let mut count = 0usize;
            let mut stopped_at_delim = false;
            for (byte_idx, ch) in stream.char_indices() {
                if !exact_chars && ch == delim {
                    consumed_bytes = byte_idx + ch.len_utf8();
                    stopped_at_delim = true;
                    break;
                }
                if count < limit {
                    taken.push(ch);
                    count += 1;
                    consumed_bytes = byte_idx + ch.len_utf8();
                    if count == limit {
                        break;
                    }
                }
            }
            if stopped_at_delim && delim == '\n' {
                taken = taken.trim_end_matches('\r').to_string();
            }
            hit_delim = stopped_at_delim || count == limit;
            let rest = stream[consumed_bytes..].to_string();
            *stream = rest;
            taken
        } else if raw_mode {
            match stream.split_once(delim) {
                Some((l, r)) => {
                    hit_delim = true;
                    let clean = if delim == '\n' {
                        l.trim_end_matches('\r').to_string()
                    } else {
                        l.to_string()
                    };
                    *stream = r.to_string();
                    clean
                }
                None => {
                    let clean = if delim == '\n' {
                        stream.trim_end_matches('\r').to_string()
                    } else {
                        stream.clone()
                    };
                    stream.clear();
                    clean
                }
            }
        } else {
            let mut acc = String::new();
            loop {
                match stream.split_once(delim) {
                    Some((l, r)) => {
                        hit_delim = true;
                        let seg = if delim == '\n' {
                            l.trim_end_matches('\r').to_string()
                        } else {
                            l.to_string()
                        };
                        let r_owned = r.to_string();
                        *stream = r_owned;
                        if delim == '\n' && seg.ends_with('\\') {
                            acc.push_str(&seg[..seg.len() - 1]);
                            continue;
                        }
                        acc.push_str(&seg);
                        break;
                    }
                    None => {
                        acc.push_str(stream);
                        stream.clear();
                        break;
                    }
                }
            }
            let mut unescaped = String::new();
            let mut chars = acc.chars().peekable();
            while let Some(c) = chars.next() {
                if c == '\\' {
                    if let Some(nc) = chars.next() {
                        unescaped.push(nc);
                    }
                } else {
                    unescaped.push(c);
                }
            }
            unescaped
        };

        if fd_num >= 3 {
            self.in_fds.insert(fd_num, fd_buf);
        }

        let ifs = if exact_chars {
            String::new()
        } else {
            self.env
                .get("IFS")
                .cloned()
                .unwrap_or_else(|| " \t\n".to_string())
        };

        if let Some(arr) = array_name {
            let resolved = resolve_nameref_base(&arr, self.env).to_string();
            if self
                .env
                .get(&format!("__attr__{resolved}"))
                .is_some_and(|a| a.contains('r'))
            {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{resolved}: readonly variable\n"),
                    exit_code: 1,
                };
            }
            let prefix = format!("{arr}[");
            let old: Vec<String> = self
                .env
                .keys()
                .filter(|k| k.starts_with(&prefix))
                .cloned()
                .collect();
            for k in old {
                self.env.remove(&k);
            }
            let fields = split_ifs_fields(&line_owned, &ifs, None);
            for (i, f) in fields.into_iter().enumerate() {
                self.env.insert(format!("{arr}[{i}]"), f);
            }
            sync_array_metadata(&arr, self.env);
        } else if vars.len() == 1 {
            let resolved = resolve_nameref_base(&vars[0], self.env).to_string();
            let base = resolved.split_once('[').map(|(b, _)| b).unwrap_or(&resolved);
            if self
                .env
                .get(&format!("__attr__{base}"))
                .is_some_and(|a| a.contains('r'))
            {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{base}: readonly variable\n"),
                    exit_code: if default_reply { 2 } else { 1 },
                };
            }
            let trimmed = if default_reply || ifs.is_empty() {
                line_owned.clone()
            } else {
                line_owned
                    .trim_matches(|c: char| ifs.contains(c) && c.is_whitespace())
                    .to_string()
            };
            self.env.insert(vars[0].clone(), trimmed);
        } else {
            let fields = split_ifs_fields(&line_owned, &ifs, Some(vars.len()));
            for (i, v) in vars.iter().enumerate() {
                let resolved = resolve_nameref_base(v, self.env).to_string();
                let base = resolved.split_once('[').map(|(b, _)| b).unwrap_or(&resolved);
                if self
                    .env
                    .get(&format!("__attr__{base}"))
                    .is_some_and(|a| a.contains('r'))
                {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{base}: readonly variable\n"),
                        exit_code: if i + 1 == vars.len() { 1 } else { 2 },
                    };
                }
                let val = fields.get(i).cloned().unwrap_or_default();
                self.env.insert(v.clone(), val);
            }
        }

        BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: if hit_delim || nchars.is_some() { 0 } else { 1 },
        }
    }

    fn builtin_mapfile(&mut self, args: &[String], stdin: &mut String) -> BuiltinOutcome {
        let mut strip_delim = false;
        let mut delim = '\n';
        let mut skip_count = 0usize;
        let mut max_count: Option<usize> = None;
        let mut origin = 0usize;
        let mut callback: Option<String> = None;
        let mut quantum = 5000usize;
        let mut fd_num: u32 = 0;
        let mut arr_name = "MAPFILE".to_string();

        let mut i = 0usize;
        while i < args.len() {
            let a = &args[i];
            if a == "-t" {
                strip_delim = true;
                i += 1;
            } else if a == "-d" && i + 1 < args.len() {
                delim = args[i + 1].chars().next().unwrap_or('\0');
                i += 2;
            } else if a == "-s" && i + 1 < args.len() {
                skip_count = args[i + 1].parse::<usize>().unwrap_or(0);
                i += 2;
            } else if a == "-n" && i + 1 < args.len() {
                let n = args[i + 1].parse::<usize>().unwrap_or(0);
                if n > 0 {
                    max_count = Some(n);
                }
                i += 2;
            } else if a == "-O" && i + 1 < args.len() {
                origin = args[i + 1].parse::<usize>().unwrap_or(0);
                i += 2;
            } else if a == "-C" && i + 1 < args.len() {
                callback = Some(args[i + 1].clone());
                i += 2;
            } else if a == "-c" && i + 1 < args.len() {
                quantum = args[i + 1].parse::<usize>().unwrap_or(5000).max(1);
                i += 2;
            } else if a == "-u" && i + 1 < args.len() {
                fd_num = args[i + 1].parse::<u32>().unwrap_or(0);
                i += 2;
            } else if !a.starts_with('-') {
                arr_name = a.clone();
                i += 1;
            } else {
                i += 1;
            }
        }

        let resolved_arr = resolve_nameref_base(&arr_name, self.env).to_string();
        if self
            .env
            .get(&format!("__attr__{resolved_arr}"))
            .is_some_and(|a| a.contains('r'))
        {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{resolved_arr}: readonly variable\n"),
                exit_code: 1,
            };
        }

        if origin == 0 {
            let prefix = format!("{arr_name}[");
            let old: Vec<String> = self
                .env
                .keys()
                .filter(|k| k.starts_with(&prefix))
                .cloned()
                .collect();
            for k in old {
                self.env.remove(&k);
            }
        }

        let raw = if fd_num >= 3 {
            self.in_fds.remove(&fd_num).unwrap_or_default()
        } else {
            std::mem::take(stdin)
        };
        let mut cb_stdout = String::new();
        let mut cb_stderr = String::new();
        if !raw.is_empty() {
            let mut records = Vec::new();
            let mut start = 0usize;
            for (idx, ch) in raw.char_indices() {
                if ch == delim {
                    let end = if strip_delim {
                        idx
                    } else {
                        idx + ch.len_utf8()
                    };
                    records.push(raw[start..end].to_string());
                    start = idx + ch.len_utf8();
                }
            }
            if start < raw.len() {
                records.push(raw[start..].to_string());
            }

            let iter = records.into_iter().skip(skip_count);
            let taken: Vec<String> = match max_count {
                Some(m) => iter.take(m).collect(),
                None => iter.collect(),
            };
            for (offset, item) in taken.into_iter().enumerate() {
                let idx = origin + offset;
                if let Some(ref cb) = callback
                    && (offset + 1) % quantum == 0
                {
                    let cb_words = vec![cb.clone(), idx.to_string(), item.clone()];
                    let mut empty_in = String::new();
                    if let Ok(cb_out) = self.dispatch_words(&cb_words, &mut empty_in, false) {
                        cb_stdout.push_str(&cb_out.stdout);
                        cb_stderr.push_str(&cb_out.stderr);
                    }
                }
                self.env.insert(format!("{arr_name}[{idx}]"), item);
            }
        }
        sync_array_metadata(&arr_name, self.env);
        BuiltinOutcome {
            stdout: cb_stdout,
            stderr: cb_stderr,
            exit_code: 0,
        }
    }

    fn builtin_getopts(&mut self, args: &[String]) -> BuiltinOutcome {
        let offset = if args.first().map(|s| s.as_str()) == Some("--") {
            1
        } else {
            0
        };
        if offset == 0
            && let Some(first) = args.first()
            && first.starts_with('-')
            && first != "-"
        {
            let ch = first.chars().nth(1).unwrap_or('-');
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!(
                    "getopts: -{ch}: invalid option\ngetopts: usage: getopts optstring name [arg ...]\n"
                ),
                exit_code: 2,
            };
        }
        if args.len() - offset < 2 {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "getopts: usage: getopts optstring name [arg ...]\n".to_string(),
                exit_code: 2,
            };
        }
        let optstring = args[offset].clone();
        let var_name = args[offset + 1].clone();
        let opt_args: Vec<String> = if args.len() > offset + 2 {
            args[offset + 2..].to_vec()
        } else {
            self.pos_args.clone()
        };

        let silent = optstring.starts_with(':');
        let clean_opts = optstring.strip_prefix(':').unwrap_or(&optstring);
        let report_errors = !silent
            && self
                .env
                .get("OPTERR")
                .map(|v| v.is_empty() || v.trim().parse::<i64>() != Ok(0))
                .unwrap_or(true);
        let prog_name = self
            .env
            .get("0")
            .cloned()
            .or_else(|| self.script_name.clone())
            .unwrap_or_else(|| "shell".to_string());

        let optind = self
            .env
            .get("OPTIND")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(1)
            .max(1);
        let mut sub_idx = if self.env.get("__getopts_ind").and_then(|s| s.parse::<usize>().ok()) == Some(optind) {
            self.env
                .get("__getopts_sub")
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(1)
        } else {
            1
        };

        let resolved_var = resolve_nameref_base(&var_name, self.env).to_string();
        let var_is_readonly = self
            .env
            .get(&format!("__attr__{resolved_var}"))
            .is_some_and(|a| a.contains('r'));

        let finish_end = |this: &mut Self, next_optind: usize| -> BuiltinOutcome {
            this.env.insert("OPTIND".to_string(), next_optind.to_string());
            this.env.remove("OPTARG");
            this.env.remove("__getopts_sub");
            if !is_valid_shell_ident(&var_name) {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("getopts: `{var_name}': not a valid identifier\n"),
                    exit_code: 1,
                };
            }
            if var_is_readonly {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{resolved_var}: readonly variable\n"),
                    exit_code: 1,
                };
            }
            this.env.insert(resolved_var.clone(), "?".to_string());
            BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 1,
            }
        };

        let idx = optind - 1;
        if idx >= opt_args.len() {
            return finish_end(self, opt_args.len() + 1);
        }
        let cur = &opt_args[idx];
        if !cur.starts_with('-') || cur == "-" {
            return finish_end(self, optind);
        }
        if cur == "--" {
            return finish_end(self, optind + 1);
        }

        let cur_chars: Vec<char> = cur.chars().collect();
        if sub_idx >= cur_chars.len() {
            sub_idx = 1;
        }
        let flag_ch = cur_chars[sub_idx];

        let opt_match = if flag_ch == ':' || flag_ch == '?' {
            None
        } else {
            clean_opts.find(flag_ch)
        };

        let Some(pos) = opt_match else {
            let mut stderr = if report_errors {
                format!("{prog_name}: illegal option -- {flag_ch}\n")
            } else {
                String::new()
            };
            if sub_idx + 1 < cur_chars.len() {
                self.env.insert("OPTIND".to_string(), optind.to_string());
                self.env.insert("__getopts_ind".to_string(), optind.to_string());
                self.env.insert("__getopts_sub".to_string(), (sub_idx + 1).to_string());
            } else {
                self.env.insert("OPTIND".to_string(), (optind + 1).to_string());
                self.env.remove("__getopts_sub");
            }
            if silent {
                self.env.insert("OPTARG".to_string(), flag_ch.to_string());
            } else {
                self.env.remove("OPTARG");
            }
            if !is_valid_shell_ident(&var_name) {
                stderr.push_str(&format!("getopts: `{var_name}': not a valid identifier\n"));
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 1,
                };
            }
            if var_is_readonly {
                stderr.push_str(&format!("{resolved_var}: readonly variable\n"));
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 1,
                };
            }
            self.env.insert(resolved_var, "?".to_string());
            return BuiltinOutcome {
                stdout: String::new(),
                stderr,
                exit_code: 0,
            };
        };

        let takes_arg = clean_opts[pos + flag_ch.len_utf8()..].starts_with(':');
        if takes_arg {
            let rest: String = cur_chars[sub_idx + 1..].iter().collect();
            self.env.remove("__getopts_sub");
            if !rest.is_empty() {
                self.env.insert("OPTARG".to_string(), rest);
                self.env.insert("OPTIND".to_string(), (optind + 1).to_string());
                if !is_valid_shell_ident(&var_name) {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("getopts: `{var_name}': not a valid identifier\n"),
                        exit_code: 1,
                    };
                }
                if var_is_readonly {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{resolved_var}: readonly variable\n"),
                        exit_code: 1,
                    };
                }
                self.env.insert(resolved_var, flag_ch.to_string());
            } else if idx + 1 < opt_args.len() {
                self.env.insert("OPTARG".to_string(), opt_args[idx + 1].clone());
                self.env.insert("OPTIND".to_string(), (optind + 2).to_string());
                if !is_valid_shell_ident(&var_name) {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("getopts: `{var_name}': not a valid identifier\n"),
                        exit_code: 1,
                    };
                }
                if var_is_readonly {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{resolved_var}: readonly variable\n"),
                        exit_code: 1,
                    };
                }
                self.env.insert(resolved_var, flag_ch.to_string());
            } else {
                let mut stderr = if report_errors {
                    format!("{prog_name}: option requires an argument -- {flag_ch}\n")
                } else {
                    String::new()
                };
                self.env.insert("OPTIND".to_string(), (optind + 1).to_string());
                if silent {
                    self.env.insert("OPTARG".to_string(), flag_ch.to_string());
                } else {
                    self.env.remove("OPTARG");
                }
                if !is_valid_shell_ident(&var_name) {
                    stderr.push_str(&format!("getopts: `{var_name}': not a valid identifier\n"));
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr,
                        exit_code: 1,
                    };
                }
                if var_is_readonly {
                    stderr.push_str(&format!("{resolved_var}: readonly variable\n"));
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr,
                        exit_code: 1,
                    };
                }
                self.env.insert(
                    resolved_var,
                    if silent { ":" } else { "?" }.to_string(),
                );
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 0,
                };
            }
        } else {
            self.env.remove("OPTARG");
            if sub_idx + 1 < cur_chars.len() {
                self.env.insert("OPTIND".to_string(), optind.to_string());
                self.env.insert("__getopts_ind".to_string(), optind.to_string());
                self.env.insert("__getopts_sub".to_string(), (sub_idx + 1).to_string());
            } else {
                self.env.insert("OPTIND".to_string(), (optind + 1).to_string());
                self.env.remove("__getopts_sub");
            }
            if !is_valid_shell_ident(&var_name) {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("getopts: `{var_name}': not a valid identifier\n"),
                    exit_code: 1,
                };
            }
            if var_is_readonly {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{resolved_var}: readonly variable\n"),
                    exit_code: 1,
                };
            }
            self.env.insert(resolved_var, flag_ch.to_string());
        }

        BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        }
    }

    fn apply_umask_to_new_file(&self, full_path: &str) {
        if let Some(mask_s) = self.env.get("__umask")
            && let Ok(mask) = u32::from_str_radix(mask_s, 8)
        {
            let mode = 0o666 & !mask;
            let _ = self.fs.chmod(full_path, mode);
        }
    }

    #[allow(clippy::type_complexity)]
    fn setup_redirects(
        &mut self,
        redirects: &[Redirect],
        default_stdin: &str,
    ) -> Result<
        (
            BTreeMap<u32, FdTarget>,
            Vec<(u32, Option<String>)>,
            String,
            bool,
            Option<u32>,
            Option<BuiltinOutcome>,
        ),
        EvalError,
    > {
        if redirects.len() > self.budget.limits.max_redirects {
            return Err(EvalError::Budget(format!(
                "Execution aborted: Shell limit exceeded: maxRedirects ({})",
                self.budget.limits.max_redirects
            )));
        }
        let saved_fds = self.fd_table.clone();
        let mut saved_in: Vec<(u32, Option<String>)> = Vec::new();
        let mut local_stdin = default_stdin.to_string();
        let mut use_local = false;
        let mut dup_fd: Option<u32> = None;

        for r in redirects {
            let expand_redir_target = |this: &mut Self, raw: &str| -> Result<Result<String, BuiltinOutcome>, EvalError> {
                let fields = this.expand_word_to_fields(raw)?;
                if fields.len() != 1 {
                    let mut err_out = BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{raw}: ambiguous redirect\n"),
                        exit_code: 1,
                    };
                    this.route_outcome(&mut err_out);
                    return Ok(Err(err_out));
                }
                Ok(Ok(fields.into_iter().next().unwrap()))
            };
            match &r.kind {
                RedirectKind::In(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    let content = match self.fs.read_file(&full) {
                        Ok(bytes) => {
                            if bytes.len() > self.budget.limits.max_input_bytes {
                                return Ok((
                                    saved_fds,
                                    saved_in,
                                    local_stdin,
                                    true,
                                    None,
                                    Some(BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format!("{target}: EFBIG: File too large\n"),
                                        exit_code: 1,
                                    }),
                                ));
                            }
                            bytes_to_stream_string(&bytes)
                        }
                        Err(e) => {
                            return Ok((
                                saved_fds,
                                saved_in,
                                local_stdin,
                                true,
                                None,
                                Some(BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!("{target}: {e}\n"),
                                    exit_code: 1,
                                }),
                            ));
                        }
                    };
                    if *fd == 0 {
                        local_stdin = content;
                        use_local = true;
                        dup_fd = None;
                    } else {
                        if !saved_in.iter().any(|(f, _)| f == fd) {
                            saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                        }
                        self.in_fds.insert(*fd, content);
                    }
                }
                RedirectKind::ReadWrite(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if full != "/dev/null" && !self.fs.exists(&full) {
                        if let Err(e) = self.fs.write_file(&full, b"") {
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{target}: {e}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out)));
                        }
                        self.apply_umask_to_new_file(&full);
                    }
                    let content = match self.fs.read_file(&full) {
                        Ok(bytes) => {
                            if bytes.len() > self.budget.limits.max_input_bytes {
                                return Ok((
                                    saved_fds,
                                    saved_in,
                                    local_stdin,
                                    true,
                                    None,
                                    Some(BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format!("{target}: EFBIG: File too large\n"),
                                        exit_code: 1,
                                    }),
                                ));
                            }
                            bytes_to_stream_string(&bytes)
                        }
                        Err(e) => {
                            return Ok((
                                saved_fds,
                                saved_in,
                                local_stdin,
                                true,
                                None,
                                Some(BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!("{target}: {e}\n"),
                                    exit_code: 1,
                                }),
                            ));
                        }
                    };
                    if *fd == 0 {
                        local_stdin = content;
                        use_local = true;
                        dup_fd = None;
                    } else {
                        if !saved_in.iter().any(|(f, _)| f == fd) {
                            saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                        }
                        self.in_fds.insert(*fd, content);
                    }
                    self.fd_table.insert(*fd, FdTarget::File { path: full });
                }
                RedirectKind::HereString(fd) => {
                    let val = self.expand_word_to_string(&r.target)?;
                    let content = format!("{val}\n");
                    if *fd == 0 {
                        local_stdin = content;
                        use_local = true;
                        dup_fd = None;
                    } else {
                        if !saved_in.iter().any(|(f, _)| f == fd) {
                            saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                        }
                        self.in_fds.insert(*fd, content);
                    }
                }
                RedirectKind::HereDoc { fd, quoted } => {
                    let content = if *quoted {
                        r.target.clone()
                    } else {
                        self.expand_heredoc_text(&r.target)?
                    };
                    if *fd == 0 {
                        local_stdin = content;
                        use_local = true;
                        dup_fd = None;
                    } else {
                        if !saved_in.iter().any(|(f, _)| f == fd) {
                            saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                        }
                        self.in_fds.insert(*fd, content);
                    }
                }
                RedirectKind::DupIn(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    if target == "-" {
                        self.fd_table.insert(*fd, FdTarget::Closed);
                        if *fd == 0 {
                            local_stdin.clear();
                            use_local = true;
                        } else {
                            if !saved_in.iter().any(|(f, _)| f == fd) {
                                saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                            }
                            self.in_fds.remove(fd);
                        }
                    } else if let Ok(src_fd) = target.parse::<u32>() {
                        let content = self.in_fds.get(&src_fd).cloned().unwrap_or_default();
                        if *fd == 0 {
                            local_stdin = content;
                            use_local = true;
                            dup_fd = Some(src_fd);
                        } else {
                            if !saved_in.iter().any(|(f, _)| f == fd) {
                                saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                            }
                            self.in_fds.insert(*fd, content);
                        }
                    }
                }
                RedirectKind::Out(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if self.noclobber
                        && full != "/dev/null"
                        && self.fs.exists(&full)
                        && !self.fs.is_dir(&full)
                    {
                        let mut err_out = BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{target}: cannot overwrite existing file\n"),
                            exit_code: 1,
                        };
                        self.route_outcome(&mut err_out);
                        return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out)));
                    }
                    if full != "/dev/null" {
                        let existed = self.fs.exists(&full);
                        if let Err(e) = self.fs.write_file(&full, b"") {
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{target}: {e}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out)));
                        }
                        if !existed {
                            self.apply_umask_to_new_file(&full);
                        }
                    }
                    self.fd_table.insert(*fd, FdTarget::File { path: full });
                }
                RedirectKind::Clobber(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if full != "/dev/null" {
                        let existed = self.fs.exists(&full);
                        if let Err(e) = self.fs.write_file(&full, b"") {
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{target}: {e}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out)));
                        }
                        if !existed {
                            self.apply_umask_to_new_file(&full);
                        }
                    }
                    self.fd_table.insert(*fd, FdTarget::File { path: full });
                }
                RedirectKind::Append(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if full != "/dev/null" && !self.fs.exists(&full) {
                        if let Err(e) = self.fs.write_file(&full, b"") {
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{target}: {e}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out)));
                        }
                        self.apply_umask_to_new_file(&full);
                    }
                    self.fd_table.insert(*fd, FdTarget::File { path: full });
                }
                RedirectKind::DupOut(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    if target == "-" {
                        self.fd_table.insert(*fd, FdTarget::Closed);
                    } else if let Ok(src_fd) = target.parse::<u32>() {
                        let inherited = self
                            .fd_table
                            .get(&src_fd)
                            .cloned()
                            .unwrap_or(FdTarget::Closed);
                        self.fd_table.insert(*fd, inherited);
                    }
                }
                RedirectKind::BothOut => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if full != "/dev/null" {
                        let existed = self.fs.exists(&full);
                        let _ = self.fs.write_file(&full, b"");
                        if !existed {
                            self.apply_umask_to_new_file(&full);
                        }
                    }
                    self.fd_table
                        .insert(1, FdTarget::File { path: full.clone() });
                    self.fd_table.insert(2, FdTarget::File { path: full });
                }
                RedirectKind::BothAppend => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => return Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, Some(err_out))),
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if full != "/dev/null" && !self.fs.exists(&full) {
                        let _ = self.fs.write_file(&full, b"");
                        self.apply_umask_to_new_file(&full);
                    }
                    self.fd_table
                        .insert(1, FdTarget::File { path: full.clone() });
                    self.fd_table.insert(2, FdTarget::File { path: full });
                }
            }
        }

        Ok((saved_fds, saved_in, local_stdin, use_local, dup_fd, None))
    }

    fn restore_redirects(
        &mut self,
        saved_fds: BTreeMap<u32, FdTarget>,
        saved_in: Vec<(u32, Option<String>)>,
    ) {
        self.fd_table = saved_fds;
        for (fd, prev) in saved_in {
            if let Some(val) = prev {
                self.in_fds.insert(fd, val);
            } else {
                self.in_fds.remove(&fd);
            }
        }
    }

    fn route_outcome(&mut self, out: &mut BuiltinOutcome) {
        let raw_out = std::mem::take(&mut out.stdout);
        let raw_err = std::mem::take(&mut out.stderr);
        let fd1 = self.fd_table.get(&1).cloned().unwrap_or(FdTarget::Stdout);
        let fd2 = self.fd_table.get(&2).cloned().unwrap_or(FdTarget::Stderr);

        self.write_to_fd_target(&fd1, &raw_out, out);
        self.write_to_fd_target(&fd2, &raw_err, out);
    }

    fn write_to_fd_target(&mut self, target: &FdTarget, data: &str, out: &mut BuiltinOutcome) {
        if data.is_empty() {
            return;
        }
        match target {
            FdTarget::Stdout => out.stdout.push_str(data),
            FdTarget::Stderr => out.stderr.push_str(data),
            FdTarget::File { path } => {
                if path != "/dev/null" {
                    if let Err(e) = self.fs.append_file(path, &stream_string_to_bytes(data)) {
                        out.stderr.push_str(&format!("{path}: {e}\n"));
                        out.exit_code = 1;
                    }
                }
            }
            FdTarget::Closed => {}
        }
    }

    fn expand_heredoc_text(&mut self, text: &str) -> Result<String, EvalError> {
        let mut out = String::new();
        let chars: Vec<char> = text.chars().collect();
        let mut idx = 0usize;
        while idx < chars.len() {
            if chars[idx] == '\\' && idx + 1 < chars.len() {
                if chars[idx + 1] == '\n' {
                    idx += 2;
                    continue;
                }
                if matches!(chars[idx + 1], '$' | '`' | '\\') {
                    out.push(chars[idx + 1]);
                    idx += 2;
                    continue;
                }
            }
            if chars[idx] == '$' {
                let expanded = self.expand_dollar(&chars, &mut idx)?;
                out.push_str(&expanded);
                continue;
            }
            if chars[idx] == '`' {
                let expanded = self.expand_backticks(&chars, &mut idx)?;
                out.push_str(&expanded);
                continue;
            }
            out.push(chars[idx]);
            idx += 1;
        }
        Ok(out)
    }

    pub fn expand_assignment_rhs(&mut self, word: &str) -> Result<String, EvalError> {
        let tilded = self.expand_tilde_in_word(word, true);
        let fields = self.expand_word_internal(&tilded, false, false)?;
        Ok(fields.join(" "))
    }

    pub fn expand_word_to_string(&mut self, word: &str) -> Result<String, EvalError> {
        let tilded = self.expand_tilde_in_word(word, false);
        let fields = self.expand_word_internal(&tilded, false, false)?;
        Ok(fields.join(" "))
    }

    pub fn expand_word_for_pattern(&mut self, word: &str) -> Result<String, EvalError> {
        let tilded = self.expand_tilde_in_word(word, false);
        let fields = self.expand_word_internal(&tilded, false, true)?;
        Ok(fields.join(" "))
    }

    fn eval_double_bracket_words(&mut self, words: &[String]) -> Result<(i32, String), EvalError> {
        if words.last().map(|s| s.as_str()) != Some("]]") {
            return Ok((2, "test: missing closing bracket\n".to_string()));
        }
        let args = &words[1..words.len() - 1];
        if args.is_empty() {
            return Ok((2, "[[: syntax error\n".to_string()));
        }
        let mut pos = 0usize;
        let mut stderr = String::new();
        let status = self.eval_db_or(args, &mut pos, true, &mut stderr)?;
        Ok((status, stderr))
    }

    fn eval_db_or(
        &mut self,
        args: &[String],
        pos: &mut usize,
        active: bool,
        stderr: &mut String,
    ) -> Result<i32, EvalError> {
        let mut res = self.eval_db_and(args, pos, active, stderr)?;
        while args.get(*pos).map(|s| s.as_str()) == Some("||") {
            *pos += 1;
            let rhs_active = active && res != 0;
            let rhs = self.eval_db_and(args, pos, rhs_active, stderr)?;
            if rhs_active {
                res = rhs;
            }
        }
        Ok(res)
    }

    fn eval_db_and(
        &mut self,
        args: &[String],
        pos: &mut usize,
        active: bool,
        stderr: &mut String,
    ) -> Result<i32, EvalError> {
        let mut res = self.eval_db_not(args, pos, active, stderr)?;
        while args.get(*pos).map(|s| s.as_str()) == Some("&&") {
            *pos += 1;
            let rhs_active = active && res == 0;
            let rhs = self.eval_db_not(args, pos, rhs_active, stderr)?;
            if rhs_active {
                res = rhs;
            }
        }
        Ok(res)
    }

    fn eval_db_not(
        &mut self,
        args: &[String],
        pos: &mut usize,
        active: bool,
        stderr: &mut String,
    ) -> Result<i32, EvalError> {
        if args.get(*pos).map(|s| s.as_str()) == Some("!") {
            *pos += 1;
            let inner = self.eval_db_not(args, pos, active, stderr)?;
            return Ok(if !active {
                inner
            } else if inner == 0 {
                1
            } else {
                0
            });
        }
        if args.get(*pos).map(|s| s.as_str()) == Some("(") {
            *pos += 1;
            let val = self.eval_db_or(args, pos, active, stderr)?;
            if args.get(*pos).map(|s| s.as_str()) == Some(")") {
                *pos += 1;
            }
            return Ok(val);
        }
        self.eval_db_primary(args, pos, active, stderr)
    }

    fn eval_db_primary(
        &mut self,
        args: &[String],
        pos: &mut usize,
        active: bool,
        stderr: &mut String,
    ) -> Result<i32, EvalError> {
        if *pos >= args.len() {
            return Ok(1);
        }
        if *pos + 2 < args.len()
            && let Some(op) = args.get(*pos + 1).map(|s| s.as_str())
            && matches!(
                op,
                "="
                    | "=="
                    | "!="
                    | "=~"
                    | "<"
                    | ">"
                    | "-eq"
                    | "-ne"
                    | "-lt"
                    | "-le"
                    | "-gt"
                    | "-ge"
                    | "-nt"
                    | "-ot"
                    | "-ef"
            )
        {
            let raw_left = &args[*pos];
            let raw_right = &args[*pos + 2];
            *pos += 3;
            if !active {
                return Ok(1);
            }
            let left = self.expand_word_to_string(raw_left)?;
            if op == "=~" {
                let fragments = self.expand_word_for_ere(raw_right)?;
                return Ok(eval_ere_match(&left, &fragments, self.env, stderr));
            }
            let nocase = self
                .env
                .get("__shopt_nocasematch")
                .is_some_and(|v| v == "1");
            if matches!(op, "=" | "==" | "!=") {
                let right = self.expand_word_for_pattern(raw_right)?;
                let matched = glob_match_ext(&right, &left, nocase);
                let ok = if op == "!=" { !matched } else { matched };
                return Ok(if ok { 0 } else { 1 });
            }
            let right = self.expand_word_to_string(raw_right)?;
            let ok = match op {
                "<" => left < right,
                ">" => left > right,
                "-eq" => {
                    let l = eval_arith(&left, self.env).map_err(EvalError::Syntax)?;
                    let r = eval_arith(&right, self.env).map_err(EvalError::Syntax)?;
                    l == r
                }
                "-ne" => {
                    let l = eval_arith(&left, self.env).map_err(EvalError::Syntax)?;
                    let r = eval_arith(&right, self.env).map_err(EvalError::Syntax)?;
                    l != r
                }
                "-lt" => {
                    let l = eval_arith(&left, self.env).map_err(EvalError::Syntax)?;
                    let r = eval_arith(&right, self.env).map_err(EvalError::Syntax)?;
                    l < r
                }
                "-le" => {
                    let l = eval_arith(&left, self.env).map_err(EvalError::Syntax)?;
                    let r = eval_arith(&right, self.env).map_err(EvalError::Syntax)?;
                    l <= r
                }
                "-gt" => {
                    let l = eval_arith(&left, self.env).map_err(EvalError::Syntax)?;
                    let r = eval_arith(&right, self.env).map_err(EvalError::Syntax)?;
                    l > r
                }
                "-ge" => {
                    let l = eval_arith(&left, self.env).map_err(EvalError::Syntax)?;
                    let r = eval_arith(&right, self.env).map_err(EvalError::Syntax)?;
                    l >= r
                }
                "-nt" => {
                    let lp = resolve_posix_path(self.cwd, &left);
                    let rp = resolve_posix_path(self.cwd, &right);
                    match (self.fs.stat(&lp), self.fs.stat(&rp)) {
                        (Ok(ls), Ok(rs)) => ls.mtime_ms > rs.mtime_ms,
                        (Ok(_), Err(_)) => true,
                        _ => false,
                    }
                }
                "-ot" => {
                    let lp = resolve_posix_path(self.cwd, &left);
                    let rp = resolve_posix_path(self.cwd, &right);
                    match (self.fs.stat(&lp), self.fs.stat(&rp)) {
                        (Ok(ls), Ok(rs)) => ls.mtime_ms < rs.mtime_ms,
                        (Err(_), Ok(_)) => true,
                        _ => false,
                    }
                }
                "-ef" => {
                    let lp = resolve_posix_path(self.cwd, &left);
                    let rp = resolve_posix_path(self.cwd, &right);
                    self.fs.stat(&lp).is_ok()
                        && self.fs.stat(&rp).is_ok()
                        && resolve_physical_path(self.cwd, &left, self.fs)
                            == resolve_physical_path(self.cwd, &right, self.fs)
                }
                _ => false,
            };
            return Ok(if ok { 0 } else { 1 });
        }
        if *pos + 1 < args.len()
            && !args[*pos].contains(['\'', '"', '\\', '$', '`'])
            && is_test_unary_op(args[*pos].as_str())
            && !matches!(args[*pos + 1].as_str(), ")" | "&&" | "||")
        {
            let op = args[*pos].as_str();
            let raw_val = &args[*pos + 1];
            *pos += 2;
            if !active {
                return Ok(1);
            }
            let val = self.expand_word_to_string(raw_val)?;
            let ok = eval_test_unary_predicate(op, &val, self.cwd, self.env, self.fs);
            return Ok(if ok { 0 } else { 1 });
        }
        let raw_single = &args[*pos];
        *pos += 1;
        if !active {
            return Ok(1);
        }
        let single = self.expand_word_to_string(raw_single)?;
        Ok(if !single.is_empty() { 0 } else { 1 })
    }

    pub fn expand_word_for_ere(&mut self, word: &str) -> Result<Vec<(String, bool)>, EvalError> {
        let chars: Vec<char> = word.chars().collect();
        let mut idx = 0usize;
        let mut fragments: Vec<(String, bool)> = Vec::new();
        if chars.first() == Some(&'~') {
            if chars.get(1).copied() == Some('+')
                && matches!(chars.get(2).copied(), None | Some('/'))
            {
                fragments.push((self.cwd.clone(), true));
                idx = 2;
            } else if chars.get(1).copied() == Some('-')
                && matches!(chars.get(2).copied(), None | Some('/'))
            {
                if let Some(old) = self.env.get("OLDPWD").cloned() {
                    fragments.push((old, true));
                    idx = 2;
                }
            } else if matches!(chars.get(1).copied(), None | Some('/')) {
                if let Some(home) = self.env.get("HOME").cloned() {
                    fragments.push((home, true));
                    idx = 1;
                }
            }
        }
        while idx < chars.len() {
            let c = chars[idx];
            if c == '\'' {
                idx += 1;
                let mut lit = String::new();
                while idx < chars.len() && chars[idx] != '\'' {
                    lit.push(chars[idx]);
                    idx += 1;
                }
                if idx < chars.len() {
                    idx += 1;
                }
                fragments.push((lit, true));
                continue;
            }
            if c == '$' && idx + 1 < chars.len() && chars[idx + 1] == '\'' {
                idx += 2;
                let mut raw = String::new();
                while idx < chars.len() && chars[idx] != '\'' {
                    if chars[idx] == '\\' && idx + 1 < chars.len() {
                        raw.push(chars[idx]);
                        raw.push(chars[idx + 1]);
                        idx += 2;
                        continue;
                    }
                    raw.push(chars[idx]);
                    idx += 1;
                }
                if idx < chars.len() {
                    idx += 1;
                }
                fragments.push((decode_ansi_c_escapes(&raw), true));
                continue;
            }
            if c == '"' {
                idx += 1;
                let mut dq = String::new();
                while idx < chars.len() && chars[idx] != '"' {
                    if chars[idx] == '\\' && idx + 1 < chars.len() {
                        let nc = chars[idx + 1];
                        if matches!(nc, '"' | '\\' | '$' | '`') {
                            dq.push(nc);
                            idx += 2;
                            continue;
                        }
                    }
                    if chars[idx] == '$' {
                        let prev_dq = self.env.insert("__in_dquote".to_string(), "1".to_string());
                        let exp = self.expand_dollar(&chars, &mut idx)?;
                        match prev_dq {
                            Some(v) => {
                                self.env.insert("__in_dquote".to_string(), v);
                            }
                            None => {
                                self.env.remove("__in_dquote");
                            }
                        }
                        dq.push_str(&exp);
                        continue;
                    }
                    if chars[idx] == '`' {
                        let exp = self.expand_backticks(&chars, &mut idx)?;
                        dq.push_str(&exp);
                        continue;
                    }
                    dq.push(chars[idx]);
                    idx += 1;
                }
                if idx < chars.len() {
                    idx += 1;
                }
                fragments.push((dq, true));
                continue;
            }
            if c == '\\' {
                if idx + 1 < chars.len() {
                    fragments.push((chars[idx + 1].to_string(), true));
                    idx += 2;
                } else {
                    fragments.push(("\\".to_string(), true));
                    idx += 1;
                }
                continue;
            }
            if c == '$' {
                let exp = self.expand_dollar(&chars, &mut idx)?;
                fragments.push((exp, false));
                continue;
            }
            if c == '`' {
                let exp = self.expand_backticks(&chars, &mut idx)?;
                fragments.push((exp, false));
                continue;
            }
            let mut plain = String::new();
            while idx < chars.len() && !matches!(chars[idx], '\'' | '"' | '\\' | '$' | '`') {
                plain.push(chars[idx]);
                idx += 1;
            }
            fragments.push((plain, false));
        }
        let total_exp_bytes: usize = fragments.iter().map(|(s, _)| s.len()).sum();
        if total_exp_bytes > self.budget.limits.max_expansion_bytes {
            return Err(EvalError::Budget(format!(
                "Execution aborted: Shell limit exceeded: maxExpansionBytes ({})",
                self.budget.limits.max_expansion_bytes
            )));
        }
        Ok(fragments)
    }

    pub fn is_braceexpand_enabled(&self) -> bool {
        self.env
            .get("__set_braceexpand")
            .map(|v| v != "0")
            .unwrap_or(true)
    }

    pub fn expand_word_to_fields(&mut self, word: &str) -> Result<Vec<String>, EvalError> {
        let brace_expanded = if self.is_braceexpand_enabled() {
            expand_braces_with_limits(
                word,
                self.budget.limits.max_expansion_fields,
                self.budget.limits.max_expansion_bytes,
            )?
            .0
        } else {
            vec![word.to_string()]
        };
        let mut final_fields = Vec::new();
        for bw in brace_expanded {
            let tilded = self.expand_tilde_in_word(&bw, false);
            let fields = self.expand_word_internal(&tilded, true, false)?;
            final_fields.extend(fields);
            if final_fields.len() > self.budget.limits.max_expansion_fields {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                    self.budget.limits.max_expansion_fields
                )));
            }
        }
        Ok(final_fields)
    }

    fn expand_tilde_in_word(&self, word: &str, allow_after_colon: bool) -> String {
        if self.env.get("PWD").map(|s| s.as_str()) == Some(self.cwd.as_str()) {
            expand_tilde_prefix(word, self.env, allow_after_colon, false)
        } else {
            let mut env_copy = self.env.clone();
            env_copy.insert("PWD".to_string(), self.cwd.clone());
            expand_tilde_prefix(word, &env_copy, allow_after_colon, false)
        }
    }

    fn collect_word_segments(
        &mut self,
        word: &str,
        escape_quoted_glob: bool,
        segments: &mut Vec<WordSeg>,
    ) -> Result<(), EvalError> {
        let chars: Vec<char> = word.chars().collect();
        let mut idx = 0usize;

        while idx < chars.len() {
            let c = chars[idx];
            if c == '\'' {
                idx += 1;
                let mut lit = String::new();
                while idx < chars.len() && chars[idx] != '\'' {
                    if escape_quoted_glob
                        && matches!(
                            chars[idx],
                            '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '+' | '!' | '@' | ':'
                        )
                    {
                        lit.push('\\');
                    }
                    lit.push(chars[idx]);
                    idx += 1;
                }
                if idx < chars.len() {
                    idx += 1;
                }
                segments.push(WordSeg::Quoted(lit));
                continue;
            }
            if c == '$' && idx + 1 < chars.len() && chars[idx + 1] == '\'' {
                idx += 2;
                let mut raw = String::new();
                while idx < chars.len() && chars[idx] != '\'' {
                    if chars[idx] == '\\' && idx + 1 < chars.len() {
                        raw.push(chars[idx]);
                        raw.push(chars[idx + 1]);
                        idx += 2;
                        continue;
                    }
                    raw.push(chars[idx]);
                    idx += 1;
                }
                if idx < chars.len() {
                    idx += 1;
                }
                let decoded = decode_ansi_c_escapes(&raw);
                let seg = if escape_quoted_glob {
                    let mut esc = String::new();
                    for dc in decoded.chars() {
                        if matches!(
                            dc,
                            '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '+' | '!' | '@' | ':'
                        ) {
                            esc.push('\\');
                        }
                        esc.push(dc);
                    }
                    esc
                } else {
                    decoded
                };
                segments.push(WordSeg::Quoted(seg));
                continue;
            }
            if c == '"' {
                idx += 1;
                let mut dq = String::new();
                while idx < chars.len() && chars[idx] != '"' {
                    if chars[idx] == '\\' && idx + 1 < chars.len() {
                        let nc = chars[idx + 1];
                        if matches!(nc, '"' | '\\' | '$' | '`') {
                            if escape_quoted_glob
                                && matches!(
                                    nc,
                                    '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '+' | '!' | '@' | ':'
                                )
                            {
                                dq.push('\\');
                            }
                            dq.push(nc);
                            idx += 2;
                            continue;
                        }
                    }
                    if chars[idx] == '$' {
                        let prev_dq = self.env.insert("__in_dquote".to_string(), "1".to_string());
                        let exp = self.expand_dollar(&chars, &mut idx);
                        match prev_dq {
                            Some(v) => {
                                self.env.insert("__in_dquote".to_string(), v);
                            }
                            None => {
                                self.env.remove("__in_dquote");
                            }
                        }
                        let exp = exp?;
                        if escape_quoted_glob {
                            for ec in exp.chars() {
                                if matches!(
                                    ec,
                                    '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '+' | '!' | '@' | ':'
                                ) {
                                    dq.push('\\');
                                }
                                dq.push(ec);
                            }
                        } else {
                            dq.push_str(&exp);
                        }
                        continue;
                    }
                    if chars[idx] == '`' {
                        let exp = self.expand_backticks(&chars, &mut idx)?;
                        if escape_quoted_glob {
                            for ec in exp.chars() {
                                if matches!(
                                    ec,
                                    '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '+' | '!' | '@' | ':'
                                ) {
                                    dq.push('\\');
                                }
                                dq.push(ec);
                            }
                        } else {
                            dq.push_str(&exp);
                        }
                        continue;
                    }
                    if escape_quoted_glob
                        && matches!(
                            chars[idx],
                            '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '+' | '!' | '@' | ':'
                        )
                    {
                        dq.push('\\');
                    }
                    dq.push(chars[idx]);
                    idx += 1;
                }
                if idx < chars.len() {
                    idx += 1;
                }
                segments.push(WordSeg::Quoted(dq));
                continue;
            }
            if (c == '<' || c == '>') && idx + 1 < chars.len() && chars[idx + 1] == '(' {
                let is_out = c == '>';
                idx += 2;
                let mut depth = 1usize;
                let mut sub_cmd = String::new();
                while idx < chars.len() && depth > 0 {
                    let sc = chars[idx];
                    idx += 1;
                    if sc == '(' {
                        depth += 1;
                    } else if sc == ')' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    sub_cmd.push(sc);
                }
                self.procsub_seq += 1;
                let proc_path = format!("/tmp/.procsub_{}", self.procsub_seq);
                let _ = self.fs.mkdir_all("/tmp");
                if is_out {
                    let _ = self.fs.write_file(&proc_path, b"");
                    self.pending_out_procsubs.push((proc_path.clone(), sub_cmd));
                } else {
                    let out_str = self.run_command_substitution_raw(&sub_cmd)?;
                    let _ = self
                        .fs
                        .write_file(&proc_path, &stream_string_to_bytes(&out_str));
                }
                segments.push(WordSeg::Literal(proc_path));
                continue;
            }
            if c == '\\' {
                if idx + 1 < chars.len() {
                    let nc = chars[idx + 1];
                    if escape_quoted_glob
                        && matches!(
                            nc,
                            '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '+' | '!' | '@' | ':' | '.' | '$' | '{' | '}'
                        )
                    {
                        segments.push(WordSeg::Quoted(format!("\\{nc}")));
                    } else {
                        segments.push(WordSeg::Quoted(nc.to_string()));
                    }
                    idx += 2;
                } else {
                    segments.push(WordSeg::Quoted(String::new()));
                    idx += 1;
                }
                continue;
            }
            if c == '$' {
                if idx + 1 < chars.len() && chars[idx + 1] == '{' {
                    let mut probe_idx = idx + 1;
                    let expr = scan_nested_brace_sub(&chars, &mut probe_idx)?;
                    if let Some(alt_raw) = try_resolve_unquoted_alternate_operand(
                        &expr,
                        self.env,
                        self.last_exit,
                        &self.pos_args,
                    ) {
                        let alt_owned = alt_raw.to_string();
                        idx = probe_idx;
                        let tilded_alt = self.expand_tilde_in_word(&alt_owned, false);
                        self.collect_word_segments(&tilded_alt, escape_quoted_glob, segments)?;
                        continue;
                    }
                }
                let exp = self.expand_dollar(&chars, &mut idx)?;
                segments.push(WordSeg::Split(exp));
                continue;
            }
            if c == '`' {
                let exp = self.expand_backticks(&chars, &mut idx)?;
                segments.push(WordSeg::Split(exp));
                continue;
            }
            let mut plain = String::new();
            while idx < chars.len()
                && !matches!(chars[idx], '\'' | '"' | '\\' | '$' | '`')
                && !((chars[idx] == '<' || chars[idx] == '>')
                    && idx + 1 < chars.len()
                    && chars[idx + 1] == '(')
            {
                plain.push(chars[idx]);
                idx += 1;
            }
            segments.push(WordSeg::Literal(plain));
        }
        Ok(())
    }

    fn expand_word_internal(
        &mut self,
        word: &str,
        split_and_glob: bool,
        escape_quoted_glob: bool,
    ) -> Result<Vec<String>, EvalError> {
        if split_and_glob && (word == "\"$@\"" || word == "\"${@}\"") {
            return Ok(self.pos_args.clone());
        }
        if split_and_glob
            && let Some(dq_body) = word.strip_prefix('"').and_then(|s| s.strip_suffix('"'))
            && !dq_body.contains('"')
        {
            if let Some(start_brace) = dq_body.find("${")
                && let Some(rel_end) = dq_body[start_brace + 2..].find('}')
            {
                let end_brace = start_brace + 2 + rel_end;
                let prefix = &dq_body[..start_brace];
                let inner = &dq_body[start_brace + 2..end_brace];
                let suffix = &dq_body[end_brace + 1..];
                if !suffix.contains("${")
                    && let Some(mut items) =
                        expand_double_quoted_at_expr(inner, self.env, &self.pos_args)
                {
                    if prefix.is_empty() && suffix.is_empty() {
                        return Ok(items);
                    }
                    let pre_s = self.expand_word_to_string(&format!("\"{prefix}\""))?;
                    let suf_s = self.expand_word_to_string(&format!("\"{suffix}\""))?;
                    if items.is_empty() {
                        if pre_s.is_empty() && suf_s.is_empty() {
                            return Ok(Vec::new());
                        }
                        return Ok(vec![format!("{pre_s}{suf_s}")]);
                    }
                    items[0] = format!("{pre_s}{}", items[0]);
                    if let Some(last) = items.last_mut() {
                        last.push_str(&suf_s);
                    }
                    return Ok(items);
                }
            }
        }
        if split_and_glob && (word == "$@" || word == "${@}") {
            let ifs = self
                .env
                .get("IFS")
                .cloned()
                .unwrap_or_else(|| " \t\n".to_string());
            let mut out = Vec::new();
            for arg in &self.pos_args {
                out.extend(split_ifs_fields(arg, &ifs, None));
            }
            return Ok(out);
        }

        let mut segments: Vec<WordSeg> = Vec::new();
        self.collect_word_segments(word, escape_quoted_glob, &mut segments)?;

        let total_exp_bytes: usize = segments
            .iter()
            .map(|seg| match seg {
                WordSeg::Quoted(s) | WordSeg::Literal(s) | WordSeg::Split(s) => s.len(),
            })
            .sum();
        if total_exp_bytes > self.budget.limits.max_expansion_bytes {
            return Err(EvalError::Budget(format!(
                "Execution aborted: Shell limit exceeded: maxExpansionBytes ({})",
                self.budget.limits.max_expansion_bytes
            )));
        }

        if !split_and_glob {
            let mut s = String::new();
            for seg in segments {
                match seg {
                    WordSeg::Quoted(part) | WordSeg::Literal(part) | WordSeg::Split(part) => {
                        s.push_str(&part);
                    }
                }
            }
            return Ok(vec![s]);
        }

        let ifs = self
            .env
            .get("IFS")
            .cloned()
            .unwrap_or_else(|| " \t\n".to_string());
        let is_ifs = |c: char| ifs.contains(c);
        let is_ifs_ws = |c: char| is_ifs(c) && matches!(c, ' ' | '\t' | '\n');

        struct Field {
            fragments: String,
            pattern: String,
            present: bool,
        }
        let mut fields: Vec<Field> = vec![Field {
            fragments: String::new(),
            pattern: String::new(),
            present: false,
        }];
        let mut split_boundary = false;

        let escape_glob_chars = |s: &str| -> String {
            let mut out = String::with_capacity(s.len());
            for ch in s.chars() {
                if matches!(
                    ch,
                    '\\' | '*' | '?' | '[' | ']' | '(' | ')' | '|' | '@' | '+' | '!'
                ) {
                    out.push('\\');
                }
                out.push(ch);
            }
            out
        };

        let add_field = |fields: &mut Vec<Field>, split_boundary: &mut bool| {
            *split_boundary = false;
            fields.push(Field {
                fragments: String::new(),
                pattern: String::new(),
                present: false,
            });
        };

        let append_piece = |fields: &mut Vec<Field>,
                            split_boundary: &mut bool,
                            text: &str,
                            glob: bool,
                            present: bool| {
            if *split_boundary && present {
                add_field(fields, split_boundary);
            }
            let field = fields.last_mut().unwrap();
            if !text.is_empty() {
                field.fragments.push_str(text);
                if glob {
                    field.pattern.push_str(text);
                } else {
                    field.pattern.push_str(&escape_glob_chars(text));
                }
            }
            field.present |= present;
        };

        for seg in segments {
            match seg {
                WordSeg::Quoted(text) => {
                    append_piece(&mut fields, &mut split_boundary, &text, false, true);
                }
                WordSeg::Literal(text) => {
                    if !text.is_empty() {
                        append_piece(&mut fields, &mut split_boundary, &text, true, true);
                    }
                }
                WordSeg::Split(text) => {
                    if text.is_empty() {
                        continue;
                    }
                    if ifs.is_empty() {
                        append_piece(&mut fields, &mut split_boundary, &text, true, true);
                        continue;
                    }
                    let mut start = 0usize;
                    for (idx, ch) in text.char_indices() {
                        if is_ifs(ch) {
                            if start < idx {
                                if split_boundary {
                                    add_field(&mut fields, &mut split_boundary);
                                }
                                split_boundary = false;
                                append_piece(
                                    &mut fields,
                                    &mut split_boundary,
                                    &text[start..idx],
                                    true,
                                    true,
                                );
                            }
                            if !is_ifs_ws(ch) {
                                split_boundary = false;
                                fields.last_mut().unwrap().present = true;
                                add_field(&mut fields, &mut split_boundary);
                            } else if fields.last().unwrap().present {
                                split_boundary = true;
                            }
                            start = idx + ch.len_utf8();
                        }
                    }
                    if start < text.len() {
                        if split_boundary {
                            add_field(&mut fields, &mut split_boundary);
                        }
                        split_boundary = false;
                        append_piece(
                            &mut fields,
                            &mut split_boundary,
                            &text[start..],
                            true,
                            true,
                        );
                    }
                }
            }
        }
        fields.retain(|f| f.present);

        if self
            .env
            .get("__set_noglob")
            .map(|v| v == "1")
            .unwrap_or(false)
        {
            return Ok(fields.into_iter().map(|f| f.fragments).collect());
        }

        let mut globbed = Vec::new();
        let failglob = self
            .env
            .get("__shopt_failglob")
            .map(|v| v == "1")
            .unwrap_or(false);
        for field in fields {
            if !has_glob_meta(&field.pattern) {
                globbed.push(field.fragments);
                continue;
            }
            let expanded = expand_globs_in_word_with_projection(
                &field.pattern,
                &field.fragments,
                self.cwd,
                self.fs,
                self.env,
            );
            if failglob
                && (expanded.is_empty()
                    || (expanded.len() == 1
                        && expanded[0] == field.fragments
                        && !self
                            .fs
                            .exists(&resolve_posix_path(self.cwd, &field.fragments))))
            {
                return Err(EvalError::Syntax(format!(
                    "bash: no match: {}",
                    field.fragments
                )));
            }
            globbed.extend(expanded);
            if globbed.len() > self.budget.limits.max_expansion_fields {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                    self.budget.limits.max_expansion_fields
                )));
            }
        }
        Ok(globbed)
    }

    fn expand_dollar(&mut self, chars: &[char], idx: &mut usize) -> Result<String, EvalError> {
        *idx += 1; // skip '$'
        if *idx >= chars.len() {
            return Ok("$".to_string());
        }
        if chars[*idx] == '(' && *idx + 1 < chars.len() && chars[*idx + 1] == '(' {
            *idx += 2;
            let mut depth = 2i32;
            let mut expr = String::new();
            while *idx < chars.len() && depth > 0 {
                let c = chars[*idx];
                if c == '(' {
                    depth += 1;
                    expr.push(c);
                    *idx += 1;
                } else if c == ')' {
                    depth -= 1;
                    if depth == 0 {
                        *idx += 1;
                        break;
                    }
                    if depth == 1 && *idx + 1 < chars.len() && chars[*idx + 1] == ')' {
                        *idx += 2;
                        break;
                    }
                    expr.push(c);
                    *idx += 1;
                } else {
                    expr.push(c);
                    *idx += 1;
                }
            }
            let expanded_expr = self.expand_heredoc_text(&expr)?;
            let val = eval_arith(&expanded_expr, self.env).map_err(EvalError::Syntax)?;
            return Ok(val.to_string());
        }
        if chars[*idx] == '(' {
            let cmd_str = scan_nested_command_sub(chars, idx)?;
            return self.run_command_substitution(&cmd_str);
        }
        if chars[*idx] == '{' {
            let expr = scan_nested_brace_sub(chars, idx)?;
            return expand_parameter_expr(&expr, self.env, self.last_exit, &self.pos_args)
                .map_err(EvalError::Syntax);
        }
        let first = chars[*idx];
        if matches!(first, '?' | '#' | '@' | '*' | '$' | '!' | '-') || first.is_ascii_digit() {
            *idx += 1;
            let key = first.to_string();
            return expand_parameter_expr(&key, self.env, self.last_exit, &self.pos_args)
                .map_err(EvalError::Syntax);
        }
        if first.is_ascii_alphabetic() || first == '_' {
            let mut name = String::new();
            while *idx < chars.len()
                && (chars[*idx].is_ascii_alphanumeric() || chars[*idx] == '_')
            {
                name.push(chars[*idx]);
                *idx += 1;
            }
            return expand_parameter_expr(&name, self.env, self.last_exit, &self.pos_args)
                .map_err(EvalError::Syntax);
        }
        Ok("$".to_string())
    }

    fn expand_backticks(&mut self, chars: &[char], idx: &mut usize) -> Result<String, EvalError> {
        *idx += 1;
        let mut cmd_str = String::new();
        while *idx < chars.len() && chars[*idx] != '`' {
            if chars[*idx] == '\\' && *idx + 1 < chars.len() {
                let nc = chars[*idx + 1];
                if matches!(nc, '`' | '$' | '\\') {
                    cmd_str.push(nc);
                    *idx += 2;
                    continue;
                }
            }
            cmd_str.push(chars[*idx]);
            *idx += 1;
        }
        if *idx >= chars.len() {
            return Err(EvalError::Syntax(
                "Syntax error: Unterminated command substitution".to_string(),
            ));
        }
        *idx += 1;
        self.run_command_substitution(&cmd_str)
    }

    fn run_command_substitution_raw(&mut self, cmd_str: &str) -> Result<String, EvalError> {
        self.budget.enter_substitution().map_err(EvalError::Budget)?;
        if let Err(e) = self.budget.enter_recursion() {
            self.budget.leave_substitution();
            return Err(EvalError::Budget(e));
        }
        let mut sub_cwd = self.cwd.clone();
        let mut sub_env = self.env.clone();
        let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
        let inherit_errexit = self
            .env
            .get("__shopt_inherit_errexit")
            .map(|v| v == "1")
            .unwrap_or(false);
        sub.errexit = inherit_errexit && self.errexit && !self.in_condition;
        sub.fd_table.insert(1, FdTarget::Stdout);
        let mut sub_in = self.in_fds.remove(&0).unwrap_or_default();
        let res = sub.eval_script_units(cmd_str, &mut sub_in);
        if !sub_in.is_empty() {
            self.in_fds.insert(0, sub_in);
        }
        self.budget.leave_recursion();
        self.budget.leave_substitution();
        let mut out = match res {
            Ok(o) => o,
            Err(EvalError::Syntax(msg)) => BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{}\n", msg.strip_prefix("__param_err__").unwrap_or(&msg)),
                exit_code: 1,
            },
            Err(e) => return Err(e),
        };
        if let Some(code) = sub.exit_requested {
            out.exit_code = code;
        }
        sub.run_exit_trap_if_needed(&mut out);
        if !out.stderr.is_empty() {
            let fd2 = self.fd_table.get(&2).cloned().unwrap_or(FdTarget::Stderr);
            let mut dummy = BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            };
            self.write_to_fd_target(&fd2, &out.stderr, &mut dummy);
            self.pending_stdout.push_str(&dummy.stdout);
            self.pending_stderr.push_str(&dummy.stderr);
        }
        self.sub_exit = Some(out.exit_code);
        self.last_exit = out.exit_code;
        Ok(out.stdout)
    }

    fn run_command_substitution(&mut self, cmd_str: &str) -> Result<String, EvalError> {
        let raw = self.run_command_substitution_raw(cmd_str)?;
        Ok(raw.trim_end_matches('\n').to_string())
    }

    fn active_job_entries(&self) -> Vec<(u32, u32, String)> {
        let mut entries: Vec<(u32, u32, String)> = self
            .env
            .keys()
            .filter_map(|k| k.strip_prefix("__job_active__").and_then(|p| p.parse::<u32>().ok()))
            .map(|pid| {
                let job_id = self
                    .env
                    .get(&format!("__job_id__{pid}"))
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(1);
                let cmd = self
                    .env
                    .get(&format!("__job_cmd__{pid}"))
                    .cloned()
                    .unwrap_or_else(|| pid.to_string());
                (job_id, pid, cmd)
            })
            .collect();
        entries.sort_by_key(|(jid, pid, _)| (*jid, *pid));
        entries
    }

    fn resolve_job_operand(&self, operand: &str) -> Option<u32> {
        let entries = self.active_job_entries();
        if let Some(spec) = operand.strip_prefix('%') {
            if spec.is_empty() || spec == "%" || spec == "+" {
                return entries.last().map(|(_, pid, _)| *pid);
            }
            if spec == "-" {
                return if entries.len() >= 2 {
                    Some(entries[entries.len() - 2].1)
                } else {
                    None
                };
            }
            if let Ok(jid) = spec.parse::<u32>() {
                return entries
                    .iter()
                    .find(|(id, _, _)| *id == jid)
                    .map(|(_, pid, _)| *pid);
            }
            return None;
        }
        let pid = operand.trim().parse::<u32>().ok()?;
        if self.env.contains_key(&format!("__job_status__{pid}"))
            || self.env.contains_key(&format!("__job_active__{pid}"))
        {
            Some(pid)
        } else {
            None
        }
    }

    fn builtin_wait(&mut self, args: &[String]) -> BuiltinOutcome {
        let mut offset = 0usize;
        let mut next_mode = false;
        let mut dest_var: Option<String> = None;
        while offset < args.len() {
            let opt = &args[offset];
            if !opt.starts_with('-') || opt == "-" {
                break;
            }
            offset += 1;
            if opt == "--" {
                break;
            }
            let chars: Vec<char> = opt.chars().collect();
            let mut i = 1usize;
            while i < chars.len() {
                match chars[i] {
                    'f' => {}
                    'n' => next_mode = true,
                    'p' => {
                        let rest: String = chars[i + 1..].iter().collect();
                        let v = if !rest.is_empty() {
                            Some(rest)
                        } else if offset < args.len() {
                            let val = args[offset].clone();
                            offset += 1;
                            Some(val)
                        } else {
                            None
                        };
                        let Some(var_name) = v else {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "wait: -p: option requires an argument\nwait: usage: wait [-fn] [-p var] [id ...]\n".to_string(),
                                exit_code: 2,
                            };
                        };
                        dest_var = Some(var_name);
                        break;
                    }
                    ch => {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!(
                                "wait: -{ch}: invalid option\nwait: usage: wait [-fn] [-p var] [id ...]\n"
                            ),
                            exit_code: 2,
                        };
                    }
                }
                i += 1;
            }
        }

        if let Some(ref var_name) = dest_var {
            let base = var_name.split_once('[').map(|(b, _)| b).unwrap_or(var_name);
            if !is_valid_shell_ident(base) {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("wait: `{var_name}': not a valid identifier\n"),
                    exit_code: 1,
                };
            }
            if self
                .env
                .get(&format!("__attr__{base}"))
                .is_some_and(|a| a.contains('r'))
            {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("wait: {base}: readonly variable\n"),
                    exit_code: 1,
                };
            }
            self.env.remove(var_name);
        }

        let operands = &args[offset..];
        if operands.is_empty() {
            let active: Vec<String> = self
                .env
                .keys()
                .filter_map(|k| k.strip_prefix("__job_active__").map(|p| p.to_string()))
                .collect();
            if next_mode {
                if let Some(first_pid) = active.first() {
                    self.env.remove(&format!("__job_active__{first_pid}"));
                    if let Some(ref v) = dest_var {
                        let _ = self.assign_variable(v, first_pid, false);
                    }
                    let code = self
                        .env
                        .get(&format!("__job_status__{first_pid}"))
                        .and_then(|s| s.parse::<i32>().ok())
                        .unwrap_or(0);
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: code,
                    };
                }
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 127,
                };
            }
            for p in active {
                self.env.remove(&format!("__job_active__{p}"));
            }
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            };
        }

        let mut code = 0;
        let mut stderr = String::new();
        let mut last_waited_pid: Option<u32> = None;
        for op in operands {
            if op.starts_with('%') {
                let Some(pid) = self.resolve_job_operand(op) else {
                    stderr.push_str(&format!("wait: `{op}': no such job\n"));
                    code = 127;
                    continue;
                };
                self.env.remove(&format!("__job_active__{pid}"));
                code = self
                    .env
                    .get(&format!("__job_status__{pid}"))
                    .and_then(|s| s.parse::<i32>().ok())
                    .unwrap_or(0);
                last_waited_pid = Some(pid);
                continue;
            }
            let trimmed = op.trim();
            let parsed_pid = if !trimmed.is_empty() && trimmed.bytes().all(|b| b.is_ascii_digit()) {
                trimmed.parse::<u32>().ok().filter(|&p| p <= 2_147_483_647)
            } else {
                None
            };
            let Some(pid) = parsed_pid else {
                stderr.push_str(&format!("wait: `{op}': not a pid or valid job spec\n"));
                code = 1;
                if op.as_bytes().first().is_some_and(|b| b.is_ascii_digit()) {
                    last_waited_pid = None;
                    break;
                }
                continue;
            };
            if !self.env.contains_key(&format!("__job_status__{pid}"))
                && !self.env.contains_key(&format!("__job_active__{pid}"))
            {
                stderr.push_str(&format!("wait: pid {pid} is not a child of this shell\n"));
                code = 127;
                last_waited_pid = None;
                continue;
            }
            self.env.remove(&format!("__job_active__{pid}"));
            if let Some(st) = self.env.get(&format!("__job_status__{pid}")) {
                code = st.parse::<i32>().unwrap_or(0);
            } else {
                code = 127;
            }
            last_waited_pid = Some(pid);
        }
        if let (Some(var_name), Some(pid)) = (dest_var, last_waited_pid) {
            let _ = self.assign_variable(&var_name, &pid.to_string(), false);
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code: code,
        }
    }

    fn builtin_jobs(&self, args: &[String]) -> BuiltinOutcome {
        let mut mode = "";
        let mut offset = 0usize;
        while offset < args.len() {
            let opt = &args[offset];
            if opt == "--" {
                offset += 1;
                break;
            }
            if !opt.starts_with('-') {
                break;
            }
            if matches!(opt.as_str(), "-p" | "-l" | "-r" | "-s") {
                mode = opt.as_str();
                offset += 1;
            } else {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("jobs: {opt}: invalid option\n"),
                    exit_code: 2,
                };
            }
        }
        let entries = self.active_job_entries();
        let mut out = String::new();
        let mut stderr = String::new();
        let mut status = 0;
        let format_entry = |jid: u32, pid: u32, cmd: &str, marker: char| -> String {
            if mode == "-p" {
                format!("{pid}\n")
            } else if mode == "-l" {
                format!("[{jid}]{marker} {pid} {:<24}{cmd}\n", "Running")
            } else {
                format!("[{jid}]{marker}  {:<24}{cmd}\n", "Running")
            }
        };
        if offset == args.len() {
            if mode != "-s" {
                let len = entries.len();
                for (idx, (jid, pid, cmd)) in entries.iter().enumerate() {
                    let marker = if idx + 1 == len {
                        '+'
                    } else if idx + 2 == len {
                        '-'
                    } else {
                        ' '
                    };
                    out.push_str(&format_entry(*jid, *pid, cmd, marker));
                }
            }
            return BuiltinOutcome {
                stdout: out,
                stderr,
                exit_code: 0,
            };
        }
        let len = entries.len();
        for op in &args[offset..] {
            let spec = if op.starts_with('%') {
                op.clone()
            } else {
                format!("%{op}")
            };
            let resolved = self
                .resolve_job_operand(&spec)
                .or_else(|| self.resolve_job_operand(op));
            let Some(pid) = resolved else {
                stderr.push_str(&format!("jobs: {op}: no such job\n"));
                status = 1;
                continue;
            };
            if mode != "-s"
                && let Some((idx, (jid, _, cmd))) =
                    entries.iter().enumerate().find(|(_, (_, p, _))| *p == pid)
            {
                let marker = if idx + 1 == len {
                    '+'
                } else if idx + 2 == len {
                    '-'
                } else {
                    ' '
                };
                out.push_str(&format_entry(*jid, pid, cmd, marker));
            }
        }
        BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code: status,
        }
    }

    fn builtin_disown(&mut self, args: &[String]) -> BuiltinOutcome {
        let mut all = false;
        let mut running_only = false;
        let mut nohup_only = false;
        let mut offset = 0usize;
        while offset < args.len() {
            let arg = &args[offset];
            if arg == "--" {
                offset += 1;
                break;
            }
            if !arg.starts_with('-') || arg == "-" {
                break;
            }
            for ch in arg[1..].chars() {
                match ch {
                    'a' => all = true,
                    'r' => running_only = true,
                    'h' => nohup_only = true,
                    _ => {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("disown: -{ch}: invalid option\n"),
                            exit_code: 2,
                        };
                    }
                }
            }
            offset += 1;
        }
        let entries = self.active_job_entries();
        if offset == args.len() {
            if all || running_only {
                if !nohup_only {
                    for (_, pid, _) in entries {
                        self.env.remove(&format!("__job_active__{pid}"));
                        self.env.remove(&format!("__job_status__{pid}"));
                    }
                }
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            let Some((_, cur_pid, _)) = entries.last() else {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "disown: current: no such job\n".to_string(),
                    exit_code: 1,
                };
            };
            if !nohup_only {
                self.env.remove(&format!("__job_active__{cur_pid}"));
                self.env.remove(&format!("__job_status__{cur_pid}"));
            }
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            };
        }
        let mut stderr = String::new();
        let mut status = 0;
        for op in &args[offset..] {
            let resolved = self.resolve_job_operand(op).or_else(|| {
                if op.starts_with('%') {
                    None
                } else {
                    self.resolve_job_operand(&format!("%{op}"))
                }
            });
            let Some(pid) = resolved else {
                stderr.push_str(&format!("disown: {op}: no such job\n"));
                status = 1;
                continue;
            };
            if !nohup_only {
                self.env.remove(&format!("__job_active__{pid}"));
                self.env.remove(&format!("__job_status__{pid}"));
            }
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code: status,
        }
    }

    fn builtin_kill(&mut self, args: &[String]) -> BuiltinOutcome {
        let catalog = Self::trap_signal_catalog();
        let lookup_sig = |spec: &str| -> Option<u32> {
            if let Ok(num) = spec.parse::<u32>() {
                if num == 0 || (1..=31).contains(&num) {
                    return Some(num);
                }
                return None;
            }
            let up = spec.trim().to_uppercase();
            let stripped = up.strip_prefix("SIG").unwrap_or(&up);
            catalog
                .iter()
                .find(|(_, name)| name.strip_prefix("SIG").unwrap_or(name) == stripped)
                .map(|(n, _)| *n)
        };

        if matches!(args.first().map(|s| s.as_str()), Some("-l" | "-L")) {
            if args.len() == 1 {
                let names: Vec<&str> = catalog
                    .iter()
                    .map(|(_, n)| n.strip_prefix("SIG").unwrap_or(n))
                    .collect();
                return BuiltinOutcome {
                    stdout: format!("{}\n", names.join(" ")),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            let mut out = String::new();
            let mut stderr = String::new();
            let mut status = 0;
            for op in &args[1..] {
                if let Ok(mut num) = op.parse::<u32>() {
                    if num > 128 {
                        num -= 128;
                    }
                    if let Some((_, name)) = catalog.iter().find(|(n, _)| *n == num) {
                        out.push_str(&format!("{}\n", name.strip_prefix("SIG").unwrap_or(name)));
                    } else {
                        stderr.push_str(&format!("kill: {op}: invalid signal specification\n"));
                        status = 1;
                    }
                } else if let Some(num) = lookup_sig(op).filter(|&n| n > 0) {
                    out.push_str(&format!("{num}\n"));
                } else {
                    stderr.push_str(&format!("kill: {op}: invalid signal specification\n"));
                    status = 1;
                }
            }
            return BuiltinOutcome {
                stdout: out,
                stderr,
                exit_code: status,
            };
        }

        let mut offset = 0usize;
        let mut sig_opt: Option<u32> = Some(15);
        if matches!(args.first().map(|s| s.as_str()), Some("-s" | "-n")) {
            sig_opt = args.get(1).and_then(|s| lookup_sig(s));
            offset = 2;
        } else if let Some(first) = args.first()
            && first.starts_with('-')
            && first != "--"
        {
            sig_opt = lookup_sig(&first[1..]);
            offset = 1;
        }
        if args.get(offset).map(|s| s.as_str()) == Some("--") {
            offset += 1;
        }
        let Some(sig_num) = sig_opt.filter(|&n| n <= 31) else {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "kill: invalid signal specification\n".to_string(),
                exit_code: 1,
            };
        };
        if matches!(sig_num, 17 | 18 | 19 | 20 | 21 | 22 | 23 | 28) {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "kill: signal is not supported by virtual job termination\n".to_string(),
                exit_code: 1,
            };
        }
        if offset >= args.len() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "kill: usage: kill [-s signal | -n signal | -signal] pid | %job ...\n"
                    .to_string(),
                exit_code: 2,
            };
        }

        let mut stderr = String::new();
        let mut status = 0;
        for op in &args[offset..] {
            let Some(pid) = self.resolve_job_operand(op) else {
                let kind = if op.starts_with('%') { "job" } else { "process" };
                stderr.push_str(&format!("kill: {op}: no such {kind}\n"));
                status = 1;
                continue;
            };
            if sig_num != 0 {
                self.env
                    .insert(format!("__job_status__{pid}"), (128 + sig_num).to_string());
            }
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code: status,
        }
    }
}

fn scan_nested_command_sub(chars: &[char], idx: &mut usize) -> Result<String, EvalError> {
    *idx += 1; // skip '('
    let mut out = String::new();
    let mut depth = 1usize;
    let mut in_sq = false;
    let mut in_dq = false;
    while *idx < chars.len() && depth > 0 {
        let c = chars[*idx];
        if in_sq {
            out.push(c);
            *idx += 1;
            if c == '\'' {
                in_sq = false;
            }
        } else if in_dq {
            if c == '\\' && *idx + 1 < chars.len() {
                out.push(c);
                out.push(chars[*idx + 1]);
                *idx += 2;
            } else if c == '$' && *idx + 1 < chars.len() && chars[*idx + 1] == '(' {
                out.push('$');
                out.push('(');
                *idx += 1;
                let inner = scan_nested_command_sub(chars, idx)?;
                out.push_str(&inner);
                out.push(')');
            } else {
                out.push(c);
                *idx += 1;
                if c == '"' {
                    in_dq = false;
                }
            }
        } else if c == '\\' && *idx + 1 < chars.len() {
            out.push(c);
            out.push(chars[*idx + 1]);
            *idx += 2;
        } else if c == '\\' && *idx + 1 < chars.len() {
            out.push(c);
            out.push(chars[*idx + 1]);
            *idx += 2;
        } else if c == '\'' {
            out.push(c);
            *idx += 1;
            in_sq = true;
        } else if c == '"' {
            out.push(c);
            *idx += 1;
            in_dq = true;
        } else if c == '$' && *idx + 1 < chars.len() && chars[*idx + 1] == '(' {
            out.push('$');
            out.push('(');
            *idx += 1;
            let inner = scan_nested_command_sub(chars, idx)?;
            out.push_str(&inner);
            out.push(')');
        } else if c == '(' {
            depth += 1;
            out.push(c);
            *idx += 1;
        } else if c == ')' {
            depth -= 1;
            *idx += 1;
            if depth > 0 {
                out.push(c);
            }
        } else {
            out.push(c);
            *idx += 1;
        }
    }
    Ok(out)
}

fn scan_nested_brace_sub(chars: &[char], idx: &mut usize) -> Result<String, EvalError> {
    *idx += 1; // skip '{'
    let mut out = String::new();
    let mut depth = 1usize;
    let mut in_sq = false;
    let mut in_dq = false;
    while *idx < chars.len() && depth > 0 {
        let c = chars[*idx];
        if in_sq {
            out.push(c);
            *idx += 1;
            if c == '\'' {
                in_sq = false;
            }
        } else if in_dq {
            if c == '\\' && *idx + 1 < chars.len() {
                out.push(c);
                out.push(chars[*idx + 1]);
                *idx += 2;
            } else if c == '$' && *idx + 1 < chars.len() && chars[*idx + 1] == '{' {
                out.push('$');
                out.push('{');
                *idx += 1;
                let inner = scan_nested_brace_sub(chars, idx)?;
                out.push_str(&inner);
                out.push('}');
            } else {
                out.push(c);
                *idx += 1;
                if c == '"' {
                    in_dq = false;
                }
            }
        } else if c == '\\' && *idx + 1 < chars.len() {
            out.push(c);
            out.push(chars[*idx + 1]);
            *idx += 2;
        } else if c == '\'' {
            out.push(c);
            *idx += 1;
            in_sq = true;
        } else if c == '"' {
            out.push(c);
            *idx += 1;
            in_dq = true;
        } else if c == '{' {
            depth += 1;
            out.push(c);
            *idx += 1;
        } else if c == '}' {
            depth -= 1;
            *idx += 1;
            if depth > 0 {
                out.push(c);
            }
        } else {
            out.push(c);
            *idx += 1;
        }
    }
    Ok(out)
}

fn parse_assignment_lhs_rhs(word: &str) -> Option<(&str, &str, bool)> {
    let bytes = word.as_bytes();
    if bytes.is_empty() || !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_') {
        return None;
    }
    let mut i = 1usize;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i < bytes.len() && bytes[i] == b'[' {
        i += 1;
        let mut depth = 1usize;
        while i < bytes.len() && depth > 0 {
            if bytes[i] == b'[' {
                depth += 1;
            } else if bytes[i] == b']' {
                depth -= 1;
            }
            i += 1;
        }
    }
    if i >= bytes.len() {
        return None;
    }
    if word[i..].starts_with("+=") {
        Some((&word[..i], &word[i + 2..], true))
    } else if word[i..].starts_with('=') {
        Some((&word[..i], &word[i + 1..], false))
    } else {
        None
    }
}

fn split_ifs_fields(s: &str, ifs: &str, max_fields: Option<usize>) -> Vec<String> {
    if ifs.is_empty() {
        return if s.is_empty() {
            Vec::new()
        } else {
            vec![s.to_string()]
        };
    }
    let is_ifs_ws = |c: char| ifs.contains(c) && c.is_whitespace();
    let is_ifs_non_ws = |c: char| ifs.contains(c) && !c.is_whitespace();

    let trimmed = s.trim_start_matches(is_ifs_ws);
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut chars = trimmed.char_indices().peekable();
    let mut field_start = 0usize;

    while let Some((idx, ch)) = chars.next() {
        if let Some(max) = max_fields
            && out.len() + 1 >= max
        {
            let rest = trimmed[field_start..].trim_end_matches(is_ifs_ws);
            out.push(rest.to_string());
            return out;
        }

        if is_ifs_ws(ch) {
            out.push(trimmed[field_start..idx].to_string());
            while let Some(&(_, nc)) = chars.peek() {
                if is_ifs_ws(nc) {
                    chars.next();
                } else {
                    break;
                }
            }
            if let Some(&(_, nc)) = chars.peek()
                && is_ifs_non_ws(nc)
            {
                chars.next();
                while let Some(&(_, nc2)) = chars.peek() {
                    if is_ifs_ws(nc2) {
                        chars.next();
                    } else {
                        break;
                    }
                }
            }
            field_start = chars.peek().map(|&(i, _)| i).unwrap_or(trimmed.len());
        } else if is_ifs_non_ws(ch) {
            out.push(trimmed[field_start..idx].to_string());
            while let Some(&(_, nc)) = chars.peek() {
                if is_ifs_ws(nc) {
                    chars.next();
                } else {
                    break;
                }
            }
            field_start = chars.peek().map(|&(i, _)| i).unwrap_or(trimmed.len());
        }
    }

    if field_start < trimmed.len() {
        out.push(trimmed[field_start..].to_string());
    }
    out
}

#[derive(Debug, Clone)]
enum WordSeg {
    Quoted(String),
    Literal(String),
    Split(String),
}

fn is_select_byte_locale(env: &BTreeMap<String, String>) -> bool {
    let locale = env
        .get("LC_ALL")
        .filter(|s| !s.is_empty())
        .or_else(|| env.get("LC_CTYPE").filter(|s| !s.is_empty()))
        .or_else(|| env.get("LANG").filter(|s| !s.is_empty()))
        .map(|s| s.as_str())
        .unwrap_or("");
    matches!(locale, "C" | "POSIX")
}

fn select_char_width(ch: char) -> usize {
    let point = ch as u32;
    if matches!(
        point,
        0x0300..=0x036F
            | 0x0483..=0x0489
            | 0x0591..=0x05BD
            | 0x05BF
            | 0x05C1..=0x05C2
            | 0x05C4..=0x05C5
            | 0x05C7
            | 0x0600..=0x0605
            | 0x0610..=0x061A
            | 0x064B..=0x065F
            | 0x0670
            | 0x06D6..=0x06DD
            | 0x06DF..=0x06E4
            | 0x06E7..=0x06E8
            | 0x06EA..=0x06ED
            | 0x070F
            | 0x0711
            | 0x0730..=0x074A
            | 0x0E31
            | 0x0E34..=0x0E3A
            | 0x0E47..=0x0E4E
            | 0x1AB0..=0x1AFF
            | 0x1DC0..=0x1DFF
            | 0x200B..=0x200F
            | 0x202A..=0x202E
            | 0x2060..=0x206F
            | 0x20D0..=0x20FF
            | 0xFE00..=0xFE0F
            | 0xFE20..=0xFE2F
            | 0xFEFF
            | 0xFFF9..=0xFFFB
    ) {
        return 0;
    }
    if point >= 0x1100
        && (point <= 0x115f
            || point == 0x2329
            || point == 0x232a
            || (point >= 0x2e80 && point <= 0xa4cf && point != 0x303f)
            || (point >= 0xac00 && point <= 0xd7a3)
            || (point >= 0xf900 && point <= 0xfaff)
            || (point >= 0xfe10 && point <= 0xfe19)
            || (point >= 0xfe30 && point <= 0xfe6f)
            || (point >= 0xff00 && point <= 0xff60)
            || (point >= 0xffe0 && point <= 0xffe6)
            || (point >= 0x1f300 && point <= 0x1faff)
            || (point >= 0x20000 && point <= 0x3fffd))
    {
        2
    } else {
        1
    }
}

fn format_select_menu(values: &[String], env: &BTreeMap<String, String>) -> String {
    let byte_locale = is_select_byte_locale(env);
    let mut items: Vec<(Vec<u8>, usize)> = Vec::with_capacity(values.len());
    let mut maximum = 0usize;
    for val in values {
        let bytes = stream_string_to_bytes(val);
        let mut width = 0usize;
        if let Ok(text) = std::str::from_utf8(&bytes) {
            for ch in text.chars() {
                let point = ch as u32;
                if byte_locale && point >= 128 {
                    width = 0;
                    break;
                }
                if point < 32 || point == 127 {
                    width = bytes.len();
                    break;
                }
                width += select_char_width(ch);
            }
        }
        maximum = maximum.max(if byte_locale { bytes.len() } else { width });
        items.push((bytes, width));
    }

    let mut screen = 0usize;
    if let Some(cols_str) = env.get("COLUMNS") {
        let mut started = false;
        for ch in cols_str.chars() {
            if !started && matches!(ch, ' ' | '\t' | '\r' | '\n' | '\x0b' | '\x0c') {
                continue;
            }
            if !started && ch == '+' {
                started = true;
                continue;
            }
            if !ch.is_ascii_digit() {
                break;
            }
            started = true;
            let digit = (ch as u8 - b'0') as usize;
            screen = (screen.saturating_mul(10).saturating_add(digit)).min(0x7fffffff);
        }
    }
    if screen == 0 {
        screen = 80;
    }

    let digits = values.len().to_string().len();
    let cell = maximum + digits + 4;
    let cols_per_row = (screen / cell).max(1);
    let mut rows = values.len().div_ceil(cols_per_row);
    if rows == 1 {
        rows = values.len();
    }

    let mut out_bytes = Vec::new();
    let rows_digits = rows.to_string().len();
    for row in 0..rows {
        let mut position = 0usize;
        let mut index = row;
        while index < items.len() {
            let (ref item_bytes, item_width) = items[index];
            let index_width = if position > 0 { digits } else { rows_digits };
            let prefix = format!("{:>width$}) ", index + 1, width = index_width);
            out_bytes.extend_from_slice(prefix.as_bytes());
            out_bytes.extend_from_slice(item_bytes);
            if index + rows < items.len() {
                let mut from = position + index_width + 2 + item_width;
                let to = position + cell;
                while from < to {
                    let tab = (to / 8) > (from / 8);
                    if tab {
                        out_bytes.push(b'\t');
                        from += 8 - (from % 8);
                    } else {
                        out_bytes.push(b' ');
                        from += 1;
                    }
                }
                position += cell;
            }
            index += rows;
        }
        out_bytes.push(b'\n');
    }
    bytes_to_stream_string(&out_bytes)
}

fn select_read_line(
    stdin: &mut String,
    max_output_bytes: usize,
) -> Result<(Vec<u8>, bool), EvalError> {
    let raw = stream_string_to_bytes(stdin);
    let mut line = Vec::new();
    let mut escaped = false;
    let mut terminated = false;
    let mut idx = 0usize;
    while idx < raw.len() {
        let byte = raw[idx];
        idx += 1;
        if byte == 0 {
            continue;
        }
        if escaped {
            escaped = false;
            if byte != b'\n' {
                if line.len() >= max_output_bytes {
                    return Err(EvalError::Budget(format!(
                        "Execution aborted: Shell limit exceeded: maxOutputBytes ({max_output_bytes})"
                    )));
                }
                line.push(byte);
            }
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            continue;
        }
        if byte == b'\n' {
            terminated = true;
            break;
        }
        if line.len() >= max_output_bytes {
            return Err(EvalError::Budget(format!(
                "Execution aborted: Shell limit exceeded: maxOutputBytes ({max_output_bytes})"
            )));
        }
        line.push(byte);
    }
    *stdin = bytes_to_stream_string(&raw[idx..]);
    Ok((line, terminated))
}

fn parse_select_choice(bytes: &[u8]) -> Option<usize> {
    let is_ws = |b: u8| b == b' ' || (9..=13).contains(&b);
    let mut start = 0usize;
    let mut end = bytes.len();
    while start < end && is_ws(bytes[start]) {
        start += 1;
    }
    while end > start && is_ws(bytes[end - 1]) {
        end -= 1;
    }
    let mut sign = 1i64;
    if start < end && (bytes[start] == b'+' || bytes[start] == b'-') {
        if bytes[start] == b'-' {
            sign = -1;
        }
        start += 1;
    }
    if start == end {
        return None;
    }
    let mut value: usize = 0;
    for &b in &bytes[start..end] {
        if !b.is_ascii_digit() {
            return None;
        }
        value = value.saturating_mul(10).saturating_add((b - b'0') as usize);
    }
    if sign < 0 || value == 0 {
        None
    } else {
        Some(value)
    }
}

#[derive(Debug, Clone)]
enum BracePart {
    Text { raw: String, byte_len: usize },
    AnsiQuote { raw: String, decoded: String, byte_len: usize },
    Atom { raw: String, byte_len: usize },
}

#[derive(Debug, Clone)]
enum BraceNodeKind {
    Part(BracePart),
    Product(Vec<BraceNode>),
    Choice(Vec<BraceNode>),
    Range {
        start: i64,
        step: i64,
        width: usize,
        numeric: bool,
    },
}

#[derive(Debug, Clone)]
struct BraceNode {
    count: usize,
    bytes: usize,
    kind: BraceNodeKind,
}

fn brace_limit_err(limit: &str, max_val: usize) -> EvalError {
    EvalError::Budget(format!(
        "Execution aborted: Shell limit exceeded: {limit} ({max_val})"
    ))
}

fn brace_sum(left: usize, right: usize, max_val: usize, limit: &str) -> Result<usize, EvalError> {
    if right > max_val.saturating_sub(left) {
        return Err(brace_limit_err(limit, max_val));
    }
    Ok(left + right)
}

fn brace_mul(left: usize, right: usize, max_val: usize, limit: &str) -> Result<usize, EvalError> {
    if left != 0 && right > max_val / left {
        return Err(brace_limit_err(limit, max_val));
    }
    Ok(left * right)
}

fn parse_brace_int(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    let mut offset = if text.starts_with('-') || text.starts_with('+') {
        1
    } else {
        0
    };
    if offset == bytes.len() {
        return None;
    }
    while offset < bytes.len() && bytes[offset] == b'0' {
        offset += 1;
    }
    if bytes.len() - offset > 19 {
        return None;
    }
    for &b in &bytes[offset..] {
        if !b.is_ascii_digit() {
            return None;
        }
    }
    let digits = if offset == bytes.len() {
        "0"
    } else {
        &text[offset..]
    };
    let unsigned: i128 = digits.parse().ok()?;
    let signed = if text.starts_with('-') {
        -unsigned
    } else {
        unsigned
    };
    if signed < (i64::MIN as i128) || signed > (i64::MAX as i128) {
        None
    } else {
        Some(signed as i64)
    }
}

fn scan_brace_atom_sub(chars: &[char], idx: &mut usize, open: char, close: char) {
    let mut depth = 1usize;
    *idx += 1;
    while *idx < chars.len() && depth > 0 {
        let c = chars[*idx];
        if c == '\\' && *idx + 1 < chars.len() {
            *idx += 2;
            continue;
        }
        if c == '\'' {
            *idx += 1;
            while *idx < chars.len() && chars[*idx] != '\'' {
                *idx += 1;
            }
            if *idx < chars.len() {
                *idx += 1;
            }
            continue;
        }
        if c == '"' {
            *idx += 1;
            while *idx < chars.len() && chars[*idx] != '"' {
                if chars[*idx] == '\\' && *idx + 1 < chars.len() {
                    *idx += 2;
                    continue;
                }
                *idx += 1;
            }
            if *idx < chars.len() {
                *idx += 1;
            }
            continue;
        }
        if c == open {
            depth += 1;
        } else if c == close {
            depth -= 1;
        }
        *idx += 1;
    }
}

fn tokenize_brace_word(word: &str) -> Vec<BracePart> {
    let chars: Vec<char> = word.chars().collect();
    let mut parts = Vec::new();
    let mut idx = 0usize;
    while idx < chars.len() {
        let c = chars[idx];
        if c == '\'' {
            let start = idx;
            idx += 1;
            let mut inner = String::new();
            while idx < chars.len() && chars[idx] != '\'' {
                inner.push(chars[idx]);
                idx += 1;
            }
            if idx < chars.len() {
                idx += 1;
            }
            let raw: String = chars[start..idx].iter().collect();
            let byte_len = stream_string_to_bytes(&inner).len();
            parts.push(BracePart::Atom { raw, byte_len });
            continue;
        }
        if c == '$' && idx + 1 < chars.len() && chars[idx + 1] == '\'' {
            let start = idx;
            idx += 2;
            let mut inner = String::new();
            while idx < chars.len() && chars[idx] != '\'' {
                if chars[idx] == '\\' && idx + 1 < chars.len() {
                    inner.push(chars[idx]);
                    inner.push(chars[idx + 1]);
                    idx += 2;
                    continue;
                }
                inner.push(chars[idx]);
                idx += 1;
            }
            if idx < chars.len() {
                idx += 1;
            }
            let raw: String = chars[start..idx].iter().collect();
            let decoded = decode_ansi_c_escapes(&inner);
            let byte_len = stream_string_to_bytes(&decoded).len();
            parts.push(BracePart::AnsiQuote {
                raw,
                decoded,
                byte_len,
            });
            continue;
        }
        if c == '"' {
            let start = idx;
            idx += 1;
            let mut has_subst = false;
            let mut inner = String::new();
            while idx < chars.len() && chars[idx] != '"' {
                if chars[idx] == '\\' && idx + 1 < chars.len() {
                    inner.push(chars[idx + 1]);
                    idx += 2;
                    continue;
                }
                if chars[idx] == '$' && idx + 1 < chars.len() {
                    has_subst = true;
                    if chars[idx + 1] == '(' {
                        idx += 1;
                        scan_brace_atom_sub(&chars, &mut idx, '(', ')');
                        continue;
                    }
                    if chars[idx + 1] == '{' {
                        idx += 1;
                        scan_brace_atom_sub(&chars, &mut idx, '{', '}');
                        continue;
                    }
                }
                if chars[idx] == '`' {
                    has_subst = true;
                    idx += 1;
                    while idx < chars.len() && chars[idx] != '`' {
                        if chars[idx] == '\\' && idx + 1 < chars.len() {
                            idx += 2;
                            continue;
                        }
                        idx += 1;
                    }
                    if idx < chars.len() {
                        idx += 1;
                    }
                    continue;
                }
                inner.push(chars[idx]);
                idx += 1;
            }
            if idx < chars.len() {
                idx += 1;
            }
            let raw: String = chars[start..idx].iter().collect();
            let byte_len = if has_subst {
                0
            } else {
                stream_string_to_bytes(&inner).len()
            };
            parts.push(BracePart::Atom { raw, byte_len });
            continue;
        }
        if c == '\\' {
            if idx + 1 < chars.len() {
                let raw: String = chars[idx..idx + 2].iter().collect();
                let byte_len = stream_string_to_bytes(&chars[idx + 1].to_string()).len();
                parts.push(BracePart::Atom { raw, byte_len });
                idx += 2;
            } else {
                parts.push(BracePart::Atom {
                    raw: "\\".to_string(),
                    byte_len: 1,
                });
                idx += 1;
            }
            continue;
        }
        if c == '$' {
            let start = idx;
            idx += 1;
            if idx < chars.len() && chars[idx] == '(' {
                scan_brace_atom_sub(&chars, &mut idx, '(', ')');
                let raw: String = chars[start..idx].iter().collect();
                parts.push(BracePart::Atom { raw, byte_len: 0 });
                continue;
            }
            if idx < chars.len() && chars[idx] == '{' {
                scan_brace_atom_sub(&chars, &mut idx, '{', '}');
                let raw: String = chars[start..idx].iter().collect();
                parts.push(BracePart::Atom { raw, byte_len: 0 });
                continue;
            }
            if idx < chars.len()
                && (matches!(chars[idx], '?' | '#' | '@' | '*' | '$' | '!' | '-')
                    || chars[idx].is_ascii_digit())
            {
                idx += 1;
                let raw: String = chars[start..idx].iter().collect();
                parts.push(BracePart::Atom { raw, byte_len: 0 });
                continue;
            }
            if idx < chars.len() && (chars[idx].is_ascii_alphabetic() || chars[idx] == '_') {
                while idx < chars.len()
                    && (chars[idx].is_ascii_alphanumeric() || chars[idx] == '_')
                {
                    idx += 1;
                }
                let raw: String = chars[start..idx].iter().collect();
                parts.push(BracePart::Atom { raw, byte_len: 0 });
                continue;
            }
            parts.push(BracePart::Text {
                raw: "$".to_string(),
                byte_len: 1,
            });
            continue;
        }
        if c == '`' {
            let start = idx;
            idx += 1;
            while idx < chars.len() && chars[idx] != '`' {
                if chars[idx] == '\\' && idx + 1 < chars.len() {
                    idx += 2;
                    continue;
                }
                idx += 1;
            }
            if idx < chars.len() {
                idx += 1;
            }
            let raw: String = chars[start..idx].iter().collect();
            parts.push(BracePart::Atom { raw, byte_len: 0 });
            continue;
        }
        if (c == '<' || c == '>') && idx + 1 < chars.len() && chars[idx + 1] == '(' {
            let start = idx;
            idx += 1;
            scan_brace_atom_sub(&chars, &mut idx, '(', ')');
            let raw: String = chars[start..idx].iter().collect();
            parts.push(BracePart::Atom { raw, byte_len: 0 });
            continue;
        }
        let start = idx;
        while idx < chars.len()
            && !matches!(chars[idx], '\'' | '"' | '\\' | '$' | '`')
            && !((chars[idx] == '<' || chars[idx] == '>')
                && idx + 1 < chars.len()
                && chars[idx + 1] == '(')
        {
            idx += 1;
        }
        let raw: String = chars[start..idx].iter().collect();
        let byte_len = stream_string_to_bytes(&raw).len();
        parts.push(BracePart::Text { raw, byte_len });
    }
    parts
}

fn expand_braces_with_limits(
    word: &str,
    max_fields: usize,
    max_bytes: usize,
) -> Result<(Vec<String>, bool), EvalError> {
    let parts = tokenize_brace_word(word);
    let part_node = |part: BracePart| -> BraceNode {
        let bytes = match &part {
            BracePart::Text { byte_len, .. }
            | BracePart::AnsiQuote { byte_len, .. }
            | BracePart::Atom { byte_len, .. } => *byte_len,
        };
        BraceNode {
            count: 1,
            bytes,
            kind: BraceNodeKind::Part(part),
        }
    };
    let text_node = |s: &str| -> BraceNode {
        part_node(BracePart::Text {
            raw: s.to_string(),
            byte_len: stream_string_to_bytes(s).len(),
        })
    };
    let product = |children: Vec<BraceNode>| -> Result<BraceNode, EvalError> {
        let mut count = 1usize;
        let mut bytes = 0usize;
        for child in &children {
            let t1 = brace_mul(bytes, child.count, max_bytes, "maxExpansionBytes")?;
            let t2 = brace_mul(child.bytes, count, max_bytes, "maxExpansionBytes")?;
            bytes = brace_sum(t1, t2, max_bytes, "maxExpansionBytes")?;
            count = brace_mul(count, child.count, max_fields, "maxExpansionFields")?;
        }
        Ok(BraceNode {
            count,
            bytes,
            kind: BraceNodeKind::Product(children),
        })
    };
    let sequence = |children: &[BraceNode]| -> Result<Option<BraceNode>, EvalError> {
        if children.len() != 1 {
            return Ok(None);
        }
        let BraceNodeKind::Part(BracePart::Text { ref raw, .. }) = children[0].kind else {
            return Ok(None);
        };
        let mut pieces: Vec<&str> = Vec::new();
        let mut start_offset = 0usize;
        let bytes = raw.as_bytes();
        let mut offset = 0usize;
        while offset + 1 < bytes.len() {
            if bytes[offset] == b'.' && bytes[offset + 1] == b'.' {
                if pieces.len() == 2 {
                    return Ok(None);
                }
                pieces.push(&raw[start_offset..offset]);
                start_offset = offset + 2;
                offset += 2;
                continue;
            }
            offset += 1;
        }
        if pieces.is_empty() {
            return Ok(None);
        }
        pieces.push(&raw[start_offset..]);
        let first = pieces[0];
        let last = pieces[1];
        let mut start = parse_brace_int(first);
        let mut end = parse_brace_int(last);
        let numeric = start.is_some() && end.is_some();
        if !numeric {
            let is_alpha = |s: &str| s.len() == 1 && s.as_bytes()[0].is_ascii_alphabetic();
            if !is_alpha(first) || !is_alpha(last) {
                return Ok(None);
            }
            start = Some(first.as_bytes()[0] as i64);
            end = Some(last.as_bytes()[0] as i64);
        }
        let step_raw = if pieces.len() == 3 {
            parse_brace_int(pieces[2])
        } else {
            Some(1)
        };
        let Some(step_val) = step_raw else {
            return Ok(None);
        };
        let mut step_abs = (step_val as i128).unsigned_abs();
        if step_abs == 0 {
            step_abs = 1;
        }
        let start_val = start.unwrap();
        let end_val = end.unwrap();
        let distance = (end_val as i128) - (start_val as i128);
        let cardinality = (distance.unsigned_abs() / step_abs) + 1;
        if cardinality > (max_fields as u128) {
            return Err(brace_limit_err("maxExpansionFields", max_fields));
        }
        let is_padded = |v: &str| {
            (v.len() > 1 && v.starts_with('0')) || (v.len() > 2 && v.starts_with("-0"))
        };
        let width = if numeric && (is_padded(first) || is_padded(last)) {
            first.len().max(last.len())
        } else {
            0
        };
        let count = cardinality as usize;
        let term_bytes = if numeric {
            width
                .max(start_val.to_string().len())
                .max(end_val.to_string().len())
        } else {
            1
        };
        let total_bytes = brace_mul(count, term_bytes, max_bytes, "maxExpansionBytes")?;
        let signed_step = if distance < 0 {
            -(step_abs as i64)
        } else {
            step_abs as i64
        };
        Ok(Some(BraceNode {
            count,
            bytes: total_bytes,
            kind: BraceNodeKind::Range {
                start: start_val,
                step: signed_step,
                width,
                numeric,
            },
        }))
    };

    struct Frame {
        branches: Vec<Vec<BraceNode>>,
    }
    let mut frames: Vec<Frame> = vec![Frame {
        branches: vec![Vec::new()],
    }];
    let mut changed = false;

    let push_node = |frames: &mut Vec<Frame>, node: BraceNode| {
        frames
            .last_mut()
            .unwrap()
            .branches
            .last_mut()
            .unwrap()
            .push(node);
    };

    for part in parts {
        let BracePart::Text { ref raw, .. } = part else {
            push_node(&mut frames, part_node(part));
            continue;
        };
        let mut start = 0usize;
        for (offset, ch) in raw.char_indices() {
            if !matches!(ch, '{' | '}' | ',') {
                continue;
            }
            if start < offset {
                push_node(&mut frames, text_node(&raw[start..offset]));
            }
            start = offset + ch.len_utf8();
            if ch == '{' {
                frames.push(Frame {
                    branches: vec![Vec::new()],
                });
            } else if ch == ',' && frames.len() > 1 {
                frames.last_mut().unwrap().branches.push(Vec::new());
            } else if ch == '}' && frames.len() > 1 {
                let frame = frames.pop().unwrap();
                if frame.branches.len() > 1 {
                    let mut children = Vec::with_capacity(frame.branches.len());
                    for branch in frame.branches {
                        children.push(product(branch)?);
                    }
                    let mut count = 0usize;
                    let mut bytes = 0usize;
                    for child in &children {
                        count = brace_sum(count, child.count, max_fields, "maxExpansionFields")?;
                        bytes = brace_sum(bytes, child.bytes, max_bytes, "maxExpansionBytes")?;
                    }
                    push_node(
                        &mut frames,
                        BraceNode {
                            count,
                            bytes,
                            kind: BraceNodeKind::Choice(children),
                        },
                    );
                    changed = true;
                } else {
                    let children = frame.branches.into_iter().next().unwrap();
                    if let Some(range_node) = sequence(&children)? {
                        push_node(&mut frames, range_node);
                        changed = true;
                    } else {
                        push_node(&mut frames, text_node("{"));
                        push_node(&mut frames, product(children)?);
                        push_node(&mut frames, text_node("}"));
                    }
                }
            } else {
                push_node(&mut frames, text_node(&ch.to_string()));
            }
        }
        if start < raw.len() {
            if start == 0 {
                push_node(&mut frames, part_node(part));
            } else {
                push_node(&mut frames, text_node(&raw[start..]));
            }
        }
    }

    while frames.len() > 1 {
        let frame = frames.pop().unwrap();
        push_node(&mut frames, text_node("{"));
        for (index, branch) in frame.branches.into_iter().enumerate() {
            if index > 0 {
                push_node(&mut frames, text_node(","));
            }
            push_node(&mut frames, product(branch)?);
        }
    }

    if !changed {
        return Ok((vec![word.to_string()], false));
    }

    let root_branch = frames.pop().unwrap().branches.pop().unwrap();
    let root = product(root_branch)?;
    let mut out = Vec::with_capacity(root.count);
    for rank in 0..root.count {
        let mut materialized_parts: Vec<(BracePart, bool)> = Vec::new();
        let mut pending: Vec<(&BraceNode, usize)> = vec![(&root, rank)];
        while let Some((node, cur_rank)) = pending.pop() {
            match &node.kind {
                BraceNodeKind::Product(children) => {
                    let mut divisor = 1usize;
                    for child in children.iter().rev() {
                        let child_rank = (cur_rank / divisor) % child.count;
                        pending.push((child, child_rank));
                        divisor = divisor.saturating_mul(child.count);
                    }
                }
                BraceNodeKind::Choice(children) => {
                    let mut choice = cur_rank;
                    for child in children {
                        if choice < child.count {
                            pending.push((child, choice));
                            break;
                        }
                        choice -= child.count;
                    }
                }
                BraceNodeKind::Part(part) => {
                    materialized_parts.push((part.clone(), false));
                }
                BraceNodeKind::Range {
                    start,
                    step,
                    width,
                    numeric,
                } => {
                    let val = (*start as i128) + (cur_rank as i128) * (*step as i128);
                    let text = if *numeric {
                        let abs_digits = val.unsigned_abs().to_string();
                        if *width > 0 {
                            let pad_len = width.saturating_sub(usize::from(val < 0));
                            if val < 0 {
                                format!("-{:0>width$}", abs_digits, width = pad_len)
                            } else {
                                format!("{:0>width$}", abs_digits, width = pad_len)
                            }
                        } else {
                            val.to_string()
                        }
                    } else {
                        ((val as u8) as char).to_string()
                    };
                    let gen_syn = !*numeric && (text == "\\" || text == "`");
                    materialized_parts.push((
                        BracePart::Text {
                            byte_len: text.len(),
                            raw: text,
                        },
                        gen_syn,
                    ));
                }
            }
        }
        let mut word_out = String::new();
        let mut after_gen_syn = false;
        for (part, is_gen) in materialized_parts {
            if is_gen {
                after_gen_syn = true;
            }
            match part {
                BracePart::Text { raw, .. } | BracePart::Atom { raw, .. } => {
                    word_out.push_str(&raw);
                }
                BracePart::AnsiQuote { raw, decoded, .. } => {
                    if after_gen_syn {
                        word_out.push('\'');
                        word_out.push_str(&decoded.replace('\'', "'\\''"));
                        word_out.push('\'');
                    } else {
                        word_out.push_str(&raw);
                    }
                }
            }
        }
        out.push(word_out);
    }
    Ok((out, true))
}

fn expand_braces(word: &str) -> Vec<String> {
    expand_braces_with_limits(word, usize::MAX, usize::MAX)
        .map(|(v, _)| v)
        .unwrap_or_else(|_| vec![word.to_string()])
}

fn is_valid_shell_ident(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn format_function_display(name: &str, body: &Script) -> String {
    if body.lists.len() == 1
        && body.lists[0].rest.is_empty()
        && body.lists[0].first.commands.len() == 1
        && matches!(
            body.lists[0].first.commands[0],
            CommandNode::Subshell { .. } | CommandNode::Group { .. }
        )
    {
        format!(
            "{name} () \n{}\n",
            format_command_node(&body.lists[0].first.commands[0], "")
        )
    } else {
        format!(
            "{name} () \n{{ \n    {}\n}}\n",
            format_script_node(body, "    ", false)
        )
    }
}

fn format_script_node(script: &Script, indent: &str, terminate: bool) -> String {
    let mut parts = Vec::with_capacity(script.lists.len());
    for (list_idx, list) in script.lists.iter().enumerate() {
        let mut line = format_pipeline_node(&list.first, indent);
        for (op, pipe) in &list.rest {
            let op_s = match op {
                ListOp::And => "&&",
                ListOp::Or => "||",
            };
            line.push_str(&format!(" {op_s} {}", format_pipeline_node(pipe, indent)));
        }
        if list.background {
            line.push_str(" &");
        } else if terminate || list_idx + 1 < script.lists.len() {
            line.push(';');
        }
        parts.push(line);
    }
    parts.join(&format!("\n{indent}"))
}

fn format_pipeline_node(pipe: &Pipeline, indent: &str) -> String {
    let prefix = if pipe.negated { "! " } else { "" };
    let cmds: Vec<String> = pipe
        .commands
        .iter()
        .map(|c| format_command_node(c, indent))
        .collect();
    format!("{prefix}{}", cmds.join(" | "))
}

fn format_command_node(cmd: &CommandNode, indent: &str) -> String {
    let nested = format!("{indent}    ");
    match cmd {
        CommandNode::Simple(s) => {
            let mut tokens = Vec::new();
            for (k, v, app) in &s.assignments {
                tokens.push(format!("{k}{}{v}", if *app { "+=" } else { "=" }));
            }
            tokens.extend(s.words.iter().cloned());
            tokens.join(" ")
        }
        CommandNode::Subshell { body, .. } => {
            format!("( {} )", format_script_node(body, indent, false))
        }
        CommandNode::Group { body, .. } => {
            format!("{{\n{nested}{}\n{indent}}}", format_script_node(body, &nested, false))
        }
        CommandNode::ArithCommand(expr) => format!("(( {expr} ))"),
        CommandNode::FuncDef { name, body } => format_function_display(name, body),
        CommandNode::If {
            branches,
            else_branch,
            ..
        } => {
            let mut out = String::new();
            for (idx, (cond, body)) in branches.iter().enumerate() {
                if idx > 0 {
                    out.push_str(&format!("\n{indent}elif "));
                } else {
                    out.push_str("if ");
                }
                out.push_str(&format!(
                    "{} then\n{nested}{}",
                    format_script_node(cond, indent, true),
                    format_script_node(body, &nested, true)
                ));
            }
            if let Some(eb) = else_branch {
                out.push_str(&format!(
                    "\n{indent}else\n{nested}{}",
                    format_script_node(eb, &nested, true)
                ));
            }
            out.push_str(&format!("\n{indent}fi"));
            out
        }
        CommandNode::While {
            until, cond, body, ..
        } => {
            let kw = if *until { "until" } else { "while" };
            format!(
                "{kw} {} do\n{nested}{}\n{indent}done",
                format_script_node(cond, indent, true),
                format_script_node(body, &nested, true)
            )
        }
        CommandNode::ForIn {
            var, items, body, ..
        } => {
            let in_part = if items.is_empty() {
                String::new()
            } else {
                format!(" in {}", items.join(" "))
            };
            format!(
                "for {var}{in_part};\ndo\n{nested}{}\n{indent}done",
                format_script_node(body, &nested, true)
            )
        }
        CommandNode::Select {
            var, items, body, ..
        } => {
            let in_part = if items.is_empty() {
                String::new()
            } else {
                format!(" in {}", items.join(" "))
            };
            format!(
                "select {var}{in_part};\ndo\n{nested}{}\n{indent}done",
                format_script_node(body, &nested, true)
            )
        }
        CommandNode::ForArith {
            init,
            cond,
            step,
            body,
            ..
        } => format!(
            "for (( {init}; {cond}; {step} ));\ndo\n{nested}{}\n{indent}done",
            format_script_node(body, &nested, true)
        ),
        CommandNode::Case { word, arms, .. } => {
            let arm_strs: Vec<String> = arms
                .iter()
                .map(|(pats, body, _)| {
                    format!(
                        "{nested}{})\n{nested}    {}\n{nested};;",
                        pats.join(" | "),
                        format_script_node(body, &format!("{nested}    "), false)
                    )
                })
                .collect();
            format!("case {word} in\n{}\n{indent}esac", arm_strs.join("\n"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_brace_expansion_and_sequences() {
        assert_eq!(
            expand_braces("pre-{a,b,c}-post"),
            vec!["pre-a-post", "pre-b-post", "pre-c-post"]
        );
        assert_eq!(
            expand_braces("n{01..03}"),
            vec!["n01", "n02", "n03"]
        );
        assert_eq!(
            expand_braces("{d..a..2}"),
            vec!["d", "b"]
        );
    }

    #[test]
    fn unit_nested_brace_expansion_and_zero_padded_descending_ranges() {
        assert_eq!(
            expand_braces("v{003..001}"),
            vec!["v003", "v002", "v001"]
        );
        assert_eq!(
            expand_braces("{x,y}{1..2}"),
            vec!["x1", "x2", "y1", "y2"]
        );
        assert_eq!(
            expand_braces("literal_without_range"),
            vec!["literal_without_range"]
        );
    }

    #[test]
    fn unit_subshell_outer_redirection_does_not_double_route() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);
        let res = state
            .eval_script_str(
            "swapped=$( (echo out_msg; echo err_msg >&2) 2>&1 >/dev/null ); echo \"swapped=$swapped\"",
            "",
            )
            .unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(res.stdout, "swapped=err_msg\n");
    }

    #[test]
    fn unit_eval_return_trap_and_process_substitution() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);
        let res = state
            .eval_script_str(
                "f() { trap 'echo RET' RETURN; echo IN; }; f; cat <(printf 'procsub\\n')",
                "",
            )
            .unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(res.stdout, "IN\nRET\nprocsub\n");
    }

    #[test]
    fn unit_readwrite_redirect_local_array_shadowing_and_unset_subscripts() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);
        let res = state
            .eval_script_str(
                "exec 3<> /tmp/rw.txt; printf 'hello\\nworld\\n' >&3; exec 3<&-; exec 3< /tmp/rw.txt; read -r l1 <&3; read -r l2 <&3; exec 3<&-; echo \"rw=$l1|$l2\"; \
                 arr=(outer1 outer2); f() { local arr=(inner1 inner2 inner3); echo \"in:${arr[*]}\"; }; f; echo \"out:${arr[*]}\"; \
                 u=(a b c d); unset 'u[-2]'; echo \"u:${!u[*]}:${u[*]}\"",
                "",
            )
            .unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(
            res.stdout,
            "rw=hello|world\nin:inner1 inner2 inner3\nout:outer1 outer2\nu:0 1 3:a b d\n"
        );
    }

    #[test]
    fn unit_builtin_command_v_shopt_and_readonly_abort_semantics() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let b_err = state.eval_script_str("builtin cat", "").unwrap();
        assert_eq!(b_err.exit_code, 1);
        assert_eq!(b_err.stderr, "builtin: cat: not a shell builtin\n");

        let cv = state.eval_script_str("command -v echo nonexistent_xyz", "").unwrap();
        assert_eq!(cv.exit_code, 0);
        assert_eq!(cv.stdout, "echo\n");

        let shopt_err = state.eval_script_str("shopt bogus_opt", "").unwrap();
        assert_eq!(shopt_err.exit_code, 1);
        assert!(shopt_err.stderr.contains("shopt: bogus_opt: unsupported shell option name"));

        let ro_abort = state.eval_script_str("readonly R=1; R=2; echo unreachable", "").unwrap();
        assert_eq!(ro_abort.exit_code, 1);
        assert_eq!(ro_abort.stdout, "");
        assert!(ro_abort.stderr.contains("R: readonly variable"));
    }

    #[test]
    fn unit_declare_f_set_o_control_flow_and_readonly_builtins() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let decl_f = state
            .eval_script_str("b_fn() { :; }; a_fn() { :; }; declare -F", "")
            .unwrap();
        assert_eq!(decl_f.exit_code, 0);
        assert_eq!(decl_f.stdout, "a_fn\nb_fn\n");

        let set_o = state.eval_script_str("set -o", "").unwrap();
        assert_eq!(set_o.exit_code, 0);
        assert!(set_o.stdout.contains("braceexpand\ton\n"));
        assert!(set_o.stdout.contains("errexit\toff\n"));

        let ret_outside = state.eval_script_str("return 1; echo after:$?", "").unwrap();
        assert_eq!(ret_outside.exit_code, 0);
        assert_eq!(ret_outside.stdout, "after:2\n");
        assert_eq!(
            ret_outside.stderr,
            "return: can only `return' from a function or sourced script\n"
        );

        let read_ro = state
            .eval_script_str("readonly RO_R=1; echo hi | { read RO_R; echo rc:$?; }", "")
            .unwrap();
        assert_eq!(read_ro.stdout, "rc:1\n");
        assert!(read_ro.stderr.contains("RO_R: readonly variable"));

        let type_out = state
            .eval_script_str("fn_d() { echo d; }; type -t if fn_d echo cat; type fn_d", "")
            .unwrap();
        assert_eq!(type_out.exit_code, 0);
        assert_eq!(
            type_out.stdout,
            "keyword\nfunction\nbuiltin\nfile\nfn_d is a function\nfn_d () \n{ \n    echo d\n}\n"
        );
    }

    #[test]
    fn unit_type_command_unset_declare_local_functions_and_print_parity() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let local_err = state.eval_script_str("local x=1", "").unwrap();
        assert_eq!(local_err.exit_code, 1);
        assert_eq!(local_err.stderr, "local: not in a function\n");

        let unset_err = state.eval_script_str("unset -v -f x", "").unwrap();
        assert_eq!(unset_err.exit_code, 1);
        assert_eq!(
            unset_err.stderr,
            "unset: cannot simultaneously unset a function and a variable\n"
        );

        let print_out = state
            .eval_script_str("print -n hello ' ' world; print !; setopt a; unsetopt b", "")
            .unwrap();
        assert_eq!(print_out.exit_code, 0);
        assert_eq!(print_out.stdout, "hello   world!\n");
    }

    #[test]
    fn unit_eval_source_exec_trap_jobs_wait_disown_and_kill_parity() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let eval_err = state.eval_script_str("eval -z", "").unwrap();
        assert_eq!(eval_err.exit_code, 2);
        assert_eq!(
            eval_err.stderr,
            "eval: -z: invalid option\neval: usage: eval [arg ...]\n"
        );

        let src_err = state.eval_script_str("source", "").unwrap();
        assert_eq!(src_err.exit_code, 2);
        assert_eq!(
            src_err.stderr,
            "source: filename argument required\nsource: usage: source [-p path] filename [arguments]\n"
        );

        let trap_l = state.eval_script_str("trap -l", "").unwrap();
        assert_eq!(trap_l.exit_code, 0);
        assert!(trap_l.stdout.contains("1) SIGHUP"));
        assert!(trap_l.stdout.contains("31) SIGSYS"));

        let trap_sort = state
            .eval_script_str("trap 'echo term' TERM; trap 'echo ex' EXIT; trap 'echo int' INT; trap -p; trap 0 2 15; trap -p", "")
            .unwrap();
        assert_eq!(trap_sort.exit_code, 0);
        assert_eq!(
            trap_sort.stdout,
            "trap -- 'echo ex' EXIT\ntrap -- 'echo int' SIGINT\ntrap -- 'echo term' SIGTERM\n"
        );

        let wait_err = state.eval_script_str("wait 999", "").unwrap();
        assert_eq!(wait_err.exit_code, 127);
        assert_eq!(wait_err.stderr, "wait: pid 999 is not a child of this shell\n");

        let disown_err = state.eval_script_str("disown", "").unwrap();
        assert_eq!(disown_err.exit_code, 1);
        assert_eq!(disown_err.stderr, "disown: current: no such job\n");

        let kill_err = state.eval_script_str("kill -s BOGUS 123", "").unwrap();
        assert_eq!(kill_err.exit_code, 1);
        assert_eq!(kill_err.stderr, "kill: invalid signal specification\n");

        let kill_l_err = state.eval_script_str("kill -l BOGUS", "").unwrap();
        assert_eq!(kill_l_err.exit_code, 1);
        assert_eq!(kill_l_err.stderr, "kill: BOGUS: invalid signal specification\n");
    }

    #[test]
    fn unit_eval_set_dump_and_getopts_parity() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let set_out = state
            .eval_script_str(
                "SCALAR='a b'; SIMPLE=ok; ARR=(one 'two three'); myfn() { echo hi; }; set",
                "",
            )
            .unwrap();
        assert_eq!(set_out.exit_code, 0);
        assert!(set_out.stdout.contains("ARR=([0]=\"one\" [1]=\"two three\")\n"));
        assert!(set_out.stdout.contains("SCALAR=\"a b\"\n"));
        assert!(set_out.stdout.contains("SIMPLE=ok\n"));
        assert!(set_out.stdout.contains("myfn () \n{ \n    echo hi\n}\n"));

        let getopts_bad = state.eval_script_str("getopts -z ab opt", "").unwrap();
        assert_eq!(getopts_bad.exit_code, 2);
        assert_eq!(
            getopts_bad.stderr,
            "getopts: -z: invalid option\ngetopts: usage: getopts optstring name [arg ...]\n"
        );

        let getopts_end = state
            .eval_script_str(
                "OPTARG=stale; getopts -- 'a:b' opt -a val -- rest; r1=\"$opt:$OPTARG:$OPTIND\"; getopts 'a:b' opt -a val -- rest; r2=\"$?:$opt:${OPTARG:-unset}:$OPTIND\"; echo \"$r1|$r2\"",
                "",
            )
            .unwrap();
        assert_eq!(getopts_end.exit_code, 0);
        assert_eq!(getopts_end.stdout, "a:val:3|1:?:unset:4\n");
    }

    #[test]
    fn unit_eval_dynamic_variables_random_seconds_lineno_last_arg_dirstack() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        env.insert("PWD".to_string(), "/".to_string());
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let out = state
            .eval_script_str(
                "RANDOM=7\nr1=$RANDOM\nr2=$RANDOM\nRANDOM=7\nr3=$RANDOM\n: first second third-arg\nlast1=$_\nlast_after_assign=$_\nf() { echo \"in:$_\"; }\n: before-fn\nf fn-arg\nlast2=$_\necho \"$r1:$r2:$r3|$last1|$last_after_assign|$last2|$$:$BASHPID|$0|${DIRSTACK[0]}|$LINENO\"",
                "",
            )
            .unwrap();
        assert_eq!(out.exit_code, 0);
        assert_eq!(
            out.stdout,
            "in:before-fn\n19344:26956:19344|third-arg||fn-arg|1:1|virtual-bash|/|13\n"
        );
    }

    #[test]
    fn unit_eval_double_bracket_short_circuit_ere_and_var_present() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let out = state
            .eval_script_str(
                "x=0\n[[ 1 -eq 2 && $((x++)) -eq 0 ]]\ns1=\"$?:$x\"\n[[ 1 -eq 1 || $((x++)) -eq 0 ]]\ns2=\"$?:$x\"\n[[ 'a+b' =~ 'a+'([a-z]) ]]\ns3=\"$?:${BASH_REMATCH[0]}:${BASH_REMATCH[1]}\"\narr=([2]=val)\ni=2\ndeclare -n ref='arr[2]'\n[[ -v arr ]]; v_base=$?\n[[ -v arr[i++] ]]; v_sub=$?\n[[ -v ref ]]; v_ref=$?\n: keep-last\n[[ 1 -eq 1 ]]\nlast=$_\necho \"$s1|$s2|$s3|$v_base:$v_sub:$v_ref:$i|$last\"",
                "",
            )
            .unwrap();
        assert_eq!(out.exit_code, 0);
        assert_eq!(out.stdout, "1:0|0:0|0:a+b:b|1:0:0:3|keep-last\n");
    }

    #[test]
    fn unit_eval_traps_extdebug_errtrace_functrace_and_parse_time_aliases() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let out = state
            .eval_script_str(
                "shopt -s expand_aliases\nalias greet='printf \"hi;\"'\nf() {\n  greet\n}\nunalias greet\nf\nshopt -s extdebug\ng() { trap 'trap - DEBUG; (exit 2)' DEBUG; printf bad; }\ng\nprintf 'g:%s;' \"$?\"\nh() { trap 'trap - RETURN; return 8' RETURN; return 7; }\nh\nprintf 'h:%s' \"$?\"",
                "",
            )
            .unwrap();
        assert_eq!(out.exit_code, 0);
        assert_eq!(out.stdout, "hi;g:2;h:8");
    }

    #[test]
    fn unit_eval_select_menu_reply_continuation_and_eof() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        env.insert("COLUMNS".to_string(), "20".to_string());
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let menu_res = state
            .eval_script_str(
                "PS3='P>'; select x in a b c d e f; do printf '%s:%s' \"$x\" \"$REPLY\"; break; done",
                "\\2\\\n\n",
            )
            .unwrap();
        assert_eq!(menu_res.exit_code, 0);
        assert_eq!(menu_res.stdout, "b:2");
        assert_eq!(menu_res.stderr, "1) a  3) c  5) e\n2) b  4) d  6) f\nP>");

        let empty_res = state
            .eval_script_str("select x in; do echo bad; done", "1\n")
            .unwrap();
        assert_eq!(empty_res.exit_code, 0);
        assert_eq!(empty_res.stdout, "");
        assert_eq!(empty_res.stderr, "");

        let eof_res = state
            .eval_script_str(
                "x=old; select x in a; do :; done; printf '%s|%s|%s' \"$REPLY\" \"$x\" \"$?\"",
                "2",
            )
            .unwrap();
        assert_eq!(eof_res.exit_code, 0);
        assert_eq!(eof_res.stdout, "\n2|old|1");
    }

    #[test]
    fn unit_eval_tilde_and_cross_segment_ifs_splitting() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();
        env.insert("HOME".to_string(), "/home/a b:*".to_string());
        env.insert("OLDPWD".to_string(), "/var/log".to_string());
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let res = state
            .eval_script_str(
                "IFS=' :'; x='a '; y=' b '; z=': c'; printf '<%s>\\n' $x$y$z $x\"\"$z ~ ${u:-~/dir} ~+/sub ~-/sub; p=~/a:~/b; q=~/a\\:~/b; printf '<%s>\\n' \"$p\" \"$q\"",
                "",
            )
            .unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(
            res.stdout,
            "<a>\n<b>\n<c>\n<a>\n<>\n<c>\n</home/a b:*>\n</home/a b:*/dir>\n</work/sub>\n</var/log/sub>\n</home/a b:*/a:/home/a b:*/b>\n</home/a b:*/a:~/b>\n"
        );
    }

    #[test]
    fn unit_eval_brace_expansion_ranges_declarations_arrays_and_redirects() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let res = state
            .eval_script_str(
                "value=tail; printf '<%s>\\n' {Y..c..3}$value {Y..c..3}\"post\" {-03..03..2}; export ex={a,b}; values=([2]={x,y} [5]=last); declare -A m; m=([{a,b}]={c,d}); ( : > {left,right} ) 2>/dev/null; printf 'ex=%s|arr=%s|mk=%s|mv=%s|rc=%s\\n' \"$ex\" \"${values[*]}\" \"${!m[*]}\" \"${m[*]}\" \"$?\"",
                "",
            )
            .unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(
            res.stdout,
            "<Ytail>\n<$value>\n<_tail>\n<btail>\n<Ypost>\n<\"post>\n<_post>\n<bpost>\n<-03>\n<-01>\n<001>\n<003>\nex=b|arr=[2]=x [2]=y last|mk={a,b}|mv={c,d}|rc=1\n"
        );
    }
}
