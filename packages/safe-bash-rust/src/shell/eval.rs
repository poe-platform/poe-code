use crate::backend::{CommandContext, CommandResult, RustCommand};
use crate::budget::ExecutionBudget;
use crate::commands::try_run_command;
use crate::shell::builtins::{
    BuiltinOutcome, effective_path_env, eval_ere_match, eval_test_unary_predicate,
    path_targets, resolve_physical_path, try_run_builtin,
};
use crate::shell::expand::{
    apply_var_attributes, bash_quote_double, decimal_index, decode_ansi_c_escapes,
    decode_ansi_c_escapes_with_locale, eval_arith,
    expand_double_quoted_at_expr, expand_globs_in_word_with_projection, expand_parameter_expr,
    expand_tilde_prefix, find_var_name_end, get_var_meta_info, glob_match_ext, glob_match_full,
    has_glob_meta_ext, is_param_operand_active, resolve_nameref_base,
    sync_array_metadata, sync_getopts_env,
    try_resolve_unquoted_alternate_operand, write_dynamic_variable,
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

const STDIN_STREAM_FD: u32 = u32::MAX;
type SavedFds = (Vec<(u32, Option<FdTarget>)>, Vec<(u32, Option<u32>)>);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FdTarget {
    Stdout,
    PipeStdout { peer_retired: bool },
    Stderr,
    File { path: String },
    ReadWriteFile { path: String, owner_fd: u32 },
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
    pub in_fd_aliases: BTreeMap<u32, u32>,
    pub rw_offsets: BTreeMap<u32, usize>,
    pub rw_last_rem: BTreeMap<u32, usize>,
    pub mapfile_callback_depth: usize,
    pub callback_line_offset: usize,
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
    pub pos_args_version: u64,
    pub syntax_contexts: Vec<(String, usize, bool)>,
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
    pub in_cmdsub_file_shortcut: bool,
    pub async_default_stdin: bool,
    pub redirect_assignments: Vec<(String, String)>,
    pub procsub_seq: usize,
    pub cmdsub_seq: usize,
    pub in_prefix_assignment: bool,
    pub retained_prefix_vars: Vec<String>,
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
        if !env.contains_key("PWD") && !env.contains_key("__pwd_unset__") {
            env.insert("PWD".to_string(), cwd.clone());
        }
        if !env.contains_key("OPTIND") && !env.contains_key("__getopts_int") {
            env.insert("OPTIND".to_string(), "1".to_string());
            env.insert("__unexported__OPTIND".to_string(), "1".to_string());
        }
        if !env.contains_key("OPTERR") && !env.contains_key("__opterr_unset__") {
            env.insert("OPTERR".to_string(), "1".to_string());
            env.insert("__unexported__OPTERR".to_string(), "1".to_string());
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
            in_fd_aliases: BTreeMap::new(),
            rw_offsets: BTreeMap::new(),
            rw_last_rem: BTreeMap::new(),
            mapfile_callback_depth: 0,
            callback_line_offset: 0,
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
            pos_args_version: 0,
            syntax_contexts: Vec::new(),
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
            in_cmdsub_file_shortcut: false,
            async_default_stdin: false,
            redirect_assignments: Vec::new(),
            procsub_seq: 0,
            cmdsub_seq: 0,
            in_prefix_assignment: false,
            retained_prefix_vars: Vec::new(),
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
        let old_parent_keys: Vec<String> = env
            .keys()
            .filter(|k| k.starts_with("__parent_job_"))
            .cloned()
            .collect();
        for k in old_parent_keys {
            env.remove(&k);
        }
        let listed_pids: Vec<String> = self
            .env
            .keys()
            .filter_map(|k| k.strip_prefix("__job_active__").map(|s| s.to_string()))
            .collect();
        for pid in listed_pids {
            if let Some(jid) = self.env.get(&format!("__job_id__{pid}")) {
                env.insert(format!("__parent_job_id__{pid}"), jid.clone());
            }
            if let Some(cmd) = self.env.get(&format!("__job_cmd__{pid}")) {
                env.insert(format!("__parent_job_cmd__{pid}"), cmd.clone());
            }
        }
        let own_job_keys: Vec<String> = env
            .keys()
            .filter(|k| {
                k.starts_with("__job_status__")
                    || k.starts_with("__job_active__")
                    || k.starts_with("__job_notified__")
                    || k.starts_with("__job_saved__")
                    || k.starts_with("__job_settled__")
                    || k.starts_with("__job_id__")
                    || k.starts_with("__job_cmd__")
                    || *k == "__job_next_id"
            })
            .cloned()
            .collect();
        for k in own_job_keys {
            env.remove(&k);
        }
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
            in_fd_aliases: self.in_fd_aliases.clone(),
            rw_offsets: self.rw_offsets.clone(),
            rw_last_rem: self.rw_last_rem.clone(),
            mapfile_callback_depth: 0,
            callback_line_offset: self.callback_line_offset,
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
            pos_args_version: self.pos_args_version,
            syntax_contexts: self.syntax_contexts.clone(),
            last_exit: self.last_exit,
            errexit: self.errexit,
            nounset: self.nounset,
            pipefail: self.pipefail,
            noclobber: self.noclobber,
            noexec: self.noexec,
            xtrace: self.xtrace,
            in_condition: self.in_condition,
            in_trap: self.in_trap,
            in_pipeline_producer: self.in_pipeline_producer,
            in_cmdsub_file_shortcut: false,
            async_default_stdin: false,
            redirect_assignments: Vec::new(),
            procsub_seq: self.procsub_seq,
            cmdsub_seq: self.cmdsub_seq,
            in_prefix_assignment: false,
            retained_prefix_vars: Vec::new(),
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

    fn resolve_in_fd(&self, mut fd: u32) -> u32 {
        for _ in 0..16 {
            if let Some(&target) = self.in_fd_aliases.get(&fd) {
                if target == fd {
                    break;
                }
                fd = target;
            } else {
                break;
            }
        }
        if fd == 0 {
            STDIN_STREAM_FD
        } else {
            fd
        }
    }

    fn is_fd_open(&self, fd: u32) -> bool {
        if matches!(self.fd_table.get(&fd), Some(FdTarget::Closed)) {
            return false;
        }
        if self.in_fds.contains_key(&fd)
            || self.in_fd_aliases.contains_key(&fd)
            || self.fd_table.contains_key(&fd)
        {
            return true;
        }
        fd == 0
    }

    fn is_fd_readable(&self, fd: u32) -> bool {
        if matches!(self.fd_table.get(&fd), Some(FdTarget::Closed)) {
            return false;
        }
        if matches!(self.fd_table.get(&fd), Some(FdTarget::ReadWriteFile { .. })) {
            return true;
        }
        if self.in_fds.contains_key(&fd) {
            return true;
        }
        if self.in_fd_aliases.contains_key(&fd) {
            let canon = self.resolve_in_fd(fd);
            return canon == STDIN_STREAM_FD || self.in_fds.contains_key(&canon);
        }
        if fd == 0 {
            return !self.fd_table.contains_key(&0);
        }
        false
    }

    fn is_fd_writable(&self, fd: u32) -> bool {
        matches!(
            self.fd_table.get(&fd),
            Some(
                FdTarget::Stdout
                    | FdTarget::PipeStdout { .. }
                    | FdTarget::Stderr
                    | FdTarget::File { .. }
                    | FdTarget::ReadWriteFile { .. }
            )
        )
    }

    fn enter_body_stdio(&mut self) -> (Option<FdTarget>, Option<FdTarget>) {
        let saved_fd1 = if matches!(self.fd_table.get(&1), Some(FdTarget::Stderr)) {
            self.fd_table.insert(1, FdTarget::Stdout)
        } else {
            None
        };
        let saved_fd2 = if matches!(
            self.fd_table.get(&2),
            Some(FdTarget::Stdout | FdTarget::PipeStdout { .. })
        ) {
            self.fd_table.insert(2, FdTarget::Stderr)
        } else {
            None
        };
        (saved_fd1, saved_fd2)
    }

    fn leave_body_stdio(&mut self, saved: (Option<FdTarget>, Option<FdTarget>)) {
        if let Some(fd1) = saved.0 {
            self.fd_table.insert(1, fd1);
        }
        if let Some(fd2) = saved.1 {
            self.fd_table.insert(2, fd2);
        }
    }

    fn evacuate_in_fd_owner(
        &mut self,
        fd: u32,
        saved_aliases: &mut Vec<(u32, Option<u32>)>,
    ) {
        let new_owner = self
            .in_fd_aliases
            .iter()
            .find_map(|(&k, &v)| if k != fd && v == fd { Some(k) } else { None });
        if let Some(owner) = new_owner {
            if !saved_aliases.iter().any(|(f, _)| *f == fd) {
                saved_aliases.push((fd, Some(owner)));
            }
            if let Some(buf) = self.in_fds.remove(&fd) {
                self.in_fds.insert(owner, buf);
            }
            if let Some(off) = self.rw_offsets.remove(&fd) {
                self.rw_offsets.insert(owner, off);
            }
            if let Some(rem) = self.rw_last_rem.remove(&fd) {
                self.rw_last_rem.insert(owner, rem);
            }
            for target in self.fd_table.values_mut() {
                if let FdTarget::ReadWriteFile { owner_fd, .. } = target
                    && *owner_fd == fd
                {
                    *owner_fd = owner;
                }
            }
            self.in_fd_aliases.remove(&owner);
            for v in self.in_fd_aliases.values_mut() {
                if *v == fd {
                    *v = owner;
                }
            }
        }
    }

    fn materialize_stdin_aliases(
        &mut self,
        default_stdin: &str,
        saved_in: &mut Vec<(u32, Option<String>)>,
    ) {
        let new_owner = self.in_fd_aliases.iter().find_map(|(&k, &v)| {
            if k != 0 && (v == STDIN_STREAM_FD || v == 0) {
                Some(k)
            } else {
                None
            }
        });
        if let Some(owner) = new_owner {
            if !saved_in.iter().any(|(f, _)| *f == owner) {
                saved_in.push((owner, self.in_fds.get(&owner).cloned()));
            }
            let buf = self
                .in_fds
                .get(&STDIN_STREAM_FD)
                .cloned()
                .unwrap_or_else(|| default_stdin.to_string());
            self.in_fds.insert(owner, buf);
            self.in_fd_aliases.remove(&owner);
            for v in self.in_fd_aliases.values_mut() {
                if *v == STDIN_STREAM_FD || *v == 0 {
                    *v = owner;
                }
            }
        }
    }

    pub fn eval_script_str(&mut self, script: &str, stdin: &str) -> Result<CommandResult, EvalError> {
        self.budget
            .add_source_bytes(script.len())
            .map_err(EvalError::Budget)?;
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
            || script_text.contains("shopt")
            || (script_text.contains("$'")
                && (script_text.contains("LC_") || script_text.contains("LANG")));
        if !needs_unit_loop {
            match validate_basic_syntax(script_text).and_then(|()| parse_script(script_text)) {
                Ok(ast) => {
                    let parse_units: usize = ast.lists.iter().map(|l| 1 + l.rest.len()).sum();
                    if parse_units > self.budget.limits.max_parse_units {
                        return Err(EvalError::Budget(format!(
                            "Execution aborted: Shell limit exceeded: maxParseUnits ({})",
                            self.budget.limits.max_parse_units
                        )));
                    }
                    if ast.lists.is_empty() {
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: String::new(),
                            exit_code: 0,
                        });
                    }
                    return self.eval_script(&ast, stdin);
                }
                Err(syn_err) if !script_text.contains('\n') => {
                    return Err(EvalError::Syntax(syn_err));
                }
                Err(_) => {}
            }
        }

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut last_code = 0;
        let mut executed = false;
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
            let ast = match self.parse_with_current_aliases(&unit_buf, unit_start_line) {
                Ok(a) => a,
                Err(syn_err) => {
                    if !executed && self.mapfile_callback_depth == 0 {
                        return Err(EvalError::Syntax(syn_err));
                    }
                    stderr.push_str(&self.format_active_syntax_diagnostic(script_text, &syn_err));
                    self.last_exit = 2;
                    if self.syntax_contexts.is_empty() && self.mapfile_callback_depth == 0 {
                        self.exit_requested = Some(2);
                    }
                    return Ok(BuiltinOutcome {
                        stdout,
                        stderr,
                        exit_code: 2,
                    });
                }
            };
            unit_buf.clear();
            let parse_units: usize = ast.lists.iter().map(|l| 1 + l.rest.len()).sum();
            total_parse_units += parse_units;
            if total_parse_units > self.budget.limits.max_parse_units {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxParseUnits ({})",
                    self.budget.limits.max_parse_units
                )));
            }
            if !ast.lists.is_empty() {
                let unit_out = self.eval_script(&ast, stdin)?;
                stdout.push_str(&unit_out.stdout);
                stderr.push_str(&unit_out.stderr);
                last_code = unit_out.exit_code;
                executed = true;
            }
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
            let ast = match self.parse_with_current_aliases(&unit_buf, unit_start_line) {
                Ok(a) => a,
                Err(syn_err) => {
                    if !executed && self.mapfile_callback_depth == 0 {
                        return Err(EvalError::Syntax(syn_err));
                    }
                    stderr.push_str(&self.format_active_syntax_diagnostic(script_text, &syn_err));
                    self.last_exit = 2;
                    if self.syntax_contexts.is_empty() && self.mapfile_callback_depth == 0 {
                        self.exit_requested = Some(2);
                    }
                    return Ok(BuiltinOutcome {
                        stdout,
                        stderr,
                        exit_code: 2,
                    });
                }
            };
            if !ast.lists.is_empty() {
                let unit_out = self.eval_script(&ast, stdin)?;
                stdout.push_str(&unit_out.stdout);
                stderr.push_str(&unit_out.stderr);
                last_code = unit_out.exit_code;
            }
        }
        Ok(BuiltinOutcome {
            stdout,
            stderr,
            exit_code: last_code,
        })
    }

    fn format_active_syntax_diagnostic(&self, script_text: &str, syn_err: &str) -> String {
        if self.mapfile_callback_depth > 0 {
            let outer_script = self
                .script_name
                .clone()
                .unwrap_or_else(|| "shell".to_string());
            return format_syntax_diagnostic(
                &format!("{outer_script}: stdin"),
                self.callback_line_offset,
                script_text,
                syn_err,
                false,
            );
        }
        if let Some((name, offset, include_ctx)) = self.syntax_contexts.last() {
            return format_syntax_diagnostic(name, *offset, script_text, syn_err, *include_ctx);
        }
        let name = self.script_name.as_deref().unwrap_or("shell");
        format_syntax_diagnostic(name, 0, script_text, syn_err, true)
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
        let saved_exit = out.exit_code;
        self.last_exit = saved_exit;
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
        let prev_unit_locale = self.env.insert(
            "__unit_byte_locale".to_string(),
            if self.is_current_byte_locale() { "1" } else { "0" }.to_string(),
        );

        for list in &script.lists {
            if self.noexec || crate::commands::is_timeout_expired() {
                break;
            }
            self.budget.check_cancelled().map_err(EvalError::Budget)?;
            if list.background {
                self.retire_notified_jobs();
                let next_pid = self
                    .env
                    .get("__job_next_pid")
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(1001);
                self.env
                    .insert("__job_next_pid".to_string(), (next_pid + 1).to_string());
                let max_occupied_job_id = self
                    .env
                    .keys()
                    .filter_map(|k| k.strip_prefix("__job_active__"))
                    .filter_map(|pid| {
                        self.env
                            .get(&format!("__job_id__{pid}"))
                            .and_then(|s| s.parse::<u32>().ok())
                    })
                    .max()
                    .unwrap_or(0);
                let next_job_id = max_occupied_job_id + 1;
                let pid_str = next_pid.to_string();
                self.env.insert("!".to_string(), pid_str.clone());

                let alias_owner = self.in_fd_aliases.iter().find_map(|(&k, &v)| {
                    if k != 0 && (v == STDIN_STREAM_FD || v == 0) {
                        Some(k)
                    } else {
                        None
                    }
                });
                if let Some(owner) = alias_owner {
                    let mut dummy_saved = Vec::new();
                    self.materialize_stdin_aliases(stdin, &mut dummy_saved);
                    if !self.fd_table.contains_key(&0) && !self.in_fd_aliases.contains_key(&0) {
                        self.in_fd_aliases.insert(0, owner);
                    }
                }

                let mut sub_cwd = self.cwd.clone();
                let mut sub_env = self.env.clone();
                let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
                sub.errexit = self.errexit;
                sub.async_default_stdin = true;
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
                if fg_list.rest.is_empty() && fg_list.first.negated {
                    sub.in_condition = true;
                    fg_list.first.negated = false;
                }
                let bg_out = match sub.eval_and_or_list(&fg_list, stdin) {
                    Ok(mut o) => {
                        if let Some(code) = sub.exit_requested {
                            o.exit_code = code;
                        }
                        sub.run_exit_trap_if_needed(&mut o);
                        o
                    }
                    Err(EvalError::Syntax(msg)) => BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!(
                            "{}\n",
                            msg.strip_prefix("__param_err__")
                                .or_else(|| msg.strip_prefix("__nounset__"))
                                .unwrap_or(&msg)
                        ),
                        exit_code: 1,
                    },
                    Err(e) => return Err(e),
                };
                for (k, v) in &sub.in_fds {
                    if *k != 0 && *k != STDIN_STREAM_FD && self.in_fds.contains_key(k) {
                        self.in_fds.insert(*k, v.clone());
                    }
                }
                for (k, v) in &sub.rw_offsets {
                    if self.rw_offsets.contains_key(k) {
                        self.rw_offsets.insert(*k, *v);
                    }
                }
                for (k, v) in &sub.rw_last_rem {
                    if self.rw_last_rem.contains_key(k) {
                        self.rw_last_rem.insert(*k, *v);
                    }
                }
                let canon0 = self.resolve_in_fd(0);
                if canon0 >= 3
                    && canon0 != STDIN_STREAM_FD
                    && let Some(updated) = self.in_fds.get(&canon0)
                {
                    *stdin = updated.clone();
                }
                stdout.push_str(&bg_out.stdout);
                stderr.push_str(&bg_out.stderr);
                self.env
                    .insert(format!("__job_status__{pid_str}"), bg_out.exit_code.to_string());
                self.env
                    .insert(format!("__job_active__{pid_str}"), "1".to_string());
                self.env.remove(&format!("__job_notified__{pid_str}"));
                self.env.remove(&format!("__job_saved__{pid_str}"));
                self.env.remove(&format!("__job_settled__{pid_str}"));
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
                    let clean_msg = msg
                        .strip_prefix("__param_err__")
                        .or_else(|| msg.strip_prefix("__nounset__"))
                        .unwrap_or(&msg);
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
        }
        match prev_unit_locale {
            Some(v) => {
                self.env.insert("__unit_byte_locale".to_string(), v);
            }
            None => {
                self.env.remove("__unit_byte_locale");
            }
        }

        Ok(BuiltinOutcome {
            stdout,
            stderr,
            exit_code: last_code,
        })
    }

    fn is_current_byte_locale(&self) -> bool {
        let eff = self
            .env
            .get("LC_ALL")
            .filter(|v| !v.is_empty())
            .or_else(|| self.env.get("LC_CTYPE").filter(|v| !v.is_empty()))
            .or_else(|| self.env.get("LANG").filter(|v| !v.is_empty()))
            .map(String::as_str)
            .unwrap_or("");
        matches!(eff, "C" | "POSIX")
    }

    fn is_unit_byte_locale(&self) -> bool {
        if let Some(v) = self.env.get("__unit_byte_locale") {
            v == "1"
        } else {
            self.is_current_byte_locale()
        }
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
                        | CommandNode::ArithCommand { .. }
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
                                | CommandNode::ArithCommand { .. }
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
            if self.errexit {
                self.exit_requested = Some(first_out.exit_code);
            }
        }

        Ok(first_out)
    }

    fn set_pipestatus(&mut self, codes: &[i32]) {
        let is_indexed = self.env.contains_key("__keys__PIPESTATUS")
            || self.env.keys().any(|k| k.starts_with("PIPESTATUS["));
        let pipestatus_attr = self
            .env
            .get("__attr__PIPESTATUS")
            .map(|s| s.as_str())
            .unwrap_or("");
        let is_readonly = pipestatus_attr.contains('r');
        let is_exported = pipestatus_attr.contains('x');
        let in_local_scope = self
            .local_scopes
            .iter()
            .any(|f| f.contains_key("PIPESTATUS"));
        if !is_indexed
            && (self.env.contains_key("PIPESTATUS")
                || is_readonly
                || is_exported
                || in_local_scope)
        {
            return;
        }
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
            let publishes = matches!(
                pipe.commands[0],
                CommandNode::Simple(_)
                    | CommandNode::Subshell { .. }
                    | CommandNode::ArithCommand { .. }
            );
            if publishes {
                let is_cond_or_arith = match &pipe.commands[0] {
                    CommandNode::ArithCommand { .. } => true,
                    CommandNode::Simple(s) => s.words.first().is_some_and(|w| w == "[["),
                    _ => false,
                };
                let reported = if pipe.negated && is_cond_or_arith {
                    if raw_code == 0 { 1 } else { 0 }
                } else {
                    raw_code
                };
                self.set_pipestatus(&[reported]);
            }
            let flow_active = self.exit_requested.is_some()
                || self.return_requested.is_some()
                || self.break_count > 0
                || self.continue_count > 0;
            if pipe.negated && !flow_active {
                out.exit_code = if out.exit_code == 0 { 1 } else { 0 };
            }
            self.last_exit = out.exit_code;
            return Ok(out);
        }

        self.retire_notified_jobs();
        let mut cur_stdin = String::new();
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
                    CommandNode::ArithCommand { expr, .. } => {
                        self.env
                            .insert("BASH_COMMAND".to_string(), format!("(({expr}))"));
                    }
                    _ => {}
                }
            }
        }

        for (idx, cmd_node) in pipe.commands.iter().enumerate() {
            let is_last = idx + 1 == pipe.commands.len();
            let use_lastpipe =
                is_last && self.env.get("__shopt_lastpipe").is_some_and(|v| v == "1");
            if use_lastpipe {
                let prev_pipe0 = self.env.insert("__pipe_fd__0".to_string(), "1".to_string());
                let stage_res = self.eval_command_node(cmd_node, &mut cur_stdin);
                if let Some(p0) = prev_pipe0 {
                    self.env.insert("__pipe_fd__0".to_string(), p0);
                } else {
                    self.env.remove("__pipe_fd__0");
                }
                let mut stage_out = match stage_res {
                    Ok(o) => o,
                    Err(e) => {
                        self.in_condition = prev_cond;
                        return Err(e);
                    }
                };
                if let Some(code) = self.exit_requested {
                    stage_out.exit_code = code;
                }
                combined_stderr.push_str(&stage_out.stderr);
                stage_codes.push(stage_out.exit_code);
                cur_stdin = stage_out.stdout;
                continue;
            }
            let mut sub_cwd = self.cwd.clone();
            let mut sub_env = self.env.clone();
            let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
            if idx == 0 {
                sub.async_default_stdin = self.async_default_stdin;
            } else {
                sub.env.insert("__pipe_fd__0".to_string(), "1".to_string());
            }
            if !is_last {
                let peer_retired = pipe.commands.get(idx + 1).is_some_and(|next| {
                    matches!(
                        next,
                        CommandNode::Simple(sc)
                            if sc
                                .words
                                .first()
                                .is_some_and(|w| matches!(w.as_str(), "true" | "false" | ":"))
                    )
                });
                sub.fd_table.insert(1, FdTarget::PipeStdout { peer_retired });
                sub.env.insert("__pipe_fd__1".to_string(), "1".to_string());
                sub.in_pipeline_producer = true;
            } else {
                sub.fd_table.insert(1, FdTarget::Stdout);
                sub.env.remove("__pipe_fd__1");
            }
            let stage_res = if idx == 0 {
                sub.eval_command_node(cmd_node, stdin)
            } else {
                sub.eval_command_node(cmd_node, &mut cur_stdin)
            };
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
            if !is_last {
                if let Err(e) = self.budget.record_stdout(stage_out.stdout.len()) {
                    self.in_condition = prev_cond;
                    return Err(EvalError::Budget(e));
                }
            }
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

        let flow_active = self.exit_requested.is_some()
            || self.return_requested.is_some()
            || self.break_count > 0
            || self.continue_count > 0;
        if pipe.negated && !flow_active {
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
        if self.async_default_stdin {
            let prev_async = std::mem::replace(&mut self.async_default_stdin, false);
            let redirects: &[Redirect] = match node {
                CommandNode::Simple(s) => &s.redirects,
                CommandNode::Subshell { redirects, .. }
                | CommandNode::Group { redirects, .. }
                | CommandNode::If { redirects, .. }
                | CommandNode::ForIn { redirects, .. }
                | CommandNode::Select { redirects, .. }
                | CommandNode::ForArith { redirects, .. }
                | CommandNode::While { redirects, .. }
                | CommandNode::Case { redirects, .. }
                | CommandNode::ArithCommand { redirects, .. } => redirects,
                CommandNode::FuncDef { .. } => &[],
            };
            let redirects_fd0 = redirects.iter().any(|r| {
                matches!(
                    r.kind,
                    RedirectKind::In(0)
                        | RedirectKind::ReadWrite(0)
                        | RedirectKind::HereString(0)
                        | RedirectKind::HereDoc { fd: 0, .. }
                        | RedirectKind::DupIn { fd: 0, .. }
                        | RedirectKind::Out(0)
                        | RedirectKind::Append(0)
                        | RedirectKind::Clobber(0)
                        | RedirectKind::DupOut { fd: 0, .. }
                )
            });
            if !matches!(self.fd_table.get(&0), Some(FdTarget::Closed)) && !redirects_fd0 {
                let saved_alias0 = if !self.fd_table.contains_key(&0) {
                    self.in_fd_aliases.remove(&0)
                } else {
                    None
                };
                let saved_stream = self.in_fds.remove(&STDIN_STREAM_FD);
                let mut empty_stdin = String::new();
                let res = self.eval_command_node(node, &mut empty_stdin);
                if let Some(a0) = saved_alias0 {
                    self.in_fd_aliases.insert(0, a0);
                }
                if let Some(st) = saved_stream {
                    self.in_fds.insert(STDIN_STREAM_FD, st);
                }
                self.async_default_stdin = prev_async;
                return res;
            } else {
                let res = self.eval_command_node(node, stdin);
                self.async_default_stdin = prev_async;
                return res;
            }
        }
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
                self.retire_notified_jobs();
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let mut sub_cwd = self.cwd.clone();
                let mut sub_env = self.env.clone();
                let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
                let _ = sub.enter_body_stdio();
                let res = sub.eval_script(body, eff_stdin);
                self.budget.leave_recursion();
                let mut out = match res {
                    Ok(o) => o,
                    Err(EvalError::Syntax(msg)) => {
                        let is_syn = msg.starts_with("Syntax error:");
                        BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!(
                                "{}\n",
                                msg.strip_prefix("__param_err__")
                                    .or_else(|| msg.strip_prefix("__nounset__"))
                                    .unwrap_or(&msg)
                            ),
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
                if let Some(mut err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    if !self.in_condition && !self.in_trap {
                        self.fire_err_trap(&mut err_out);
                        if self.errexit {
                            self.exit_requested = Some(err_out.exit_code);
                        }
                    }
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_stdio = self.enter_body_stdio();
                let mut out = self.eval_script(body, eff_stdin)?;
                self.leave_body_stdio(body_stdio);
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
                if let Some(mut err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    if !self.in_condition && !self.in_trap {
                        self.fire_err_trap(&mut err_out);
                        if self.errexit {
                            self.exit_requested = Some(err_out.exit_code);
                        }
                    }
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_stdio = self.enter_body_stdio();
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut executed = false;
                let mut code = 0;

                for (cond, body) in branches {
                    let prev_cond = self.in_condition;
                    self.in_condition = true;
                    let cond_out = self.eval_script(cond, eff_stdin)?;
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

                self.leave_body_stdio(body_stdio);
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
                if let Some(mut err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    if !self.in_condition && !self.in_trap {
                        self.fire_err_trap(&mut err_out);
                        if self.errexit {
                            self.exit_requested = Some(err_out.exit_code);
                        }
                    }
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_stdio = self.enter_body_stdio();
                let mut expanded_items = Vec::new();
                for raw in items {
                    match self.expand_word_to_fields(raw) {
                        Ok(fields) => {
                            expanded_items.extend(fields);
                            if expanded_items.len() > self.budget.limits.max_expansion_fields {
                                self.leave_body_stdio(body_stdio);
                                self.restore_redirects(saved_fds, saved_in);
                                return Err(EvalError::Budget(format!(
                                    "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                                    self.budget.limits.max_expansion_fields
                                )));
                            }
                        }
                        Err(EvalError::Syntax(msg)) if msg.starts_with("bash: no match:") => {
                            self.leave_body_stdio(body_stdio);
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
                    self.retire_notified_jobs();
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
                }
                self.loop_depth -= 1;

                self.leave_body_stdio(body_stdio);
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
                if let Some(mut err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    if !self.in_condition && !self.in_trap {
                        self.fire_err_trap(&mut err_out);
                        if self.errexit {
                            self.exit_requested = Some(err_out.exit_code);
                        }
                    }
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_stdio = self.enter_body_stdio();
                let mut expanded_items = Vec::new();
                for raw in items {
                    match self.expand_word_to_fields(raw) {
                        Ok(fields) => {
                            expanded_items.extend(fields);
                            if expanded_items.len() > self.budget.limits.max_expansion_fields {
                                self.leave_body_stdio(body_stdio);
                                self.restore_redirects(saved_fds, saved_in);
                                return Err(EvalError::Budget(format!(
                                    "Execution aborted: Shell limit exceeded: maxExpansionFields ({})",
                                    self.budget.limits.max_expansion_fields
                                )));
                            }
                        }
                        Err(EvalError::Syntax(msg)) if msg.starts_with("bash: no match:") => {
                            self.leave_body_stdio(body_stdio);
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
                            self.leave_body_stdio(body_stdio);
                            self.restore_redirects(saved_fds, saved_in);
                            return Err(e);
                        }
                    }
                }
                if expanded_items.is_empty() {
                    self.leave_body_stdio(body_stdio);
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
                        self.leave_body_stdio(body_stdio);
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
                                self.leave_body_stdio(body_stdio);
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
                                self.leave_body_stdio(body_stdio);
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
                    self.retire_notified_jobs();
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
                    show_menu = self
                        .env
                        .get("REPLY")
                        .map(|v| stream_string_to_bytes(v).is_empty())
                        .unwrap_or(true);
                }
                self.loop_depth -= 1;

                self.leave_body_stdio(body_stdio);
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
                if let Some(mut err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    if !self.in_condition && !self.in_trap {
                        self.fire_err_trap(&mut err_out);
                        if self.errexit {
                            self.exit_requested = Some(err_out.exit_code);
                        }
                    }
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_stdio = self.enter_body_stdio();
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;

                if !init.trim().is_empty() {
                    let exp_init = self.expand_arith_text(init)?;
                    if let Err(e) = eval_arith(&exp_init, self.env) {
                        self.leave_body_stdio(body_stdio);
                        self.restore_redirects(saved_fds, saved_in);
                        if let Some(nu) = e.strip_prefix("__nounset__") {
                            return Err(EvalError::Syntax(nu.to_string()));
                        }
                        stderr.push_str(&format!("((: {e}\n"));
                        let mut out = BuiltinOutcome {
                            stdout,
                            stderr,
                            exit_code: 1,
                        };
                        self.route_outcome(&mut out);
                        return Ok(out);
                    }
                }

                self.loop_depth += 1;
                loop {
                    crate::commands::tick_virtual_loop(self.env);
                    if crate::commands::is_timeout_expired() {
                        break;
                    }
                    if !cond.trim().is_empty() {
                        let exp_cond = self.expand_arith_text(cond)?;
                        match eval_arith(&exp_cond, self.env) {
                            Ok(cval) => {
                                if cval == 0 {
                                    break;
                                }
                            }
                            Err(e) => {
                                if let Some(nu) = e.strip_prefix("__nounset__") {
                                    self.loop_depth -= 1;
                                    self.leave_body_stdio(body_stdio);
                                    self.restore_redirects(saved_fds, saved_in);
                                    return Err(EvalError::Syntax(nu.to_string()));
                                }
                                stderr.push_str(&format!("((: {e}\n"));
                                code = 1;
                                break;
                            }
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
                    self.retire_notified_jobs();
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
                    if !step.trim().is_empty() {
                        let exp_step = self.expand_arith_text(step)?;
                        if let Err(e) = eval_arith(&exp_step, self.env) {
                            if let Some(nu) = e.strip_prefix("__nounset__") {
                                self.loop_depth -= 1;
                                self.leave_body_stdio(body_stdio);
                                self.restore_redirects(saved_fds, saved_in);
                                return Err(EvalError::Syntax(nu.to_string()));
                            }
                            stderr.push_str(&format!("((: {e}\n"));
                            code = 1;
                            break;
                        }
                    }
                }
                self.loop_depth -= 1;

                self.leave_body_stdio(body_stdio);
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
                if let Some(mut err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    if !self.in_condition && !self.in_trap {
                        self.fire_err_trap(&mut err_out);
                        if self.errexit {
                            self.exit_requested = Some(err_out.exit_code);
                        }
                    }
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_stdio = self.enter_body_stdio();
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
                    let prev_cond = self.in_condition;
                    self.in_condition = true;
                    self.env.remove("__arith_diag");
                    let cond_out = self.eval_script(cond, eff_stdin)?;
                    let arith_diag = self.env.remove("__arith_diag").is_some();
                    self.in_condition = prev_cond;
                    stdout.push_str(&cond_out.stdout);
                    stderr.push_str(&cond_out.stderr);
                    if self.exit_requested.is_some() || self.return_requested.is_some() {
                        code = cond_out.exit_code;
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
                        continue;
                    }
                    if arith_diag {
                        break;
                    }

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
                    self.retire_notified_jobs();
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
                }
                self.loop_depth -= 1;

                self.leave_body_stdio(body_stdio);
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
                if let Some(mut err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    if !self.in_condition && !self.in_trap {
                        self.fire_err_trap(&mut err_out);
                        if self.errexit {
                            self.exit_requested = Some(err_out.exit_code);
                        }
                    }
                    return Ok(err_out);
                }
                let eff_stdin = if use_local { &mut local_stdin } else { stdin };
                let body_stdio = self.enter_body_stdio();
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
                    let extglob = self
                        .env
                        .get("__shopt_extglob")
                        .map(|v| v == "1")
                        .unwrap_or(false);
                    let mut force_exec = false;

                    for (pats, body, term) in arms {
                        let mut matched = force_exec;
                        force_exec = false;
                        if !matched {
                            for p in pats {
                                let exp_p = self.expand_word_for_pattern(p)?;
                                if glob_match_full(&exp_p, &target, nocase, extglob) {
                                    matched = true;
                                    break;
                                }
                            }
                        }
                        if matched {
                            if body.lists.is_empty() {
                                code = 0;
                                self.last_exit = 0;
                            } else {
                                let arm_out = self.eval_script(body, eff_stdin)?;
                                stdout.push_str(&arm_out.stdout);
                                stderr.push_str(&arm_out.stderr);
                                code = arm_out.exit_code;
                            }
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

                self.leave_body_stdio(body_stdio);
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
            CommandNode::ArithCommand { expr, redirects } => {
                let (saved_fds, saved_in, local_stdin, _use_local, dup_fd, redir_err) =
                    self.setup_redirects(redirects, stdin)?;
                if let Some(err_out) = redir_err {
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(err_out);
                }
                let arith_desc = format!("(({expr}))");
                let (dbg_out, skip_cmd) = self.fire_debug_trap(&arith_desc);
                if skip_cmd {
                    let mut out = dbg_out;
                    if let Some(dfd) = dup_fd {
                        self.in_fds.insert(dfd, local_stdin);
                    }
                    self.route_outcome(&mut out);
                    self.restore_redirects(saved_fds, saved_in);
                    return Ok(out);
                }
                let exp = match self.expand_arith_text(expr) {
                    Ok(v) => v,
                    Err(e) => {
                        self.restore_redirects(saved_fds, saved_in);
                        return Err(e);
                    }
                };
                let mut out = BuiltinOutcome {
                    stdout: dbg_out.stdout,
                    stderr: dbg_out.stderr,
                    exit_code: 0,
                };
                if let Some(dfd) = dup_fd {
                    self.in_fds.insert(dfd, local_stdin);
                }
                self.route_outcome(&mut out);
                match eval_arith(&exp, self.env) {
                    Ok(val) => {
                        self.restore_redirects(saved_fds, saved_in);
                        out.exit_code = if val != 0 { 0 } else { 1 };
                        Ok(out)
                    }
                    Err(e) => {
                        if let Some(nu) = e.strip_prefix("__nounset__") {
                            self.restore_redirects(saved_fds, saved_in);
                            return Err(EvalError::Syntax(nu.to_string()));
                        }
                        self.env.insert("__arith_diag".to_string(), "1".to_string());
                        let mut diag_out = BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("((: {e}\n"),
                            exit_code: 1,
                        };
                        self.route_outcome(&mut diag_out);
                        self.restore_redirects(saved_fds, saved_in);
                        out.stdout.push_str(&diag_out.stdout);
                        out.stderr.push_str(&diag_out.stderr);
                        out.exit_code = 1;
                        Ok(out)
                    }
                }
            }
            CommandNode::FuncDef { name, body } => {
                let is_posix = self
                    .env
                    .get("__set_posix")
                    .map(|v| v == "1")
                    .unwrap_or(false);
                if is_posix
                    && matches!(
                        name.as_str(),
                        ":"
                            | "."
                            | "break"
                            | "continue"
                            | "eval"
                            | "exec"
                            | "exit"
                            | "export"
                            | "readonly"
                            | "return"
                            | "set"
                            | "shift"
                            | "times"
                            | "trap"
                            | "unset"
                    )
                {
                    let prefix = self.diag_prefix();
                    let mut err_out = BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{prefix}`{name}': is a special builtin\n"),
                        exit_code: 2,
                    };
                    self.last_exit = 2;
                    self.exit_requested = Some(2);
                    self.route_outcome(&mut err_out);
                    return Ok(err_out);
                }
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
                if let Some(ref src) = self.script_name {
                    self.env.insert(format!("__func_src__{name}"), src.clone());
                } else {
                    self.env.remove(&format!("__func_src__{name}"));
                }
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
                .unwrap_or(false)
                || self
                    .env
                    .get(&format!("__attr__{resolved_base}"))
                    .is_some_and(|a| a.contains('A'));
            if !is_assoc {
                let prefix = format!("{resolved_base}[");
                let has_arr_elems = self.env.keys().any(|k| k.starts_with(&prefix));
                if !has_arr_elems
                    && let Some(scalar_v) = self.env.get(&resolved_base).cloned()
                {
                    self.env.insert(format!("{resolved_base}[0]"), scalar_v);
                    sync_array_metadata(&resolved_base, self.env);
                }
            }
            let final_sub = if is_assoc {
                clean_sub.to_string()
            } else {
                if clean_sub.trim().is_empty() {
                    return Err(EvalError::Syntax(format!("{lhs}: bad array subscript")));
                }
                let idx = eval_arith(clean_sub, self.env).map_err(EvalError::Syntax)?;
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
                    let resolved_idx = max_idx + 1 + idx;
                    if resolved_idx < 0 {
                        return Err(EvalError::Syntax(format!("{lhs}: bad array subscript")));
                    }
                    resolved_idx.to_string()
                } else {
                    idx.to_string()
                }
            };
            let key = format!("{resolved_base}[{final_sub}]");
            let attr = self
                .env
                .get(&format!("__attr__{resolved_base}"))
                .cloned()
                .unwrap_or_default();
            let val = if attr.contains('i') {
                let rhs_num = eval_arith(raw_val, self.env).map_err(EvalError::Syntax)?;
                let num = if append {
                    let cur = self
                        .env
                        .get(&key)
                        .cloned()
                        .and_then(|s| eval_arith(&s, self.env).ok())
                        .unwrap_or(0);
                    cur.wrapping_add(rhs_num)
                } else {
                    rhs_num
                };
                num.to_string()
            } else {
                let mut s = if append {
                    let cur = self.env.get(&key).cloned().unwrap_or_default();
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
            if is_assoc {
                let keys_k = format!("__keys__{resolved_base}");
                let mut order: Vec<String> = self
                    .env
                    .get(&keys_k)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.split('\x1f').map(|p| p.to_string()).collect())
                    .unwrap_or_default();
                if !order.contains(&final_sub) {
                    order.push(final_sub.clone());
                    self.env.insert(keys_k, order.join("\x1f"));
                }
            }
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
                .unwrap_or(false)
                || self
                    .env
                    .get(&format!("__attr__{resolved}"))
                    .is_some_and(|a| a.contains('A'));
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
                self.env.remove(&format!("__keys__{resolved}"));
                self.env.remove(&resolved);
            } else if !is_assoc {
                let prefix = format!("{resolved}[");
                let has_arr_elems = self.env.keys().any(|k| k.starts_with(&prefix));
                if !has_arr_elems
                    && let Some(scalar_v) = self.env.get(&resolved).cloned()
                {
                    self.env.insert(format!("{resolved}[0]"), scalar_v);
                    sync_array_metadata(&resolved, self.env);
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

            for (explicit_sub, item_val, item_append) in items {
                if let Some(sub_k) = explicit_sub {
                    let final_k = if is_assoc {
                        sub_k
                    } else {
                        let idx = eval_arith(&sub_k, self.env).map_err(EvalError::Syntax)?;
                        next_idx = idx + 1;
                        idx.to_string()
                    };
                    let elem_key = format!("{resolved}[{final_k}]");
                    let attr = self
                        .env
                        .get(&format!("__attr__{resolved}"))
                        .cloned()
                        .unwrap_or_default();
                    let final_item_val = if item_append {
                        if attr.contains('i') {
                            let cur = self
                                .env
                                .get(&elem_key)
                                .cloned()
                                .and_then(|s| eval_arith(&s, self.env).ok())
                                .unwrap_or(0);
                            let add = eval_arith(&item_val, self.env).map_err(EvalError::Syntax)?;
                            cur.wrapping_add(add).to_string()
                        } else {
                            let cur = self.env.get(&elem_key).cloned().unwrap_or_default();
                            apply_var_attributes(&resolved, &format!("{cur}{item_val}"), self.env)
                                .map_err(EvalError::Syntax)?
                        }
                    } else {
                        apply_var_attributes(&resolved, &item_val, self.env)
                            .map_err(EvalError::Syntax)?
                    };
                    if is_assoc {
                        let keys_k = format!("__keys__{resolved}");
                        let mut order: Vec<String> = self
                            .env
                            .get(&keys_k)
                            .filter(|s| !s.is_empty())
                            .map(|s| s.split('\x1f').map(|p| p.to_string()).collect())
                            .unwrap_or_default();
                        if !order.contains(&final_k) {
                            order.push(final_k.clone());
                            self.env.insert(keys_k, order.join("\x1f"));
                        }
                    }
                    self.env.insert(elem_key, final_item_val);
                    sync_array_metadata(&resolved, self.env);
                } else {
                    let final_item_val = apply_var_attributes(&resolved, &item_val, self.env)
                        .map_err(EvalError::Syntax)?;
                    self.env
                        .insert(format!("{resolved}[{next_idx}]"), final_item_val);
                    next_idx += 1;
                    sync_array_metadata(&resolved, self.env);
                }
            }
            sync_array_metadata(&resolved, self.env);
            if let Some(first) = self.env.get(&format!("{resolved}[0]")).cloned() {
                self.env.insert(resolved, first);
            }
            return Ok(());
        }

        let arr_prefix = format!("{resolved}[");
        let is_existing_array = self.env.contains_key(&format!("__assoc__{resolved}"))
            || self.env.keys().any(|k| k.starts_with(&arr_prefix));
        let attr = self
            .env
            .get(&format!("__attr__{resolved}"))
            .cloned()
            .unwrap_or_default();
        let final_val = if attr.contains('i') {
            let rhs_num = eval_arith(raw_val, self.env).unwrap_or(0);
            let num = if append {
                let cur = if is_existing_array {
                    self.env
                        .get(&format!("{resolved}[0]"))
                        .or_else(|| self.env.get(&resolved))
                } else {
                    self.env.get(&resolved)
                }
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0);
                cur + rhs_num
            } else {
                rhs_num
            };
            num.to_string()
        } else {
            let mut s = if append {
                let cur = if is_existing_array {
                    self.env
                        .get(&format!("{resolved}[0]"))
                        .or_else(|| self.env.get(&resolved))
                        .cloned()
                        .unwrap_or_default()
                } else {
                    self.env.get(&resolved).cloned().unwrap_or_default()
                };
                format!("{cur}{raw_val}")
            } else {
                raw_val.to_string()
            };
            if attr.contains('l') {
                s = s.to_lowercase();
            } else if attr.contains('u') {
                s = s.to_uppercase();
            }
            if resolved == "OPTIND"
                && self.env.get("__getopts_int").map(|v| v.as_str()) != Some("0")
            {
                let expr = if s.is_empty() { "0" } else { s.as_str() };
                s = eval_arith(expr, self.env)
                    .map_err(EvalError::Syntax)?
                    .to_string();
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
        if write_dynamic_variable(&resolved, &final_val, self.env) {
            return Ok(());
        }
        if is_existing_array {
            self.env.insert(format!("{resolved}[0]"), final_val.clone());
            sync_array_metadata(&resolved, self.env);
        }
        let is_optind = resolved == "OPTIND";
        if resolved == "OPTERR" {
            self.env.remove("__opterr_unset__");
        }
        if resolved == "PWD" {
            self.env.remove("__pwd_unset__");
        }
        if resolved == "PATH" {
            self.env.remove("__path_unset__");
        }
        self.env.insert(resolved, final_val);
        if is_optind {
            sync_getopts_env(self.env);
        }
        Ok(())
    }

    fn expand_array_literal_items(
        &mut self,
        inner: &str,
        is_assoc: bool,
    ) -> Result<Vec<(Option<String>, String, bool)>, EvalError> {
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
                && let Some((sub_k, sub_v, sub_append)) = rest
                    .split_once("]+=")
                    .map(|(k, v)| (k, v, true))
                    .or_else(|| rest.split_once("]=").map(|(k, v)| (k, v, false)))
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
                                out.push((None, f, false));
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
                out.push((Some(exp_k), exp_v, sub_append));
            } else {
                let fields = self.expand_word_to_fields(&tok)?;
                for f in fields {
                    out.push((None, f, false));
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
            let effective_line = simple.line + self.callback_line_offset;
            self.current_line = effective_line;
            self.env
                .insert("__lineno".to_string(), effective_line.to_string());
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
            let (saved_fds, saved_in, local_stdin, use_local, _dup_fd, redir_err) =
                self.setup_redirects(&simple.redirects, stdin)?;
            if let Some(err_out) = redir_err {
                self.restore_redirects(saved_fds, saved_in);
                return Ok(err_out);
            }
            if use_local {
                let mut exec_saved_in = Vec::new();
                self.materialize_stdin_aliases(stdin, &mut exec_saved_in);
                *stdin = local_stdin;
            }
            return Ok(BuiltinOutcome {
                stdout: debug_out.stdout,
                stderr: debug_out.stderr,
                exit_code: 0,
            });
        }

        let is_posix = self
            .env
            .get("__set_posix")
            .map(|v| v == "1")
            .unwrap_or(false);
        let is_special_head = is_posix
            && expanded_words.first().is_some_and(|w| {
                !self.functions.contains_key(w)
                    && matches!(
                        w.as_str(),
                        ":"
                            | "."
                            | "break"
                            | "continue"
                            | "eval"
                            | "exec"
                            | "exit"
                            | "export"
                            | "readonly"
                            | "return"
                            | "set"
                            | "shift"
                            | "times"
                            | "trap"
                            | "unset"
                    )
            });
        let has_inline_input = simple.redirects.iter().any(|r| {
            matches!(
                r.kind,
                RedirectKind::HereString(_) | RedirectKind::HereDoc { .. }
            )
        });
        let has_readonly_assign = simple.assignments.iter().any(|(k, _, _)| {
            let base_k = k.split('[').next().unwrap_or(k);
            let resolved = resolve_nameref_base(base_k, self.env);
            self.env
                .get(&format!("__attr__{resolved}"))
                .is_some_and(|a| a.contains('r'))
        });
        if !has_inline_input && (is_posix || expanded_words.is_empty()) && has_readonly_assign {
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
                            let code =
                                if is_posix && (is_special_head || expanded_words.is_empty()) {
                                    127
                                } else {
                                    1
                                };
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: debug_out.stdout,
                                stderr: format!("{}{prefix}{msg}\n", debug_out.stderr),
                                exit_code: code,
                            };
                            self.last_exit = code;
                            self.exit_requested = Some(code);
                            self.route_outcome(&mut err_out);
                            return Ok(err_out);
                        }
                        other => return Err(other),
                    }
                }
            }
        }

        if !expanded_words.is_empty()
            && !simple.assignments.is_empty()
            && has_inline_input
        {
            self.redirect_assignments.clear();
            for (k, v, append) in &simple.assignments {
                if !v.starts_with('(') && !k.contains('[') {
                    let rhs = self.expand_assignment_rhs(v)?;
                    let combined = if *append {
                        let cur = self
                            .redirect_assignments
                            .iter()
                            .rev()
                            .find_map(|(rk, rv)| if rk == k { Some(rv.clone()) } else { None })
                            .or_else(|| self.env.get(k).cloned())
                            .unwrap_or_default();
                        format!("{cur}{rhs}")
                    } else {
                        rhs
                    };
                    self.redirect_assignments.push((k.clone(), combined));
                }
            }
        }

        let (saved_fds, saved_in, mut local_stdin, use_local, dup_fd, redir_err) =
            match self.setup_redirects(&simple.redirects, stdin) {
                Ok(res) => {
                    self.redirect_assignments.clear();
                    res
                }
                Err(e) => {
                    self.redirect_assignments.clear();
                    return Err(e);
                }
            };
        if let Some(err_out) = redir_err {
            self.restore_redirects(saved_fds, saved_in);
            self.last_exit = err_out.exit_code;
            if is_special_head || (self.errexit && !self.in_condition) {
                self.exit_requested = Some(err_out.exit_code);
            }
            return Ok(err_out);
        }
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
                            let code = if is_posix { 127 } else { 1 };
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: debug_out.stdout,
                                stderr: format!("{}{prefix}{msg}\n", debug_out.stderr),
                                exit_code: code,
                            };
                            self.last_exit = code;
                            self.exit_requested = Some(code);
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
            let mut shortcut_out = debug_out.stdout;
            if self.in_cmdsub_file_shortcut && use_local {
                shortcut_out.push_str(&local_stdin);
                local_stdin.clear();
            }
            if let Some(dfd) = dup_fd {
                self.in_fds.insert(dfd, local_stdin);
            }
            let mut out = BuiltinOutcome {
                stdout: shortcut_out,
                stderr: debug_out.stderr,
                exit_code: self.last_exit,
            };
            self.route_outcome(&mut out);
            self.restore_redirects(saved_fds, saved_in);
            return Ok(out);
        }

        let mut temp_saved: Vec<(String, Option<String>, bool, Vec<(String, Option<String>)>)> =
            Vec::new();
        self.in_prefix_assignment = true;
        for (k, v, append) in &simple.assignments {
            let base_k = k.split('[').next().unwrap_or(k);
            let prev_val = self.env.get(base_k).cloned();
            let was_unexp = self.env.contains_key(&format!("__unexported__{base_k}"));
            let is_arr_lit = v.starts_with('(') && v.ends_with(')');
            let has_existing_arr = self.env.contains_key(&format!("__keys__{base_k}"))
                || self.env.contains_key(&format!("__assoc__{base_k}"));
            let extra_prev: Vec<(String, Option<String>)> =
                if is_arr_lit || k.contains('[') || has_existing_arr {
                let mut extras = vec![
                    (
                        format!("__keys__{base_k}"),
                        self.env.get(&format!("__keys__{base_k}")).cloned(),
                    ),
                    (
                        format!("__assoc__{base_k}"),
                        self.env.get(&format!("__assoc__{base_k}")).cloned(),
                    ),
                ];
                let prefix = format!("{base_k}[");
                for (ek, ev) in self.env.iter() {
                    if ek.starts_with(&prefix) {
                        extras.push((ek.clone(), Some(ev.clone())));
                    }
                }
                extras
            } else {
                Vec::new()
            };
            let val = if is_arr_lit {
                format!("\x00__ARRAY_LITERAL__{v}")
            } else {
                self.expand_assignment_rhs(v)?
            };
            if has_existing_arr && !is_arr_lit && !k.contains('[') {
                self.env.remove(&format!("__keys__{base_k}"));
                self.env.remove(&format!("__assoc__{base_k}"));
                let prefix = format!("{base_k}[");
                let to_remove: Vec<String> = self
                    .env
                    .keys()
                    .filter(|ek| ek.starts_with(&prefix))
                    .cloned()
                    .collect();
                for rk in to_remove {
                    self.env.remove(&rk);
                }
            }
            match self.assign_variable(k, &val, *append) {
                Ok(()) => {
                    temp_saved.push((base_k.to_string(), prev_val, was_unexp, extra_prev));
                }
                Err(EvalError::Syntax(msg)) if msg.contains("readonly variable") => {
                    let prefix = self.diag_prefix();
                    if is_posix {
                        let code = if is_special_head { 127 } else { 1 };
                        self.in_prefix_assignment = false;
                        let mut err_out = BuiltinOutcome {
                            stdout: debug_out.stdout,
                            stderr: format!("{}{prefix}{msg}\n", debug_out.stderr),
                            exit_code: code,
                        };
                        self.last_exit = code;
                        self.exit_requested = Some(code);
                        self.route_outcome(&mut err_out);
                        self.restore_redirects(saved_fds, saved_in);
                        return Ok(err_out);
                    }
                    debug_out.stderr.push_str(&format!("{prefix}{msg}\n"));
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

        let stashed_outer_stdin = if use_local
            && !self.in_fds.contains_key(&STDIN_STREAM_FD)
            && self
                .in_fd_aliases
                .values()
                .any(|&v| v == STDIN_STREAM_FD)
        {
            self.in_fds.insert(STDIN_STREAM_FD, std::mem::take(stdin));
            true
        } else {
            false
        };
        let eff_stdin = if use_local { &mut local_stdin } else { &mut *stdin };
        let body_stdio = self.enter_body_stdio();
        self.retained_prefix_vars.clear();
        let dispatch_res = self.dispatch_words(&expanded_words, eff_stdin, false);
        self.leave_body_stdio(body_stdio);
        if stashed_outer_stdin {
            *stdin = self.in_fds.remove(&STDIN_STREAM_FD).unwrap_or_default();
        }
        let mut out = dispatch_res?;
        if !debug_out.stdout.is_empty() || !debug_out.stderr.is_empty() {
            out.stdout = format!("{}{}", debug_out.stdout, out.stdout);
            out.stderr = format!("{}{}", debug_out.stderr, out.stderr);
        }

        let keep_prefix_assigns = is_special_head;
        if !keep_prefix_assigns {
            for (k, prev, was_unexp, extra_prev) in temp_saved.into_iter().rev() {
                if self.retained_prefix_vars.iter().any(|rv| rv == &k) {
                    continue;
                }
                if !extra_prev.is_empty() {
                    let prefix = format!("{k}[");
                    let to_remove: Vec<String> = self
                        .env
                        .keys()
                        .filter(|ek| ek.starts_with(&prefix))
                        .cloned()
                        .collect();
                    for rk in to_remove {
                        self.env.remove(&rk);
                    }
                    for (ek, ev) in extra_prev {
                        match ev {
                            Some(v) => {
                                self.env.insert(ek, v);
                            }
                            None => {
                                self.env.remove(&ek);
                            }
                        }
                    }
                }
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
            let prev_loop_depth = self.loop_depth;
            let prev_args = std::mem::replace(&mut self.pos_args, args.to_vec());
            let prev_pos_ver = self.pos_args_version;
            let caller_frame = self.capture_caller_frame(cmd);
            self.caller_frames.insert(0, caller_frame);
            self.func_stack.insert(0, cmd.to_string());
            self.sync_funcname();
            self.local_scopes.push(BTreeMap::new());
            let func_src = self.env.get(&format!("__func_src__{cmd}")).cloned();
            let prev_script_name = std::mem::replace(&mut self.script_name, func_src);
            let prev_func_line = self.current_line;
            let prev_cb_offset = std::mem::replace(&mut self.callback_line_offset, 0);
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
            sync_getopts_env(self.env);
            let mut out = res;
            if let Ok(ref mut o) = out
                && self.exit_requested.is_some()
                && !self.explicit_exit
            {
                self.run_exit_trap_if_needed(o);
            }
            self.loop_depth = prev_loop_depth;
            self.pos_args = prev_args;
            self.pos_args_version = prev_pos_ver;
            if !self.caller_frames.is_empty() {
                self.caller_frames.remove(0);
            }
            if !self.func_stack.is_empty() {
                self.func_stack.remove(0);
            }
            self.script_name = prev_script_name;
            self.current_line = prev_func_line;
            self.callback_line_offset = prev_cb_offset;
            self.env
                .insert("__lineno".to_string(), prev_func_line.to_string());
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
                let out = self.builtin_declare(cmd, args)?;
                if out.exit_code != 0
                    && !bypass_functions
                    && self.env.get("__set_posix").is_some_and(|v| v == "1")
                    && matches!(cmd.as_str(), "export" | "readonly")
                {
                    self.exit_requested = Some(out.exit_code);
                }
                return Ok(out);
            }
            "unset" => {
                let out = self.builtin_unset(args);
                if out.exit_code != 0
                    && !bypass_functions
                    && self.env.get("__set_posix").is_some_and(|v| v == "1")
                {
                    self.exit_requested = Some(out.exit_code);
                }
                return Ok(out);
            }
            "read" => {
                return self.builtin_read(args, stdin);
            }
            "mapfile" | "readarray" => {
                return self.builtin_mapfile(cmd, args, stdin);
            }
            "getopts" => {
                return Ok(self.builtin_getopts(args));
            }
            "let" => {
                if args.first().map(|s| s.as_str()) == Some("--help") {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "let: --help: unsupported option\n".to_string(),
                        exit_code: 2,
                    });
                }
                let offset = if args.first().map(|s| s.as_str()) == Some("--") {
                    1
                } else {
                    0
                };
                if args.len() == offset {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "let: expression expected\n".to_string(),
                        exit_code: 1,
                    });
                }
                let mut last = 0i64;
                for arg in &args[offset..] {
                    let expr_str = if arg.contains('$') || arg.contains('`') {
                        self.expand_heredoc_text(arg)?
                    } else {
                        arg.clone()
                    };
                    match eval_arith(&expr_str, self.env) {
                        Ok(v) => last = v,
                        Err(e) => {
                            if let Some(nu) = e.strip_prefix("__nounset__") {
                                return Err(EvalError::Syntax(nu.to_string()));
                            }
                            self.env.insert("__arith_diag".to_string(), "1".to_string());
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("let: {e}\n"),
                                exit_code: 1,
                            });
                        }
                    }
                }
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: if last == 0 { 1 } else { 0 },
                });
            }
            "eval" => {
                let is_special = !bypass_functions
                    && self.env.get("__set_posix").is_some_and(|v| v == "1");
                let eval_args = if args.first().map(|s| s.as_str()) == Some("--") {
                    &args[1..]
                } else if let Some(first) = args.first()
                    && first.starts_with('-')
                    && first != "-"
                {
                    let flag = first.chars().nth(1).unwrap_or('-');
                    if is_special {
                        self.exit_requested = Some(2);
                    }
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!(
                            "{}eval: -{flag}: invalid option\neval: usage: eval [arg ...]\n",
                            self.diag_prefix()
                        ),
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
                self.budget
                    .enter_substitution()
                    .map_err(EvalError::Budget)?;
                let joined = eval_args.join(" ");
                if let Err(e) = self.budget.add_source_bytes(joined.len()) {
                    self.budget.leave_substitution();
                    return Err(EvalError::Budget(e));
                }
                if joined.bytes().any(|b| {
                    (b <= 0x08) || b == 0x0b || b == 0x0c || (0x0e..=0x1f).contains(&b) || b == 0x7f
                }) {
                    self.budget.leave_substitution();
                    let code = if is_special {
                        self.exit_requested = Some(1);
                        1
                    } else {
                        126
                    };
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{}eval: cannot execute binary script\n", self.diag_prefix()),
                        exit_code: code,
                    });
                }
                let eval_syntax_name = format!(
                    "{}: eval",
                    self.script_name.as_deref().unwrap_or("shell")
                );
                let prev_line = self.current_line;
                let eval_diag_offset = prev_line.saturating_sub(1);
                let prev_cb_offset =
                    std::mem::replace(&mut self.callback_line_offset, eval_diag_offset);
                self.syntax_contexts
                    .push((eval_syntax_name.clone(), eval_diag_offset, true));
                let out = self.eval_script_units(&joined, stdin);
                self.syntax_contexts.pop();
                self.callback_line_offset = prev_cb_offset;
                self.current_line = prev_line;
                self.env
                    .insert("__lineno".to_string(), prev_line.to_string());
                self.budget.leave_substitution();
                self.env.insert(
                    "__last_arg".to_string(),
                    args.last().unwrap_or(cmd).clone(),
                );
                return match out {
                    Ok(o) => Ok(o),
                    Err(EvalError::Syntax(msg))
                        if !msg.starts_with("__nounset__")
                            && !msg.starts_with("__param_err__") =>
                    {
                        if is_special {
                            self.exit_requested = Some(2);
                        }
                        Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format_syntax_diagnostic(
                                &eval_syntax_name,
                                eval_diag_offset,
                                &joined,
                                &msg,
                                true,
                            ),
                            exit_code: 2,
                        })
                    }
                    Err(e) => Err(e),
                };
            }
            "source" | "." => {
                let is_posix = self.env.get("__set_posix").is_some_and(|v| v == "1");
                let is_special = !bypass_functions && is_posix && cmd == ".";
                let src_args = if args.first().map(|s| s.as_str()) == Some("--") {
                    &args[1..]
                } else if let Some(first) = args.first()
                    && first.starts_with('-')
                    && first != "-"
                {
                    if is_special {
                        self.exit_requested = Some(2);
                    }
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{}{cmd}: {first}: unsupported option\n", self.diag_prefix()),
                        exit_code: 2,
                    });
                } else {
                    args
                };
                let Some(target) = src_args.first() else {
                    if is_special {
                        self.exit_requested = Some(2);
                    }
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!(
                            "{}{cmd}: filename argument required\n{cmd}: usage: {cmd} [-p path] filename [arguments]\n",
                            self.diag_prefix()
                        ),
                        exit_code: 2,
                    });
                };
                self.budget
                    .enter_substitution()
                    .map_err(EvalError::Budget)?;
                {
                    if target.is_empty() {
                        self.budget.leave_substitution();
                        if is_special {
                            self.exit_requested = Some(1);
                        }
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{}: No such file or directory\n", self.diag_prefix()),
                            exit_code: 1,
                        });
                    }
                    let mut effective_target = target.clone();
                    if !target.contains('/')
                        && let Some(path_env) = self
                            .env
                            .get("PATH")
                            .filter(|p| !p.is_empty())
                            .cloned()
                    {
                        let mut found = false;
                        for seg in path_env.split(':') {
                            let dir = if seg.is_empty() { "." } else { seg };
                            let cand = if dir.ends_with('/') {
                                format!("{dir}{target}")
                            } else {
                                format!("{dir}/{target}")
                            };
                            let full_cand = resolve_posix_path(self.cwd, &cand);
                            if let Ok(meta) = self.fs.stat(&full_cand)
                                && meta.kind == crate::vfs::VfsEntryKind::File
                                && (meta.mode & 0o444) != 0
                            {
                                effective_target = cand;
                                found = true;
                                break;
                            }
                        }
                        if !found && is_posix {
                            self.budget.leave_substitution();
                            if is_special {
                                self.exit_requested = Some(1);
                            }
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!(
                                    "{}{cmd}: {target}: file not found\n",
                                    self.diag_prefix()
                                ),
                                exit_code: 1,
                            });
                        }
                    }
                    let full = resolve_posix_path(self.cwd, &effective_target);
                    if self.fs.is_dir(&full) {
                        self.budget.leave_substitution();
                        if is_special {
                            self.exit_requested = Some(1);
                        }
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!(
                                "{}{cmd}: {effective_target}: is a directory\n",
                                self.diag_prefix()
                            ),
                            exit_code: 1,
                        });
                    }
                    if let Ok(meta) = self.fs.stat(&full)
                        && (meta.mode & 0o444) == 0
                    {
                        self.budget.leave_substitution();
                        if is_special {
                            self.exit_requested = Some(1);
                        }
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!(
                                "{}{effective_target}: Permission denied\n",
                                self.diag_prefix()
                            ),
                            exit_code: 1,
                        });
                    }
                    let read_res = self.fs.read_file(&full).or_else(|e| {
                        if let Some(fd_str) = full
                            .strip_prefix("/dev/fd/")
                            .or_else(|| full.strip_prefix("/proc/self/fd/"))
                            && let Ok(fd) = fd_str.parse::<u32>()
                        {
                            let canon = self.resolve_in_fd(fd);
                            if let Some(buf) = self.in_fds.get(&canon) {
                                return Ok(stream_string_to_bytes(buf));
                            }
                        }
                        Err(e)
                    });
                    match read_res {
                        Ok(bytes) => {
                            if let Err(e) = self.budget.add_source_bytes(bytes.len()) {
                                self.budget.leave_substitution();
                                return Err(EvalError::Budget(e));
                            }
                            if bytes.iter().any(|&b| {
                                b < 9 || (b > 10 && b < 13) || (b > 13 && b < 32) || b == 127
                            }) {
                                self.budget.leave_substitution();
                                let code = if is_special {
                                    self.exit_requested = Some(1);
                                    1
                                } else {
                                    126
                                };
                                return Ok(BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!(
                                        "{}{effective_target}: cannot execute binary script\n",
                                        self.diag_prefix()
                                    ),
                                    exit_code: code,
                                });
                            }
                            let script_str = String::from_utf8_lossy(&bytes);
                            let saved_pos_ver = self.pos_args_version;
                            let saved_args = if src_args.len() > 1 {
                                Some(std::mem::replace(&mut self.pos_args, src_args[1..].to_vec()))
                            } else {
                                None
                            };
                            let caller_frame = self.capture_caller_frame("source");
                            self.caller_frames.insert(0, caller_frame);
                            let prev_script_name =
                                self.script_name.replace(effective_target.clone());
                            let prev_line = self.current_line;
                            let prev_cb_offset =
                                std::mem::replace(&mut self.callback_line_offset, 0);
                            self.current_line = 1;
                            self.env.insert("__lineno".to_string(), "1".to_string());
                            self.source_depth += 1;
                            self.source_debug_snapshots.push((
                                self.traps.get("DEBUG").cloned(),
                                self.trap_versions.get("DEBUG").copied(),
                            ));
                            self.syntax_contexts
                                .push((effective_target.clone(), 0, true));
                            let eval_res = self.eval_script_units(&script_str, stdin);
                            self.syntax_contexts.pop();
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
                            self.callback_line_offset = prev_cb_offset;
                            self.env.insert("__lineno".to_string(), prev_line.to_string());
                            self.script_name = prev_script_name;
                            if !self.caller_frames.is_empty() {
                                self.caller_frames.remove(0);
                            }
                            self.budget.leave_substitution();
                            let mut out = match eval_res {
                                Ok(o) => o,
                                Err(EvalError::Syntax(msg))
                                    if !msg.starts_with("__nounset__")
                                        && !msg.starts_with("__param_err__") =>
                                {
                                    if let Some(prev) = saved_args
                                        && (!self.func_stack.is_empty()
                                            || self.pos_args_version == saved_pos_ver)
                                    {
                                        self.pos_args = prev;
                                        self.pos_args_version = saved_pos_ver;
                                    }
                                    if is_special {
                                        self.exit_requested = Some(2);
                                    }
                                    self.env.insert(
                                        "__last_arg".to_string(),
                                        args.last().unwrap_or(cmd).clone(),
                                    );
                                    return Ok(BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format_syntax_diagnostic(
                                            &effective_target,
                                            0,
                                            &script_str,
                                            &msg,
                                            true,
                                        ),
                                        exit_code: 2,
                                    });
                                }
                                Err(e) => {
                                    if let Some(prev) = saved_args
                                        && (!self.func_stack.is_empty()
                                            || self.pos_args_version == saved_pos_ver)
                                    {
                                        self.pos_args = prev;
                                        self.pos_args_version = saved_pos_ver;
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
                            if let Some(prev) = saved_args
                                && (!self.func_stack.is_empty()
                                    || self.pos_args_version == saved_pos_ver)
                            {
                                self.pos_args = prev;
                                self.pos_args_version = saved_pos_ver;
                            }
                            self.env.insert(
                                "__last_arg".to_string(),
                                args.last().unwrap_or(cmd).clone(),
                            );
                            return Ok(out);
                        }
                        Err(_) => {
                            self.budget.leave_substitution();
                            if is_special {
                                self.exit_requested = Some(1);
                            }
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!(
                                    "{}{effective_target}: No such file or directory\n",
                                    self.diag_prefix()
                                ),
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
                    self.env.insert("0".to_string(), a0.clone());
                    self.env.insert("__argv0".to_string(), a0);
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
                self.budget.tick_command().map_err(EvalError::Budget)?;
                self.budget
                    .enter_substitution()
                    .map_err(EvalError::Budget)?;
                if let Some(b_out) =
                    try_run_builtin(target, &args[idx + 1..], stdin, self.cwd, self.env, self.fs)
                {
                    self.budget.leave_substitution();
                    return Ok(b_out);
                }
                let res = self.dispatch_words(&args[idx..], stdin, true);
                self.budget.leave_substitution();
                return res;
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
                                let prefix = self.diag_prefix();
                                return Ok(BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!(
                                        "{prefix}command: -{ch}: invalid option\ncommand: usage: command [-pVv] command [arg ...]\n"
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
                if default_path {
                    self.env
                        .insert("__command_default_path__".to_string(), "1".to_string());
                }
                self.budget.tick_command().map_err(EvalError::Budget)?;
                self.budget
                    .enter_substitution()
                    .map_err(EvalError::Budget)?;
                let res = self.dispatch_words(&args[idx..], stdin, true);
                self.budget.leave_substitution();
                self.env.remove("__command_default_path__");
                return res;
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
            _ => {}
        }

        let default_path = self.env.remove("__command_default_path__").is_some();
        let custom_argv0 = self.env.remove("__argv0");
        let virtual_name = if cmd.contains('/') {
            self.virtual_executable_name(&resolve_posix_path(self.cwd, cmd))
        } else {
            None
        };
        let effective_cmd = virtual_name.as_deref().unwrap_or(cmd.as_str());

        if virtual_name.is_some() {
            match effective_cmd {
                "true" => {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 0,
                    });
                }
                "false" => {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 1,
                    });
                }
                "pwd" => {
                    return self.dispatch_words(
                        &std::iter::once("pwd".to_string())
                            .chain(args.iter().cloned())
                            .collect::<Vec<_>>(),
                        stdin,
                        true,
                    );
                }
                "kill" => {
                    return Ok(self.builtin_kill(args));
                }
                _ => {}
            }
        }

        if let Some(custom) = self.custom_commands.get(effective_cmd) {
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

        if let Some(b_out) =
            try_run_builtin(effective_cmd, args, stdin, self.cwd, self.env, self.fs)
        {
            return Ok(b_out);
        }

        if matches!(effective_cmd, "bash" | "sh" | "zsh") {
            let argv0_override = custom_argv0.or_else(|| {
                if virtual_name.is_some() {
                    Some(cmd.clone())
                } else {
                    None
                }
            });
            return self.run_sub_shell_command(effective_cmd, argv0_override.as_deref(), args, stdin);
        }

        let fs_ref = self.fs;
        let budget_ref = self.budget;
        let custom_ref = self.custom_commands;
        let funcs_clone = self.functions.clone();
        let exported_clone = self.exported_functions.clone();
        let allow_fallback = self.allow_unported_fallback;
        let mut sub_err: Option<EvalError> = None;

        if let Some(c_out) = try_run_command(
            effective_cmd,
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
                    in_fd_aliases: BTreeMap::new(),
                    rw_offsets: BTreeMap::new(),
                    rw_last_rem: BTreeMap::new(),
                    mapfile_callback_depth: 0,
                    callback_line_offset: 0,
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
                    pos_args_version: 0,
                    syntax_contexts: Vec::new(),
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
                    in_cmdsub_file_shortcut: false,
                    async_default_stdin: false,
                    redirect_assignments: Vec::new(),
                    procsub_seq: 0,
                    cmdsub_seq: 0,
                    in_prefix_assignment: false,
                    retained_prefix_vars: Vec::new(),
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
                if let Err(e) = sub_eval.budget.enter_substitution() {
                    sub_err = Some(EvalError::Budget(e));
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 1,
                    };
                }
                if let Err(e) = sub_eval.budget.tick_command() {
                    sub_eval.budget.leave_substitution();
                    sub_err = Some(EvalError::Budget(e));
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 1,
                    };
                }
                let mut sub_in = sub_stdin.to_string();
                let res = sub_eval.dispatch_words(sub_words, &mut sub_in, false);
                sub_eval.budget.leave_substitution();
                let mut out = match res {
                    Ok(o) => o,
                    Err(e) => {
                        sub_err = Some(e);
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: String::new(),
                            exit_code: 1,
                        };
                    }
                };
                if out.exit_code == 127
                    && let Some(stripped) = out.stderr.strip_prefix("shell: line 1: ")
                {
                    out.stderr = stripped.to_string();
                }
                out
            },
        ) {
            if let Some(e) = sub_err {
                return Err(e);
            }
            if effective_cmd == "cat"
                && (args.iter().all(|a| a.starts_with('-') && a != "-")
                    || args.iter().any(|a| a == "-"))
            {
                stdin.clear();
            }
            return Ok(c_out);
        }

        if cmd.contains('/')
            || (!default_path
                && !self.env.contains_key("PATH")
                && self.env.contains_key("__path_unset__"))
        {
            return self.run_vfs_script(
                cmd,
                args,
                stdin,
                true,
                false,
                None,
                false,
                false,
                false,
                false,
                false,
                false,
                cmd,
                None,
            );
        }

        match self.search_command_path(cmd, default_path) {
            Err(denied) => return Ok(denied),
            Ok(Some(target)) => {
                return self.run_vfs_script(
                    &target,
                    args,
                    stdin,
                    true,
                    false,
                    None,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    cmd,
                    None,
                );
            }
            Ok(None) => {}
        }

        if self.allow_unported_fallback {
            return Err(EvalError::UnportedCommand(cmd.clone()));
        }

        let displayed = format_diagnostic_command_name(cmd, is_select_byte_locale(self.env));
        Ok(BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("{}{displayed}: command not found\n", self.diag_prefix()),
            exit_code: 127,
        })
    }

    fn search_command_path(
        &self,
        name: &str,
        default_path: bool,
    ) -> Result<Option<String>, BuiltinOutcome> {
        if name.is_empty() {
            return Ok(None);
        }
        let path_opt = if default_path {
            Some("/bin:/usr/bin")
        } else {
            effective_path_env(self.env)
        };
        let mut denied: Option<BuiltinOutcome> = None;
        for target in path_targets(path_opt, name) {
            let resolved = resolve_posix_path(self.cwd, &target);
            if self.is_virtual_executable_path(&resolved) {
                return Ok(Some(target));
            }
            if let Ok(st) = self.fs.stat(&resolved) {
                if st.kind != crate::vfs::VfsEntryKind::File {
                    continue;
                }
                if (st.mode & 0o111) != 0 {
                    return Ok(Some(target));
                }
                if denied.is_none() {
                    denied = Some(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{}{target}: Permission denied\n", self.diag_prefix()),
                        exit_code: 126,
                    });
                }
            }
        }
        if let Some(d) = denied {
            return Err(d);
        }
        Ok(None)
    }

    fn resolve_vfs_executable(&self, cmd: &str) -> Option<String> {
        if let Some(hashed) = self.env.get(&format!("__hash__{cmd}")) {
            let resolved = resolve_posix_path(self.cwd, hashed);
            if let Ok(st) = self.fs.stat(&resolved)
                && st.kind == crate::vfs::VfsEntryKind::File
                && (st.mode & 0o111) != 0
            {
                return Some(hashed.clone());
            }
        }
        self.search_command_path(cmd, false).ok().flatten()
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

    fn virtual_executable_name(&self, resolved_path: &str) -> Option<String> {
        if resolved_path.ends_with('/')
            || resolved_path.ends_with("/.")
            || resolved_path.ends_with("/..")
        {
            return None;
        }
        let norm = resolve_posix_path("/", resolved_path);
        let Some(slash) = norm.rfind('/') else {
            return None;
        };
        let dir = &norm[..slash];
        let name = &norm[slash + 1..];
        if matches!(name, "zsh" | "bash" | "sh") && matches!(dir, "/bin" | "/usr/bin" | "/tmp") {
            return Some(name.to_string());
        }
        if dir != "/bin" && dir != "/usr/bin" {
            return None;
        }
        if self.is_registered_command_name(name)
            || matches!(name, "true" | "false" | "pwd" | "kill" | "bash" | "sh" | "zsh")
        {
            Some(name.to_string())
        } else {
            None
        }
    }

    fn is_virtual_executable_path(&self, resolved_path: &str) -> bool {
        self.virtual_executable_name(resolved_path).is_some()
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
        let path_opt = if default_path {
            Some("/bin:/usr/bin")
        } else {
            effective_path_env(self.env)
        };
        for target in path_targets(path_opt, name) {
            let resolved = resolve_posix_path(self.cwd, &target);
            if self.is_virtual_executable_path(&resolved) {
                matches.push(target);
                if !show_all {
                    break;
                }
                continue;
            }
            if let Ok(st) = self.fs.stat(&resolved)
                && st.kind == crate::vfs::VfsEntryKind::File
                && (st.mode & 0o111) != 0
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
                let is_posix = self
                    .env
                    .get("__set_posix")
                    .map(|v| v == "1")
                    .unwrap_or(false);
                let absolute = is_command && mode == "describe";
                for mut path in self.search_discovery_paths(name, show_all, default_path) {
                    if (absolute || is_posix)
                        && !name.contains('/')
                        && !path.starts_with('/')
                    {
                        let rel = if absolute {
                            path.strip_prefix("./").unwrap_or(&path)
                        } else {
                            path.as_str()
                        };
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
                    stderr.push_str(&format!("{}{invoked}: {name}: not found\n", self.diag_prefix()));
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

    fn build_child_process_env(&self, sub_cwd: &str, arg0: &str) -> BTreeMap<String, String> {
        let mut sub_env = BTreeMap::new();
        for (k, v) in self.env.iter() {
            if k == "__umask"
                || k.starts_with("__trap_inherited_ignored__")
                || k == "__epoch_realtime_sec"
            {
                sub_env.insert(k.clone(), v.clone());
            } else if !k.starts_with("__")
                && !k.contains('[')
                && k != "0"
                && !self.env.contains_key(&format!("__unexported__{k}"))
                && !self.env.contains_key(&format!("__keys__{k}"))
                && !self.env.contains_key(&format!("__assoc__{k}"))
                && !matches!(
                    k.as_str(),
                    "PIPESTATUS"
                        | "BASH_REMATCH"
                        | "DIRSTACK"
                        | "FUNCNAME"
                        | "BASH_SOURCE"
                        | "BASH_LINENO"
                        | "BASH_SUBSHELL"
                        | "BASH_COMMAND"
                )
            {
                sub_env.insert(k.clone(), v.clone());
                sub_env.insert(format!("__attr__{k}"), "x".to_string());
            }
        }
        for (k, v) in &self.traps {
            if v.is_empty() && !matches!(k.as_str(), "EXIT" | "ERR" | "DEBUG" | "RETURN") {
                sub_env.insert(format!("__trap_inherited_ignored__{k}"), "1".to_string());
            }
        }
        sub_env.insert("PWD".to_string(), sub_cwd.to_string());
        sub_env.insert("__attr__PWD".to_string(), "x".to_string());
        sub_env.insert("OPTIND".to_string(), "1".to_string());
        sub_env.insert("__unexported__OPTIND".to_string(), "1".to_string());
        sub_env.remove("__attr__OPTIND");
        sub_env.insert("__getopts_index".to_string(), "0".to_string());
        sub_env.insert("OPTERR".to_string(), "1".to_string());
        sub_env.insert("__unexported__OPTERR".to_string(), "1".to_string());
        sub_env.remove("__attr__OPTERR");
        sub_env.insert("0".to_string(), arg0.to_string());
        sub_env
    }

    fn run_sub_shell_command(
        &mut self,
        invoked_cmd: &str,
        argv0_override: Option<&str>,
        args: &[String],
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        let mut idx = 0usize;
        let mut allexport = false;
        let mut errexit = false;
        let mut noclobber = false;
        let mut nounset = false;
        let mut pipefail = false;
        let mut noexec = false;
        let mut noglob = false;
        let mut braceexpand: Option<bool> = None;
        let mut command_string = false;
        let mut standard_input = false;

        let loaded_source = self
            .env
            .remove("__shebang_loaded_path")
            .and_then(|p| self.env.remove("__shebang_loaded_source").map(|s| (p, s)));

        while idx < args.len() {
            let a = &args[idx];
            if !a.starts_with('-') && !a.starts_with('+') {
                break;
            }
            idx += 1;
            if a == "--" || a == "-" {
                break;
            }
            if a == "--version" {
                return Ok(BuiltinOutcome {
                    stdout: "safe-bash (poe-code)\n".to_string(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            if matches!(a.as_str(), "--login" | "--norc" | "--noprofile" | "--posix") {
                continue;
            }
            let on = a.starts_with('-');
            if (a == "-o" || a == "+o")
                && let Some(opt_name) = args.get(idx)
                && matches!(
                    opt_name.as_str(),
                    "allexport"
                        | "braceexpand"
                        | "errexit"
                        | "noclobber"
                        | "noexec"
                        | "noglob"
                        | "nounset"
                        | "pipefail"
                )
            {
                match opt_name.as_str() {
                    "allexport" => allexport = on,
                    "braceexpand" => braceexpand = Some(on),
                    "errexit" => errexit = on,
                    "noclobber" => noclobber = on,
                    "noexec" => noexec = on,
                    "noglob" => noglob = on,
                    "nounset" => nounset = on,
                    "pipefail" => pipefail = on,
                    _ => {}
                }
                idx += 1;
                continue;
            }
            let flags = &a[1..];
            let valid_flags = !flags.is_empty()
                && flags.chars().all(|ch| {
                    matches!(ch, 'a' | 'B' | 'e' | 'C' | 'n' | 'f' | 'u')
                        || (on && matches!(ch, 'c' | 's' | 'l' | 'i'))
                });
            if !valid_flags {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!(
                        "{invoked_cmd}: {a}: unsupported option; supported flags are -c, -s, +/-a, +/-e, +/-u, +/-n, +/-B, +/-f, +/-C and +/-o allexport, braceexpand, errexit, noclobber, noexec, noglob, nounset, pipefail\n"
                    ),
                    exit_code: 2,
                });
            }
            for ch in flags.chars() {
                match ch {
                    'c' => command_string = true,
                    's' => standard_input = true,
                    'a' => allexport = on,
                    'B' => braceexpand = Some(on),
                    'e' => errexit = on,
                    'C' => noclobber = on,
                    'n' => noexec = on,
                    'f' => noglob = on,
                    'u' => nounset = on,
                    _ => {}
                }
            }
        }

        if !command_string && !standard_input && idx < args.len() {
            let file_arg = &args[idx];
            let file_args = &args[idx + 1..];
            return self.run_vfs_script(
                file_arg,
                file_args,
                stdin,
                false,
                errexit,
                braceexpand,
                noexec,
                nounset,
                pipefail,
                allexport,
                noclobber,
                noglob,
                invoked_cmd,
                loaded_source,
            );
        }

        let script_source = if command_string {
            let Some(cs) = args.get(idx).cloned() else {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{invoked_cmd}: -c: option requires an argument\n"),
                    exit_code: 2,
                });
            };
            idx += 1;
            Some(cs)
        } else {
            None
        };

        let arg0 = if command_string && idx < args.len() {
            let a0 = args[idx].clone();
            idx += 1;
            a0
        } else {
            argv0_override.unwrap_or(invoked_cmd).to_string()
        };

        if noexec && let Some(ref cs) = script_source {
            return match validate_basic_syntax(cs) {
                Ok(()) => Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                }),
                Err(e) => Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format_syntax_diagnostic(&format!("{arg0}: -c"), 0, cs, &e, true),
                    exit_code: 2,
                }),
            };
        }

        let mut sub_cwd = self.cwd.clone();
        let mut sub_env = self.build_child_process_env(&sub_cwd, &arg0);
        if invoked_cmd == "sh" {
            sub_env.insert("__set_posix".to_string(), "1".to_string());
        }
        self.budget
            .enter_substitution()
            .map_err(EvalError::Budget)?;
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
        sub.env.remove("!");
        let parent_job_keys: Vec<String> = sub
            .env
            .keys()
            .filter(|k| k.starts_with("__parent_job_"))
            .cloned()
            .collect();
        for k in parent_job_keys {
            sub.env.remove(&k);
        }
        sub.apply_set_option("allexport", allexport);
        sub.apply_set_option("braceexpand", braceexpand.unwrap_or(true));
        sub.apply_set_option("errexit", errexit);
        sub.apply_set_option("noclobber", noclobber);
        sub.apply_set_option("noexec", noexec);
        sub.apply_set_option("noglob", noglob);
        sub.apply_set_option("nounset", nounset);
        sub.apply_set_option("pipefail", pipefail);
        sub.in_condition = false;
        sub.script_name = Some(arg0.clone());
        sub.current_line = 1;
        if command_string {
            sub.syntax_contexts.push((format!("{arg0}: -c"), 0, true));
        }
        sub.pos_args = args[idx..].to_vec();
        sub.functions = self
            .functions
            .iter()
            .filter(|(k, _)| self.exported_functions.contains(*k))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        if let Some(cs) = script_source {
            if let Err(e) = sub.budget.add_source_bytes(cs.len()) {
                self.budget.leave_substitution();
                return Err(EvalError::Budget(e));
            }
            let res = sub.eval_script_units(&cs, stdin);
            self.budget.leave_substitution();
            match res {
                Ok(mut out) => {
                    out.exit_code = sub.exit_requested.unwrap_or(out.exit_code);
                    sub.last_exit = out.exit_code;
                    sub.run_exit_trap_if_needed(&mut out);
                    out.exit_code = sub.exit_requested.unwrap_or(out.exit_code);
                    Ok(out)
                }
                Err(EvalError::Syntax(msg)) => {
                    let mut out = BuiltinOutcome {
                        stdout: String::new(),
                        stderr: sub.format_active_syntax_diagnostic(&cs, &msg),
                        exit_code: 2,
                    };
                    sub.last_exit = 2;
                    sub.exit_requested = Some(2);
                    sub.run_exit_trap_if_needed(&mut out);
                    Ok(out)
                }
                Err(other) => Err(other),
            }
        } else {
            let res = sub.eval_stdin_stream(stdin, &arg0);
            self.budget.leave_substitution();
            res
        }
    }

    fn eval_stdin_stream(
        &mut self,
        stdin: &mut String,
        arg0: &str,
    ) -> Result<BuiltinOutcome, EvalError> {
        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut last_code = 0;
        let mut unit_buf = String::new();
        let mut unit_start_line = 0usize;
        let mut total_parse_units = 0usize;

        loop {
            let (line_bytes, eof) = if stdin.is_empty() {
                (Vec::new(), true)
            } else {
                let raw_bytes = stream_string_to_bytes(stdin);
                let take_len = match raw_bytes.iter().position(|&b| b == b'\n') {
                    Some(nl) => nl + 1,
                    None => raw_bytes.len(),
                };
                let taken = raw_bytes[..take_len].to_vec();
                *stdin = bytes_to_stream_string(&raw_bytes[take_len..]);
                (taken, false)
            };

            if !line_bytes.is_empty() {
                self.budget
                    .add_source_bytes(line_bytes.len())
                    .map_err(EvalError::Budget)?;
                let decoded = match Self::decode_script_bytes(&line_bytes, arg0) {
                    Ok(s) => s,
                    Err(mut err_out) => {
                        let line_no = unit_start_line + unit_buf.matches('\n').count() + 1;
                        err_out.stdout = stdout;
                        err_out.stderr =
                            format!("{stderr}{arg0}: line {line_no}: {}", err_out.stderr);
                        self.last_exit = err_out.exit_code;
                        self.exit_requested = Some(err_out.exit_code);
                        self.run_exit_trap_if_needed(&mut err_out);
                        return Ok(err_out);
                    }
                };
                unit_buf.push_str(&decoded);
            }

            if !eof && is_incomplete_shell_unit(&unit_buf, &self.active_alias_map()) {
                continue;
            }

            if !unit_buf.is_empty() {
                let ast = match self.parse_with_current_aliases(&unit_buf, unit_start_line) {
                    Ok(a) => a,
                    Err(syn_err) => {
                        stderr.push_str(&format_syntax_diagnostic(
                            arg0,
                            unit_start_line,
                            &unit_buf,
                            &syn_err,
                            true,
                        ));
                        self.last_exit = 2;
                        self.exit_requested = Some(2);
                        let mut out = BuiltinOutcome {
                            stdout,
                            stderr,
                            exit_code: 2,
                        };
                        self.run_exit_trap_if_needed(&mut out);
                        return Ok(out);
                    }
                };
                let parse_units: usize = ast.lists.iter().map(|l| 1 + l.rest.len()).sum();
                total_parse_units += parse_units;
                if total_parse_units > self.budget.limits.max_parse_units {
                    return Err(EvalError::Budget(format!(
                        "Execution aborted: Shell limit exceeded: maxParseUnits ({})",
                        self.budget.limits.max_parse_units
                    )));
                }
                if !self.noexec && !ast.lists.is_empty() {
                    let unit_out = self.eval_script(&ast, stdin)?;
                    stdout.push_str(&unit_out.stdout);
                    stderr.push_str(&unit_out.stderr);
                    last_code = unit_out.exit_code;
                }
                unit_start_line += unit_buf.matches('\n').count();
                unit_buf.clear();

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

            if eof {
                break;
            }
        }

        let mut out = BuiltinOutcome {
            stdout,
            stderr,
            exit_code: self.exit_requested.unwrap_or(last_code),
        };
        self.last_exit = out.exit_code;
        self.run_exit_trap_if_needed(&mut out);
        out.exit_code = self.exit_requested.unwrap_or(out.exit_code);
        Ok(out)
    }

    fn decode_script_bytes(bytes: &[u8], name: &str) -> Result<String, BuiltinOutcome> {
        if bytes
            .iter()
            .any(|&b| b < 9 || (b > 10 && b < 13) || (b > 13 && b < 32) || b == 127)
        {
            return Err(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{name}: cannot execute binary script\n"),
                exit_code: 126,
            });
        }
        let stripped = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
        match std::str::from_utf8(stripped) {
            Ok(s) => Ok(s.to_string()),
            Err(_) => Err(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{name}: cannot execute binary or non-UTF-8 script\n"),
                exit_code: 126,
            }),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run_vfs_script(
        &mut self,
        target: &str,
        args: &[String],
        stdin: &mut String,
        direct: bool,
        mut errexit: bool,
        braceexpand: Option<bool>,
        noexec: bool,
        nounset: bool,
        pipefail: bool,
        allexport: bool,
        noclobber: bool,
        noglob: bool,
        invoked_cmd: &str,
        loaded_source: Option<(String, String)>,
    ) -> Result<BuiltinOutcome, EvalError> {
        if target.is_empty() {
            let prefix = if direct { self.diag_prefix() } else { String::new() };
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{prefix}{invoked_cmd}: : No such file or directory\n"),
                exit_code: 127,
            });
        }
        self.budget
            .enter_substitution()
            .map_err(EvalError::Budget)?;
        self.budget.leave_substitution();
        let path = resolve_posix_path(self.cwd, target);
        let mut source_bytes: Option<Vec<u8>> = None;
        let first_or_full_source: String;
        let mut interpreter_profile: Option<&'static str> = None;
        let diag_pfx = if direct { self.diag_prefix() } else { String::new() };

        if let Some((ref lp, ref ls)) = loaded_source
            && lp == &path
        {
            first_or_full_source = ls.clone();
        } else {
            let st = match self.fs.stat(&path) {
                Ok(s) => s,
                Err(_) => {
                    let mut cur = String::new();
                    for comp in path.split('/').filter(|c| !c.is_empty()) {
                        cur.push('/');
                        cur.push_str(comp);
                        if cur != path
                            && let Ok(pst) = self.fs.stat(&cur)
                            && pst.kind != crate::vfs::VfsEntryKind::Directory
                        {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{diag_pfx}{target}: Not a directory\n"),
                                exit_code: 126,
                            });
                        }
                    }
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{diag_pfx}{target}: No such file or directory\n"),
                        exit_code: 127,
                    });
                }
            };
            if st.kind == crate::vfs::VfsEntryKind::Directory {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{diag_pfx}{target}: Is a directory\n"),
                    exit_code: 126,
                });
            }
            if st.kind != crate::vfs::VfsEntryKind::File {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{diag_pfx}{target}: not a regular file\n"),
                    exit_code: 126,
                });
            }
            if (st.mode & 0o444) == 0 || (direct && (st.mode & 0o111) == 0) {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{diag_pfx}{target}: Permission denied\n"),
                    exit_code: 126,
                });
            }
            let bytes = match self.fs.read_file(&path) {
                Ok(b) => b,
                Err(_) => {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{diag_pfx}{target}: No such file or directory\n"),
                        exit_code: 127,
                    });
                }
            };
            self.budget
                .add_source_bytes(bytes.len())
                .map_err(EvalError::Budget)?;
            first_or_full_source = if direct && bytes.starts_with(b"#!") {
                let nl = bytes.iter().position(|&b| b == b'\n').unwrap_or(bytes.len());
                match Self::decode_script_bytes(&bytes[..nl], target) {
                    Ok(s) => s,
                    Err(mut out) => {
                        out.stderr = format!("{diag_pfx}{}", out.stderr);
                        return Ok(out);
                    }
                }
            } else {
                match Self::decode_script_bytes(&bytes, target) {
                    Ok(s) => s,
                    Err(mut out) => {
                        out.stderr = format!("{diag_pfx}{}", out.stderr);
                        return Ok(out);
                    }
                }
            };
            source_bytes = Some(bytes);
        }

        if direct && first_or_full_source.starts_with("#!") {
            let first_line = first_or_full_source.lines().next().unwrap_or("");
            let interpreter = first_line[2..].trim_matches(|c| c == ' ' || c == '\t');
            if interpreter == "/usr/bin/env"
                || interpreter.starts_with("/usr/bin/env ")
                || interpreter.starts_with("/usr/bin/env\t")
            {
                let opt_arg = if interpreter.len() > "/usr/bin/env".len() {
                    Some(
                        interpreter["/usr/bin/env".len()..]
                            .trim_start_matches(|c| c == ' ' || c == '\t')
                            .to_string(),
                    )
                } else {
                    None
                };
                let full_src = if let Some(ref b) = source_bytes {
                    match Self::decode_script_bytes(b, target) {
                        Ok(s) => s,
                        Err(mut out) => {
                            out.stderr = format!("{diag_pfx}{}", out.stderr);
                            return Ok(out);
                        }
                    }
                } else {
                    first_or_full_source.clone()
                };
                let mut words = vec!["env".to_string()];
                if let Some(a) = opt_arg {
                    words.push(a);
                }
                words.push(target.to_string());
                words.extend(args.iter().cloned());
                self.env
                    .insert("__shebang_loaded_path".to_string(), path.clone());
                self.env
                    .insert("__shebang_loaded_source".to_string(), full_src);
                let res = self.dispatch_words(&words, stdin, true);
                self.env.remove("__shebang_loaded_path");
                self.env.remove("__shebang_loaded_source");
                return match res {
                    Ok(mut o) => {
                        if o.exit_code == 127
                            && !o.stderr.starts_with("env: ")
                            && o.stderr.ends_with(": command not found\n")
                        {
                            o.stderr = format!("env: {}", o.stderr);
                        }
                        Ok(o)
                    }
                    Err(e) => Err(e),
                };
            }

            let shell_match = interpreter
                .strip_prefix("/bin/")
                .or_else(|| interpreter.strip_prefix("/usr/bin/"))
                .and_then(|rest| {
                    for sh_name in ["bash", "sh", "zsh"] {
                        if let Some(after) = rest.strip_prefix(sh_name) {
                            if after.is_empty() {
                                return Some((sh_name, None));
                            }
                            if after.starts_with(' ') || after.starts_with('\t') {
                                let flag_s = after.trim_start_matches(|c| c == ' ' || c == '\t');
                                if (flag_s.starts_with('-') || flag_s.starts_with('+'))
                                    && flag_s.len() > 1
                                    && flag_s[1..].chars().all(|c| c == 'e')
                                {
                                    return Some((sh_name, Some(flag_s.starts_with('-'))));
                                }
                            }
                        }
                    }
                    None
                });

            if let Some((sh_name, err_flag)) = shell_match {
                interpreter_profile = Some(if sh_name == "sh" { "sh" } else { "bash" });
                if let Some(ef) = err_flag {
                    errexit = ef;
                }
            } else {
                let split_idx = interpreter.find([' ', '\t']);
                let executable = match split_idx {
                    Some(i) => &interpreter[..i],
                    None => interpreter,
                };
                let (directory, name) = match executable.rfind('/') {
                    Some(slash) => (&executable[..slash], &executable[slash + 1..]),
                    None => ("", executable),
                };
                if (directory != "/bin" && directory != "/usr/bin")
                    || matches!(name, "sh" | "bash" | "zsh")
                    || !self.is_registered_command_name(name)
                {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{diag_pfx}{target}: unsupported interpreter: {interpreter}\n"),
                        exit_code: 126,
                    });
                }
                let argument = split_idx
                    .map(|i| interpreter[i..].trim_start_matches(|c| c == ' ' || c == '\t'))
                    .filter(|s| !s.is_empty());
                let mut words = vec![name.to_string()];
                if let Some(arg) = argument {
                    words.push(arg.to_string());
                }
                words.push(target.to_string());
                words.extend(args.iter().cloned());
                self.budget
                    .enter_substitution()
                    .map_err(EvalError::Budget)?;
                let res = self.dispatch_words(&words, stdin, true);
                self.budget.leave_substitution();
                return res;
            }
        }

        let full_source = if let Some(ref b) = source_bytes {
            match Self::decode_script_bytes(b, target) {
                Ok(s) => s,
                Err(mut out) => {
                    out.stderr = format!("{diag_pfx}{}", out.stderr);
                    return Ok(out);
                }
            }
        } else {
            first_or_full_source
        };

        if noexec {
            return match validate_basic_syntax(&full_source) {
                Ok(()) => Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                }),
                Err(e) => Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{target}: {e}\n"),
                    exit_code: 2,
                }),
            };
        }

        let mut sub_cwd = self.cwd.clone();
        let use_posix = if direct {
            match interpreter_profile {
                Some("sh") => true,
                Some(_) => false,
                None => self.env.get("__set_posix").is_some_and(|v| v == "1"),
            }
        } else {
            invoked_cmd == "sh"
        };
        let mut sub_env = self.build_child_process_env(&sub_cwd, target);
        if use_posix {
            sub_env.insert("__set_posix".to_string(), "1".to_string());
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
        sub.script_name = Some(target.to_string());
        sub.current_line = 1;
        sub.func_stack.clear();
        sub.sync_funcname();
        sub.env.remove("BASH_SUBSHELL");
        sub.env.remove("__unexported__BASH_SUBSHELL");
        sub.env.remove("!");
        let parent_job_keys: Vec<String> = sub
            .env
            .keys()
            .filter(|k| k.starts_with("__parent_job_"))
            .cloned()
            .collect();
        for k in parent_job_keys {
            sub.env.remove(&k);
        }
        sub.apply_set_option("allexport", allexport);
        sub.apply_set_option("braceexpand", braceexpand.unwrap_or(true));
        sub.apply_set_option("errexit", errexit);
        sub.apply_set_option("noclobber", noclobber);
        sub.apply_set_option("noexec", noexec);
        sub.apply_set_option("noglob", noglob);
        sub.apply_set_option("nounset", nounset);
        sub.apply_set_option("pipefail", pipefail);
        sub.in_condition = false;
        sub.functions = self
            .functions
            .iter()
            .filter(|(k, _)| self.exported_functions.contains(*k))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        self.budget
            .enter_substitution()
            .map_err(EvalError::Budget)?;
        let res = sub.eval_script_units(&full_source, stdin);
        self.budget.leave_substitution();
        match res {
            Ok(mut out) => {
                out.exit_code = sub.exit_requested.unwrap_or(out.exit_code);
                sub.last_exit = out.exit_code;
                sub.run_exit_trap_if_needed(&mut out);
                out.exit_code = sub.exit_requested.unwrap_or(out.exit_code);
                Ok(out)
            }
            Err(EvalError::Syntax(msg)) => Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{target}: {msg}\n"),
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
            "xtrace",
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
                self.pos_args_version = self.pos_args_version.wrapping_add(1);
                break;
            } else if a == "-" {
                if i + 1 < args.len() {
                    self.pos_args = args[i + 1..].to_vec();
                    self.pos_args_version = self.pos_args_version.wrapping_add(1);
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
                                if SET_OPTIONS.contains(&opt_name.as_str()) {
                                    self.apply_set_option(&opt_name, enable);
                                } else if UNSUPPORTED_SET_OPTIONS.contains(&opt_name.as_str()) {
                                    return BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format!(
                                            "{}set: {opt_name}: unsupported shell option\n",
                                            self.diag_prefix()
                                        ),
                                        exit_code: 1,
                                    };
                                } else {
                                    return BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format!(
                                            "{}set: {opt_name}: invalid option name\n",
                                            self.diag_prefix()
                                        ),
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
                self.pos_args_version = self.pos_args_version.wrapping_add(1);
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
            let valid = known.contains(&name.as_str());
            if !valid {
                stderr.push_str(&format!(
                    "{}shopt: {name}: unsupported shell option name (supported: {})\n",
                    self.diag_prefix(),
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
                        'n' | 'A' | 'a' | 'i' | 'l' | 'u' | 'r' | 'x' | 'I' => {
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
        let inherit_prev = enabled.contains(&'I');
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
                decl_stderr.push_str(&format!("{}{cmd}: `{op}': not a valid identifier\n", self.diag_prefix()));
                decl_status = 1;
                continue;
            }

            if self
                .env
                .get(&format!("__attr__{base_name}"))
                .is_some_and(|a| a.contains('r'))
                && (val_opt.is_some() || is_local)
            {
                decl_stderr.push_str(&format!("{}{cmd}: {base_name}: readonly variable\n", self.diag_prefix()));
                decl_status = 1;
                continue;
            }

            if is_local
                && let Some(frame) = self.local_scopes.last_mut()
                && !frame.contains_key(&base_name)
            {
                frame.insert(base_name.clone(), self.env.get(&base_name).cloned());
                for meta_prefix in [
                    "__attr__",
                    "__assoc__",
                    "__nameref__",
                    "__declared__",
                    "__keys__",
                    "__unexported__",
                ] {
                    let mk = format!("{meta_prefix}{base_name}");
                    frame.insert(mk.clone(), self.env.get(&mk).cloned());
                }
                if base_name == "OPTIND" {
                    for gk in [
                        "__getopts_index",
                        "__getopts_active_arg",
                        "__getopts_active_off",
                        "__getopts_int",
                    ] {
                        frame.insert(gk.to_string(), self.env.get(gk).cloned());
                    }
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
                    if !inherit_prev && (val_opt.is_none() || !append) {
                        self.env.remove(&ak);
                    }
                }
                if !inherit_prev {
                    self.env.remove(&format!("__attr__{base_name}"));
                    self.env.remove(&format!("__assoc__{base_name}"));
                    self.env.remove(&format!("__nameref__{base_name}"));
                    self.env.remove(&format!("__declared__{base_name}"));
                    self.env.remove(&format!("__keys__{base_name}"));
                    if val_opt.is_none() || !append {
                        self.env.remove(&base_name);
                    }
                }
                if base_name == "OPTIND" {
                    self.env.insert("__getopts_int".to_string(), "0".to_string());
                }
            }

            if is_assoc {
                let arr_prefix = format!("{base_name}[");
                let was_indexed = !self.env.contains_key(&format!("__assoc__{base_name}"))
                    && (self
                        .env
                        .get(&format!("__attr__{base_name}"))
                        .is_some_and(|a| a.contains('a'))
                        || self.env.contains_key(&format!("{base_name}[#]"))
                        || self.env.keys().any(|k| k.starts_with(&arr_prefix)));
                if was_indexed {
                    decl_stderr.push_str(&format!(
                        "{cmd}: {base_name}: cannot convert indexed to associative array\n"
                    ));
                    decl_status = 1;
                    continue;
                }
                self.env
                    .insert(format!("__assoc__{base_name}"), "1".to_string());
            }
            if is_indexed
                && (self.env.contains_key(&format!("__assoc__{base_name}"))
                    || self
                        .env
                        .get(&format!("__attr__{base_name}"))
                        .is_some_and(|a| a.contains('A')))
            {
                decl_stderr.push_str(&format!(
                    "{cmd}: {base_name}: cannot convert associative to indexed array\n"
                ));
                decl_status = 1;
                continue;
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
            } else if is_local
                && base_name == "PIPESTATUS"
                && !inherit_prev
                && !self.env.contains_key(&base_name)
            {
                self.env.insert(base_name.clone(), String::new());
            } else if !self.env.contains_key(&base_name) {
                self.env
                    .insert(format!("__declared__{base_name}"), "1".to_string());
            }
            if cmd == "local" && base_name == "OPTIND" {
                sync_getopts_env(self.env);
            }

            if cur_attr.is_empty() {
                self.env.remove(&format!("__attr__{base_name}"));
            } else {
                self.env.insert(format!("__attr__{base_name}"), cur_attr);
            }
            self.retained_prefix_vars.push(base_name);
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
            if unset_func {
                if arg.is_empty() {
                    stderr.push_str(&format!("unset: `{arg}': not a valid identifier\n"));
                    status = 1;
                    continue;
                }
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
                self.env.remove(&format!("__func_src__{arg}"));
                continue;
            }
            let base_ident = arg.split_once('[').map(|(b, _)| b).unwrap_or(arg);
            if !is_valid_shell_ident(base_ident)
                || (arg.contains('[') && !arg.ends_with(']'))
            {
                stderr.push_str(&format!("unset: `{arg}': not a valid identifier\n"));
                status = 1;
                continue;
            }
            let has_var_binding = self.env.contains_key(arg)
                || self.env.contains_key(&format!("__attr__{arg}"))
                || self.env.contains_key(&format!("__declared__{arg}"))
                || self.env.contains_key(&format!("__assoc__{arg}"))
                || self.env.contains_key(&format!("__nameref__{arg}"))
                || self.env.keys().any(|k| k.starts_with(&format!("{arg}[")))
                || self.local_scopes.iter().any(|f| f.contains_key(arg));
            let fallback_func =
                !unset_var && !unset_nameref && !has_var_binding && self.functions.contains_key(arg);
            if fallback_func {
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
                self.env.remove(&format!("__func_src__{arg}"));
                continue;
            }
            if unset_nameref {
                if self.env.contains_key(&format!("__nameref__{arg}"))
                    || self
                        .env
                        .get(&format!("__attr__{arg}"))
                        .is_some_and(|a| a.contains('n'))
                {
                    if self
                        .env
                        .get(&format!("__attr__{arg}"))
                        .is_some_and(|a| a.contains('r'))
                    {
                        stderr.push_str(&format!(
                            "{}unset: {arg}: cannot unset: readonly variable\n",
                            self.diag_prefix()
                        ));
                        status = 1;
                        continue;
                    }
                    self.env.remove(&format!("__nameref__{arg}"));
                    self.env.remove(&format!("__attr__{arg}"));
                    self.env.remove(&format!("__declared__{arg}"));
                    self.env.remove(arg);
                }
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
                        "{}unset: {resolved}: cannot unset: readonly variable\n",
                        self.diag_prefix()
                    ));
                    status = 1;
                    continue;
                }
                let clean_sub = raw_sub.trim_matches('"').trim_matches('\'');
                let is_assoc = self
                    .env
                    .get(&format!("__assoc__{resolved}"))
                    .map(|v| v == "1")
                    .unwrap_or(false)
                    || self
                        .env
                        .get(&format!("__attr__{resolved}"))
                        .is_some_and(|a| a.contains('A'));
                if (clean_sub == "@" || clean_sub == "*") && !is_assoc {
                    let prefix = format!("{resolved}[");
                    let arr_keys: Vec<String> = self
                        .env
                        .keys()
                        .filter(|k| k.starts_with(&prefix))
                        .cloned()
                        .collect();
                    let was_arr = !arr_keys.is_empty()
                        || self
                            .env
                            .get(&format!("__attr__{resolved}"))
                            .is_some_and(|a| a.contains('a'));
                    for k in arr_keys {
                        self.env.remove(&k);
                    }
                    self.env.remove(&resolved);
                    self.env.remove(&format!("__keys__{resolved}"));
                    if was_arr {
                        self.env.insert(format!("{resolved}[#]"), "0".to_string());
                        self.env.insert(format!("{resolved}[*]"), String::new());
                        self.env.insert(format!("{resolved}[@]"), String::new());
                    }
                    continue;
                }
                if is_assoc {
                    let elem_key = format!("{resolved}[{clean_sub}]");
                    self.env.remove(&elem_key);
                    if let Some(order_str) = self.env.get(&format!("__keys__{resolved}")).cloned() {
                        let filtered: Vec<&str> = order_str
                            .split('\x1f')
                            .filter(|&k| !k.is_empty() && k != clean_sub)
                            .collect();
                        self.env
                            .insert(format!("__keys__{resolved}"), filtered.join("\x1f"));
                    }
                    sync_array_metadata(&resolved, self.env);
                    continue;
                }
                if clean_sub.trim().is_empty() {
                    stderr.push_str(&format!("unset: {arg}: bad array subscript\n"));
                    status = 1;
                    continue;
                }
                let sub_idx = match eval_arith(clean_sub, self.env) {
                    Ok(v) => v,
                    Err(e) => {
                        stderr.push_str(&format!("unset: {arg}: {e}\n"));
                        status = 1;
                        continue;
                    }
                };
                let final_idx = if sub_idx < 0 {
                    let prefix = format!("{resolved}[");
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
                    max_idx + 1 + sub_idx
                } else {
                    sub_idx
                };
                if final_idx < 0 {
                    stderr.push_str(&format!("unset: {arg}: bad array subscript\n"));
                    status = 1;
                    continue;
                }
                if final_idx == 0 {
                    let prefix = format!("{resolved}[");
                    let has_arr = self.env.keys().any(|k| k.starts_with(&prefix));
                    if !has_arr && self.env.contains_key(&resolved) {
                        self.env.remove(&resolved);
                        self.env.remove(&format!("__attr__{resolved}"));
                        self.env.remove(&format!("__declared__{resolved}"));
                        continue;
                    }
                }
                self.env.remove(&format!("{resolved}[{final_idx}]"));
                sync_array_metadata(&resolved, self.env);
                continue;
            }
            let base_arg = arg.split_once('[').map(|(b, _)| b).unwrap_or(arg);
            let resolved = resolve_nameref_base(base_arg, self.env).to_string();
            if self
                .env
                .get(&format!("__attr__{resolved}"))
                .is_some_and(|a| a.contains('r'))
            {
                stderr.push_str(&format!(
                    "{}unset: {resolved}: cannot unset: readonly variable\n",
                    self.diag_prefix()
                ));
                status = 1;
                continue;
            }
            self.env.remove(&resolved);
            if self.env.get("__set_posix").is_some_and(|v| v == "1") {
                self.retained_prefix_vars.push(resolved.clone());
            }
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
                sync_getopts_env(self.env);
            }
            if resolved == "OPTERR" {
                self.env.insert("__opterr_unset__".to_string(), "1".to_string());
            }
            if resolved == "PWD" {
                self.env.insert("__pwd_unset__".to_string(), "1".to_string());
            }
            self.env.remove(&format!("__attr__{resolved}"));
            self.env.remove(&format!("__declared__{resolved}"));
            self.env.remove(&format!("__assoc__{resolved}"));
            self.env.remove(&format!("__keys__{resolved}"));
            self.env.remove(&format!("__mapfile_active__{resolved}"));
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

    fn diag_prefix(&self) -> String {
        let name = self.script_name.as_deref().unwrap_or("shell");
        let line = self.current_line.max(1);
        format!("{name}: line {line}: ")
    }

    fn sync_shared_stdin(&mut self, canon: u32, stdin: &mut String, from_stdin: bool) {
        if canon >= 3 && canon != STDIN_STREAM_FD && self.resolve_in_fd(0) == canon {
            if from_stdin {
                self.in_fds.insert(canon, stdin.clone());
            } else if let Some(buf) = self.in_fds.get(&canon) {
                *stdin = buf.clone();
            }
        }
    }

    fn builtin_read(
        &mut self,
        args: &[String],
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        const READ_USAGE: &str = "read: usage: read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n";
        let prefix = self.diag_prefix();

        let mut raw_mode = false;
        let mut delim_byte: Option<u8> = None;
        let mut nchars: Option<usize> = None;
        let mut exact_chars = false;
        let mut array_name: Option<String> = None;
        let mut fd_num: u32 = 0;
        let mut timeout_secs: Option<f64> = None;
        let mut terminal_flag: Option<char> = None;
        let mut vars: Vec<String> = Vec::new();

        let mut idx = 0usize;
        while idx < args.len() {
            let arg = &args[idx];
            if arg == "--" {
                idx += 1;
                break;
            }
            let raw_arg = stream_string_to_bytes(arg);
            if raw_arg.first() != Some(&b'-') || raw_arg.len() == 1 {
                break;
            }
            idx += 1;
            let mut c_idx = 1usize;
            while c_idx < raw_arg.len() {
                let flag_byte = raw_arg[c_idx];
                let flag = flag_byte as char;
                c_idx += 1;
                match flag_byte {
                    b'r' => {
                        raw_mode = true;
                    }
                    b's' | b'e' | b'E' => {
                        terminal_flag = Some(flag);
                    }
                    b'a' | b'd' | b'i' | b'n' | b'N' | b'p' | b't' | b'u' => {
                        let val = if c_idx < raw_arg.len() {
                            let rest = bytes_to_stream_string(&raw_arg[c_idx..]);
                            c_idx = raw_arg.len();
                            rest
                        } else if idx < args.len() {
                            let v = args[idx].clone();
                            idx += 1;
                            v
                        } else {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!(
                                    "{prefix}read: -{flag}: option requires an argument\n{READ_USAGE}"
                                ),
                                exit_code: 2,
                            });
                        };
                        match flag_byte {
                            b'a' => {
                                array_name = Some(val);
                            }
                            b'd' => {
                                let raw_delim = stream_string_to_bytes(&val);
                                delim_byte = Some(raw_delim.first().copied().unwrap_or(0));
                            }
                            b'p' | b'i' => {
                                terminal_flag = Some(flag);
                            }
                            b't' => match parse_read_timeout(&val) {
                                Some(t) => {
                                    timeout_secs = Some(t);
                                }
                                None => {
                                    return Ok(BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format!(
                                            "{prefix}read: {val}: invalid timeout specification\n"
                                        ),
                                        exit_code: 1,
                                    });
                                }
                            },
                            b'u' => match parse_read_fd(&val) {
                                Some(fd) => {
                                    if !self.is_fd_open(fd) {
                                        return Ok(BuiltinOutcome {
                                            stdout: String::new(),
                                            stderr: format!(
                                                "{prefix}read: {fd}: invalid file descriptor: Bad file descriptor\n"
                                            ),
                                            exit_code: 1,
                                        });
                                    }
                                    fd_num = fd;
                                }
                                None => {
                                    return Ok(BuiltinOutcome {
                                        stdout: String::new(),
                                        stderr: format!(
                                            "{prefix}read: {val}: invalid file descriptor specification\n"
                                        ),
                                        exit_code: 1,
                                    });
                                }
                            },
                            b'n' | b'N' => {
                                exact_chars |= flag_byte == b'N';
                                match parse_read_count(&val) {
                                    Ok(c) => {
                                        nchars = Some(c);
                                    }
                                    Err(_is_overflow) => {
                                        let is_hex =
                                            val.starts_with("0x") || val.starts_with("0X");
                                        let hex_label = if is_hex {
                                            "hex "
                                        } else {
                                            ""
                                        };
                                        return Ok(BuiltinOutcome {
                                            stdout: String::new(),
                                            stderr: format!(
                                                "{prefix}read: {val}: invalid {hex_label}number\n"
                                            ),
                                            exit_code: 1,
                                        });
                                    }
                                }
                            }
                            _ => unreachable!(),
                        }
                    }
                    _ => {
                        let flag_str = bytes_to_stream_string(&[flag_byte]);
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!(
                                "{prefix}read: -{flag_str}: invalid option\n{READ_USAGE}"
                            ),
                            exit_code: 2,
                        });
                    }
                }
            }
        }
        while idx < args.len() {
            vars.push(args[idx].clone());
            idx += 1;
        }

        if timeout_secs == Some(0.0) {
            if !self.is_fd_open(fd_num) {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 1,
                });
            }
            if !self.is_fd_readable(fd_num) {
                match self.fd_table.get(&fd_num) {
                    Some(FdTarget::File { .. }) => {
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: String::new(),
                            exit_code: 0,
                        });
                    }
                    Some(FdTarget::PipeStdout { peer_retired }) => {
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: String::new(),
                            exit_code: if *peer_retired { 0 } else { 1 },
                        });
                    }
                    _ => {}
                }
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!(
                        "{prefix}read: descriptor readiness unavailable through this extension API\n"
                    ),
                    exit_code: 1,
                });
            }
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            });
        }

        if let Some(tflag) = terminal_flag {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!(
                    "{prefix}read: -{tflag}: terminal input capabilities unavailable through this extension API\n"
                ),
                exit_code: 1,
            });
        }

        if let Some(first_var) = vars.first()
            && !is_valid_shell_ident(first_var)
        {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{prefix}read: `{first_var}': not a valid identifier\n"),
                exit_code: 1,
            });
        }

        let effective_timeout = match timeout_secs {
            Some(t) => Some(t),
            None if nchars != Some(0) => self.env.get("TMOUT").and_then(|v| parse_read_timeout(v)),
            None => None,
        };

        let mut timed_out = false;
        if !self.is_fd_readable(fd_num) && nchars != Some(0) {
            if effective_timeout.is_some_and(|t| t > 0.0) {
                match self.fd_table.get(&fd_num) {
                    Some(FdTarget::File { .. }) => {}
                    Some(FdTarget::PipeStdout { peer_retired }) => {
                        timed_out = !*peer_retired;
                    }
                    _ => {
                        return Ok(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!(
                                "{prefix}read: descriptor timeout observation unavailable through this extension API\n"
                            ),
                            exit_code: 1,
                        });
                    }
                }
            }
            if !timed_out {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{prefix}read: {fd_num}: read error: Bad file descriptor\n"),
                    exit_code: 1,
                });
            }
        }

        let byte_locale = is_select_byte_locale(self.env);
        let effective_delim: Option<u8> = if exact_chars {
            None
        } else {
            Some(delim_byte.unwrap_or(b'\n'))
        };

        let (record_bytes, escaped_offsets, terminated) = if timed_out || nchars == Some(0) {
            (Vec::new(), Vec::new(), !timed_out && self.is_fd_readable(fd_num))
        } else {
            let canon = self.resolve_in_fd(fd_num);
            let use_direct_stdin = (fd_num == 0 && !self.in_fd_aliases.contains_key(&0))
                || (canon == STDIN_STREAM_FD && !self.in_fds.contains_key(&STDIN_STREAM_FD));
            if use_direct_stdin {
                let raw_in = stream_string_to_bytes(stdin);
                let (rec, esc, term, consumed) = scan_read_stream(
                    &raw_in,
                    raw_mode,
                    effective_delim,
                    nchars,
                    byte_locale,
                    self.budget,
                )?;
                *stdin = bytes_to_stream_string(&raw_in[consumed..]);
                (rec, esc, term)
            } else {
                if fd_num == 0 && canon != STDIN_STREAM_FD {
                    self.sync_shared_stdin(canon, stdin, true);
                }
                let raw_in = self
                    .in_fds
                    .get(&canon)
                    .map(|s| stream_string_to_bytes(s))
                    .unwrap_or_default();
                let (rec, esc, term, consumed) = scan_read_stream(
                    &raw_in,
                    raw_mode,
                    effective_delim,
                    nchars,
                    byte_locale,
                    self.budget,
                )?;
                let remaining = bytes_to_stream_string(&raw_in[consumed..]);
                self.in_fds.insert(canon, remaining);
                self.sync_shared_stdin(canon, stdin, false);
                (rec, esc, term)
            }
        };

        let ifs_bytes: Vec<u8> = if exact_chars {
            Vec::new()
        } else {
            self.env
                .get("IFS")
                .map(|s| stream_string_to_bytes(s))
                .unwrap_or_else(|| b" \t\n".to_vec())
        };

        let status = if timed_out {
            142
        } else if terminated {
            0
        } else {
            1
        };

        if let Some(arr) = array_name {
            if !is_valid_shell_ident(&arr) {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{prefix}read: `{arr}': not a valid identifier\n"),
                    exit_code: 1,
                });
            }
            let resolved = arr;
            if self
                .env
                .get(&format!("__attr__{resolved}"))
                .is_some_and(|a| a.contains('r'))
            {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{prefix}{resolved}: readonly variable\n"),
                    exit_code: 1,
                });
            }
            let fields = split_read_fields(
                &record_bytes,
                &escaped_offsets,
                &ifs_bytes,
                None,
                byte_locale,
            );
            if fields.len() > self.budget.limits.max_expansion_fields {
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{prefix}indexed array: private Map slot limit exceeded\n"),
                    exit_code: 1,
                });
            }
            for f in &fields {
                if f.len() > self.budget.limits.max_expansion_bytes {
                    return Err(EvalError::Budget(format!(
                        "Execution aborted: Shell limit exceeded: maxExpansionBytes ({})",
                        self.budget.limits.max_expansion_bytes
                    )));
                }
            }
            let arr_prefix = format!("{resolved}[");
            let old_keys: Vec<String> = self
                .env
                .keys()
                .filter(|k| k.starts_with(&arr_prefix))
                .cloned()
                .collect();
            for k in old_keys {
                self.env.remove(&k);
            }
            self.env.remove(&resolved);
            self.env.remove(&format!("__nameref__{resolved}"));
            self.env.remove(&format!("__assoc__{resolved}"));
            self.env
                .insert(format!("__declared__{resolved}"), "1".to_string());
            for (i, f) in fields.into_iter().enumerate() {
                self.env
                    .insert(format!("{resolved}[{i}]"), bytes_to_stream_string(&f));
            }
            sync_array_metadata(&resolved, self.env);
        } else {
            let default_reply = vars.is_empty();
            let target_names: Vec<String> = if default_reply {
                vec!["REPLY".to_string()]
            } else {
                vars.clone()
            };
            let fields = if default_reply {
                None
            } else {
                Some(split_read_fields(
                    &record_bytes,
                    &escaped_offsets,
                    &ifs_bytes,
                    Some(target_names.len()),
                    byte_locale,
                ))
            };
            for (i, orig_name) in target_names.iter().enumerate() {
                if !is_valid_shell_ident(orig_name) {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{prefix}read: `{orig_name}': not a valid identifier\n"),
                        exit_code: 1,
                    });
                }
                let resolved = resolve_nameref_base(orig_name, self.env).to_string();
                let base = resolved
                    .split_once('[')
                    .map(|(b, _)| b)
                    .unwrap_or(&resolved);
                if self
                    .env
                    .get(&format!("__attr__{base}"))
                    .is_some_and(|a| a.contains('r'))
                {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{prefix}{orig_name}: readonly variable\n"),
                        exit_code: if default_reply || i + 1 < target_names.len() {
                            2
                        } else {
                            1
                        },
                    });
                }
                let val_bytes: &[u8] = match &fields {
                    Some(f_list) => f_list.get(i).map(|v| v.as_slice()).unwrap_or(&[]),
                    None => &record_bytes,
                };
                if val_bytes.len() > self.budget.limits.max_expansion_bytes {
                    return Err(EvalError::Budget(format!(
                        "Execution aborted: Shell limit exceeded: maxExpansionBytes ({})",
                        self.budget.limits.max_expansion_bytes
                    )));
                }
                let val_str = bytes_to_stream_string(val_bytes);
                self.assign_variable(orig_name, &val_str, false)?;
            }
        }

        Ok(BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: status,
        })
    }

    fn builtin_mapfile(
        &mut self,
        cmd: &str,
        args: &[String],
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        let prefix = self.diag_prefix();
        let usage = format!(
            "{cmd}: usage: {cmd} [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]\n"
        );

        let mut strip_delim = false;
        let mut delim_byte: u8 = b'\n';
        let mut skip_count: u64 = 0;
        let mut max_count: u64 = 0;
        let mut origin: u32 = 0;
        let mut clear = true;
        let mut callback: Option<String> = None;
        let mut quantum: u64 = 5000;
        let mut fd_num: u32 = 0;
        let mut operands: Vec<String> = Vec::new();

        let mut idx = 0usize;
        while idx < args.len() {
            let arg = &args[idx];
            if arg == "--" {
                operands.extend_from_slice(&args[idx + 1..]);
                break;
            }
            if arg == "--help" {
                return Ok(BuiltinOutcome {
                    stdout: mapfile_help_header(cmd),
                    stderr: String::new(),
                    exit_code: 2,
                });
            }
            let raw_arg = stream_string_to_bytes(arg);
            if raw_arg.first() != Some(&b'-') || raw_arg.len() == 1 {
                operands.extend_from_slice(&args[idx..]);
                break;
            }
            idx += 1;
            let mut c_idx = 1usize;
            while c_idx < raw_arg.len() {
                let flag_byte = raw_arg[c_idx];
                let flag = flag_byte as char;
                c_idx += 1;
                if flag_byte == b't' {
                    strip_delim = true;
                    continue;
                }
                if !matches!(flag_byte, b'd' | b'n' | b'O' | b's' | b'u' | b'C' | b'c') {
                    let flag_str = bytes_to_stream_string(&[flag_byte]);
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("{prefix}{cmd}: -{flag_str}: invalid option\n{usage}"),
                        exit_code: 2,
                    });
                }
                let val = if c_idx < raw_arg.len() {
                    let rest = bytes_to_stream_string(&raw_arg[c_idx..]);
                    c_idx = raw_arg.len();
                    rest
                } else if idx < args.len() {
                    let v = args[idx].clone();
                    idx += 1;
                    v
                } else {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!(
                            "{prefix}{cmd}: -{flag}: option requires an argument\n{usage}"
                        ),
                        exit_code: 2,
                    });
                };
                match flag_byte {
                    b'd' => {
                        let raw_delim = stream_string_to_bytes(&val);
                        delim_byte = raw_delim.first().copied().unwrap_or(0);
                    }
                    b'C' => {
                        callback = Some(val);
                    }
                    b'u' => match parse_mapfile_decimal(&val, 2_147_483_647) {
                        Some(n) => {
                            let fd = n as u32;
                            if !self.is_fd_open(fd) {
                                return Ok(BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!(
                                        "{prefix}{cmd}: {fd}: invalid file descriptor: Bad file descriptor\n"
                                    ),
                                    exit_code: 1,
                                });
                            }
                            fd_num = fd;
                        }
                        _ => {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!(
                                    "{prefix}{cmd}: {val}: invalid file descriptor specification\n"
                                ),
                                exit_code: 1,
                            });
                        }
                    },
                    b'n' => match parse_mapfile_decimal(&val, 4_294_967_295) {
                        Some(n) => {
                            max_count = n;
                        }
                        _ => {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{cmd}: {val}: invalid line count\n"),
                                exit_code: 1,
                            });
                        }
                    },
                    b'O' => match parse_mapfile_decimal(&val, 4_294_967_295) {
                        Some(n) => {
                            origin = n as u32;
                            clear = false;
                        }
                        _ => {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{cmd}: {val}: invalid array origin\n"),
                                exit_code: 1,
                            });
                        }
                    },
                    b's' => match parse_mapfile_decimal(&val, 4_294_967_295) {
                        Some(n) => {
                            skip_count = n;
                        }
                        _ => {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{cmd}: {val}: invalid line count\n"),
                                exit_code: 1,
                            });
                        }
                    },
                    b'c' => match parse_mapfile_decimal(&val, 4_294_967_295) {
                        Some(n) if n >= 1 => {
                            quantum = n;
                        }
                        _ => {
                            return Ok(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{cmd}: {val}: invalid callback quantum\n"),
                                exit_code: 1,
                            });
                        }
                    },
                    _ => unreachable!(),
                }
            }
        }

        let arr_name = operands
            .first()
            .cloned()
            .unwrap_or_else(|| "MAPFILE".to_string());
        if arr_name.is_empty() {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{prefix}{cmd}: empty array variable name\n"),
                exit_code: 2,
            });
        }
        if !is_valid_shell_ident(&arr_name) {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{prefix}{cmd}: `{arr_name}': not a valid identifier\n"),
                exit_code: 1,
            });
        }

        let resolved_arr = arr_name;
        if self
            .env
            .get(&format!("__attr__{resolved_arr}"))
            .is_some_and(|a| a.contains('r'))
        {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{prefix}{resolved_arr}: readonly variable\n"),
                exit_code: 1,
            });
        }

        let active_key = format!("__mapfile_active__{resolved_arr}");
        let active_token = self
            .env
            .get(&active_key)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
            .wrapping_add(1)
            .to_string();
        self.env.insert(active_key.clone(), active_token.clone());

        let arr_prefix = format!("{resolved_arr}[");
        if clear {
            let old_keys: Vec<String> = self
                .env
                .keys()
                .filter(|k| k.starts_with(&arr_prefix))
                .cloned()
                .collect();
            for k in old_keys {
                self.env.remove(&k);
            }
            self.env.remove(&resolved_arr);
            self.env.remove(&format!("__nameref__{resolved_arr}"));
            self.env.remove(&format!("__assoc__{resolved_arr}"));
            self.env
                .insert(format!("__declared__{resolved_arr}"), "1".to_string());
            sync_array_metadata(&resolved_arr, self.env);
        } else {
            let has_arr_elems = self.env.keys().any(|k| k.starts_with(&arr_prefix));
            if !has_arr_elems {
                if let Some(scalar_val) = self.env.remove(&resolved_arr) {
                    self.env.insert(format!("{resolved_arr}[0]"), scalar_val);
                }
                self.env
                    .insert(format!("__declared__{resolved_arr}"), "1".to_string());
                sync_array_metadata(&resolved_arr, self.env);
            }
        }

        if !self.is_fd_readable(fd_num) {
            self.env.remove(&active_key);
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            });
        }

        let mut cb_stdout = String::new();
        let mut cb_stderr = String::new();
        let mut total_input_bytes = 0usize;

        let take_next_record = |this: &mut Self,
                                stdin_ref: &mut String,
                                total_bytes: &mut usize|
         -> Result<Option<Vec<u8>>, EvalError> {
            this.budget.tick_loop().map_err(EvalError::Budget)?;
            let canon = this.resolve_in_fd(fd_num);
            let use_direct_stdin = (fd_num == 0 && !this.in_fd_aliases.contains_key(&0))
                || (canon == STDIN_STREAM_FD && !this.in_fds.contains_key(&STDIN_STREAM_FD));
            let raw_in = if use_direct_stdin {
                stream_string_to_bytes(stdin_ref)
            } else {
                if fd_num == 0 && canon != STDIN_STREAM_FD {
                    this.sync_shared_stdin(canon, stdin_ref, true);
                }
                this.in_fds
                    .get(&canon)
                    .map(|s| stream_string_to_bytes(s))
                    .unwrap_or_default()
            };
            if raw_in.is_empty() {
                return Ok(None);
            }
            let mut end = raw_in.len();
            for (pos, &b) in raw_in.iter().enumerate() {
                if b == delim_byte {
                    end = pos + 1;
                    break;
                }
            }
            *total_bytes = total_bytes.saturating_add(end);
            if *total_bytes > this.budget.limits.max_input_bytes {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxInputBytes ({})",
                    this.budget.limits.max_input_bytes
                )));
            }
            if end > this.budget.limits.max_output_bytes {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxOutputBytes ({})",
                    this.budget.limits.max_output_bytes
                )));
            }
            let rec = raw_in[..end].to_vec();
            let rest = bytes_to_stream_string(&raw_in[end..]);
            if use_direct_stdin {
                *stdin_ref = rest;
            } else {
                this.in_fds.insert(canon, rest);
                this.sync_shared_stdin(canon, stdin_ref, false);
            }
            Ok(Some(rec))
        };

        for _ in 0..skip_count {
            match take_next_record(self, stdin, &mut total_input_bytes)? {
                Some(_) => {}
                None => {
                    self.env.remove(&active_key);
                    return Ok(BuiltinOutcome {
                        stdout: cb_stdout,
                        stderr: cb_stderr,
                        exit_code: 0,
                    });
                }
            }
        }

        let mut index: u32 = origin;
        let mut count: u64 = 1;
        let mut stored_elems: usize = self
            .env
            .keys()
            .filter(|k| {
                k.strip_prefix(&arr_prefix)
                    .and_then(|s| s.strip_suffix(']'))
                    .is_some_and(|sub| !matches!(sub, "@" | "*" | "#"))
            })
            .count();

        loop {
            if max_count != 0 && count > max_count {
                break;
            }
            let Some(rec_bytes) = take_next_record(self, stdin, &mut total_input_bytes)? else {
                break;
            };
            let nul_pos = rec_bytes.iter().position(|&b| b == 0);
            let mut length = nul_pos.unwrap_or(rec_bytes.len());
            if strip_delim && length > 0 && rec_bytes[length - 1] == delim_byte {
                length -= 1;
            }
            let line_slice = &rec_bytes[..length];

            if let Some(ref cb) = callback
                && count != 0
                && count % quantum == 0
            {
                let cb_source = format_mapfile_callback_command(cb, index, line_slice);
                if cb_source.len() > self.budget.limits.max_source_bytes {
                    self.env.remove(&active_key);
                    return Err(EvalError::Budget(format!(
                        "Execution aborted: Shell limit exceeded: maxSourceBytes ({})",
                        self.budget.limits.max_source_bytes
                    )));
                }
                let outer_script = self
                    .script_name
                    .clone()
                    .unwrap_or_else(|| "shell".to_string());
                let prev_script = self.script_name.clone();
                let prev_line = self.current_line;
                let diag_offset = prev_line.saturating_sub(1);
                let prev_cb_offset =
                    std::mem::replace(&mut self.callback_line_offset, diag_offset);
                self.mapfile_callback_depth += 1;
                let cb_res = self.eval_script_units(&cb_source, stdin);
                self.mapfile_callback_depth -= 1;
                self.callback_line_offset = prev_cb_offset;
                self.current_line = prev_line;
                self.script_name = prev_script;
                match cb_res {
                    Ok(cb_out) => {
                        cb_stdout.push_str(&cb_out.stdout);
                        cb_stderr.push_str(&cb_out.stderr);
                    }
                    Err(EvalError::Syntax(syn_msg)) => {
                        cb_stderr.push_str(&format_callback_syntax_diagnostic(
                            &format!("{outer_script}: stdin"),
                            diag_offset,
                            &cb_source,
                            &syn_msg,
                        ));
                        self.last_exit = 2;
                    }
                    Err(other) => {
                        self.env.remove(&active_key);
                        return Err(other);
                    }
                }
                if let Some(exit_code) = self.exit_requested {
                    self.env.remove(&active_key);
                    return Ok(BuiltinOutcome {
                        stdout: cb_stdout,
                        stderr: cb_stderr,
                        exit_code,
                    });
                }
                if let Some(ret_code) = self.return_requested {
                    self.env.remove(&active_key);
                    return Ok(BuiltinOutcome {
                        stdout: cb_stdout,
                        stderr: cb_stderr,
                        exit_code: ret_code,
                    });
                }
                if self.break_count > 0 || self.continue_count > 0 {
                    self.env.remove(&active_key);
                    return Ok(BuiltinOutcome {
                        stdout: cb_stdout,
                        stderr: cb_stderr,
                        exit_code: 0,
                    });
                }
            }

            if self.env.get(&active_key) != Some(&active_token) {
                self.env.remove(&active_key);
                return Ok(BuiltinOutcome {
                    stdout: cb_stdout,
                    stderr: format!(
                        "{cb_stderr}{prefix}indexed array: incremental target identity changed\n"
                    ),
                    exit_code: 1,
                });
            }
            if line_slice.len() > self.budget.limits.max_expansion_bytes {
                self.env.remove(&active_key);
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxExpansionBytes ({})",
                    self.budget.limits.max_expansion_bytes
                )));
            }
            let elem_key = format!("{resolved_arr}[{index}]");
            if !self.env.contains_key(&elem_key) {
                stored_elems += 1;
                if stored_elems > self.budget.limits.max_expansion_fields {
                    self.env.remove(&active_key);
                    return Ok(BuiltinOutcome {
                        stdout: cb_stdout,
                        stderr: format!(
                            "{cb_stderr}{prefix}indexed array: private Map slot limit exceeded\n"
                        ),
                        exit_code: 1,
                    });
                }
            }
            self.env
                .insert(elem_key, bytes_to_stream_string(line_slice));
            sync_array_metadata(&resolved_arr, self.env);

            index = index.wrapping_add(1);
            count = (count.wrapping_add(1)) & 0xffff_ffff;
        }

        self.env.remove(&active_key);

        Ok(BuiltinOutcome {
            stdout: cb_stdout,
            stderr: cb_stderr,
            exit_code: 0,
        })
    }

    fn builtin_getopts(&mut self, args: &[String]) -> BuiltinOutcome {
        if args.iter().any(|a| a.contains('\0')) {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "getopts: arguments must be strings without NUL\n".to_string(),
                exit_code: 2,
            };
        }
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
        if opt_args.iter().any(|a| a.contains('\0')) {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "getopts: arguments must be strings without NUL\n".to_string(),
                exit_code: 2,
            };
        }
        if !optstring.is_ascii() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "getopts: Non-ASCII getopts option specifications are unsupported\n"
                    .to_string(),
                exit_code: 2,
            };
        }
        let opt_bytes = optstring.as_bytes();
        let silent = opt_bytes.first() == Some(&b':');
        let mut spec = [-1i8; 128];
        let mut pos = if silent { 1usize } else { 0usize };
        while pos < opt_bytes.len() {
            let code = opt_bytes[pos] as usize;
            if code != b':' as usize && code != b'?' as usize && spec[code] == -1 {
                spec[code] = i8::from(opt_bytes.get(pos + 1) == Some(&b':'));
            }
            pos += 1;
        }

        let report_errors = self
            .env
            .get("OPTERR")
            .map(|v| v.is_empty() || decimal_index(v) != 0)
            .unwrap_or(true);
        let prog_name = self
            .env
            .get("0")
            .cloned()
            .or_else(|| self.script_name.clone())
            .unwrap_or_else(|| "shell".to_string());

        let state_index = self
            .env
            .get("__getopts_index")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        let mut index = if state_index == 0 { 1usize } else { state_index };
        let mut active: Option<(usize, usize)> = if state_index == 0 {
            None
        } else {
            self.env
                .get("__getopts_active_arg")
                .and_then(|a| a.parse::<usize>().ok())
                .zip(
                    self.env
                        .get("__getopts_active_off")
                        .and_then(|o| o.parse::<usize>().ok()),
                )
        };

        if let Some((arg_i, off_i)) = active
            && opt_args.get(arg_i).is_none_or(|s| off_i >= s.len())
        {
            active = None;
        }

        let apply_result = |this: &mut Self,
                            next_index: usize,
                            next_active: Option<(usize, usize)>,
                            next_optind: usize,
                            opt_val: &str,
                            optarg_val: Option<String>,
                            diag: Option<String>,
                            status: i32|
         -> BuiltinOutcome {
            this.env
                .insert("__getopts_index".to_string(), next_index.to_string());
            if let Some((aa, ao)) = next_active {
                this.env
                    .insert("__getopts_active_arg".to_string(), aa.to_string());
                this.env
                    .insert("__getopts_active_off".to_string(), ao.to_string());
            } else {
                this.env.remove("__getopts_active_arg");
                this.env.remove("__getopts_active_off");
            }
            let mut stderr = diag.unwrap_or_default();
            let resolved_optind = resolve_nameref_base("OPTIND", this.env).to_string();
            if this
                .env
                .get(&format!("__attr__{resolved_optind}"))
                .is_some_and(|a| a.contains('r'))
            {
                stderr.push_str(&format!("{resolved_optind}: readonly variable\n"));
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 1,
                };
            }
            this.env.insert("OPTIND".to_string(), next_optind.to_string());
            if this
                .env
                .get("__set_allexport")
                .is_some_and(|v| v == "1")
            {
                this.env.remove("__unexported__OPTIND");
            }

            let resolved_optarg = resolve_nameref_base("OPTARG", this.env).to_string();
            if this
                .env
                .get(&format!("__attr__{resolved_optarg}"))
                .is_some_and(|a| a.contains('r'))
            {
                stderr.push_str(&format!("{resolved_optarg}: readonly variable\n"));
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 1,
                };
            }
            if let Some(arg_s) = optarg_val {
                let already_existed = this.env.contains_key(&resolved_optarg);
                let was_unexported = this
                    .env
                    .contains_key(&format!("__unexported__{resolved_optarg}"));
                let allexport = this
                    .env
                    .get("__set_allexport")
                    .is_some_and(|v| v == "1");
                let attr_x = this
                    .env
                    .get(&format!("__attr__{resolved_optarg}"))
                    .is_some_and(|a| a.contains('x'));
                if allexport || attr_x {
                    this.env.remove(&format!("__unexported__{resolved_optarg}"));
                } else if !already_existed || was_unexported {
                    this.env
                        .insert(format!("__unexported__{resolved_optarg}"), "1".to_string());
                }
                this.env.insert(resolved_optarg, arg_s);
            } else {
                this.env.remove(&resolved_optarg);
                this.env.remove(&format!("__attr__{resolved_optarg}"));
                this.env.remove(&format!("__declared__{resolved_optarg}"));
            }

            if !is_valid_shell_ident(&var_name) {
                stderr.push_str(&format!("getopts: `{var_name}': not a valid identifier\n"));
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 1,
                };
            }
            if let Err(err_msg) = this.assign_variable(&var_name, opt_val, false) {
                let err_msg = match err_msg {
                    EvalError::Syntax(m) | EvalError::Budget(m) | EvalError::UnportedCommand(m) => m,
                };
                stderr.push_str(&format!("{err_msg}\n"));
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 1,
                };
            }
            BuiltinOutcome {
                stdout: String::new(),
                stderr,
                exit_code: status,
            }
        };

        if index > opt_args.len() {
            let end_idx = opt_args.len() + 1;
            return apply_result(self, end_idx, None, end_idx, "?", None, None, 1);
        }
        if active.is_none() {
            let token = &opt_args[index - 1];
            if token.len() < 2 || !token.starts_with('-') {
                return apply_result(self, index, None, index, "?", None, None, 1);
            }
            if token == "--" {
                let next_i = index + 1;
                return apply_result(self, next_i, None, next_i, "?", None, None, 1);
            }
            active = Some((index - 1, 1));
        }

        let (act_arg, act_off) = active.unwrap();
        let token = &opt_args[act_arg];
        let rest_str = &token[act_off..];
        let Some(flag_ch) = rest_str.chars().next() else {
            return apply_result(self, index, None, index, "?", None, None, 1);
        };
        if !flag_ch.is_ascii() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "getopts: Non-ASCII getopts option characters are unsupported\n"
                    .to_string(),
                exit_code: 2,
            };
        }
        let code = flag_ch as usize;
        let next_off = act_off + 1;
        let attached = next_off < token.len();
        let mut next_active = if attached {
            Some((act_arg, next_off))
        } else {
            None
        };
        if !attached {
            index += 1;
        }

        if spec[code] == -1 {
            let diag = if !silent && report_errors {
                Some(format!("{prog_name}: illegal option -- {flag_ch}\n"))
            } else {
                None
            };
            let optarg_v = if silent {
                Some(flag_ch.to_string())
            } else {
                None
            };
            return apply_result(self, index, next_active, index, "?", optarg_v, diag, 0);
        }

        if spec[code] == 1 {
            if attached {
                next_active = None;
                index += 1;
                let val = token[next_off..].to_string();
                return apply_result(
                    self,
                    index,
                    next_active,
                    index,
                    &flag_ch.to_string(),
                    Some(val),
                    None,
                    0,
                );
            }
            if index <= opt_args.len() {
                let val = opt_args[index - 1].clone();
                index += 1;
                return apply_result(
                    self,
                    index,
                    next_active,
                    index,
                    &flag_ch.to_string(),
                    Some(val),
                    None,
                    0,
                );
            }
            let diag = if !silent && report_errors {
                Some(format!(
                    "{prog_name}: option requires an argument -- {flag_ch}\n"
                ))
            } else {
                None
            };
            let opt_out = if silent { ":" } else { "?" };
            let optarg_v = if silent {
                Some(flag_ch.to_string())
            } else {
                None
            };
            return apply_result(self, index, next_active, index, opt_out, optarg_v, diag, 0);
        }

        apply_result(
            self,
            index,
            next_active,
            index,
            &flag_ch.to_string(),
            None,
            None,
            0,
        )
    }

    fn apply_umask_to_new_file(&self, full_path: &str) {
        if let Some(mask_s) = self.env.get("__umask")
            && let Ok(mask) = u32::from_str_radix(mask_s, 8)
        {
            let mode = 0o666 & !mask;
            let _ = self.fs.chmod(full_path, mode);
        }
    }

    fn is_noclobber_blocked(&self, full_path: &str) -> bool {
        if !self.noclobber {
            return false;
        }
        let resolved = resolve_physical_path(self.cwd, full_path, self.fs);
        if matches!(
            resolved.as_str(),
            "/dev/null" | "/dev/zero" | "/dev/random" | "/dev/urandom"
        ) {
            return false;
        }
        if self.fs.exists(full_path) {
            return !self.fs.is_dir(full_path);
        }
        self.fs.lstat(full_path).is_ok()
    }

    fn check_redirect_parent_dir(&self, full: &str, target: &str) -> Option<BuiltinOutcome> {
        if matches!(
            full,
            "/dev/null" | "/dev/zero" | "/dev/random" | "/dev/urandom" | "/dev/full"
        ) {
            return None;
        }
        let parent = full
            .rsplit_once('/')
            .map(|(p, _)| if p.is_empty() { "/" } else { p })
            .unwrap_or("/");
        if self.fs.is_dir(parent) {
            return None;
        }
        let prefix = self.diag_prefix();
        let detail = if self.fs.exists(parent) {
            "Not a directory"
        } else {
            "No such file or directory"
        };
        Some(BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("{prefix}{target}: {detail}\n"),
            exit_code: 1,
        })
    }

    #[allow(clippy::type_complexity)]
    fn setup_redirects(
        &mut self,
        redirects: &[Redirect],
        default_stdin: &str,
    ) -> Result<
        (
            SavedFds,
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
        for r in redirects {
            if let RedirectKind::HereDoc {
                eof_warning: Some(w),
                ..
            } = &r.kind
            {
                let prog = self.script_name.as_deref().unwrap_or("shell");
                let msg = format!("{prog}: warning: {w}\n");
                let fd2 = self.fd_table.get(&2).cloned().unwrap_or(FdTarget::Stderr);
                let mut dummy = BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                };
                self.write_to_fd_target(&fd2, &msg, &mut dummy);
                self.pending_stdout.push_str(&dummy.stdout);
                self.pending_stderr.push_str(&dummy.stderr);
            }
        }
        let mut saved_fd_table: Vec<(u32, Option<FdTarget>)> = Vec::new();
        let mut saved_aliases: Vec<(u32, Option<u32>)> = Vec::new();
        let mut saved_in: Vec<(u32, Option<String>)> = Vec::new();
        let mut local_stdin = default_stdin.to_string();
        let mut use_local = false;
        let mut dup_fd: Option<u32> = None;

        let record_saved_fd =
            |fd_table: &BTreeMap<u32, FdTarget>, saved: &mut Vec<(u32, Option<FdTarget>)>, f: u32| {
                if !saved.iter().any(|(k, _)| *k == f) {
                    saved.push((f, fd_table.get(&f).cloned()));
                }
            };
        let record_saved_alias =
            |aliases: &BTreeMap<u32, u32>, saved: &mut Vec<(u32, Option<u32>)>, f: u32| {
                if !saved.iter().any(|(k, _)| *k == f) {
                    saved.push((f, aliases.get(&f).copied()));
                }
            };

        for r in redirects {
            let expand_redir_target =
                |this: &mut Self, raw: &str| -> Result<Result<String, BuiltinOutcome>, EvalError> {
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
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    let content = if self.fs.is_dir(&full) {
                        if self.in_cmdsub_file_shortcut {
                            String::new()
                        } else {
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{target}: Is a directory\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                true,
                                None,
                                Some(err_out),
                            ));
                        }
                    } else {
                        match self.fs.read_file(&full) {
                        Ok(bytes) => {
                            if bytes.len() > self.budget.limits.max_input_bytes {
                                return Ok((
                                    (saved_fd_table, saved_aliases),
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
                            let prefix = self.diag_prefix();
                            let detail = if e.starts_with("ENOENT:") {
                                "No such file or directory"
                            } else {
                                e.as_str()
                            };
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{target}: {detail}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                true,
                                None,
                                Some(err_out),
                            ));
                        }
                        }
                    };
                    self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                    self.fd_table.remove(fd);
                    self.in_fd_aliases.remove(fd);
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
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if let Some(mut err_out) = self.check_redirect_parent_dir(&full, &target) {
                        self.route_outcome(&mut err_out);
                        return Ok((
                            (saved_fd_table, saved_aliases),
                            saved_in,
                            local_stdin,
                            use_local,
                            dup_fd,
                            Some(err_out),
                        ));
                    }
                    if full != "/dev/null" && !self.fs.exists(&full) {
                        if let Err(e) = self.fs.write_file(&full, b"") {
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{target}: {e}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        self.apply_umask_to_new_file(&full);
                    }
                    let content = match self.fs.read_file(&full) {
                        Ok(bytes) => {
                            if bytes.len() > self.budget.limits.max_input_bytes {
                                return Ok((
                                    (saved_fd_table, saved_aliases),
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
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{target}: {e}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                true,
                                None,
                                Some(err_out),
                            ));
                        }
                    };
                    let content_len = stream_string_to_bytes(&content).len();
                    self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                    self.in_fd_aliases.remove(fd);
                    self.rw_offsets.insert(*fd, 0);
                    self.rw_last_rem.insert(*fd, content_len);
                    if *fd == 0 {
                        local_stdin = content;
                        use_local = true;
                        dup_fd = None;
                        self.in_fd_aliases.insert(0, STDIN_STREAM_FD);
                    } else {
                        if !saved_in.iter().any(|(f, _)| f == fd) {
                            saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                        }
                        self.in_fds.insert(*fd, content);
                    }
                    self.fd_table.insert(
                        *fd,
                        FdTarget::ReadWriteFile {
                            path: full,
                            owner_fd: *fd,
                        },
                    );
                }
                RedirectKind::HereString(fd) => {
                    let val = match self.expand_word_to_string(&r.target) {
                        Ok(v) => v,
                        Err(EvalError::Syntax(msg)) => {
                            let is_param_err = msg.starts_with("__param_err__");
                            let is_nounset = msg.starts_with("__nounset__");
                            let clean = msg
                                .strip_prefix("__param_err__")
                                .or_else(|| msg.strip_prefix("__nounset__"))
                                .unwrap_or(&msg);
                            let prefix = self.diag_prefix();
                            let in_subshell = self
                                .env
                                .get("BASH_SUBSHELL")
                                .and_then(|v| v.parse::<u32>().ok())
                                .unwrap_or(0)
                                > 0;
                            let code = if is_param_err && !in_subshell { 127 } else { 1 };
                            let mut err_out = BuiltinOutcome {
                                stdout: std::mem::take(&mut self.pending_stdout),
                                stderr: format!(
                                    "{}{prefix}{clean}\n",
                                    std::mem::take(&mut self.pending_stderr)
                                ),
                                exit_code: code,
                            };
                            self.route_outcome(&mut err_out);
                            self.last_exit = code;
                            if is_nounset || (self.errexit && !self.in_condition) {
                                self.exit_requested = Some(code);
                            }
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        Err(e) => return Err(e),
                    };
                    let content = format!("{val}\n");
                    self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                    self.fd_table.remove(fd);
                    self.in_fd_aliases.remove(fd);
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
                RedirectKind::HereDoc { fd, quoted, .. } => {
                    let content = if *quoted {
                        r.target.clone()
                    } else {
                        match self.expand_heredoc_text(&r.target) {
                            Ok(v) => v,
                            Err(EvalError::Syntax(msg)) => {
                                let is_param_err = msg.starts_with("__param_err__");
                                let is_nounset = msg.starts_with("__nounset__");
                                let clean = msg
                                    .strip_prefix("__param_err__")
                                    .or_else(|| msg.strip_prefix("__nounset__"))
                                    .unwrap_or(&msg);
                                let prefix = self.diag_prefix();
                                let in_subshell = self
                                    .env
                                    .get("BASH_SUBSHELL")
                                    .and_then(|v| v.parse::<u32>().ok())
                                    .unwrap_or(0)
                                    > 0;
                                let code = if is_param_err && !in_subshell { 127 } else { 1 };
                                let mut err_out = BuiltinOutcome {
                                    stdout: std::mem::take(&mut self.pending_stdout),
                                    stderr: format!(
                                        "{}{prefix}{clean}\n",
                                        std::mem::take(&mut self.pending_stderr)
                                    ),
                                    exit_code: code,
                                };
                                self.route_outcome(&mut err_out);
                                self.last_exit = code;
                                if is_nounset || (self.errexit && !self.in_condition) {
                                    self.exit_requested = Some(code);
                                }
                                return Ok((
                                    (saved_fd_table, saved_aliases),
     saved_in,
                                    local_stdin,
                                    use_local,
                                    dup_fd,
                                    Some(err_out),
                                ));
                            }
                            Err(e) => return Err(e),
                        }
                    };
                    self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                    self.fd_table.remove(fd);
                    self.in_fd_aliases.remove(fd);
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
                RedirectKind::DupIn { fd, raw_move } => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    if target == "-" {
                        self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                        record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                        record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                        if *fd == 0 {
                            local_stdin.clear();
                            use_local = true;
                            dup_fd = None;
                        } else {
                            if !saved_in.iter().any(|(f, _)| f == fd) {
                                saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                            }
                            self.in_fds.remove(fd);
                        }
                        self.in_fd_aliases.remove(fd);
                        self.fd_table.insert(*fd, FdTarget::Closed);
                    } else {
                        let (src_str, move_fd) = match target.strip_suffix('-') {
                            Some(s) if !s.is_empty() => (s, true),
                            _ => (target.as_str(), false),
                        };
                        let is_digits = !src_str.is_empty()
                            && src_str.chars().all(|c| c.is_ascii_digit());
                        if !is_digits {
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{target}: Bad file descriptor\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        if move_fd && !*raw_move {
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{target}: ambiguous redirect\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        if let Ok(src_fd) = src_str.parse::<u32>() {
                            if !self.is_fd_open(src_fd)
                                || (!move_fd && !self.is_fd_readable(src_fd))
                            {
                                let prefix = self.diag_prefix();
                                let mut err_out = BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!("{prefix}{src_fd}: Bad file descriptor\n"),
                                    exit_code: 1,
                                };
                                self.route_outcome(&mut err_out);
                                return Ok((
                                    (saved_fd_table, saved_aliases),
                                    saved_in,
                                    local_stdin,
                                    use_local,
                                    dup_fd,
                                    Some(err_out),
                                ));
                            }
                            if self.is_fd_readable(src_fd) {
                                let rw_target = match self.fd_table.get(&src_fd) {
                                    Some(FdTarget::ReadWriteFile { path, owner_fd }) => {
                                        Some(FdTarget::ReadWriteFile {
                                            path: path.clone(),
                                            owner_fd: *owner_fd,
                                        })
                                    }
                                    _ => None,
                                };
                                if move_fd && src_fd != *fd {
                                    self.evacuate_in_fd_owner(src_fd, &mut saved_aliases);
                                }
                                let canon = if src_fd == 0 {
                                    if use_local {
                                        dup_fd.unwrap_or(0)
                                    } else {
                                        self.resolve_in_fd(0)
                                    }
                                } else {
                                    self.resolve_in_fd(src_fd)
                                };
                                if *fd == 0 {
                                    self.evacuate_in_fd_owner(0, &mut saved_aliases);
                                    record_saved_fd(&self.fd_table, &mut saved_fd_table, 0);
                                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, 0);
                                    self.fd_table.remove(&0);
                                    self.in_fd_aliases.remove(&0);
                                    if canon == STDIN_STREAM_FD {
                                        local_stdin = default_stdin.to_string();
                                        use_local = false;
                                        dup_fd = None;
                                    } else if canon != 0 {
                                        local_stdin = self
                                            .in_fds
                                            .get(&canon)
                                            .cloned()
                                            .unwrap_or_default();
                                        use_local = true;
                                        if move_fd && canon == src_fd {
                                            dup_fd = None;
                                        } else {
                                            dup_fd = Some(canon);
                                            self.in_fd_aliases.insert(0, canon);
                                        }
                                    }
                                    if let Some(rwt) = rw_target {
                                        self.fd_table.insert(0, rwt);
                                    }
                                } else {
                                    if !saved_in.iter().any(|(f, _)| f == fd) {
                                        saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                                    }
                                    self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                                    record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                                    self.fd_table.remove(fd);
                                    if let Some(rwt) = rw_target {
                                        self.fd_table.insert(*fd, rwt);
                                    }
                                    if src_fd == 0 && use_local && dup_fd.is_none() {
                                        self.in_fds.insert(*fd, local_stdin.clone());
                                        self.in_fd_aliases.remove(fd);
                                        self.in_fd_aliases.insert(0, *fd);
                                        dup_fd = Some(*fd);
                                    } else if move_fd
                                        && src_fd != *fd
                                        && canon == src_fd
                                        && src_fd != 0
                                    {
                                        if !saved_in.iter().any(|(f, _)| *f == src_fd) {
                                            saved_in
                                                .push((src_fd, self.in_fds.get(&src_fd).cloned()));
                                        }
                                        if let Some(content) = self.in_fds.remove(&src_fd) {
                                            self.in_fds.insert(*fd, content);
                                        }
                                        self.in_fd_aliases.remove(fd);
                                    } else if canon != *fd {
                                        self.in_fds.remove(fd);
                                        self.in_fd_aliases.insert(*fd, canon);
                                    }
                                }
                            } else {
                                self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                                record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                                record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                                if !saved_in.iter().any(|(f, _)| f == fd) {
                                    saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                                }
                                self.in_fds.remove(fd);
                                self.in_fd_aliases.remove(fd);
                                if let Some(inherited) = self.fd_table.get(&src_fd).cloned() {
                                    self.fd_table.insert(*fd, inherited);
                                }
                            }
                            if move_fd && src_fd != *fd {
                                record_saved_fd(&self.fd_table, &mut saved_fd_table, src_fd);
                                record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, src_fd);
                                if src_fd == 0 {
                                    self.fd_table.insert(0, FdTarget::Closed);
                                    self.in_fd_aliases.remove(&0);
                                    local_stdin.clear();
                                    use_local = true;
                                    dup_fd = None;
                                } else {
                                    if !saved_in.iter().any(|(f, _)| *f == src_fd) {
                                        saved_in.push((src_fd, self.in_fds.get(&src_fd).cloned()));
                                    }
                                    self.fd_table.insert(src_fd, FdTarget::Closed);
                                    self.in_fds.remove(&src_fd);
                                    self.in_fd_aliases.remove(&src_fd);
                                }
                            }
                        } else {
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{target}: Bad file descriptor\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    }
                }
                RedirectKind::Out(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if let Some(mut err_out) = self.check_redirect_parent_dir(&full, &target) {
                        self.route_outcome(&mut err_out);
                        return Ok((
                            (saved_fd_table, saved_aliases),
                            saved_in,
                            local_stdin,
                            use_local,
                            dup_fd,
                            Some(err_out),
                        ));
                    }
                    if self.is_noclobber_blocked(&full) {
                        let mut err_out = BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{target}: cannot overwrite existing file\n"),
                            exit_code: 1,
                        };
                        self.route_outcome(&mut err_out);
                        return Ok((
                            (saved_fd_table, saved_aliases),
                            saved_in,
                            local_stdin,
                            use_local,
                            dup_fd,
                            Some(err_out),
                        ));
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
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        if !existed {
                            self.apply_umask_to_new_file(&full);
                        }
                    }
                    self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                    if *fd == 0 {
                        self.materialize_stdin_aliases(default_stdin, &mut saved_in);
                        local_stdin.clear();
                        use_local = true;
                        dup_fd = None;
                    } else {
                        if !saved_in.iter().any(|(f, _)| f == fd) {
                            saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                        }
                        self.in_fds.remove(fd);
                    }
                    self.in_fd_aliases.remove(fd);
                    self.fd_table.insert(*fd, FdTarget::File { path: full });
                }
                RedirectKind::Clobber(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if let Some(mut err_out) = self.check_redirect_parent_dir(&full, &target) {
                        self.route_outcome(&mut err_out);
                        return Ok((
                            (saved_fd_table, saved_aliases),
                            saved_in,
                            local_stdin,
                            use_local,
                            dup_fd,
                            Some(err_out),
                        ));
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
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        if !existed {
                            self.apply_umask_to_new_file(&full);
                        }
                    }
                    self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                    if *fd == 0 {
                        self.materialize_stdin_aliases(default_stdin, &mut saved_in);
                        local_stdin.clear();
                        use_local = true;
                        dup_fd = None;
                    } else {
                        if !saved_in.iter().any(|(f, _)| f == fd) {
                            saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                        }
                        self.in_fds.remove(fd);
                    }
                    self.in_fd_aliases.remove(fd);
                    self.fd_table.insert(*fd, FdTarget::File { path: full });
                }
                RedirectKind::Append(fd) => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if let Some(mut err_out) = self.check_redirect_parent_dir(&full, &target) {
                        self.route_outcome(&mut err_out);
                        return Ok((
                            (saved_fd_table, saved_aliases),
                            saved_in,
                            local_stdin,
                            use_local,
                            dup_fd,
                            Some(err_out),
                        ));
                    }
                    if full != "/dev/null" && !self.fs.exists(&full) {
                        if let Err(e) = self.fs.write_file(&full, b"") {
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{target}: {e}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        self.apply_umask_to_new_file(&full);
                    }
                    self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                    record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                    if *fd == 0 {
                        self.materialize_stdin_aliases(default_stdin, &mut saved_in);
                        local_stdin.clear();
                        use_local = true;
                        dup_fd = None;
                    } else {
                        if !saved_in.iter().any(|(f, _)| f == fd) {
                            saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                        }
                        self.in_fds.remove(fd);
                    }
                    self.in_fd_aliases.remove(fd);
                    self.fd_table.insert(*fd, FdTarget::File { path: full });
                }
                RedirectKind::DupOut {
                    fd,
                    explicit_fd,
                    raw_move,
                } => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    if target == "-" {
                        self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                        record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                        record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                        if *fd == 0 {
                            local_stdin.clear();
                            use_local = true;
                            dup_fd = None;
                        } else {
                            if !saved_in.iter().any(|(f, _)| f == fd) {
                                saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                            }
                            self.in_fds.remove(fd);
                        }
                        self.in_fd_aliases.remove(fd);
                        self.fd_table.insert(*fd, FdTarget::Closed);
                    } else {
                        let (src_str, move_fd) = match target.strip_suffix('-') {
                            Some(s) if !s.is_empty() => (s, true),
                            _ => (target.as_str(), false),
                        };
                        let is_digits = !src_str.is_empty()
                            && src_str.chars().all(|c| c.is_ascii_digit());
                        if !is_digits && !*explicit_fd {
                            let full = resolve_posix_path(self.cwd, &target);
                            if let Some(mut err_out) =
                                self.check_redirect_parent_dir(&full, &target)
                            {
                                self.route_outcome(&mut err_out);
                                return Ok((
                                    (saved_fd_table, saved_aliases),
                                    saved_in,
                                    local_stdin,
                                    use_local,
                                    dup_fd,
                                    Some(err_out),
                                ));
                            }
                            if self.is_noclobber_blocked(&full) {
                                let mut err_out = BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!("{target}: cannot overwrite existing file\n"),
                                    exit_code: 1,
                                };
                                self.route_outcome(&mut err_out);
                                return Ok((
                                    (saved_fd_table, saved_aliases),
                                    saved_in,
                                    local_stdin,
                                    use_local,
                                    dup_fd,
                                    Some(err_out),
                                ));
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
                                    return Ok((
                                        (saved_fd_table, saved_aliases),
                                        saved_in,
                                        local_stdin,
                                        use_local,
                                        dup_fd,
                                        Some(err_out),
                                    ));
                                }
                                if !existed {
                                    self.apply_umask_to_new_file(&full);
                                }
                            }
                            record_saved_fd(&self.fd_table, &mut saved_fd_table, 1);
                            record_saved_fd(&self.fd_table, &mut saved_fd_table, 2);
                            self.fd_table
                                .insert(1, FdTarget::File { path: full.clone() });
                            self.fd_table.insert(2, FdTarget::File { path: full });
                            continue;
                        }
                        if !is_digits {
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{target}: Bad file descriptor\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        if move_fd && !*raw_move {
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{target}: ambiguous redirect\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        if is_digits && let Ok(src_fd) = src_str.parse::<u32>() {
                            if !self.is_fd_open(src_fd)
                                || (!move_fd && !self.is_fd_writable(src_fd))
                            {
                                let prefix = self.diag_prefix();
                                let mut err_out = BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!("{prefix}{src_fd}: Bad file descriptor\n"),
                                    exit_code: 1,
                                };
                                self.route_outcome(&mut err_out);
                                return Ok((
                                    (saved_fd_table, saved_aliases),
                                    saved_in,
                                    local_stdin,
                                    use_local,
                                    dup_fd,
                                    Some(err_out),
                                ));
                            }
                            self.evacuate_in_fd_owner(*fd, &mut saved_aliases);
                            record_saved_fd(&self.fd_table, &mut saved_fd_table, *fd);
                            record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, *fd);
                            if !saved_in.iter().any(|(f, _)| f == fd) {
                                saved_in.push((*fd, self.in_fds.get(fd).cloned()));
                            }
                            self.in_fds.remove(fd);
                            self.in_fd_aliases.remove(fd);
                            if *fd == 0 {
                                self.materialize_stdin_aliases(default_stdin, &mut saved_in);
                                local_stdin.clear();
                                use_local = true;
                                dup_fd = None;
                            }
                            let inherited = self
                                .fd_table
                                .get(&src_fd)
                                .cloned()
                                .unwrap_or(FdTarget::Closed);
                            if matches!(inherited, FdTarget::PipeStdout { .. }) {
                                self.env.insert(format!("__pipe_fd__{fd}"), "1".to_string());
                            } else {
                                self.env.remove(&format!("__pipe_fd__{fd}"));
                            }
                            self.fd_table.insert(*fd, inherited);
                            if move_fd && src_fd != *fd {
                                self.evacuate_in_fd_owner(src_fd, &mut saved_aliases);
                                record_saved_fd(&self.fd_table, &mut saved_fd_table, src_fd);
                                record_saved_alias(&self.in_fd_aliases, &mut saved_aliases, src_fd);
                                if src_fd == 0 {
                                    local_stdin.clear();
                                    use_local = true;
                                    dup_fd = None;
                                } else {
                                    if !saved_in.iter().any(|(f, _)| *f == src_fd) {
                                        saved_in.push((src_fd, self.in_fds.get(&src_fd).cloned()));
                                    }
                                    self.in_fds.remove(&src_fd);
                                }
                                self.in_fd_aliases.remove(&src_fd);
                                self.fd_table.insert(src_fd, FdTarget::Closed);
                            }
                        } else {
                            let prefix = self.diag_prefix();
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{prefix}{target}: Bad file descriptor\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    }
                }
                RedirectKind::BothOut => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if let Some(mut err_out) = self.check_redirect_parent_dir(&full, &target) {
                        self.route_outcome(&mut err_out);
                        return Ok((
                            (saved_fd_table, saved_aliases),
                            saved_in,
                            local_stdin,
                            use_local,
                            dup_fd,
                            Some(err_out),
                        ));
                    }
                    if self.is_noclobber_blocked(&full) {
                        let mut err_out = BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{target}: cannot overwrite existing file\n"),
                            exit_code: 1,
                        };
                        self.route_outcome(&mut err_out);
                        return Ok((
                            (saved_fd_table, saved_aliases),
                            saved_in,
                            local_stdin,
                            use_local,
                            dup_fd,
                            Some(err_out),
                        ));
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
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        if !existed {
                            self.apply_umask_to_new_file(&full);
                        }
                    }
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, 1);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, 2);
                    self.fd_table
                        .insert(1, FdTarget::File { path: full.clone() });
                    self.fd_table.insert(2, FdTarget::File { path: full });
                }
                RedirectKind::BothAppend => {
                    let target = match expand_redir_target(self, &r.target)? {
                        Ok(t) => t,
                        Err(err_out) => {
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                    };
                    let full = resolve_posix_path(self.cwd, &target);
                    if let Some(mut err_out) = self.check_redirect_parent_dir(&full, &target) {
                        self.route_outcome(&mut err_out);
                        return Ok((
                            (saved_fd_table, saved_aliases),
                            saved_in,
                            local_stdin,
                            use_local,
                            dup_fd,
                            Some(err_out),
                        ));
                    }
                    if full != "/dev/null" && !self.fs.exists(&full) {
                        if let Err(e) = self.fs.write_file(&full, b"") {
                            let mut err_out = BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{target}: {e}\n"),
                                exit_code: 1,
                            };
                            self.route_outcome(&mut err_out);
                            return Ok((
                                (saved_fd_table, saved_aliases),
                                saved_in,
                                local_stdin,
                                use_local,
                                dup_fd,
                                Some(err_out),
                            ));
                        }
                        self.apply_umask_to_new_file(&full);
                    }
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, 1);
                    record_saved_fd(&self.fd_table, &mut saved_fd_table, 2);
                    self.fd_table
                        .insert(1, FdTarget::File { path: full.clone() });
                    self.fd_table.insert(2, FdTarget::File { path: full });
                }
            }
        }

        Ok((
            (saved_fd_table, saved_aliases),
            saved_in,
            local_stdin,
            use_local,
            dup_fd,
            None,
        ))
    }

    fn restore_redirects(
        &mut self,
        saved_fds: SavedFds,
        saved_in: Vec<(u32, Option<String>)>,
    ) {
        for (fd, prev) in saved_fds.0.into_iter().rev() {
            match prev {
                Some(target) => {
                    self.fd_table.insert(fd, target);
                }
                None => {
                    self.fd_table.remove(&fd);
                }
            }
        }
        for (fd, prev) in saved_fds.1.into_iter().rev() {
            match prev {
                Some(target) => {
                    self.in_fd_aliases.insert(fd, target);
                }
                None => {
                    self.in_fd_aliases.remove(&fd);
                }
            }
        }
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
            FdTarget::Stdout | FdTarget::PipeStdout { .. } => out.stdout.push_str(data),
            FdTarget::Stderr => out.stderr.push_str(data),
            FdTarget::File { path } => {
                if path != "/dev/null" {
                    if let Err(e) = self.fs.append_file(path, &stream_string_to_bytes(data)) {
                        out.stderr.push_str(&format!("{path}: {e}\n"));
                        out.exit_code = 1;
                    }
                }
            }
            FdTarget::ReadWriteFile { path, owner_fd } => {
                if path != "/dev/null" {
                    let cur_rem = if *owner_fd == 0 {
                        self.in_fds
                            .get(&0)
                            .or_else(|| self.in_fds.get(&STDIN_STREAM_FD))
                            .map(|s| stream_string_to_bytes(s).len())
                            .unwrap_or(0)
                    } else {
                        let canon = self.resolve_in_fd(*owner_fd);
                        self.in_fds
                            .get(&canon)
                            .map(|s| stream_string_to_bytes(s).len())
                            .unwrap_or(0)
                    };
                    let last_rem = self.rw_last_rem.get(owner_fd).copied().unwrap_or(cur_rem);
                    let had_read = cur_rem < last_rem;
                    let base_off = self.rw_offsets.get(owner_fd).copied().unwrap_or(0);
                    let cur_off = if had_read {
                        base_off + last_rem.min(65536)
                    } else {
                        base_off
                    };
                    let write_bytes = stream_string_to_bytes(data);
                    let mut file_bytes = self.fs.read_file(path).unwrap_or_default();
                    let end_off = cur_off + write_bytes.len();
                    if file_bytes.len() < end_off {
                        file_bytes.resize(end_off, 0);
                    }
                    file_bytes[cur_off..end_off].copy_from_slice(&write_bytes);
                    if let Err(e) = self.fs.write_file(path, &file_bytes) {
                        out.stderr.push_str(&format!("{path}: {e}\n"));
                        out.exit_code = 1;
                    } else {
                        if !had_read {
                            let new_rem_bytes = &file_bytes[end_off..];
                            let new_rem_str = bytes_to_stream_string(new_rem_bytes);
                            if *owner_fd != 0 {
                                let canon = self.resolve_in_fd(*owner_fd);
                                if self.in_fds.contains_key(&canon) {
                                    self.in_fds.insert(canon, new_rem_str);
                                }
                            }
                            self.rw_offsets.insert(*owner_fd, end_off);
                            self.rw_last_rem.insert(*owner_fd, new_rem_bytes.len());
                        } else {
                            self.rw_offsets.insert(*owner_fd, end_off);
                            self.rw_last_rem.insert(*owner_fd, cur_rem);
                        }
                    }
                }
            }
            FdTarget::Closed => {}
        }
    }

    fn expand_arith_text(&mut self, text: &str) -> Result<String, EvalError> {
        let mut out = String::new();
        let chars: Vec<char> = text.chars().collect();
        let mut idx = 0usize;
        let mut in_dq = false;
        while idx < chars.len() {
            let c = chars[idx];
            if c == '"' {
                in_dq = !in_dq;
                idx += 1;
                continue;
            }
            if c == '\\' && idx + 1 < chars.len() {
                if chars[idx + 1] == '\n' {
                    idx += 2;
                    continue;
                }
                if matches!(chars[idx + 1], '$' | '`' | '\\' | '"' | '\'') {
                    out.push(chars[idx + 1]);
                    idx += 2;
                    continue;
                }
            }
            if c == '$' {
                let expanded = self.expand_dollar(&chars, &mut idx)?;
                out.push_str(&expanded);
                continue;
            }
            if c == '`' {
                let expanded = self.expand_backticks(&chars, &mut idx)?;
                out.push_str(&expanded);
                continue;
            }
            out.push(c);
            idx += 1;
        }
        Ok(out)
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
        let mut diag_abort: Option<(i32, String)> = None;
        let status = self.eval_db_or(args, &mut pos, true, &mut stderr, &mut diag_abort)?;
        if let Some((code, msg)) = diag_abort {
            stderr.push_str(&msg);
            return Ok((code, stderr));
        }
        Ok((status, stderr))
    }

    fn eval_db_or(
        &mut self,
        args: &[String],
        pos: &mut usize,
        active: bool,
        stderr: &mut String,
        diag_abort: &mut Option<(i32, String)>,
    ) -> Result<i32, EvalError> {
        let mut res = self.eval_db_and(args, pos, active, stderr, diag_abort)?;
        if diag_abort.is_some() {
            return Ok(res);
        }
        while args.get(*pos).map(|s| s.as_str()) == Some("||") {
            *pos += 1;
            let rhs_active = active && res != 0;
            let rhs = self.eval_db_and(args, pos, rhs_active, stderr, diag_abort)?;
            if diag_abort.is_some() {
                return Ok(rhs);
            }
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
        diag_abort: &mut Option<(i32, String)>,
    ) -> Result<i32, EvalError> {
        let mut res = self.eval_db_not(args, pos, active, stderr, diag_abort)?;
        if diag_abort.is_some() {
            return Ok(res);
        }
        while args.get(*pos).map(|s| s.as_str()) == Some("&&") {
            *pos += 1;
            let rhs_active = active && res == 0;
            let rhs = self.eval_db_not(args, pos, rhs_active, stderr, diag_abort)?;
            if diag_abort.is_some() {
                return Ok(rhs);
            }
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
        diag_abort: &mut Option<(i32, String)>,
    ) -> Result<i32, EvalError> {
        if args.get(*pos).map(|s| s.as_str()) == Some("!") {
            *pos += 1;
            let inner = self.eval_db_not(args, pos, active, stderr, diag_abort)?;
            if diag_abort.is_some() {
                return Ok(inner);
            }
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
            let val = self.eval_db_or(args, pos, active, stderr, diag_abort)?;
            if args.get(*pos).map(|s| s.as_str()) == Some(")") {
                *pos += 1;
            }
            return Ok(val);
        }
        self.eval_db_primary(args, pos, active, stderr, diag_abort)
    }

    fn eval_db_primary(
        &mut self,
        args: &[String],
        pos: &mut usize,
        active: bool,
        stderr: &mut String,
        diag_abort: &mut Option<(i32, String)>,
    ) -> Result<i32, EvalError> {
        if *pos >= args.len() {
            return Ok(1);
        }
        if *pos + 2 < args.len()
            && let Some(op) = args.get(*pos + 1).map(|s| s.as_str())
            && crate::shell::parser::is_conditional_binary_op(op)
            && crate::shell::parser::is_conditional_operand(&args[*pos + 2])
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
            fn get_non_empty<'e>(env: &'e BTreeMap<String, String>, key: &str) -> Option<&'e str> {
                env.get(key).filter(|s| !s.is_empty()).map(|s| s.as_str())
            }
            let collation = get_non_empty(self.env, "LC_ALL")
                .or_else(|| get_non_empty(self.env, "LC_COLLATE"))
                .or_else(|| get_non_empty(self.env, "LANG"))
                .unwrap_or("C")
                .to_string();
            let char_locale = get_non_empty(self.env, "LC_ALL")
                .or_else(|| get_non_empty(self.env, "LC_CTYPE"))
                .or_else(|| get_non_empty(self.env, "LANG"))
                .unwrap_or("C")
                .to_string();
            let is_c_loc = |loc: &str| matches!(loc, "C" | "POSIX" | "C.UTF-8" | "C.utf8");
            let is_utf8_loc = |loc: &str| {
                loc.split('.')
                    .nth(1)
                    .and_then(|s| s.split('@').next())
                    .is_some_and(|enc| {
                        enc.eq_ignore_ascii_case("utf-8") || enc.eq_ignore_ascii_case("utf8")
                    })
            };
            if matches!(op, "=" | "==" | "!=") {
                let right = self.expand_word_for_pattern(raw_right)?;
                if !is_c_loc(&collation) && !is_utf8_loc(&collation) {
                    *diag_abort = Some((
                        2,
                        "[[ collation locale: unsupported conditional profile\n".to_string(),
                    ));
                    return Ok(2);
                }
                let pat_chars: Vec<char> = right.chars().collect();
                let mut bracket = false;
                let mut bracket_start = 0usize;
                let mut pi = 0usize;
                while pi < pat_chars.len() {
                    let ch = pat_chars[pi];
                    if ch == '\\' {
                        pi += 2;
                        continue;
                    }
                    if bracket
                        && ch == '-'
                        && pi > bracket_start + 1
                        && pat_chars.get(pi + 1) != Some(&']')
                        && !is_c_loc(&collation)
                    {
                        *diag_abort = Some((
                            2,
                            "[[ collation locale: unsupported conditional profile\n".to_string(),
                        ));
                        return Ok(2);
                    }
                    if ch == '[' && !bracket {
                        bracket = true;
                        bracket_start = pi
                            + if matches!(pat_chars.get(pi + 1), Some('!' | '^')) {
                                1
                            } else {
                                0
                            };
                    } else if ch == '[' && bracket {
                        match pat_chars.get(pi + 1).copied() {
                            Some('.' | '=') => {
                                *diag_abort = Some((
                                    2,
                                    "[[ bracket collation: unsupported conditional profile\n"
                                        .to_string(),
                                ));
                                return Ok(2);
                            }
                            Some(':') => {
                                if !matches!(char_locale.as_str(), "C" | "POSIX") {
                                    *diag_abort = Some((
                                        2,
                                        "[[ locale character class: unsupported conditional profile\n"
                                            .to_string(),
                                    ));
                                    return Ok(2);
                                }
                                while pi + 1 < pat_chars.len()
                                    && !(pat_chars[pi] == ':' && pat_chars[pi + 1] == ']')
                                {
                                    pi += 1;
                                }
                                if pi + 1 < pat_chars.len() {
                                    pi += 1;
                                }
                            }
                            _ => {}
                        }
                    } else if ch == ']' && bracket && pi > bracket_start + 1 {
                        bracket = false;
                    }
                    pi += 1;
                }
                let matched = glob_match_ext(&right, &left, nocase);
                let ok = if op == "!=" { !matched } else { matched };
                return Ok(if ok { 0 } else { 1 });
            }
            let right = self.expand_word_to_string(raw_right)?;
            if matches!(op, "<" | ">") && !is_c_loc(&collation) && !is_utf8_loc(&collation) {
                *diag_abort = Some((
                    2,
                    "[[ collation locale: unsupported conditional profile\n".to_string(),
                ));
                return Ok(2);
            }
            if matches!(op, "-eq" | "-ne" | "-lt" | "-le" | "-gt" | "-ge") {
                let l_src = if left.trim().is_empty() {
                    "0".to_string()
                } else {
                    self.expand_arith_text(&left)?
                };
                let r_src = if right.trim().is_empty() {
                    "0".to_string()
                } else {
                    self.expand_arith_text(&right)?
                };
                let eval_db_num = |src: &str,
                                   env: &mut BTreeMap<String, String>,
                                   diag_abort: &mut Option<(i32, String)>|
                 -> Result<Option<i64>, EvalError> {
                    match eval_arith(src, env) {
                        Ok(v) => Ok(Some(v)),
                        Err(e) => {
                            if e.starts_with("__nounset__")
                                || e.starts_with("__param_err__")
                                || e.contains("readonly variable")
                            {
                                return Err(EvalError::Syntax(e));
                            }
                            let formatted = if e == "Division by zero" {
                                let trimmed = src.trim_start();
                                let err_tok = trimmed
                                    .rsplit_once(['/', '%'])
                                    .map(|(_, rhs)| rhs.trim_start())
                                    .unwrap_or("0");
                                format!(
                                    "[[: {trimmed}: division by 0 (error token is \"{err_tok}\")\n"
                                )
                            } else {
                                format!("[[: {e}\n")
                            };
                            *diag_abort = Some((1, formatted));
                            Ok(None)
                        }
                    }
                };
                let Some(l) = eval_db_num(&l_src, self.env, diag_abort)? else {
                    return Ok(1);
                };
                let Some(r) = eval_db_num(&r_src, self.env, diag_abort)? else {
                    return Ok(1);
                };
                let ok = match op {
                    "-eq" => l == r,
                    "-ne" => l != r,
                    "-lt" => l < r,
                    "-le" => l <= r,
                    "-gt" => l > r,
                    _ => l >= r,
                };
                return Ok(if ok { 0 } else { 1 });
            }
            let stat_nonempty = |raw: &str| {
                if raw.is_empty() {
                    Err("empty path".to_string())
                } else {
                    self.fs.stat(&resolve_posix_path(self.cwd, raw))
                }
            };
            let ok = match op {
                "<" => left < right,
                ">" => left > right,
                "-nt" => match (stat_nonempty(&left), stat_nonempty(&right)) {
                    (Ok(ls), Ok(rs)) => ls.mtime_ms > rs.mtime_ms,
                    (Ok(_), Err(_)) => true,
                    _ => false,
                },
                "-ot" => match (stat_nonempty(&left), stat_nonempty(&right)) {
                    (Ok(ls), Ok(rs)) => ls.mtime_ms < rs.mtime_ms,
                    (Err(_), Ok(_)) => true,
                    _ => false,
                },
                "-ef" => {
                    stat_nonempty(&left).is_ok()
                        && stat_nonempty(&right).is_ok()
                        && resolve_physical_path(self.cwd, &left, self.fs)
                            == resolve_physical_path(self.cwd, &right, self.fs)
                }
                _ => false,
            };
            return Ok(if ok { 0 } else { 1 });
        }
        if *pos + 1 < args.len()
            && crate::shell::parser::is_conditional_unary_op(args[*pos].as_str())
            && crate::shell::parser::is_conditional_operand(args[*pos + 1].as_str())
        {
            let op = args[*pos].as_str();
            let raw_val = &args[*pos + 1];
            *pos += 2;
            if !active {
                return Ok(1);
            }
            let val = self.expand_word_to_string(raw_val)?;
            if !matches!(op, "-z" | "-n" | "-t" | "-v" | "-R" | "-o")
                && (val == "/dev/fd"
                    || val.starts_with("/dev/fd/")
                    || matches!(val.as_str(), "/dev/stdin" | "/dev/stdout" | "/dev/stderr"))
            {
                *diag_abort = Some((
                    2,
                    "[[ descriptor predicate: unsupported conditional profile\n".to_string(),
                ));
                return Ok(2);
            }
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
                if let Some(pwd) = self.env.get("PWD").cloned() {
                    fragments.push((pwd, true));
                    idx = 2;
                }
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
                fragments.push((
                    decode_ansi_c_escapes_with_locale(&raw, self.is_unit_byte_locale()),
                    true,
                ));
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
                        let prev_dq = self.env.insert("__in_dquote".to_string(), "1".to_string());
                        let exp = self.expand_backticks(&chars, &mut idx);
                        match prev_dq {
                            Some(v) => {
                                self.env.insert("__in_dquote".to_string(), v);
                            }
                            None => {
                                self.env.remove("__in_dquote");
                            }
                        }
                        let exp = exp?;
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
        expand_tilde_prefix(word, self.env, allow_after_colon, false)
    }

    fn collect_word_segments(
        &mut self,
        word: &str,
        escape_quoted_glob: bool,
        split_plain_text: bool,
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
                let decoded =
                    decode_ansi_c_escapes_with_locale(&raw, self.is_unit_byte_locale());
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
                        let prev_dq = self.env.insert("__in_dquote".to_string(), "1".to_string());
                        let exp = self.expand_backticks(&chars, &mut idx);
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
                idx += 1;
                let sub_cmd = scan_nested_command_sub(&chars, &mut idx)?;
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
                    let (pre_expr, temp_keys) = self.preprocess_param_expr_cmdsubs(&expr)?;
                    if let Some(alt_raw) = try_resolve_unquoted_alternate_operand(
                        &pre_expr,
                        self.env,
                        self.last_exit,
                        &self.pos_args,
                    ) {
                        let alt_owned = alt_raw.to_string();
                        idx = probe_idx;
                        let tilded_alt = self.expand_tilde_in_word(&alt_owned, false);
                        let seg_res = self.collect_word_segments(
                            &tilded_alt,
                            escape_quoted_glob,
                            true,
                            segments,
                        );
                        for tk in temp_keys {
                            self.env.remove(&tk);
                        }
                        seg_res?;
                        continue;
                    }
                    for tk in temp_keys {
                        self.env.remove(&tk);
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
            if split_plain_text {
                segments.push(WordSeg::Split(plain));
            } else {
                segments.push(WordSeg::Literal(plain));
            }
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
        self.collect_word_segments(word, escape_quoted_glob, false, &mut segments)?;

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
                    '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '@' | '+' | '!' | ':'
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
        let extglob = self
            .env
            .get("__shopt_extglob")
            .map(|v| v == "1")
            .unwrap_or(false);
        for field in fields {
            if !has_glob_meta_ext(&field.pattern, extglob) {
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
            if failglob && expanded.is_empty() {
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
            match crate::shell::lexer::find_arithmetic_end(chars, *idx + 2, true) {
                Ok(Some((expr_end, resume_idx))) => {
                    let expr: String = chars[*idx + 2..expr_end].iter().collect();
                    *idx = resume_idx;
                    let expanded_expr = self.expand_arith_text(&expr)?;
                    let val = eval_arith(&expanded_expr, self.env).map_err(EvalError::Syntax)?;
                    return Ok(val.to_string());
                }
                Ok(None) => {}
                Err(msg) => return Err(EvalError::Syntax(msg)),
            }
        }
        if chars[*idx] == '(' {
            let cmd_str = scan_nested_command_sub(chars, idx)?;
            self.retire_notified_jobs();
            return self.run_command_substitution(&cmd_str);
        }
        if chars[*idx] == '{' {
            let expr = scan_nested_brace_sub(chars, idx)?;
            let (pre_expr, temp_keys) = self.preprocess_param_expr_cmdsubs(&expr)?;
            let var_end = find_var_name_end(&pre_expr);
            if var_end > 0 {
                let var_part = &pre_expr[..var_end];
                let op_rest = &pre_expr[var_end..];
                if let Some(pat_raw) = op_rest
                    .strip_prefix("##")
                    .or_else(|| op_rest.strip_prefix('#'))
                    .or_else(|| op_rest.strip_prefix("%%"))
                    .or_else(|| op_rest.strip_prefix('%'))
                {
                    let val_len = self.env.get(var_part).map(|s| s.len()).unwrap_or(0);
                    if 128 + (val_len + pat_raw.len()) * 4 > self.budget.limits.max_expansion_bytes
                    {
                        for tk in temp_keys {
                            self.env.remove(&tk);
                        }
                        return Err(EvalError::Budget(format!(
                            "Execution aborted: Shell limit exceeded: maxExpansionBytes ({})",
                            self.budget.limits.max_expansion_bytes
                        )));
                    }
                }
            }
            let res = expand_parameter_expr(&pre_expr, self.env, self.last_exit, &self.pos_args)
                .map_err(EvalError::Syntax);
            for tk in temp_keys {
                self.env.remove(&tk);
            }
            return res;
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

    fn preprocess_param_expr_cmdsubs(
        &mut self,
        expr: &str,
    ) -> Result<(String, Vec<String>), EvalError> {
        if !expr.contains("$(") && !expr.contains('`') {
            return Ok((expr.to_string(), Vec::new()));
        }
        let var_end = find_var_name_end(expr);
        let var_part = &expr[..var_end];
        let rest = &expr[var_end..];
        let mut temp_keys = Vec::new();

        let expand_cmdsubs_in_str =
            |this: &mut Self, s: &str, keys: &mut Vec<String>| -> Result<String, EvalError> {
                let chars: Vec<char> = s.chars().collect();
                let mut idx = 0usize;
                let mut out = String::new();
                let mut in_sq = false;
                let mut in_dq = false;
                while idx < chars.len() {
                    let c = chars[idx];
                    if in_sq {
                        out.push(c);
                        idx += 1;
                        if c == '\'' {
                            in_sq = false;
                        }
                        continue;
                    }
                    if c == '\\' && idx + 1 < chars.len() {
                        out.push(c);
                        out.push(chars[idx + 1]);
                        idx += 2;
                        continue;
                    }
                    if c == '\'' && !in_dq {
                        in_sq = true;
                        out.push(c);
                        idx += 1;
                        continue;
                    }
                    if c == '"' {
                        in_dq = !in_dq;
                        out.push(c);
                        idx += 1;
                        continue;
                    }
                    if c == '$' && idx + 1 < chars.len() && chars[idx + 1] == '(' {
                        if idx + 2 < chars.len() && chars[idx + 2] == '(' {
                            if let Ok(Some((_e, r_idx))) =
                                crate::shell::lexer::find_arithmetic_end(&chars, idx + 3, true)
                            {
                                let seg: String = chars[idx..r_idx].iter().collect();
                                out.push_str(&seg);
                                idx = r_idx;
                                continue;
                            }
                        }
                        idx += 1;
                        let cmd_str = scan_nested_command_sub(&chars, &mut idx)?;
                        this.retire_notified_jobs();
                        let val = this.run_command_substitution(&cmd_str)?;
                        this.cmdsub_seq += 1;
                        let key = format!("__cmdsub_{}__", this.cmdsub_seq);
                        this.env.insert(key.clone(), val);
                        keys.push(key.clone());
                        out.push_str(&format!("${{{key}}}"));
                        continue;
                    }
                    if c == '`' {
                        let val = this.expand_backticks(&chars, &mut idx)?;
                        this.cmdsub_seq += 1;
                        let key = format!("__cmdsub_{}__", this.cmdsub_seq);
                        this.env.insert(key.clone(), val);
                        keys.push(key.clone());
                        out.push_str(&format!("${{{key}}}"));
                        continue;
                    }
                    out.push(c);
                    idx += 1;
                }
                Ok(out)
            };

        let new_var_part = if var_part.contains("$(") || var_part.contains('`') {
            if let Some(br_open) = var_part.find('[')
                && var_part.ends_with(']')
            {
                let base = &var_part[..br_open];
                let sub = &var_part[br_open + 1..var_part.len() - 1];
                let exp_sub = expand_cmdsubs_in_str(self, sub, &mut temp_keys)?;
                format!("{base}[{exp_sub}]")
            } else {
                var_part.to_string()
            }
        } else {
            var_part.to_string()
        };

        if rest.is_empty() || (!rest.contains("$(") && !rest.contains('`')) {
            return Ok((format!("{new_var_part}{rest}"), temp_keys));
        }

        for op in [":-", "-", ":=", "=", ":?", "?", ":+", "+"] {
            if let Some(operand) = rest.strip_prefix(op) {
                if is_param_operand_active(
                    &new_var_part,
                    op,
                    self.env,
                    self.last_exit,
                    &self.pos_args,
                ) {
                    let exp_op = expand_cmdsubs_in_str(self, operand, &mut temp_keys)?;
                    return Ok((format!("{new_var_part}{op}{exp_op}"), temp_keys));
                } else {
                    return Ok((format!("{new_var_part}{rest}"), temp_keys));
                }
            }
        }

        let exp_rest = expand_cmdsubs_in_str(self, rest, &mut temp_keys)?;
        Ok((format!("{new_var_part}{exp_rest}"), temp_keys))
    }

    fn expand_backticks(&mut self, chars: &[char], idx: &mut usize) -> Result<String, EvalError> {
        *idx += 1;
        let in_dq = self.env.get("__in_dquote").is_some_and(|v| v == "1");
        let mut cmd_str = String::new();
        while *idx < chars.len() && chars[*idx] != '`' {
            if chars[*idx] == '\\' && *idx + 1 < chars.len() {
                let nc = chars[*idx + 1];
                if matches!(nc, '`' | '$' | '\\') || (in_dq && nc == '"') {
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
        for (rk, rv) in &self.redirect_assignments {
            sub_env.insert(rk.clone(), rv.clone());
            sub_env.remove(&format!("__unexported__{rk}"));
        }
        let mut sub = self.make_child(&mut sub_cwd, &mut sub_env);
        sub.in_cmdsub_file_shortcut = is_cmdsub_file_shortcut(cmd_str);
        let inherit_errexit = self
            .env
            .get("__shopt_inherit_errexit")
            .map(|v| v == "1")
            .unwrap_or(false)
            || self
                .env
                .get("__set_posix")
                .map(|v| v == "1")
                .unwrap_or(false);
        sub.errexit = inherit_errexit && self.errexit;
        sub.env.insert(
            "__set_errexit".to_string(),
            if sub.errexit { "1" } else { "0" }.to_string(),
        );
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
                stderr: format!(
                    "{}\n",
                    msg.strip_prefix("__param_err__")
                        .or_else(|| msg.strip_prefix("__nounset__"))
                        .unwrap_or(&msg)
                ),
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
        let cleaned = if raw.contains('\0') {
            let msg = format!(
                "{}warning: command substitution: ignored null byte in input\n",
                self.diag_prefix()
            );
            let fd2 = self.fd_table.get(&2).cloned().unwrap_or(FdTarget::Stderr);
            let mut dummy = BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            };
            self.write_to_fd_target(&fd2, &msg, &mut dummy);
            self.pending_stdout.push_str(&dummy.stdout);
            self.pending_stderr.push_str(&dummy.stderr);
            raw.replace('\0', "")
        } else {
            raw
        };
        Ok(cleaned.trim_end_matches('\n').to_string())
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

    fn parent_job_entries(&self) -> Vec<(u32, u32, String)> {
        let mut entries: Vec<(u32, u32, String)> = self
            .env
            .keys()
            .filter_map(|k| {
                k.strip_prefix("__parent_job_id__")
                    .and_then(|p| p.parse::<u32>().ok())
            })
            .map(|pid| {
                let job_id = self
                    .env
                    .get(&format!("__parent_job_id__{pid}"))
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(1);
                let cmd = self
                    .env
                    .get(&format!("__parent_job_cmd__{pid}"))
                    .cloned()
                    .unwrap_or_else(|| pid.to_string());
                (job_id, pid, cmd)
            })
            .collect();
        entries.sort_by_key(|(jid, pid, _)| (*jid, *pid));
        entries
    }

    fn retire_notified_jobs(&mut self) {
        let notified_pids: Vec<String> = self
            .env
            .keys()
            .filter_map(|k| k.strip_prefix("__job_notified__").map(|s| s.to_string()))
            .collect();
        for pid in notified_pids {
            if !self.env.contains_key(&format!("__job_saved__{pid}")) {
                self.env
                    .insert(format!("__job_saved__{pid}"), "1".to_string());
                self.env.remove(&format!("__job_active__{pid}"));
            }
        }
    }

    fn forget_job(&mut self, pid: u32) {
        self.env.remove(&format!("__job_active__{pid}"));
        self.env.remove(&format!("__job_status__{pid}"));
        self.env.remove(&format!("__job_notified__{pid}"));
        self.env.remove(&format!("__job_saved__{pid}"));
        self.env.remove(&format!("__job_settled__{pid}"));
        self.env.remove(&format!("__job_id__{pid}"));
        self.env.remove(&format!("__job_cmd__{pid}"));
    }

    fn parse_wait_pid(operand: &str, flexible: bool) -> Option<i64> {
        let bytes = stream_string_to_bytes(operand);
        let mut offset = 0usize;
        let mut negative = false;
        let is_c_space = |b: u8| b == b' ' || (9..=13).contains(&b);
        if flexible {
            while offset < bytes.len() && is_c_space(bytes[offset]) {
                offset += 1;
            }
            if offset < bytes.len() && (bytes[offset] == b'+' || bytes[offset] == b'-') {
                negative = bytes[offset] == b'-';
                offset += 1;
            }
        }
        let first_digit = offset;
        let max_val: i64 = 2_147_483_647 + if negative { 1 } else { 0 };
        let mut value: i64 = 0;
        while offset < bytes.len() {
            let b = bytes[offset];
            if !b.is_ascii_digit() {
                break;
            }
            value = value * 10 + (b - b'0') as i64;
            if value > max_val {
                return None;
            }
            offset += 1;
        }
        if offset == first_digit {
            return None;
        }
        while offset < bytes.len() {
            if !is_c_space(bytes[offset]) {
                return None;
            }
            offset += 1;
        }
        Some(if negative { -value } else { value })
    }

    fn resolve_job_operand(&self, operand: &str) -> Option<u32> {
        self.resolve_job_operand_ex(operand, false)
    }

    fn resolve_job_operand_ex(&self, operand: &str, flexible: bool) -> Option<u32> {
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
            if let Some(jid) = Self::parse_wait_pid(spec, false).and_then(|v| u32::try_from(v).ok())
            {
                return entries
                    .iter()
                    .find(|(id, _, _)| *id == jid)
                    .map(|(_, pid, _)| *pid);
            }
            return None;
        }
        let pid_i64 = Self::parse_wait_pid(operand, flexible)?;
        let pid = u32::try_from(pid_i64).ok()?;
        if self.env.contains_key(&format!("__job_status__{pid}"))
            || self.env.contains_key(&format!("__job_active__{pid}"))
        {
            Some(pid)
        } else {
            None
        }
    }

    fn builtin_wait(&mut self, args: &[String]) -> BuiltinOutcome {
        let prefix = self.diag_prefix();
        let mut offset = 0usize;
        let mut next_mode = false;
        let mut dest_var: Option<String> = None;
        while offset < args.len() {
            let opt_bytes = stream_string_to_bytes(&args[offset]);
            if opt_bytes.len() < 2 || opt_bytes[0] != b'-' {
                break;
            }
            offset += 1;
            if opt_bytes == b"--" {
                break;
            }
            let mut i = 1usize;
            while i < opt_bytes.len() {
                match opt_bytes[i] {
                    b'f' => {}
                    b'n' => next_mode = true,
                    b'p' => {
                        let v = if i + 1 < opt_bytes.len() {
                            Some(bytes_to_stream_string(&opt_bytes[i + 1..]))
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
                                stderr: format!(
                                    "{prefix}wait: -p: option requires an argument\nwait: usage: wait [-fn] [-p var] [id ...]\n"
                                ),
                                exit_code: 2,
                            };
                        };
                        dest_var = Some(var_name);
                        break;
                    }
                    byte => {
                        let bad_opt = bytes_to_stream_string(&[byte]);
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!(
                                "{prefix}wait: -{bad_opt}: invalid option\nwait: usage: wait [-fn] [-p var] [id ...]\n"
                            ),
                            exit_code: 2,
                        };
                    }
                }
                i += 1;
            }
        }

        let mut dest_base_and_sub: Option<(String, Option<String>)> = None;
        if let Some(ref var_name) = dest_var {
            let parsed = if let Some((base, rest)) = var_name.split_once('[') {
                if let Some(sub) = rest.strip_suffix(']') {
                    if is_valid_shell_ident(base)
                        && !sub.is_empty()
                        && !sub.contains('[')
                        && !sub.contains(']')
                    {
                        Some((base.to_string(), Some(sub.to_string())))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else if is_valid_shell_ident(var_name) {
                Some((var_name.clone(), None))
            } else {
                None
            };
            let Some((base, sub_opt)) = parsed else {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{prefix}wait: `{var_name}': not a valid identifier\n"),
                    exit_code: 1,
                };
            };
            if sub_opt.is_none() {
                if self
                    .env
                    .get(&format!("__attr__{base}"))
                    .is_some_and(|a| a.contains('r'))
                {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!(
                            "{prefix}wait: {base}: cannot unset: readonly variable\n"
                        ),
                        exit_code: 1,
                    };
                }
                self.env.remove(&base);
                self.env.remove(&format!("__declared__{base}"));
                self.env.remove(&format!("__assoc__{base}"));
                self.env.remove(&format!("__keys__{base}"));
                let arr_prefix = format!("{base}[");
                let arr_keys: Vec<String> = self
                    .env
                    .keys()
                    .filter(|k| k.starts_with(&arr_prefix))
                    .cloned()
                    .collect();
                for k in arr_keys {
                    self.env.remove(&k);
                }
            }
            dest_base_and_sub = Some((base, sub_opt));
        }

        let publish_dest = |this: &mut Self,
                            var_name: &Option<String>,
                            base_and_sub: &Option<(String, Option<String>)>,
                            pid: Option<u32>,
                            mut stderr: String,
                            code: i32|
         -> BuiltinOutcome {
            if let (Some(vn), Some((base, _)), Some(p)) = (var_name, base_and_sub, pid) {
                if this
                    .env
                    .get(&format!("__attr__{base}"))
                    .is_some_and(|a| a.contains('r'))
                {
                    stderr.push_str(&format!("{prefix}wait: {base}: readonly variable\n"));
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr,
                        exit_code: 1,
                    };
                }
                if let Err(EvalError::Syntax(msg)) =
                    this.assign_variable(vn, &p.to_string(), false)
                {
                    stderr.push_str(&format!("{prefix}wait: {msg}\n"));
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr,
                        exit_code: 1,
                    };
                }
            }
            BuiltinOutcome {
                stdout: String::new(),
                stderr,
                exit_code: code,
            }
        };

        let operands = &args[offset..];
        if next_mode {
            for op in operands {
                if let Some(pid) = self.resolve_job_operand_ex(op, true)
                    && self
                        .env
                        .get(&format!("__job_saved__{pid}"))
                        .is_some_and(|v| v == "1")
                {
                    let saved_code = self
                        .env
                        .get(&format!("__job_status__{pid}"))
                        .and_then(|s| s.parse::<i32>().ok())
                        .unwrap_or(0);
                    return publish_dest(
                        self,
                        &dest_var,
                        &dest_base_and_sub,
                        Some(pid),
                        String::new(),
                        saved_code,
                    );
                }
            }
            let mut stderr = String::new();
            let mut candidate_pids: Vec<u32> = Vec::new();
            if operands.is_empty() {
                candidate_pids = self
                    .env
                    .keys()
                    .filter_map(|k| {
                        k.strip_prefix("__job_status__")
                            .and_then(|p| p.parse::<u32>().ok())
                    })
                    .filter(|pid| {
                        !self
                            .env
                            .get(&format!("__job_saved__{pid}"))
                            .is_some_and(|v| v == "1")
                    })
                    .collect();
            } else {
                for op in operands {
                    let parsed_pid = Self::parse_wait_pid(op, true);
                    let handle_pid = self.resolve_job_operand_ex(op, true);
                    if let Some(pid) = handle_pid
                        && !self
                            .env
                            .get(&format!("__job_saved__{pid}"))
                            .is_some_and(|v| v == "1")
                    {
                        if !candidate_pids.contains(&pid) {
                            candidate_pids.push(pid);
                        }
                        continue;
                    }
                    if (parsed_pid.is_none() || parsed_pid == Some(-1))
                        && !op.is_empty()
                        && !op.starts_with('%')
                    {
                        stderr.push_str(&format!(
                            "{prefix}wait: warning: {op}: job specification requires leading `%'\n"
                        ));
                    }
                    if op.starts_with('%') {
                        stderr.push_str(&format!("{prefix}wait: `{op}': no such job\n"));
                    } else {
                        stderr.push_str(&format!(
                            "{prefix}wait: `{op}': not a pid or valid job spec\n"
                        ));
                    }
                }
                if candidate_pids.is_empty() {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr,
                        exit_code: 127,
                    };
                }
            }
            let mut eligible: Vec<(u32, u32)> = candidate_pids
                .into_iter()
                .filter(|pid| {
                    !self
                        .env
                        .get(&format!("__job_saved__{pid}"))
                        .is_some_and(|v| v == "1")
                        && !self
                            .env
                            .get(&format!("__job_notified__{pid}"))
                            .is_some_and(|v| v == "1")
                })
                .map(|pid| {
                    let jid = self
                        .env
                        .get(&format!("__job_id__{pid}"))
                        .and_then(|s| s.parse::<u32>().ok())
                        .unwrap_or(1);
                    (jid, pid)
                })
                .collect();
            eligible.sort_by_key(|(jid, pid)| (*jid, *pid));
            if let Some((_, ready_pid)) = eligible.first().copied() {
                self.env
                    .insert(format!("__job_notified__{ready_pid}"), "1".to_string());
                self.env
                    .insert(format!("__job_saved__{ready_pid}"), "1".to_string());
                self.env.remove(&format!("__job_active__{ready_pid}"));
                let code = self
                    .env
                    .get(&format!("__job_status__{ready_pid}"))
                    .and_then(|s| s.parse::<i32>().ok())
                    .unwrap_or(0);
                return publish_dest(
                    self,
                    &dest_var,
                    &dest_base_and_sub,
                    Some(ready_pid),
                    stderr,
                    code,
                );
            }
            return BuiltinOutcome {
                stdout: String::new(),
                stderr,
                exit_code: 127,
            };
        }

        if operands.is_empty() {
            let latest_pid = self.env.get("!").and_then(|s| s.parse::<u32>().ok());
            let all_pids: Vec<u32> = self
                .env
                .keys()
                .filter_map(|k| {
                    k.strip_prefix("__job_status__")
                        .or_else(|| k.strip_prefix("__job_active__"))
                        .and_then(|p| p.parse::<u32>().ok())
                })
                .collect();
            for p in all_pids {
                if Some(p) == latest_pid
                    && !self
                        .env
                        .get(&format!("__job_notified__{p}"))
                        .is_some_and(|v| v == "1")
                    && !self
                        .env
                        .get(&format!("__job_saved__{p}"))
                        .is_some_and(|v| v == "1")
                    && self
                        .env
                        .get(&format!("__job_settled__{p}"))
                        .is_some_and(|v| v == "1")
                {
                    continue;
                }
                self.forget_job(p);
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
            let parsed_pid = Self::parse_wait_pid(op, false);
            last_waited_pid = None;
            let handle_pid = self.resolve_job_operand_ex(op, false);
            if op.starts_with('%') {
                let Some(pid) = handle_pid else {
                    stderr.push_str(&format!("{prefix}wait: `{op}': no such job\n"));
                    code = 127;
                    continue;
                };
                if !self
                    .env
                    .get(&format!("__job_saved__{pid}"))
                    .is_some_and(|v| v == "1")
                {
                    self.retire_notified_jobs();
                }
                self.env
                    .insert(format!("__job_notified__{pid}"), "1".to_string());
                self.env.remove(&format!("__job_active__{pid}"));
                code = self
                    .env
                    .get(&format!("__job_status__{pid}"))
                    .and_then(|s| s.parse::<i32>().ok())
                    .unwrap_or(0);
                last_waited_pid = Some(pid);
                continue;
            }
            let Some(pid_i64) = parsed_pid else {
                stderr.push_str(&format!(
                    "{prefix}wait: `{op}': not a pid or valid job spec\n"
                ));
                code = 1;
                if op.as_bytes().first().is_some_and(|b| b.is_ascii_digit()) {
                    last_waited_pid = None;
                    break;
                }
                continue;
            };
            let Some(pid) = handle_pid else {
                stderr.push_str(&format!(
                    "{prefix}wait: pid {pid_i64} is not a child of this shell\n"
                ));
                code = 127;
                last_waited_pid = None;
                continue;
            };
            if !self
                .env
                .get(&format!("__job_saved__{pid}"))
                .is_some_and(|v| v == "1")
            {
                self.retire_notified_jobs();
            }
            self.env
                .insert(format!("__job_notified__{pid}"), "1".to_string());
            self.env.remove(&format!("__job_active__{pid}"));
            if let Some(st) = self.env.get(&format!("__job_status__{pid}")) {
                code = st.parse::<i32>().unwrap_or(0);
            } else {
                code = 127;
            }
            last_waited_pid = Some(pid);
        }
        publish_dest(
            self,
            &dest_var,
            &dest_base_and_sub,
            last_waited_pid,
            stderr,
            code,
        )
    }

    fn builtin_jobs(&self, args: &[String]) -> BuiltinOutcome {
        let prefix = self.diag_prefix();
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
                    stderr: format!("{prefix}jobs: {opt}: invalid option\n"),
                    exit_code: 2,
                };
            }
        }
        let own_entries = self.active_job_entries();
        let entries = if own_entries.is_empty() {
            self.parent_job_entries()
        } else {
            own_entries
        };
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
        let resolve_from_entries = |spec: &str| -> Option<u32> {
            if let Some(s) = spec.strip_prefix('%') {
                if s.is_empty() || s == "%" || s == "+" {
                    return entries.last().map(|(_, pid, _)| *pid);
                }
                if s == "-" {
                    return if entries.len() >= 2 {
                        Some(entries[entries.len() - 2].1)
                    } else {
                        None
                    };
                }
                if let Some(jid) = Self::parse_wait_pid(s, false).and_then(|v| u32::try_from(v).ok())
                {
                    return entries
                        .iter()
                        .find(|(id, _, _)| *id == jid)
                        .map(|(_, pid, _)| *pid);
                }
                return None;
            }
            None
        };
        for op in &args[offset..] {
            let spec = if op.starts_with('%') {
                op.clone()
            } else {
                format!("%{op}")
            };
            let resolved = resolve_from_entries(&spec)
                .or_else(|| self.resolve_job_operand(&spec))
                .or_else(|| self.resolve_job_operand(op));
            let Some(pid) = resolved else {
                stderr.push_str(&format!("{prefix}jobs: {op}: no such job\n"));
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
        let prefix = self.diag_prefix();
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
                            stderr: format!("{prefix}disown: -{ch}: invalid option\n"),
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
                        self.forget_job(pid);
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
                    stderr: format!("{prefix}disown: current: no such job\n"),
                    exit_code: 1,
                };
            };
            if !nohup_only {
                self.forget_job(*cur_pid);
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
                stderr.push_str(&format!("{prefix}disown: {op}: no such job\n"));
                status = 1;
                continue;
            };
            if !nohup_only {
                self.forget_job(pid);
            }
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code: status,
        }
    }

    fn builtin_kill(&mut self, args: &[String]) -> BuiltinOutcome {
        let prefix = self.diag_prefix();
        let catalog = Self::trap_signal_catalog();
        let lookup_sig = |spec: &str| -> Option<u32> {
            if let Some(num) = Self::parse_wait_pid(spec, false).and_then(|v| u32::try_from(v).ok())
            {
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
                if let Some(mut num) =
                    Self::parse_wait_pid(op, false).and_then(|v| u32::try_from(v).ok())
                {
                    if num > 128 {
                        num -= 128;
                    }
                    if let Some((_, name)) = catalog.iter().find(|(n, _)| *n == num) {
                        out.push_str(&format!("{}\n", name.strip_prefix("SIG").unwrap_or(name)));
                    } else {
                        stderr.push_str(&format!(
                            "{prefix}kill: {op}: invalid signal specification\n"
                        ));
                        status = 1;
                    }
                } else if let Some(num) = lookup_sig(op).filter(|&n| n > 0) {
                    out.push_str(&format!("{num}\n"));
                } else {
                    stderr.push_str(&format!(
                        "{prefix}kill: {op}: invalid signal specification\n"
                    ));
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
                stderr: format!("{prefix}kill: invalid signal specification\n"),
                exit_code: 1,
            };
        };
        if matches!(sig_num, 17 | 18 | 19 | 20 | 21 | 22 | 23 | 28) {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!(
                    "{prefix}kill: signal is not supported by virtual job termination\n"
                ),
                exit_code: 1,
            };
        }
        if offset >= args.len() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!(
                    "{prefix}kill: usage: kill [-s signal | -n signal | -signal] pid | %job ...\n"
                ),
                exit_code: 2,
            };
        }

        let mut stderr = String::new();
        let mut status = 0;
        for op in &args[offset..] {
            let Some(pid) = self.resolve_job_operand(op) else {
                let kind = if op.starts_with('%') { "job" } else { "process" };
                stderr.push_str(&format!("{prefix}kill: {op}: no such {kind}\n"));
                status = 1;
                continue;
            };
            if sig_num == 0 {
                self.env
                    .insert(format!("__job_settled__{pid}"), "1".to_string());
                let kind = if op.starts_with('%') { "job" } else { "process" };
                stderr.push_str(&format!("{prefix}kill: {op}: no such {kind}\n"));
                status = 1;
            } else {
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
    let mut pending_heredocs: Vec<(String, bool)> = Vec::new();
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
        } else if c == '<' && *idx + 1 < chars.len() && chars[*idx + 1] == '<' {
            if *idx + 2 < chars.len() && chars[*idx + 2] == '<' {
                out.push_str("<<<");
                *idx += 3;
            } else {
                let strip_tabs = *idx + 2 < chars.len() && chars[*idx + 2] == '-';
                if strip_tabs {
                    out.push_str("<<-");
                    *idx += 3;
                } else {
                    out.push_str("<<");
                    *idx += 2;
                }
                while *idx < chars.len() && matches!(chars[*idx], ' ' | '\t') {
                    out.push(chars[*idx]);
                    *idx += 1;
                }
                let mut raw_delim = String::new();
                let mut d_sq = false;
                let mut d_dq = false;
                while *idx < chars.len() {
                    let dc = chars[*idx];
                    if d_sq {
                        raw_delim.push(dc);
                        out.push(dc);
                        *idx += 1;
                        if dc == '\'' {
                            d_sq = false;
                        }
                    } else if d_dq {
                        if dc == '\\' && *idx + 1 < chars.len() {
                            raw_delim.push(dc);
                            raw_delim.push(chars[*idx + 1]);
                            out.push(dc);
                            out.push(chars[*idx + 1]);
                            *idx += 2;
                        } else {
                            raw_delim.push(dc);
                            out.push(dc);
                            *idx += 1;
                            if dc == '"' {
                                d_dq = false;
                            }
                        }
                    } else if dc == '\'' {
                        d_sq = true;
                        raw_delim.push(dc);
                        out.push(dc);
                        *idx += 1;
                    } else if dc == '"' {
                        d_dq = true;
                        raw_delim.push(dc);
                        out.push(dc);
                        *idx += 1;
                    } else if dc == '\\' && *idx + 1 < chars.len() {
                        if chars[*idx + 1] == '\n' {
                            out.push('\\');
                            out.push('\n');
                            *idx += 2;
                        } else {
                            raw_delim.push(dc);
                            raw_delim.push(chars[*idx + 1]);
                            out.push(dc);
                            out.push(chars[*idx + 1]);
                            *idx += 2;
                        }
                    } else if matches!(dc, ' ' | '\t' | '\n' | ';' | '&' | '|' | '<' | '>' | '(' | ')') {
                        break;
                    } else {
                        raw_delim.push(dc);
                        out.push(dc);
                        *idx += 1;
                    }
                }
                let mut unquoted = String::new();
                let dchars: Vec<char> = raw_delim.chars().collect();
                let mut di = 0usize;
                while di < dchars.len() {
                    let dc = dchars[di];
                    if (dc == '$' && di + 1 < dchars.len() && matches!(dchars[di + 1], '\'' | '"'))
                        && !unquoted.ends_with('\\')
                    {
                        let q = dchars[di + 1];
                        di += 2;
                        while di < dchars.len() && dchars[di] != q {
                            if q == '"'
                                && dchars[di] == '\\'
                                && di + 1 < dchars.len()
                                && matches!(dchars[di + 1], '"' | '\\' | '$' | '`')
                            {
                                unquoted.push(dchars[di + 1]);
                                di += 2;
                            } else {
                                unquoted.push(dchars[di]);
                                di += 1;
                            }
                        }
                        if di < dchars.len() {
                            di += 1;
                        }
                    } else if dc == '\'' || dc == '"' {
                        let q = dc;
                        di += 1;
                        while di < dchars.len() && dchars[di] != q {
                            if q == '"'
                                && dchars[di] == '\\'
                                && di + 1 < dchars.len()
                                && matches!(dchars[di + 1], '"' | '\\' | '$' | '`')
                            {
                                unquoted.push(dchars[di + 1]);
                                di += 2;
                            } else {
                                unquoted.push(dchars[di]);
                                di += 1;
                            }
                        }
                        if di < dchars.len() {
                            di += 1;
                        }
                    } else if dc == '\\' && di + 1 < dchars.len() {
                        unquoted.push(dchars[di + 1]);
                        di += 2;
                    } else {
                        unquoted.push(dc);
                        di += 1;
                    }
                }
                if !unquoted.is_empty() {
                    pending_heredocs.push((unquoted, strip_tabs));
                }
            }
        } else if c == '\n' {
            out.push('\n');
            *idx += 1;
            if !pending_heredocs.is_empty() {
                let docs = std::mem::take(&mut pending_heredocs);
                for (delim, strip_tabs) in docs {
                    loop {
                        if *idx >= chars.len() {
                            break;
                        }
                        let line_start = *idx;
                        while *idx < chars.len() && chars[*idx] != '\n' {
                            *idx += 1;
                        }
                        let has_nl = *idx < chars.len() && chars[*idx] == '\n';
                        let line_str: String = chars[line_start..*idx].iter().collect();
                        if has_nl {
                            *idx += 1;
                        }
                        let trimmed_cr = line_str.strip_suffix('\r').unwrap_or(&line_str);
                        let check_line = if strip_tabs {
                            trimmed_cr.trim_start_matches('\t')
                        } else {
                            trimmed_cr
                        };
                        out.push_str(&line_str);
                        if has_nl {
                            out.push('\n');
                        }
                        if check_line == delim {
                            break;
                        }
                    }
                }
            }
        } else if c == '(' {
            depth += 1;
            out.push(c);
            *idx += 1;
        } else if c == ')' {
            if depth == 1 && !pending_heredocs.is_empty() {
                return Err(EvalError::Syntax(
                    "Syntax error: Here-document requires a newline before closing command substitution"
                        .to_string(),
                ));
            }
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
    if depth > 0 {
        return Err(EvalError::Syntax(
            "Syntax error: Unterminated command substitution".to_string(),
        ));
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
    if depth > 0 {
        return Err(EvalError::Syntax(
            "Syntax error: Unterminated parameter expansion".to_string(),
        ));
    }
    Ok(out)
}

fn is_cmdsub_file_shortcut(cmd_str: &str) -> bool {
    let s = cmd_str.trim();
    if !s.starts_with('<') || s.starts_with("<<") || s.starts_with("<>") || s.starts_with("<&") {
        return false;
    }
    let Ok(ast) = parse_script(s) else {
        return false;
    };
    if ast.lists.len() != 1 || !ast.lists[0].rest.is_empty() || ast.lists[0].background {
        return false;
    }
    let pipe = &ast.lists[0].first;
    if pipe.negated || pipe.commands.len() != 1 {
        return false;
    }
    match &pipe.commands[0] {
        CommandNode::Simple(simple) => {
            simple.words.is_empty()
                && simple.assignments.is_empty()
                && simple.redirects.len() == 1
                && matches!(simple.redirects[0].kind, RedirectKind::In(0))
        }
        _ => false,
    }
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
        for (idx, (part, is_gen)) in materialized_parts.iter().enumerate() {
            if *is_gen {
                after_gen_syn = true;
            }
            let at_word_end = materialized_parts[idx + 1..].iter().all(|(p, _)| match p {
                BracePart::Text { raw, .. }
                | BracePart::Atom { raw, .. }
                | BracePart::AnsiQuote { raw, .. } => raw.is_empty(),
            });
            match part {
                BracePart::Text { raw, .. } | BracePart::Atom { raw, .. } => {
                    if *is_gen && raw == "`" && at_word_end {
                        word_out.push_str("\\`");
                    } else {
                        word_out.push_str(raw);
                    }
                }
                BracePart::AnsiQuote { raw, decoded, .. } => {
                    if after_gen_syn {
                        word_out.push('\'');
                        word_out.push_str(&decoded.replace('\'', "'\\''"));
                        word_out.push('\'');
                    } else {
                        word_out.push_str(raw);
                    }
                }
            }
        }
        out.push(word_out);
    }
    Ok((out, true))
}


fn trim_bash_ascii_ws(raw: &str) -> &str {
    raw.trim_matches(|c: char| matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0b' | '\x0c'))
}

fn parse_read_fd(raw: &str) -> Option<u32> {
    let trimmed = trim_bash_ascii_ws(raw);
    let (negative, digits) = if let Some(rest) = trimmed.strip_prefix('-') {
        (true, rest)
    } else if let Some(rest) = trimmed.strip_prefix('+') {
        (false, rest)
    } else {
        (false, trimmed)
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if negative {
        return if digits.bytes().all(|b| b == b'0') {
            Some(0)
        } else {
            None
        };
    }
    let stripped = digits.trim_start_matches('0');
    if stripped.is_empty() {
        return Some(0);
    }
    let val = stripped.parse::<u128>().ok()?;
    if val <= 2_147_483_647 {
        Some(val as u32)
    } else {
        None
    }
}

fn parse_read_count(raw: &str) -> Result<usize, bool> {
    let trimmed = trim_bash_ascii_ws(raw);
    let (negative, digits) = if let Some(rest) = trimmed.strip_prefix('-') {
        (true, rest)
    } else if let Some(rest) = trimmed.strip_prefix('+') {
        (false, rest)
    } else {
        (false, trimmed)
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(false);
    }
    if negative {
        return if digits.bytes().all(|b| b == b'0') {
            Ok(0)
        } else {
            Err(false)
        };
    }
    let stripped = digits.trim_start_matches('0');
    if stripped.is_empty() {
        return Ok(0);
    }
    match stripped.parse::<u128>() {
        Ok(v) if v <= 2_147_483_647 => Ok(v as usize),
        _ => Err(true),
    }
}

fn parse_read_timeout(raw: &str) -> Option<f64> {
    let bytes = raw.as_bytes();
    let negative = bytes.first() == Some(&b'-');
    let mut offset = if matches!(bytes.first(), Some(b'+' | b'-')) {
        1usize
    } else {
        0usize
    };
    let mut seconds: u128 = 0;
    while offset < bytes.len() && bytes[offset] != b'.' {
        let ch = bytes[offset];
        offset += 1;
        if !ch.is_ascii_digit() {
            return None;
        }
        seconds = seconds * 10 + (ch - b'0') as u128;
        if seconds > 9_223_372_036_854_775_807 {
            return None;
        }
    }
    if offset < bytes.len() && bytes[offset] == b'.' {
        offset += 1;
    }
    let mut fraction: u64 = 0;
    let mut digits: u32 = 0;
    while offset < bytes.len() && digits < 6 {
        let ch = bytes[offset];
        offset += 1;
        if !ch.is_ascii_digit() {
            return None;
        }
        fraction = fraction * 10 + (ch - b'0') as u64;
        digits += 1;
    }
    fraction *= 10u64.pow(6 - digits);
    if digits == 6 && bytes.get(offset).is_some_and(|&b| (b'5'..=b'9').contains(&b)) {
        fraction += 1;
    }
    if negative && (seconds > 0 || fraction > 0) {
        return None;
    }
    let masked_secs = (seconds & 0xffff_ffff) as f64;
    Some(masked_secs * 1000.0 + (fraction as f64) / 1000.0)
}

fn parse_mapfile_decimal(raw: &str, maximum: u64) -> Option<u64> {
    let trimmed = trim_bash_ascii_ws(raw);
    let (negative, digits) = if let Some(rest) = trimmed.strip_prefix('-') {
        (true, rest)
    } else if let Some(rest) = trimmed.strip_prefix('+') {
        (false, rest)
    } else {
        (false, trimmed)
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if negative {
        return if digits.bytes().all(|b| b == b'0') {
            Some(0)
        } else {
            None
        };
    }
    let stripped = digits.trim_start_matches('0');
    if stripped.is_empty() {
        return Some(0);
    }
    let val = stripped.parse::<u128>().ok()?;
    if val <= maximum as u128 {
        Some(val as u64)
    } else {
        None
    }
}

fn format_callback_syntax_diagnostic(
    syntax_name: &str,
    diag_offset: usize,
    source: &str,
    syn_msg: &str,
) -> String {
    format_syntax_diagnostic(syntax_name, diag_offset, source, syn_msg, false)
}

fn find_incomplete_command(source: &str) -> Option<(&'static str, usize)> {
    let Ok(tokens) = crate::shell::lexer::tokenize_shell(source) else {
        return None;
    };
    let mut cur_line = 1usize;
    let mut at_cmd_start = true;
    let mut for_state = 0u8;
    let mut open_cmds: Vec<(&'static str, usize)> = Vec::new();
    for tok in &tokens {
        match tok {
            crate::shell::lexer::Token::Newline => {
                cur_line += 1;
                if for_state != 2 {
                    for_state = 0;
                    at_cmd_start = true;
                }
            }
            crate::shell::lexer::Token::Semi
            | crate::shell::lexer::Token::Background
            | crate::shell::lexer::Token::Pipe
            | crate::shell::lexer::Token::AndIf
            | crate::shell::lexer::Token::OrIf
            | crate::shell::lexer::Token::LParen
            | crate::shell::lexer::Token::RParen => {
                for_state = 0;
                at_cmd_start = true;
            }
            crate::shell::lexer::Token::Word(w) => {
                let word_lines = w.matches('\n').count();
                if for_state == 1 {
                    for_state = 2;
                    at_cmd_start = false;
                } else if for_state == 2 {
                    if w == "in" {
                        for_state = 3;
                        at_cmd_start = false;
                    } else if w == "do" {
                        for_state = 0;
                        at_cmd_start = true;
                    } else {
                        for_state = 0;
                        at_cmd_start = false;
                    }
                } else if for_state == 3 {
                    at_cmd_start = false;
                } else if at_cmd_start {
                    match w.as_str() {
                        "if" => {
                            open_cmds.push(("if", cur_line));
                            at_cmd_start = true;
                        }
                        "then" | "elif" | "else" => {
                            at_cmd_start = true;
                        }
                        "fi" => {
                            if let Some(pos) = open_cmds.iter().rposition(|(n, _)| *n == "if") {
                                open_cmds.remove(pos);
                            }
                            at_cmd_start = false;
                        }
                        "for" => {
                            open_cmds.push(("for", cur_line));
                            for_state = 1;
                            at_cmd_start = false;
                        }
                        "while" => {
                            open_cmds.push(("while", cur_line));
                            at_cmd_start = true;
                        }
                        "until" => {
                            open_cmds.push(("until", cur_line));
                            at_cmd_start = true;
                        }
                        "do" => {
                            at_cmd_start = true;
                        }
                        "done" => {
                            if let Some(pos) = open_cmds
                                .iter()
                                .rposition(|(n, _)| matches!(*n, "for" | "while" | "until"))
                            {
                                open_cmds.remove(pos);
                            }
                            at_cmd_start = false;
                        }
                        "case" => {
                            open_cmds.push(("case", cur_line));
                            at_cmd_start = false;
                        }
                        "esac" => {
                            if let Some(pos) = open_cmds.iter().rposition(|(n, _)| *n == "case") {
                                open_cmds.remove(pos);
                            }
                            at_cmd_start = false;
                        }
                        "{" => {
                            open_cmds.push(("{", cur_line));
                            at_cmd_start = true;
                        }
                        "}" => {
                            if let Some(pos) = open_cmds.iter().rposition(|(n, _)| *n == "{") {
                                open_cmds.remove(pos);
                            }
                            at_cmd_start = false;
                        }
                        "!" => {
                            at_cmd_start = true;
                        }
                        _ => {
                            at_cmd_start = false;
                        }
                    }
                }
                cur_line += word_lines;
            }
            crate::shell::lexer::Token::RedirectHereDoc { body, .. } => {
                cur_line += body.matches('\n').count();
                at_cmd_start = false;
            }
            _ => {
                at_cmd_start = false;
            }
        }
    }
    open_cmds.last().copied()
}

fn format_syntax_diagnostic(
    syntax_name: &str,
    diag_offset: usize,
    source: &str,
    syn_msg: &str,
    include_context: bool,
) -> String {
    if syn_msg.contains("unclosed single quote")
        || syn_msg.contains("unclosed double quote")
        || syn_msg.contains("unclosed backtick")
    {
        let quote_char = if syn_msg.contains("single quote") {
            '\''
        } else if syn_msg.contains("double quote") {
            '"'
        } else {
            '`'
        };
        let mut cur_line = 1usize;
        let mut open_quote: Option<(char, usize)> = None;
        let mut escaped = false;
        for ch in source.chars() {
            if escaped {
                escaped = false;
                if ch == '\n' {
                    cur_line += 1;
                }
                continue;
            }
            if ch == '\\' && open_quote.map(|(q, _)| q) != Some('\'') {
                escaped = true;
                continue;
            }
            if let Some((q, _)) = open_quote {
                if ch == q {
                    open_quote = None;
                }
            } else if matches!(ch, '\'' | '"' | '`') {
                open_quote = Some((ch, cur_line));
            }
            if ch == '\n' {
                cur_line += 1;
            }
        }
        let quote_line = open_quote.map(|(_, l)| l).unwrap_or(1);
        return format!(
            "{syntax_name}: line {}: unexpected EOF while looking for matching `{quote_char}'\n",
            diag_offset + quote_line
        );
    }
    if let Some(rest) = syn_msg.strip_prefix("Syntax error: unexpected `")
        && let Some(tok) = rest.strip_suffix('`')
    {
        let lines: Vec<&str> = source.split('\n').collect();
        let mut line_idx = 0usize;
        for (idx, l) in lines.iter().enumerate() {
            if l.contains(tok) {
                line_idx = idx;
            }
        }
        let err_line = diag_offset + line_idx + 1;
        let line_text = lines.get(line_idx).copied().unwrap_or("");
        return format!(
            "{syntax_name}: line {err_line}: syntax error near unexpected token `{tok}'\n{syntax_name}: line {err_line}: `{line_text}'\n"
        );
    }
    if syn_msg.contains("unexpected end of file") || syn_msg.contains("unclosed") {
        let eof_line =
            diag_offset + source.split('\n').count() + usize::from(!source.ends_with('\n'));
        let ctx = if include_context
            && let Some((cmd_name, cmd_line)) = find_incomplete_command(source)
        {
            format!(
                " from `{cmd_name}' command on line {}",
                diag_offset + cmd_line
            )
        } else {
            String::new()
        };
        return format!(
            "{syntax_name}: line {eof_line}: syntax error: unexpected end of file{ctx}\n"
        );
    }
    let clean = syn_msg.strip_prefix("bash: ").unwrap_or(syn_msg);
    format!("{syntax_name}: line {}: {clean}\n", diag_offset + 1)
}

fn format_diagnostic_command_name(cmd: &str, byte_locale: bool) -> String {
    let bytes = stream_string_to_bytes(cmd);
    let mut needs_quote = false;
    let mut idx = 0usize;
    while idx < bytes.len() {
        let b = bytes[idx];
        if (32..=126).contains(&b) {
            idx += 1;
        } else if !byte_locale && (0xc2..=0xf4).contains(&b) {
            let len = utf8_seq_length(b);
            if idx + len <= bytes.len()
                && let Ok(s) = std::str::from_utf8(&bytes[idx..idx + len])
                && let Some(ch) = s.chars().next()
                && !ch.is_control()
            {
                idx += len;
            } else {
                needs_quote = true;
                idx += 1;
            }
        } else {
            needs_quote = true;
            idx += 1;
        }
    }
    if !needs_quote {
        return cmd.to_string();
    }
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len() * 4 + 3);
    out.extend_from_slice(b"$'");
    idx = 0;
    while idx < bytes.len() {
        let b = bytes[idx];
        let esc = match b {
            7 => Some(b'a'),
            8 => Some(b'b'),
            9 => Some(b't'),
            10 => Some(b'n'),
            11 => Some(b'v'),
            12 => Some(b'f'),
            13 => Some(b'r'),
            27 => Some(b'E'),
            39 => Some(b'\''),
            92 => Some(b'\\'),
            _ => None,
        };
        if let Some(e) = esc {
            out.push(b'\\');
            out.push(e);
            idx += 1;
        } else if (32..=126).contains(&b) {
            out.push(b);
            idx += 1;
        } else if !byte_locale && (0xc2..=0xf4).contains(&b) {
            let len = utf8_seq_length(b);
            if idx + len <= bytes.len()
                && let Ok(s) = std::str::from_utf8(&bytes[idx..idx + len])
                && let Some(ch) = s.chars().next()
                && !ch.is_control()
            {
                out.extend_from_slice(&bytes[idx..idx + len]);
                idx += len;
            } else {
                out.extend_from_slice(format!("\\{:03o}", b).as_bytes());
                idx += 1;
            }
        } else {
            out.extend_from_slice(format!("\\{:03o}", b).as_bytes());
            idx += 1;
        }
    }
    out.push(b'\'');
    bytes_to_stream_string(&out)
}

fn mapfile_help_header(cmd: &str) -> String {
    if cmd == "readarray" {
        "readarray: readarray [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]\n    Read lines from a file into an array variable.\n    \n    A synonym for `mapfile'.\n".to_string()
    } else {
        concat!(
            "mapfile: mapfile [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]\n",
            "    Read lines from the standard input into an indexed array variable.\n",
            "    \n",
            "    Read lines from the standard input into the indexed array variable ARRAY, or\n",
            "    from file descriptor FD if the -u option is supplied.  The variable MAPFILE\n",
            "    is the default ARRAY.\n",
            "    \n",
            "    Options:\n",
            "      -d delim\tUse DELIM to terminate lines, instead of newline\n",
            "      -n count\tCopy at most COUNT lines.  If COUNT is 0, all lines are copied\n",
            "      -O origin\tBegin assigning to ARRAY at index ORIGIN.  The default index is 0\n",
            "      -s count\tDiscard the first COUNT lines read\n",
            "      -t\tRemove a trailing DELIM from each line read (default newline)\n",
            "      -u fd\tRead lines from file descriptor FD instead of the standard input\n",
            "      -C callback\tEvaluate CALLBACK each time QUANTUM lines are read\n",
            "      -c quantum\tSpecify the number of lines read between each call to\n",
            "    \t\t\tCALLBACK\n",
            "    \n",
            "    Arguments:\n",
            "      ARRAY\tArray variable name to use for file data\n",
            "    \n",
            "    If -C is supplied without -c, the default quantum is 5000.  When\n",
            "    CALLBACK is evaluated, it is supplied the index of the next array\n",
            "    element to be assigned and the line to be assigned to that element\n",
            "    as additional arguments.\n",
            "    \n",
            "    If not supplied with an explicit origin, mapfile will clear ARRAY before\n",
            "    assigning to it.\n",
            "    \n",
            "    Exit Status:\n",
            "    Returns success unless an invalid option is given or ARRAY is readonly or\n",
            "    not an indexed array.\n"
        )
        .to_string()
    }
}

fn format_mapfile_callback_command(callback: &str, index: u32, line: &[u8]) -> String {
    let quotes = line.iter().filter(|&&b| b == b'\'').count();
    let mut quoted = Vec::with_capacity(line.len() + quotes * 3 + 2);
    quoted.push(b'\'');
    for &b in line {
        if b == b'\'' {
            quoted.extend_from_slice(b"'\\''");
        } else {
            quoted.push(b);
        }
    }
    quoted.push(b'\'');
    let separator = format!(" {} ", index as i32);
    let cb_bytes = stream_string_to_bytes(callback);
    let capacity = cb_bytes.len() + quoted.len() + 13;
    let remaining = capacity
        .saturating_sub(1)
        .saturating_sub(cb_bytes.len())
        .saturating_sub(separator.len());
    let clipped = &quoted[..remaining.min(quoted.len())];
    format!("{callback}{separator}{}", bytes_to_stream_string(clipped))
}

fn utf8_seq_length(first: u8) -> usize {
    if (0xc2..=0xdf).contains(&first) {
        2
    } else if (0xe0..=0xef).contains(&first) {
        3
    } else if (0xf0..=0xf4).contains(&first) {
        4
    } else {
        1
    }
}

fn is_valid_utf8_continuation(first: u8, index: usize, byte: u8) -> bool {
    if !(0x80..=0xbf).contains(&byte) {
        return false;
    }
    if index == 1 {
        if (first == 0xe0 && byte < 0xa0)
            || (first == 0xed && byte > 0x9f)
            || (first == 0xf0 && byte < 0x90)
            || (first == 0xf4 && byte > 0x8f)
        {
            return false;
        }
    }
    true
}

fn read_display_width(bytes: &[u8], offset: usize) -> usize {
    if offset >= bytes.len() {
        return 0;
    }
    let first = bytes[offset];
    let length = utf8_seq_length(first);
    let limit = (offset + length).min(bytes.len());
    let mut index = offset + 1;
    while index < limit {
        if !is_valid_utf8_continuation(first, index - offset, bytes[index]) {
            break;
        }
        index += 1;
    }
    index - offset
}

fn scan_read_stream(
    raw_in: &[u8],
    raw_mode: bool,
    delimiter: Option<u8>,
    count: Option<usize>,
    byte_count: bool,
    budget: &ExecutionBudget,
) -> Result<(Vec<u8>, Vec<usize>, bool, usize), EvalError> {
    let mut out: Vec<u8> = Vec::new();
    let mut escaped_offsets: Vec<usize> = Vec::new();
    let mut escaped = false;
    let mut units = 0usize;
    let mut visible = true;
    let mut input_bytes = 0usize;
    let mut terminated = false;
    let mut pos = 0usize;

    while !terminated && pos < raw_in.len() {
        let first = raw_in[pos];
        pos += 1;
        input_bytes += 1;
        if input_bytes > budget.limits.max_input_bytes {
            return Err(EvalError::Budget(format!(
                "Execution aborted: Shell limit exceeded: maxInputBytes ({})",
                budget.limits.max_input_bytes
            )));
        }

        if !raw_mode && !escaped && first == b'\\' && delimiter != Some(b'\\') {
            escaped = true;
            continue;
        }
        let quoted = escaped;
        escaped = false;
        if quoted && first == b'\n' {
            continue;
        }
        if !quoted && delimiter == Some(first) {
            terminated = true;
            break;
        }
        if !quoted && first == 0 {
            continue;
        }
        if quoted && first == 0 {
            if out.is_empty() && visible {
                if out.len() >= budget.limits.max_output_bytes {
                    return Err(EvalError::Budget(format!(
                        "Execution aborted: Shell limit exceeded: maxOutputBytes ({})",
                        budget.limits.max_output_bytes
                    )));
                }
                out.push(1);
            }
            visible = false;
        } else if visible {
            if quoted {
                escaped_offsets.push(out.len());
            }
            if out.len() >= budget.limits.max_output_bytes {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxOutputBytes ({})",
                    budget.limits.max_output_bytes
                )));
            }
            out.push(first);
        }

        let width = if byte_count { 1 } else { utf8_seq_length(first) };
        for position in 1..width {
            if pos >= raw_in.len() {
                break;
            }
            let next = raw_in[pos];
            if !is_valid_utf8_continuation(first, position, next) {
                break;
            }
            pos += 1;
            input_bytes += 1;
            if input_bytes > budget.limits.max_input_bytes {
                return Err(EvalError::Budget(format!(
                    "Execution aborted: Shell limit exceeded: maxInputBytes ({})",
                    budget.limits.max_input_bytes
                )));
            }
            if visible {
                if out.len() >= budget.limits.max_output_bytes {
                    return Err(EvalError::Budget(format!(
                        "Execution aborted: Shell limit exceeded: maxOutputBytes ({})",
                        budget.limits.max_output_bytes
                    )));
                }
                out.push(next);
            }
        }

        units += 1;
        if Some(units) == count {
            terminated = true;
        }
    }

    Ok((out, escaped_offsets, terminated, pos))
}

fn split_read_fields(
    bytes: &[u8],
    escaped_byte_offsets: &[usize],
    separators: &[u8],
    maximum: Option<usize>,
    byte_count: bool,
) -> Vec<Vec<u8>> {
    if maximum == Some(0) || bytes.is_empty() {
        return Vec::new();
    }
    let escaped_start = |start: usize| -> bool { escaped_byte_offsets.binary_search(&start).is_ok() };
    let unit_width = |input: &[u8], start: usize, is_record: bool| -> usize {
        if byte_count || (is_record && escaped_start(start)) {
            return 1;
        }
        let len = read_display_width(input, start);
        if len == utf8_seq_length(input[start]) {
            len
        } else {
            1
        }
    };
    let unit_key = |input: &[u8], start: usize, is_record: bool| -> u64 {
        let mut val = 1u64;
        let w = unit_width(input, start, is_record);
        for &b in &input[start..(start + w).min(input.len())] {
            val = val.wrapping_mul(257).wrapping_add(b as u64);
        }
        val
    };

    let mut keys = BTreeSet::new();
    let mut sep_pos = 0usize;
    while sep_pos < separators.len() {
        let w = unit_width(separators, sep_pos, false);
        keys.insert(unit_key(separators, sep_pos, false));
        for &b in &separators[sep_pos..(sep_pos + w).min(separators.len())] {
            keys.insert(257 + b as u64);
        }
        sep_pos += w;
    }

    let is_separator = |start: usize| -> bool {
        !escaped_start(start) && keys.contains(&unit_key(bytes, start, true))
    };
    let is_whitespace = |start: usize| -> bool {
        matches!(bytes[start], b' ' | b'\t' | b'\n') && is_separator(start)
    };

    let mut end = 0usize;
    let mut scan = 0usize;
    while scan < bytes.len() {
        let w = unit_width(bytes, scan, true);
        if !is_whitespace(scan) {
            end = scan + w;
        }
        scan += w;
    }

    let mut position = 0usize;
    let mut fields: Vec<Vec<u8>> = Vec::new();
    let max_fields = maximum.unwrap_or(usize::MAX);

    while position < end && is_whitespace(position) {
        position += unit_width(bytes, position, true);
    }
    while position < end && fields.len() < max_fields {
        let start = position;
        while position < end && !is_separator(position) {
            position += unit_width(bytes, position, true);
        }
        let mut field_end = position;
        while position < end && is_whitespace(position) {
            position += unit_width(bytes, position, true);
        }
        if position < end && is_separator(position) {
            position += unit_width(bytes, position, true);
        }
        while position < end && is_whitespace(position) {
            position += unit_width(bytes, position, true);
        }
        if let Some(max) = maximum
            && fields.len() + 1 == max
            && position < end
        {
            field_end = end;
        }
        fields.push(bytes[start..field_end].to_vec());
    }
    fields
}

#[cfg(test)]
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
        CommandNode::ArithCommand { expr, .. } => format!("(( {expr} ))"),
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
        vfs.mkdir_all("/tmp").unwrap();
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
            "shell: line 1: eval: -z: invalid option\neval: usage: eval [arg ...]\n"
        );

        let src_err = state.eval_script_str("source", "").unwrap();
        assert_eq!(src_err.exit_code, 2);
        assert_eq!(
            src_err.stderr,
            "shell: line 1: source: filename argument required\nsource: usage: source [-p path] filename [arguments]\n"
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
        assert_eq!(
            wait_err.stderr,
            "shell: line 1: wait: pid 999 is not a child of this shell\n"
        );

        let disown_err = state.eval_script_str("disown", "").unwrap();
        assert_eq!(disown_err.exit_code, 1);
        assert_eq!(disown_err.stderr, "shell: line 1: disown: current: no such job\n");

        let kill_err = state.eval_script_str("kill -s BOGUS 123", "").unwrap();
        assert_eq!(kill_err.exit_code, 1);
        assert_eq!(
            kill_err.stderr,
            "shell: line 1: kill: invalid signal specification\n"
        );

        let kill_l_err = state.eval_script_str("kill -l BOGUS", "").unwrap();
        assert_eq!(kill_l_err.exit_code, 1);
        assert_eq!(
            kill_l_err.stderr,
            "shell: line 1: kill: BOGUS: invalid signal specification\n"
        );
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

        let alt_split = state.eval_script_str("IFS=' '; unset u; printf '[%s]' ${u:-a b} ${u:-\"a b\"}", "").unwrap();
        assert_eq!(alt_split.exit_code, 0);
        assert_eq!(alt_split.stdout, "[a][b][a b]");
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

        let z_to_a = state.eval_script_str("printf '<%s>' {Z..a}", "").unwrap();
        assert_eq!(z_to_a.exit_code, 0);
        assert_eq!(z_to_a.stdout, "<Z><[><><]><^><_><`><a>");

        let pre_z_to_a_post = state.eval_script_str("(printf '<%s>' pre{Z..a}post) 2>/dev/null; printf '%s' \"$?\"", "").unwrap();
        assert_eq!(pre_z_to_a_post.exit_code, 0);
        assert_eq!(pre_z_to_a_post.stdout, "1");
    }

    #[test]
    fn unit_eval_read_mapfile_readarray_fd_aliasing_and_callbacks() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        // 1. read escaping, line continuation, IFS single vs double trailing delimiter, and array element 0 preservation
        let r1 = state
            .eval_script_str(
                r#"IFS=: read a b <<< 'x\:y:z:'; IFS=: read c d <<< 'x:y::'; A=(old keep); read A <<< 'new'; printf '<%s>|<%s>|<%s>|<%s>|<%s:%s>\n' "$a" "$b" "$c" "$d" "${A[0]}" "${A[1]}""#,
                "",
            )
            .unwrap();
        assert_eq!(r1.exit_code, 0);
        assert_eq!(r1.stdout, "<x:y>|<z>|<x>|<y::>|<new:keep>\n");

        // 2. read -u with fd aliasing (4<&3, 3<&-) and move (4<&3-)
        let r2 = state
            .eval_script_str(
                r#"{ read -r u1 <&3; read -r -u 4 u2; } 3<<<$'first\nsecond' 4<&3; { read -r -u 4 u3; } 3<<<$'moved' 4<&3-; { read -r -u 4 u4; } 3<<<$'kept' 4<&3 3<&-; printf '%s|%s|%s|%s\n' "$u1" "$u2" "$u3" "$u4""#,
                "",
            )
            .unwrap();
        assert_eq!(r2.exit_code, 0);
        assert_eq!(r2.stdout, "first|second|moved|kept\n");

        // 3. mapfile / readarray options, NUL truncation, NUL delimiter, origin -O 0 preserving elements, and callbacks
        let r3 = state
            .eval_script_str(
                r#"M=(keep0 keep1 keep2); mapfile -t -O 0 -n 1 M <<< $'rep0\nrep1'; cb() { printf 'cb:%s:%s\n' "$1" "$2"; }; readarray -t -C cb -c 2 R <<< $'one\ntwo\nthree'; printf 'M=%s,%s,%s|R=%s,%s,%s\n' "${M[0]}" "${M[1]}" "${M[2]}" "${R[0]}" "${R[1]}" "${R[2]}""#,
                "",
            )
            .unwrap();
        assert_eq!(r3.exit_code, 0);
        assert_eq!(r3.stdout, "cb:1:two\nM=rep0,keep1,keep2|R=one,two,three\n");

        // 4. mapfile callback immediate break termination before current element write
        let r4 = state
            .eval_script_str(
                r#"for x in 1 2; do mapfile -t -C 'printf direct; break; printf never' -c 1 D <<< $'a\nb'; printf wrong; done; printf '|D=%s,%s\n' "${D[0]}" "${D[1]}""#,
                "",
            )
            .unwrap();
        assert_eq!(r4.exit_code, 0);
        assert_eq!(r4.stdout, "direct|D=,\n");
    }

    #[test]
    fn unit_eval_getopts_pipestatus_path_hash_shebang_parity() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        // 1. OPTIND integer arithmetic before unset, mid-cluster OPTIND advance, and local OPTIND scope restoration
        let g1 = state
            .eval_script_str(
                r#"OPTIND=1+1; r_int="$OPTIND"; OPTIND=1; getopts ab opt -ab -c; OPTIND=2; getopts abc opt -ab -c; r_mid="$opt:$OPTIND"; fn() { local OPTIND; getopts x opt -x; printf 'in=%s:%s|' "$opt" "$OPTIND"; }; fn; printf 'int=%s|mid=%s|out=%s\n' "$r_int" "$r_mid" "$OPTIND""#,
                "",
            )
            .unwrap();
        assert_eq!(g1.exit_code, 0);
        assert_eq!(g1.stdout, "in=x:2|int=2|mid=b:3|out=3\n");

        // 2. PIPESTATUS protection for scalar, local, and readonly
        let p1 = state
            .eval_script_str(
                r#"bash -c 'PIPESTATUS=keep; false | true; printf "scalar=%s|" "${PIPESTATUS[@]}"'; fn_p() { local PIPESTATUS; false | true; printf 'local=%s|' "${PIPESTATUS-unset}"; }; fn_p; bash -c 'readonly PIPESTATUS; false | true; printf "ro=%s\n" "${PIPESTATUS-unset}"'"#,
                "",
            )
            .unwrap();
        assert_eq!(p1.exit_code, 0);
        assert_eq!(p1.stdout, "scalar=keep|local=|ro=unset\n");

        // 3. PATH lookup, hash insertion order, VFS script permissions, and shebang execution
        let s1 = state
            .eval_script_str(
                r#"mkdir -p /tmp/bin
printf '#!/bin/sh -e\necho "sh:$0:$1"\nfalse\necho never\n' > /tmp/bin/fail_sh
chmod +x /tmp/bin/fail_sh
/tmp/bin/fail_sh arg1
printf 'rc=%d\n' "$?"
hash -r
hash -p /tmp/bin/fail_sh z_cmd
hash -p /bin/echo a_cmd
hash -l
"#,
                "",
            )
            .unwrap();
        assert_eq!(s1.exit_code, 0);
        assert_eq!(
            s1.stdout,
            "sh:/tmp/bin/fail_sh:arg1\nrc=1\nbuiltin hash -p /tmp/bin/fail_sh z_cmd\nbuiltin hash -p /bin/echo a_cmd\n"
        );
    }

    #[test]
    fn unit_eval_arithmetic_arrays_and_parameter_transforms_parity() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        // 1. Scalar-to-array promotion, compound [k]+=val, and -i/-u/-l array attributes
        let r1 = state
            .eval_script_str(
                r#"s=zero; s[2]=two
s2=first; s2+=(second third)
arr=([0]=foo [0]+=bar [2]=baz)
declare -ia nums=([0]="2+3" [0]+="4*5" "10-3")
declare -ua up=([0]=hello world)
printf 's=%s|s2=%s|arr=%s|nums=%s|up=%s\n' "${s[*]}" "${s2[*]}" "${arr[*]}" "${nums[*]}" "${up[*]}""#,
                "",
            )
            .unwrap();
        assert_eq!(r1.exit_code, 0);
        assert_eq!(
            r1.stdout,
            "s=zero two|s2=first second third|arr=foobar baz|nums=25 7|up=HELLO WORLD\n"
        );

        // 2. Associative array insertion order, slicing, @K/@k, and empty array fallback
        let r2 = state
            .eval_script_str(
                r#"declare -A map
map[z]=last
map[a]=first
map[m]=mid
empty=()
printf 'keys=%s|slice=%s|k=%s|empty=%s:%s\n' "${!map[*]}" "${map[*]:1:2}" "${map[*]@k}" "${empty[@]-unset_ok}" "${empty[@]+set_bad}""#,
                "",
            )
            .unwrap();
        assert_eq!(r2.exit_code, 0);
        assert_eq!(
            r2.stdout,
            "keys=z a m|slice=first mid|k=z last a first m mid|empty=unset_ok:\n"
        );

        // 3. unset array[@], unset -n, invalid unset, and until (( 1 / 0 )) termination
        let r3 = state
            .eval_script_str(
                r#"declare -a keep=(x y)
unset 'keep[@]'
target=alive
declare -n ref=target
unset -n ref
until (( 1 / 0 )); do echo unreachable; done 2>/dev/null
u_rc="$?"
for (( 1 / 0; 1; 1 )); do echo unreachable; done 2>/dev/null
f_rc="$?"
printf 'rc=%d:%d|keep_a=%s|keep_len=%d|target=%s\n' "$u_rc" "$f_rc" "${keep@a}" "${#keep[@]}" "$target""#,
                "",
            )
            .unwrap();
        assert_eq!(r3.exit_code, 0);
        assert_eq!(r3.stdout, "rc=0:1|keep_a=a|keep_len=0|target=alive\n");
    }

    #[test]
    fn unit_eval_globignore_trailing_slash_broken_symlinks_case_and_arith_redirects() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/work".to_string();
        vfs.mkdir_all("/work").unwrap();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let r1 = state
            .eval_script_str(
                r#"mkdir -p sub
touch a.txt b.log .hidden
ln -s /nonexistent dangling
ln -s sub linkdir
ln -s . sub/loop
echo "dirs:" */
echo "all:" *
GLOBIGNORE='*.log:dangling:linkdir'
echo "gi:" *
unset GLOBIGNORE
shopt -s globstar
echo "gs:" sub/**"#,
                "",
            )
            .unwrap();
        assert_eq!(r1.exit_code, 0);
        assert_eq!(
            r1.stdout,
            "dirs: linkdir/ sub/\nall: a.txt b.log dangling linkdir sub\ngi: .hidden a.txt sub\ngs: sub/ sub/loop\n"
        );

        let r2 = state
            .eval_script_str(
                r#"{ (( 08 )); } 2>/dev/null
rc_err="$?"
(( x = $(echo sub_err >&2; echo 42) )) 2>sub.err
false
case fi in
  fi) ;;
esac
rc_empty_arm="$?"
case done in
  done) out=$(echo case) ;;
esac
printf 'rc=%d:%d|x=%s|sub=%s|out=%s\n' "$rc_err" "$rc_empty_arm" "$x" "$(cat sub.err)" "$out""#,
                "",
            )
            .unwrap();
        assert_eq!(r2.exit_code, 0);
        assert_eq!(r2.stderr, "");
        assert_eq!(r2.stdout, "rc=1:0|x=42|sub=sub_err|out=case\n");
    }

    #[test]
    fn unit_eval_fd_dup_readwrite_heredoc_cmdsub_and_subshell_disambiguation() {
        let vfs = crate::vfs::MemoryVfs::new();
        let mut cwd = "/work".to_string();
        vfs.mkdir_all("/work").unwrap();
        let mut env = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::budget::ShellLimits::default(), None);
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let r1 = state
            .eval_script_str(
                r#"printf 'abcdef\n' > rw.txt
exec 3<>rw.txt
printf 'XY' >&3
read -u 3 rest_line
exec 3<&-

mkdir -p sub_dir
shortcut_file=$(< rw.txt)
shortcut_dir=$(< sub_dir)
shortcut_dir_rc="$?"

X=outer
inline_hs=$(X=inner cat <<< "$X:$(echo "$X")")

nested_hd=$(cat <<EOF
line1 \
continued
literal \\
next
EOF
)

sub_pair=$((echo s1); (echo s2))

printf 'rw=%s|%s\ndir=%s:%d\nhs=%s\nhd=%s\nsub=%s\n' \
  "$rest_line" "$shortcut_file" \
  "$shortcut_dir" "$shortcut_dir_rc" \
  "$inline_hs" \
  "$(printf '%s' "$nested_hd" | tr '\n' '|')" \
  "$(printf '%s' "$sub_pair" | tr '\n' '|')""#,
                "",
            )
            .unwrap();
        assert_eq!(r1.stderr, "");
        assert_eq!(r1.exit_code, 0);
        assert_eq!(
            r1.stdout,
            "rw=cdef|XYcdef\ndir=:0\nhs=outer:inner\nhd=line1 continued|literal \\|next\nsub=s1|s2\n"
        );

        let r2 = state
            .eval_script_str(
                r#"echo hi 2>bad_out.err >&0
rc_bad_out="$?"
cat 2>bad_in.err <&1
rc_bad_in="$?"
mv_target="1-"
echo hi 2>ambig_mv.err >&$mv_target
rc_ambig_mv="$?"
(( 1 / 0 )) 2>arith_div.err
rc_arith_div="$?"
printf 'rc=%d:%d:%d:%d|o=%s|i=%s|m=%s|a=%s\n' \
  "$rc_bad_out" "$rc_bad_in" "$rc_ambig_mv" "$rc_arith_div" \
  "$(cat bad_out.err)" "$(cat bad_in.err)" "$(cat ambig_mv.err)" "$(cat arith_div.err)""#,
                "",
            )
            .unwrap();
        assert_eq!(r2.exit_code, 0);
        assert_eq!(
            r2.stdout,
            "rc=1:1:1:1|o=shell: line 1: 0: Bad file descriptor|i=shell: line 3: 1: Bad file descriptor|m=shell: line 6: 1-: ambiguous redirect|a=((: Division by zero\n"
        );
    }

    #[test]
    fn unit_eval_conditional_test_tilde_and_errexit_parity() {
        let mut cwd = "/workspace".to_string();
        let mut env = BTreeMap::new();
        let fs = crate::vfs::MemoryVfs::new();
        fs.mkdir_all("/workspace").unwrap();
        let budget = ExecutionBudget::default();
        let cmds = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &fs, &budget, &cmds, false);

        let r1 = state
            .eval_script_str(
                r#"[[
  # comment inside conditional
  -n a &&
  ( "(" =~ [(] && ")" =~ [^]a(b] )
]]&& echo "multiline:ok"

[[ -e "" || -d "" || -r "" || "" -ef "" ]] && echo "empty:bad" || echo "empty:ok"
[ -e "" -o -d "" -o "" -ef "" ] && echo "posix_empty:bad" || echo "posix_empty:ok"

[[ ! ( 1/0 -eq 0 ) ]] 2>db_arith.err
printf 'db_arith=%d:%s\n' "$?" "$(cat db_arith.err)"

LC_CTYPE=en_US.UTF-8
[[ ! ( a == [[:alpha:]] ) ]] 2>db_loc.err
printf 'db_loc=%d:%s\n' "$?" "$(cat db_loc.err)"
unset LC_CTYPE

[[ -e /dev/fd/0 ]] 2>db_fd.err
printf 'db_fd=%d:%s\n' "$?" "$(cat db_fd.err)"

declare -n ref_unset=missing_var
scalar="hello"
declare -n ref_elem='scalar[-1]'
[[ ! -v ref_unset && -R ref_unset && -v 'scalar[-1]' && -v ref_elem && -v _ && ! -v '123' ]] && echo "var:ok"

side=0
arr=(10 20)
[ -z "nonempty" -a -v 'arr[side+=1]' ]
[ -n "nonempty" -o -v 'arr[side+=1]' ]
printf 'side=%d\n' "$side"

PWD=/custom/pwd
printf 'tilde_custom=%s\n' ~+/sub
unset PWD
printf 'tilde_unset=%s\n' ~+/sub
PWD=/workspace

set -e
if [[ -o errexit ]] && [ -o errexit ] && [[ $- == *e* ]]; then
  sub_off=$([[ -o errexit ]] && echo on || echo off):$([ -o errexit ] && echo on || echo off):$((-1)):$(echo "$-")
  shopt -s inherit_errexit
  sub_on=$([[ -o errexit ]] && echo on || echo off):$([ -o errexit ] && echo on || echo off)
  shopt -u inherit_errexit
  printf 'errexit=%s|%s\n' "$sub_off" "$sub_on"
fi"#,
                "",
            )
            .unwrap();
        assert_eq!(r1.stderr, "");
        assert_eq!(r1.exit_code, 0);
        assert_eq!(
            r1.stdout,
            "multiline:ok\nempty:ok\nposix_empty:ok\ndb_arith=1:[[: 1/0: division by 0 (error token is \"0\")\ndb_loc=2:[[ locale character class: unsupported conditional profile\ndb_fd=2:[[ descriptor predicate: unsupported conditional profile\nvar:ok\nside=0\ntilde_custom=/custom/pwd/sub\ntilde_unset=~+/sub\nerrexit=off:off:-1:B|on:on\n"
        );

        let r_nonempty_op = state.eval_script_str("[[ -z && -n = -n ]]", "").unwrap();
        assert_eq!(r_nonempty_op.exit_code, 0);
        assert!(state.eval_script_str("[[ ]]", "").is_err());
        assert!(state.eval_script_str("[[ a == ]]", "").is_err());
        assert!(state.eval_script_str("[[ -z a b ]]", "").is_err());
        assert!(state.eval_script_str("[[ a =~ (b\nc) ]]", "").is_err());
        assert!(state.eval_script_str("[[ -n a ]] extra", "").is_err());
    }

    #[test]
    fn unit_eval_read_mapfile_callback_pipe_fd_and_diagnostic_parity() {
        let mut cwd = "/workspace".to_string();
        let mut env = BTreeMap::new();
        env.insert("LC_ALL".to_string(), "C".to_string());
        let vfs = crate::vfs::MemoryVfs::new();
        vfs.mkdir_all("/workspace").unwrap();
        let budget = ExecutionBudget::default();
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);

        let r = state
            .eval_script_str(
                r#"read -s val 2>e_term; printf 'term=%d:%s\n' "$?" "$(cat e_term)"
read -t0 -s val <<< "hi" 2>e_t0s; printf 't0s=%d:%s\n' "$?" "$(cat e_t0s)"
read -N 4 -n 2 exact_val <<< " a b"; printf 'exact=<%s>\n' "$exact_val"
read -n ' 0x0 ' v 2>e_hex1; read -n '-0x0' v 2>e_hex2; read -n '0x0' v 2>e_hex3
printf 'hex=%s|%s|%s\n' "$(cat e_hex1)" "$(cat e_hex2)" "$(cat e_hex3)"
read -t 4294967296 v <<< "ready"; printf 't_mask0=%d\n' "$?"
read -t 1.123456junk v <<< "ok\n"; printf 't_junk=%d:<%s>\n' "$?" "$v"
read -t ' 0' v 2>e_t_ws; printf 't_ws=%d:%s\n' "$?" "$(cat e_t_ws)"
read -t0 -u1 v 2>e_r1; printf 'r1=%d:%s\n' "$?" "$(cat e_r1)"
read -t.02 -u1 v 2>e_to1; printf 'to1=%d:%s\n' "$?" "$(cat e_to1)"
{ read -t0 -u3 v 3>/dev/null; printf 'null_t0=%d\n' "$?"; read -t.02 -u3 v 3>/dev/null 2>e_null_to; printf 'null_to=%d:%s\n' "$?" "$(cat e_null_to)"; }
{ { [ -p /dev/fd/3 ] && echo "pipe_fd3=yes"; v=OLD; read -t0 -u3 v; printf 'p_t0=%d:<%s>\n' "$?" "$v"; read -t.02 -u3 v; printf 'p_to=%d:<%s>\n' "$?" "$v"; } 3>&1 1>&4 | cat; } 4>&1
{ v=OLD; read -t1 -u1 v 2>e_peer; printf 'peer=%d:<%s>:%s\n' "$?" "$v" "$(cat e_peer)" >&2; } 2>peer_out | true
cat peer_out
mapfile -n 4294967296 a 2>e_mf_n; mapfile -c 4294967296 a 2>e_mf_c
printf 'mf_lim=%s|%s\n' "$(cat e_mf_n)" "$(cat e_mf_c)"
mapfile -tn1 -c1 -C $':\n)' a <<< $'one\ntwo\n' 2>e_mf_syn
printf 'mf_syn=<%s>:%s\n' "${a[*]}" "$(tr '\n' '|' < e_mf_syn)"
. /dev/fd/3 3<<'EOF'
cb_src() {
  missing_cb_cmd
}
EOF
mapfile -tn1 -c1 -C cb_src a <<< $'one\n' 2>e_mf_src
printf 'mf_src=<%s>:%s\n' "${a[*]}" "$(cat e_mf_src)"
$'bad\x1b[31m' 2>e_badcmd
printf 'badcmd=%d:%s\n' "$?" "$(cat e_badcmd)"
"#,
                "",
            )
            .unwrap();
        assert_eq!(r.stderr, "");
        assert_eq!(r.exit_code, 0);
        assert_eq!(
            r.stdout,
            concat!(
                "term=1:shell: line 1: read: -s: terminal input capabilities unavailable through this extension API\n",
                "t0s=0:\n",
                "exact=< a>\n",
                "hex=shell: line 4: read:  0x0 : invalid number|shell: line 4: read: -0x0: invalid number|shell: line 4: read: 0x0: invalid hex number\n",
                "t_mask0=0\n",
                "t_junk=0:<okn>\n",
                "t_ws=1:shell: line 8: read:  0: invalid timeout specification\n",
                "r1=1:shell: line 9: read: descriptor readiness unavailable through this extension API\n",
                "to1=1:shell: line 10: read: descriptor timeout observation unavailable through this extension API\n",
                "null_t0=0\n",
                "null_to=1:shell: line 11: read: 3: read error: Bad file descriptor\n",
                "pipe_fd3=yes\n",
                "p_t0=1:<OLD>\n",
                "p_to=142:<>\n",
                "peer=1:<OLD>:shell: line 13: read: 1: read error: Bad file descriptor\n",
                "mf_lim=shell: line 15: mapfile: 4294967296: invalid line count|shell: line 15: mapfile: 4294967296: invalid callback quantum\n",
                "mf_syn=<one>:shell: stdin: line 18: syntax error near unexpected token `)'|shell: stdin: line 18: `) 0 'one''|\n",
                "mf_src=<one>:/dev/fd/3: line 2: missing_cb_cmd: command not found\n",
                "badcmd=127:shell: line 26: $'bad\\E[31m': command not found\n",
            )
        );
    }

    #[test]
    fn unit_eval_jobs_wait_negation_retirement_and_destination_parity() {
        let mut cwd = "/workspace".to_string();
        let mut env = BTreeMap::new();
        env.insert("LC_ALL".to_string(), "C".to_string());
        let vfs = crate::vfs::MemoryVfs::new();
        vfs.mkdir_all("/workspace").unwrap();
        let budget = ExecutionBudget::default();
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);
        let r = state
            .eval_script_str(
                r#"
set -e
! true & p1=$!
! false & p2=$!
: && ! true & p3=$!
: && ! false & p4=$!
: && ! { exit 7; } & p5=$!
set +e
wait "$p1"; s1=$?
wait "$p2"; s2=$?
wait "$p3"; s3=$?
wait "$p4"; s4=$?
wait "$p5"; s5=$?
printf 'neg=%d:%d:%d:%d:%d\n' "$s1" "$s2" "$s3" "$s4" "$s5"

{
  read -r bg_default &
  wait $!
  read -r fg_after
  printf 'bg_stdin=<%s>:<%s>\n' "${bg_default-UNSET}" "$fg_after"
} <<< $'first\nsecond\n'

{
  { read -r bg_dup0; printf 'bg_dup0=<%s>\n' "$bg_dup0"; } <&0 &
  wait $!
  read -r fg_dup0
  printf 'fg_dup0=<%s>\n' "$fg_dup0"
} <<< $'one\ntwo\n'

{
  exec 3<&0
  { read -r bg_fd3; printf 'bg_fd3=<%s>\n' "$bg_fd3"; } <&3 &
  wait $!
  read -r fg_fd3
  printf 'fg_fd3=<%s>\n' "$fg_fd3"
  exec 3<&-
} <<< $'alpha\nbeta\n'

( exit 9 ) & cpid=$!
(
  wait "$cpid" 2>e_sub_wait; sw=$?
  jobs > e_sub_jobs
  printf 'sub_wait=%d:%s|sub_jobs=%s\n' "$sw" "$(cat e_sub_wait)" "$(cat e_sub_jobs)"
)
wait "$cpid"; pw=$?
printf 'parent_wait=%d\n' "$pw"

shopt -s lastpipe
( exit 11 ) & lpid=$!
printf 'go\n' | { wait "$lpid"; lw=$?; }
jobs > e_lp_jobs
printf 'lastpipe=%d:<%s>\n' "$lw" "$(cat e_lp_jobs)"
shopt -u lastpipe

( exit 7 ) & j1=$!
wait "$j1"
:
who=old
wait -n -p who "$j1"; nr_st=$?
printf 'no_retire=%d:<%s>\n' "$nr_st" "${who+x}"
wait

( exit 7 ) & k1=$!
wait "$k1"
(:)
who=old
wait -n -p who "$k1"; sr_st=$?
printf 'sub_retire=%d:<%s>\n' "$sr_st" "${who+x}"
wait

( exit 17 ) & s_pid=$!
wait "$s_pid"
( exit 23 ) & a_pid=$!
wait -n -p win1 "$s_pid" "$a_pid"; w1=$?
wait -n -p win2 "$a_pid"; w2=$?
printf 'saved_prepass=%d:%s|%d:%s\n' "$w1" "$win1" "$w2" "$win2"

arr=(keep0 keep1)
wait -n -p 'arr[1]'; we=$?
printf 'arr_keep=%d:<%s>:<%s>\n' "$we" "${arr[0]}" "${arr[1]}"
scalar=OLD
wait -n -p scalar; ws=$?
printf 'scalar_unset=%d:%s\n' "$ws" "${scalar+SET}"
wait -p 'bad-name' -Z 2>e_order; wo=$?
printf 'order=%d:%s\n' "$wo" "$(tr '\n' '|' < e_order)"
( exit 5 ) & fpid=$!
wait "$fpid"
(:)
wait " +$fpid" 2>e_flex; wf=$?
wait -n -p fwin " +$fpid"; wfn=$?
printf 'flex=%d:%s|%d:%s\n' "$wf" "$(cat e_flex)" "$wfn" "$fwin"
"#,
                "",
            )
            .unwrap();
        assert_eq!(r.stderr, "");
        assert_eq!(r.exit_code, 0);
        assert_eq!(
            r.stdout,
            concat!(
                "neg=0:1:1:0:7\n",
                "bg_stdin=<UNSET>:<first>\n",
                "bg_dup0=<one>\n",
                "fg_dup0=<two>\n",
                "bg_fd3=<alpha>\n",
                "fg_fd3=<beta>\n",
                "sub_wait=127:shell: line 41: wait: pid 1009 is not a child of this shell|sub_jobs=[1]+  Running                 ( exit 9 ) &\n",
                "parent_wait=9\n",
                "lastpipe=11:<>\n",
                "no_retire=127:<>\n",
                "sub_retire=7:<x>\n",
                "saved_prepass=17:1013|23:1014\n",
                "arr_keep=127:<keep0>:<keep1>\n",
                "scalar_unset=127:\n",
                "order=2:shell: line 84: wait: -Z: invalid option|wait: usage: wait [-fn] [-p var] [id ...]|\n",
                "flex=1:shell: line 89: wait: ` +1015': not a pid or valid job spec|5:1015\n",
            )
        );
    }

    #[test]
    fn unit_eval_source_dot_eval_command_syntax_locale_and_bounds_parity() {
        let mut cwd = "/workspace".to_string();
        let mut env = BTreeMap::new();
        let vfs = crate::vfs::MemoryVfs::new();
        vfs.mkdir_all("/workspace").unwrap();
        let budget = ExecutionBudget::default();
        let custom = BTreeMap::new();
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);
        let r = state
            .eval_script_str(
                r#"
mkdir -p /workspace/sd
cd /workspace/sd

printf '%s\n' 'set -- changed' > set_lib.sh
set -- orig
. ./set_lib.sh arg1
printf 'top_set=%s\n' "$1"

fn_set() {
  set -- fn_orig
  . ./set_lib.sh arg1
  printf 'fn_set=%s\n' "$1"
}
fn_set

printf '%s\n' 'printf "seen=%s\n" "${P-unset}"' > p_lib.sh
P=outer
P=inner . ./p_lib.sh
printf 'bash_dot_after=%s\n' "$P"
P=inner eval 'printf "eval_seen=%s\n" "$P"'
printf 'bash_eval_after=%s\n' "$P"

sh -c '
  P=outer
  P=inner . ./p_lib.sh
  printf "sh_dot_after=%s\n" "$P"
  P=outer
  P=inner command . ./p_lib.sh
  printf "sh_cmd_dot_after=%s\n" "$P"
'

printf '%s\n' 'LATE=kept' 'if true; then' > late_bad.sh
( . ./late_bad.sh ) 2>e_dot_eof; d_st=$?
printf 'dot_eof=%d:%s\n' "$d_st" "$(tr '\n' '|' < e_dot_eof)"

( eval $'EVAL_KEEP=1\n(\necho nope' ) 2>e_eval_eof; e_st=$?
printf 'eval_eof=%d:%s\n' "$e_st" "$(tr '\n' '|' < e_eval_eof)"

LC_ALL=C eval $'c_val=$\'\\u00e9\\U000003a9\\U0001f600\\u0041\''
LC_ALL=en_US.UTF-8 eval $'u_val=$\'\\u00e9\''
printf 'locale=%s|%s\n' "$c_val" "$u_val"
"#,
                "",
            )
            .unwrap();
        assert_eq!(r.stderr, "");
        assert_eq!(r.exit_code, 0);
        assert_eq!(
            r.stdout,
            concat!(
                "top_set=changed\n",
                "fn_set=fn_orig\n",
                "seen=inner\n",
                "bash_dot_after=outer\n",
                "eval_seen=inner\n",
                "bash_eval_after=outer\n",
                "seen=inner\n",
                "sh_dot_after=inner\n",
                "seen=inner\n",
                "sh_cmd_dot_after=outer\n",
                "dot_eof=2:./late_bad.sh: line 3: syntax error: unexpected end of file from `if' command on line 2|\n",
                "eval_eof=2:shell: eval: line 40: syntax error: unexpected end of file|\n",
                "locale=\\u00E9\\u03A9\\U0001F600A|\u{00e9}\n",
            )
        );

        let mut lim = crate::ShellLimits::default();
        lim.max_source_bytes = 20;
        let budget_lim = ExecutionBudget::new(lim, None);
        let mut state_lim = EvalState::new(&mut cwd, &mut env, &vfs, &budget_lim, &custom, false);
        let err = state_lim.eval_script_str("eval 'VALUE=12345678901234567890'", "").unwrap_err();
        assert!(matches!(err, EvalError::Budget(ref msg) if msg.contains("Shell limit exceeded: maxSourceBytes")), "unexpected err: {err:?}");
    }

    #[test]
    fn unit_eval_invocation_closure_sh_discovery_modes_options_parity() {
        let vfs = crate::MemoryVfs::new();
        vfs.mkdir_all("/work/bin").unwrap();
        vfs.mkdir_all("/tmp").unwrap();
        vfs.write_file("/work/bin/tool", b"#!/bin/sh\nprintf 'tool:%s\\n' \"$1\"\n")
            .unwrap();
        vfs.chmod("/work/bin/tool", 0o755).unwrap();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();
        env.insert("PATH".to_string(), "".to_string());
        env.insert("LC_ALL".to_string(), "C".to_string());
        let custom = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::ShellLimits::default(), None);
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);
        state.script_name = Some("shell".to_string());

        let r = state
            .eval_script_str(
                r#"
VALUE=old; VALUE=new export OTHER=ok; printf 'bash_exp=%s:%s\n' "$VALUE" "$OTHER"
VALUE=old; VALUE=new command export VALUE; printf 'bash_cmd_exp=%s\n' "$VALUE"
sh -c 'VALUE=old; VALUE=new export OTHER=ok; printf "sh_exp=%s:%s\n" "$VALUE" "$OTHER"' sh
sh -c 'VALUE=old; VALUE=new command export OTHER=ok; printf "sh_cmd_exp=%s:%s\n" "$VALUE" "$OTHER"' sh
sh -c 'VALUE=old; VALUE=new command unset VALUE; printf "sh_cmd_unset=%s\n" "${VALUE-unset}"' sh
sh -c 'export() { :; }' sh 2>/tmp/sh_fn_err; printf 'sh_fn=%s:%s\n' "$?" "$(cat /tmp/sh_fn_err)"
sh -c 'readonly LOCK=1; LOCK=2 : >/work/m1' sh 2>/tmp/sh_ro_err; printf 'sh_ro=%s:%s:%s\n' "$?" "$(test -e /work/m1 && echo yes || echo no)" "$(cat /tmp/sh_ro_err)"
sh -c 'PATH=bin; printf "sh_disc=%s|%s\n" "$(command -v tool)" "$(type -p tool)"' sh
bash -c 'PATH=bin; printf "bash_disc=%s|%s\n" "$(command -v tool)" "$(type -p tool)"' bash
bash -c ': >/work/b1
)
: >/work/b2' named 2>/tmp/c_syn_err; printf 'c_syn=%s:%s:%s\n' "$?" "$(test -e /work/b1 && echo yes || echo no)" "$(tr '\n' '|' </tmp/c_syn_err)"
printf 'read -r v\nhello world\nprintf "stdin_rd=[%%s]\\n" "$v"\n' | bash -s
bash -o noclobber -c '[[ -o noclobber ]]; printf "opt_c=%s\n" "$?"'
"#,
                "",
            )
            .unwrap();
        assert_eq!(r.stderr, "");
        assert_eq!(r.exit_code, 0);
        assert_eq!(
            r.stdout,
            concat!(
                "bash_exp=old:ok\n",
                "bash_cmd_exp=new\n",
                "sh_exp=new:ok\n",
                "sh_cmd_exp=old:ok\n",
                "sh_cmd_unset=unset\n",
                "sh_fn=2:sh: line 1: `export': is a special builtin\n",
                "sh_ro=127:no:sh: line 1: LOCK: readonly variable\n",
                "sh_disc=/work/bin/tool|/work/bin/tool\n",
                "bash_disc=bin/tool|bin/tool\n",
                "c_syn=2:yes:named: -c: line 2: syntax error near unexpected token `)'|named: -c: line 2: `)'|\n",
                "stdin_rd=[hello world]\n",
                "opt_c=0\n",
            )
        );
    }

    #[test]
    fn test_errexit_native_expanded_gaps_bounds_and_env_split_parity() {
        let vfs = crate::MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        vfs.mkdir_all("/tmp").unwrap();
        vfs.write_file("/work/plain_file", b"x").unwrap();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();
        let custom = BTreeMap::new();
        let budget = ExecutionBudget::new(crate::ShellLimits::default(), None);
        let mut state = EvalState::new(&mut cwd, &mut env, &vfs, &budget, &custom, false);
        state.script_name = Some("shell".to_string());

        let r = state
            .eval_script_units(
                r#"
(set -e; { false && true; }; printf 'grp=%s\n' "$?")
(set -e; for v in a; do false && true; done; printf 'for=%s\n' "$?")
(set -e; f() { false && true; printf 'fn=%s\n' "$?"; }; f)
(set -e; ! true; printf 'neg=%s\n' "$?")
(set -e; { true; } 2>/tmp/r1 > /work/missing/out; printf 'BAD\n'); printf 'redir_miss=%s:%s\n' "$?" "$(cat /tmp/r1)"
(set -e; { true; } 2>/tmp/r2 > /work/plain_file/out; printf 'BAD\n'); printf 'redir_notdir=%s:%s\n' "$?" "$(cat /tmp/r2)"
sh -c 'set -e; v=$(false; printf sub); printf "BAD:%s\n" "$v"'; printf 'posix_sub=%s\n' "$?"
set -o inherit_errexit 2>/tmp/set_inv; printf 'set_inv=%s:%s\n' "$?" "$(cat /tmp/set_inv)"
set -o xtrace 2>/tmp/set_unsup; printf 'set_unsup=%s:%s\n' "$?" "$(cat /tmp/set_unsup)"
LOOP='-S ${LOOP}' env -S '${LOOP}' 2>/tmp/env_loop; printf 'env_loop=%s:%s\n' "$?" "$(cat /tmp/env_loop)"
"#,
                &mut String::new(),
            )
            .unwrap();
        assert_eq!(r.stderr, "");
        assert_eq!(r.exit_code, 0);
        assert_eq!(
            r.stdout,
            concat!(
                "grp=1\n",
                "for=1\n",
                "fn=1\n",
                "neg=1\n",
                "redir_miss=1:shell: line 6: /work/missing/out: No such file or directory\n",
                "redir_notdir=1:shell: line 7: /work/plain_file/out: Not a directory\n",
                "posix_sub=1\n",
                "set_inv=2:shell: line 9: set: inherit_errexit: invalid option name\n",
                "set_unsup=1:shell: line 10: set: xtrace: unsupported shell option\n",
                "env_loop=125:env: split-string expansion limit exceeded (32)\n",
            )
        );

        // Check maxOutputBytes across pipeline intermediate stage
        {
            let mut lim = crate::ShellLimits::default();
            lim.max_output_bytes = 7;
            let b = ExecutionBudget::new(lim, None);
            let mut c = "/work".to_string();
            let mut e = BTreeMap::new();
            let mut st = EvalState::new(&mut c, &mut e, &vfs, &b, &custom, false);
            let err = st
                .eval_script_str("set -e; env -i printf 1234 | cat", "")
                .unwrap_err();
            assert!(format!("{err:?}").contains("maxOutputBytes"));
        }
        // Check maxExpansionBytes working-memory bound on parameter trim
        {
            let mut lim = crate::ShellLimits::default();
            lim.max_expansion_bytes = 256;
            let b = ExecutionBudget::new(lim, None);
            let mut c = "/work".to_string();
            let mut e = BTreeMap::new();
            let mut st = EvalState::new(&mut c, &mut e, &vfs, &b, &custom, false);
            let val = "a".repeat(200);
            let err = st
                .eval_script_str(&format!("v={val}; printf '%s' \"${{v#a*}}\""), "")
                .unwrap_err();
            assert!(format!("{err:?}").contains("maxExpansionBytes"));
        }
    }
}
