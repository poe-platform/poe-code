use crate::backend::{CommandContext, CommandResult, RustCommand};
use crate::budget::ExecutionBudget;
use crate::commands::try_run_command;
use crate::shell::builtins::{BuiltinOutcome, try_run_builtin};
use crate::shell::expand::{
    decode_ansi_c_escapes, eval_arith, expand_globs_in_word, expand_parameter_expr, glob_match,
};
use crate::shell::parser::{
    AndOrList, CommandNode, ListOp, Pipeline, Redirect, RedirectKind, Script, SimpleCommand,
    parse_script, validate_basic_syntax,
};
use crate::vfs::{SafeBashFs, bytes_to_stream_string, resolve_posix_path, stream_string_to_bytes};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub enum EvalError {
    Syntax(String),
    Budget(String),
    UnportedCommand(String),
}

pub struct EvalState<'a> {
    pub cwd: &'a mut String,
    pub env: &'a mut BTreeMap<String, String>,
    pub fs: &'a dyn SafeBashFs,
    pub budget: &'a ExecutionBudget,
    pub custom_commands: &'a BTreeMap<String, RustCommand>,
    pub functions: BTreeMap<String, Script>,
    pub pos_args: Vec<String>,
    pub last_exit: i32,
    pub errexit: bool,
    pub nounset: bool,
    pub pipefail: bool,
    pub exit_requested: Option<i32>,
    pub return_requested: Option<i32>,
    pub break_count: usize,
    pub continue_count: usize,
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
        Self {
            cwd,
            env,
            fs,
            budget,
            custom_commands,
            functions: BTreeMap::new(),
            pos_args: Vec::new(),
            last_exit: 0,
            errexit: false,
            nounset: false,
            pipefail: false,
            exit_requested: None,
            return_requested: None,
            break_count: 0,
            continue_count: 0,
            allow_unported_fallback,
        }
    }

    pub fn eval_script_str(&mut self, script: &str, stdin: &str) -> Result<CommandResult, EvalError> {
        if let Err(syn_err) = validate_basic_syntax(script) {
            return Err(EvalError::Syntax(syn_err));
        }
        let ast = parse_script(script).map_err(EvalError::Syntax)?;
        let mut stdin_buf = stdin.to_string();
        let out = self.eval_script(&ast, &mut stdin_buf)?;
        Ok(CommandResult {
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: self.exit_requested.unwrap_or(out.exit_code),
            cwd: self.cwd.clone(),
            env: self.env.clone(),
        })
    }

    fn eval_script(&mut self, script: &Script, stdin: &mut String) -> Result<BuiltinOutcome, EvalError> {
        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut last_code = self.last_exit;

        for list in &script.lists {
            self.budget.tick_iteration().map_err(EvalError::Budget)?;
            let out = self.eval_and_or_list(list, stdin)?;
            self.budget
                .record_stdout(out.stdout.len())
                .map_err(EvalError::Budget)?;
            self.budget
                .record_stderr(out.stderr.len())
                .map_err(EvalError::Budget)?;
            stdout.push_str(&out.stdout);
            stderr.push_str(&out.stderr);
            last_code = out.exit_code;
            self.last_exit = last_code;

            if self.exit_requested.is_some()
                || self.return_requested.is_some()
                || self.break_count > 0
                || self.continue_count > 0
            {
                break;
            }
            if self.errexit && last_code != 0 {
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
        let mut first_out = self.eval_pipeline(&list.first, stdin)?;
        self.last_exit = first_out.exit_code;

        for (op, pipe) in &list.rest {
            if self.exit_requested.is_some()
                || self.return_requested.is_some()
                || self.break_count > 0
                || self.continue_count > 0
            {
                break;
            }
            let should_run = match op {
                ListOp::And => first_out.exit_code == 0,
                ListOp::Or => first_out.exit_code != 0,
            };
            if should_run {
                let next_out = self.eval_pipeline(pipe, stdin)?;
                first_out.stdout.push_str(&next_out.stdout);
                first_out.stderr.push_str(&next_out.stderr);
                first_out.exit_code = next_out.exit_code;
                self.last_exit = next_out.exit_code;
            }
        }

        Ok(first_out)
    }

    fn eval_pipeline(&mut self, pipe: &Pipeline, stdin: &mut String) -> Result<BuiltinOutcome, EvalError> {
        if pipe.commands.is_empty() {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            });
        }

        if pipe.commands.len() == 1 {
            let mut out = self.eval_command_node(&pipe.commands[0], stdin)?;
            if pipe.negated {
                out.exit_code = if out.exit_code == 0 { 1 } else { 0 };
            }
            self.last_exit = out.exit_code;
            return Ok(out);
        }

        let mut cur_stdin = std::mem::take(stdin);
        let mut combined_stderr = String::new();
        let mut stage_codes = Vec::with_capacity(pipe.commands.len());

        for (idx, cmd_node) in pipe.commands.iter().enumerate() {
            let is_last = idx + 1 == pipe.commands.len();
            let stage_out = if is_last {
                self.eval_command_node(cmd_node, &mut cur_stdin)?
            } else {
                let mut sub_cwd = self.cwd.clone();
                let mut sub_env = self.env.clone();
                let mut sub = EvalState {
                    cwd: &mut sub_cwd,
                    env: &mut sub_env,
                    fs: self.fs,
                    budget: self.budget,
                    custom_commands: self.custom_commands,
                    functions: self.functions.clone(),
                    pos_args: self.pos_args.clone(),
                    last_exit: self.last_exit,
                    errexit: self.errexit,
                    nounset: self.nounset,
                    pipefail: self.pipefail,
                    exit_requested: None,
                    return_requested: None,
                    break_count: 0,
                    continue_count: 0,
                    allow_unported_fallback: self.allow_unported_fallback,
                };
                sub.eval_command_node(cmd_node, &mut cur_stdin)?
            };
            combined_stderr.push_str(&stage_out.stderr);
            stage_codes.push(stage_out.exit_code);
            cur_stdin = stage_out.stdout;
        }

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
        self.budget.tick_iteration().map_err(EvalError::Budget)?;
        match node {
            CommandNode::Simple(simple) => self.eval_simple_command(simple, stdin),
            CommandNode::Subshell { body, redirects } => {
                self.budget.enter_recursion().map_err(EvalError::Budget)?;
                let mut local_stdin = self.prepare_input_redirects(redirects, stdin)?;
                let eff_stdin = if redirects.iter().any(|r| matches!(r.kind, RedirectKind::In | RedirectKind::HereString | RedirectKind::HereDoc { .. })) { &mut local_stdin } else { stdin };
                let mut sub_cwd = self.cwd.clone();
                let mut sub_env = self.env.clone();
                let mut sub = EvalState {
                    cwd: &mut sub_cwd,
                    env: &mut sub_env,
                    fs: self.fs,
                    budget: self.budget,
                    custom_commands: self.custom_commands,
                    functions: self.functions.clone(),
                    pos_args: self.pos_args.clone(),
                    last_exit: self.last_exit,
                    errexit: self.errexit,
                    nounset: self.nounset,
                    pipefail: self.pipefail,
                    exit_requested: None,
                    return_requested: None,
                    break_count: 0,
                    continue_count: 0,
                    allow_unported_fallback: self.allow_unported_fallback,
                };
                let res = sub.eval_script(body, eff_stdin);
                self.budget.leave_recursion();
                let mut out = res?;
                if let Some(code) = sub.exit_requested {
                    out.exit_code = code;
                }
                self.apply_output_redirects(redirects, &mut out)?;
                Ok(out)
            }
            CommandNode::Group { body, redirects } => {
                let mut local_stdin = self.prepare_input_redirects(redirects, stdin)?;
                let eff_stdin = if redirects.iter().any(|r| matches!(r.kind, RedirectKind::In | RedirectKind::HereString | RedirectKind::HereDoc { .. })) { &mut local_stdin } else { stdin };
                let mut out = self.eval_script(body, eff_stdin)?;
                self.apply_output_redirects(redirects, &mut out)?;
                Ok(out)
            }
            CommandNode::If {
                branches,
                else_branch,
                redirects,
            } => {
                let mut local_stdin = self.prepare_input_redirects(redirects, stdin)?;
                let eff_stdin = if redirects.iter().any(|r| matches!(r.kind, RedirectKind::In | RedirectKind::HereString | RedirectKind::HereDoc { .. })) { &mut local_stdin } else { stdin };
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;
                let mut matched = false;

                for (cond, body) in branches {
                    let prev_errexit = self.errexit;
                    self.errexit = false;
                    let cond_out = self.eval_script(cond, eff_stdin)?;
                    self.errexit = prev_errexit;
                    stdout.push_str(&cond_out.stdout);
                    stderr.push_str(&cond_out.stderr);
                    if cond_out.exit_code == 0 {
                        let body_out = self.eval_script(body, eff_stdin)?;
                        stdout.push_str(&body_out.stdout);
                        stderr.push_str(&body_out.stderr);
                        code = body_out.exit_code;
                        matched = true;
                        break;
                    }
                }

                if !matched {
                    if let Some(else_b) = else_branch {
                        let body_out = self.eval_script(else_b, eff_stdin)?;
                        stdout.push_str(&body_out.stdout);
                        stderr.push_str(&body_out.stderr);
                        code = body_out.exit_code;
                    }
                }

                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.apply_output_redirects(redirects, &mut out)?;
                Ok(out)
            }
            CommandNode::ForIn {
                var,
                items,
                body,
                redirects,
            } => {
                let mut local_stdin = self.prepare_input_redirects(redirects, stdin)?;
                let eff_stdin = if redirects.iter().any(|r| matches!(r.kind, RedirectKind::In | RedirectKind::HereString | RedirectKind::HereDoc { .. })) { &mut local_stdin } else { stdin };
                let mut expanded_items = Vec::new();
                for raw in items {
                    expanded_items.extend(self.expand_word_to_fields(raw)?);
                }
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;

                for val in expanded_items {
                    self.budget.tick_iteration().map_err(EvalError::Budget)?;
                    self.env.insert(var.clone(), val);
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
                }

                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.apply_output_redirects(redirects, &mut out)?;
                Ok(out)
            }
            CommandNode::ForArith {
                init,
                cond,
                step,
                body,
                redirects,
            } => {
                let mut local_stdin = self.prepare_input_redirects(redirects, stdin)?;
                let eff_stdin = if redirects.iter().any(|r| matches!(r.kind, RedirectKind::In | RedirectKind::HereString | RedirectKind::HereDoc { .. })) { &mut local_stdin } else { stdin };
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;

                if !init.trim().is_empty() {
                    let exp_init = self.expand_word_to_string(init)?;
                    let _ = eval_arith(&exp_init, self.env);
                }

                loop {
                    self.budget.tick_iteration().map_err(EvalError::Budget)?;
                    if !cond.trim().is_empty() {
                        let exp_cond = self.expand_word_to_string(cond)?;
                        let cval = eval_arith(&exp_cond, self.env).unwrap_or(0);
                        if cval == 0 {
                            break;
                        }
                    }
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
                    if !step.trim().is_empty() {
                        let exp_step = self.expand_word_to_string(step)?;
                        let _ = eval_arith(&exp_step, self.env);
                    }
                }

                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.apply_output_redirects(redirects, &mut out)?;
                Ok(out)
            }
            CommandNode::While {
                until,
                cond,
                body,
                redirects,
            } => {
                let mut local_stdin = self.prepare_input_redirects(redirects, stdin)?;
                let eff_stdin = if redirects.iter().any(|r| matches!(r.kind, RedirectKind::In | RedirectKind::HereString | RedirectKind::HereDoc { .. })) { &mut local_stdin } else { stdin };
                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut code = 0;

                loop {
                    self.budget.tick_iteration().map_err(EvalError::Budget)?;
                    let prev_errexit = self.errexit;
                    self.errexit = false;
                    let cond_out = self.eval_script(cond, eff_stdin)?;
                    self.errexit = prev_errexit;
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
                }

                let mut out = BuiltinOutcome {
                    stdout,
                    stderr,
                    exit_code: code,
                };
                self.apply_output_redirects(redirects, &mut out)?;
                Ok(out)
            }
            CommandNode::Case {
                word,
                arms,
                redirects,
            } => {
                let mut local_stdin = self.prepare_input_redirects(redirects, stdin)?;
                let eff_stdin = if redirects.iter().any(|r| matches!(r.kind, RedirectKind::In | RedirectKind::HereString | RedirectKind::HereDoc { .. })) { &mut local_stdin } else { stdin };
                let target = self.expand_word_to_string(word)?;
                let mut out = BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                };
                for (pats, body) in arms {
                    let mut matched = false;
                    for p in pats {
                        let exp_p = self.expand_word_to_string(p)?;
                        if glob_match(&exp_p, &target) {
                            matched = true;
                            break;
                        }
                    }
                    if matched {
                        out = self.eval_script(body, eff_stdin)?;
                        break;
                    }
                }
                self.apply_output_redirects(redirects, &mut out)?;
                Ok(out)
            }
            CommandNode::ArithCommand(expr) => {
                let exp = self.expand_word_to_string(expr)?;
                match eval_arith(&exp, self.env) {
                    Ok(val) => Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: if val != 0 { 0 } else { 1 },
                    }),
                    Err(e) => Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("arith: {e}\n"),
                        exit_code: 1,
                    }),
                }
            }
            CommandNode::FuncDef { name, body } => {
                self.functions.insert(name.clone(), body.clone());
                Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                })
            }
        }
    }

    fn eval_simple_command(
        &mut self,
        simple: &SimpleCommand,
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        let mut local_stdin = self.prepare_input_redirects(&simple.redirects, stdin)?;
        let eff_stdin = if simple.redirects.iter().any(|r| matches!(r.kind, RedirectKind::In | RedirectKind::HereString | RedirectKind::HereDoc { .. })) { &mut local_stdin } else { stdin };
        let mut expanded_words = Vec::new();
        for w in &simple.words {
            expanded_words.extend(self.expand_word_to_fields(w)?);
        }

        if expanded_words.is_empty() {
            for (k, v, append) in &simple.assignments {
                let val = self.expand_word_to_string(v)?;
                if *append {
                    let cur = self.env.get(k).cloned().unwrap_or_default();
                    self.env.insert(k.clone(), format!("{cur}{val}"));
                } else {
                    self.env.insert(k.clone(), val);
                }
            }
            let mut out = BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: self.last_exit,
            };
            self.apply_output_redirects(&simple.redirects, &mut out)?;
            return Ok(out);
        }

        let mut temp_saved: Vec<(String, Option<String>)> = Vec::new();
        for (k, v, append) in &simple.assignments {
            let val = self.expand_word_to_string(v)?;
            temp_saved.push((k.clone(), self.env.get(k).cloned()));
            if *append {
                let cur = self.env.get(k).cloned().unwrap_or_default();
                self.env.insert(k.clone(), format!("{cur}{val}"));
            } else {
                self.env.insert(k.clone(), val);
            }
        }

        let res = self.dispatch_words(&expanded_words, eff_stdin);

        for (k, old) in temp_saved.into_iter().rev() {
            match old {
                Some(v) => {
                    self.env.insert(k, v);
                }
                None => {
                    self.env.remove(&k);
                }
            }
        }

        let mut out = res?;
        self.apply_output_redirects(&simple.redirects, &mut out)?;
        Ok(out)
    }

    fn dispatch_words(
        &mut self,
        words: &[String],
        stdin: &mut String,
    ) -> Result<BuiltinOutcome, EvalError> {
        if words.is_empty() {
            return Ok(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            });
        }
        let cmd = &words[0];
        let args = &words[1..];

        match cmd.as_str() {
            "exit" => {
                let code = args
                    .first()
                    .and_then(|s| s.parse::<i32>().ok())
                    .unwrap_or(self.last_exit);
                self.exit_requested = Some(code);
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: code,
                });
            }
            "return" => {
                let code = args
                    .first()
                    .and_then(|s| s.parse::<i32>().ok())
                    .unwrap_or(self.last_exit);
                self.return_requested = Some(code);
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: code,
                });
            }
            "break" => {
                let n = args
                    .first()
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(1)
                    .max(1);
                self.break_count = n;
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            "continue" => {
                let n = args
                    .first()
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(1)
                    .max(1);
                self.continue_count = n;
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            "shift" => {
                let n = args
                    .first()
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(1);
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
                let mut i = 0usize;
                while i < args.len() {
                    let a = &args[i];
                    if a == "--" {
                        self.pos_args = args[i + 1..].to_vec();
                        break;
                    } else if a == "-o" && i + 1 < args.len() {
                        match args[i + 1].as_str() {
                            "errexit" => self.errexit = true,
                            "nounset" => self.nounset = true,
                            "pipefail" => self.pipefail = true,
                            _ => {}
                        }
                        i += 2;
                        continue;
                    } else if a == "+o" && i + 1 < args.len() {
                        match args[i + 1].as_str() {
                            "errexit" => self.errexit = false,
                            "nounset" => self.nounset = false,
                            "pipefail" => self.pipefail = false,
                            _ => {}
                        }
                        i += 2;
                        continue;
                    } else if a.starts_with('-') && a.len() > 1 {
                        for ch in a[1..].chars() {
                            match ch {
                                'e' => self.errexit = true,
                                'u' => self.nounset = true,
                                _ => {}
                            }
                        }
                    } else if a.starts_with('+') && a.len() > 1 {
                        for ch in a[1..].chars() {
                            match ch {
                                'e' => self.errexit = false,
                                'u' => self.nounset = false,
                                _ => {}
                            }
                        }
                    }
                    i += 1;
                }
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            "eval" => {
                let joined = args.join(" ");
                let ast = parse_script(&joined).map_err(EvalError::Syntax)?;
                return self.eval_script(&ast, stdin);
            }
            "source" | "." => {
                if let Some(target) = args.first() {
                    let full = resolve_posix_path(self.cwd, target);
                    match self.fs.read_file(&full) {
                        Ok(bytes) => {
                            let script_str = String::from_utf8_lossy(&bytes);
                            let ast = parse_script(&script_str).map_err(EvalError::Syntax)?;
                            return self.eval_script(&ast, stdin);
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
                return Ok(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            "command" | "builtin" => {
                if args.is_empty() {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 0,
                    });
                }
                if args[0] == "-v" {
                    if let Some(target) = args.get(1) {
                        if crate::commands::search::is_known_command(target)
                            || self.functions.contains_key(target)
                            || self.custom_commands.contains_key(target)
                        {
                            return Ok(BuiltinOutcome {
                                stdout: format!("{target}\n"),
                                stderr: String::new(),
                                exit_code: 0,
                            });
                        }
                    }
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: 1,
                    });
                }
                return self.dispatch_words(args, stdin);
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

        if let Some(func_body) = self.functions.get(cmd).cloned() {
            self.budget.enter_recursion().map_err(EvalError::Budget)?;
            let prev_args = std::mem::replace(&mut self.pos_args, args.to_vec());
            let res = self.eval_script(&func_body, stdin);
            self.pos_args = prev_args;
            self.budget.leave_recursion();
            let mut out = res?;
            if let Some(ret_code) = self.return_requested.take() {
                out.exit_code = ret_code;
            }
            return Ok(out);
        }

        if let Some(b_out) = try_run_builtin(cmd, args, stdin, self.cwd, self.env, self.fs) {
            return Ok(b_out);
        }

        let fs_ref = self.fs;
        let budget_ref = self.budget;
        let custom_ref = self.custom_commands;
        let funcs_clone = self.functions.clone();
        let allow_fallback = self.allow_unported_fallback;

        if let Some(c_out) = try_run_command(
            cmd,
            args,
            stdin,
            self.cwd,
            self.env,
            fs_ref,
            |sub_words, sub_stdin, sub_cwd, sub_env| {
                let mut sub_eval = EvalState {
                    cwd: sub_cwd,
                    env: sub_env,
                    fs: fs_ref,
                    budget: budget_ref,
                    custom_commands: custom_ref,
                    functions: funcs_clone.clone(),
                    pos_args: Vec::new(),
                    last_exit: 0,
                    errexit: false,
                    nounset: false,
                    pipefail: false,
                    exit_requested: None,
                    return_requested: None,
                    break_count: 0,
                    continue_count: 0,
                    allow_unported_fallback: allow_fallback,
                };
                let mut sub_in = sub_stdin.to_string();
                sub_eval.dispatch_words(sub_words, &mut sub_in).unwrap_or(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 1,
                })
            },
        ) {
            return Ok(c_out);
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

    fn prepare_input_redirects(
        &mut self,
        redirects: &[Redirect],
        default_stdin: &str,
    ) -> Result<String, EvalError> {
        let mut eff = default_stdin.to_string();
        for r in redirects {
            match &r.kind {
                RedirectKind::In => {
                    let target = self.expand_word_to_string(&r.target)?;
                    let full = resolve_posix_path(self.cwd, &target);
                    match self.fs.read_file(&full) {
                        Ok(bytes) => {
                            eff = bytes_to_stream_string(&bytes);
                        }
                        Err(_) => {
                            return Ok(String::new());
                        }
                    }
                }
                RedirectKind::HereString => {
                    let val = self.expand_word_to_string(&r.target)?;
                    eff = format!("{val}\n");
                }
                RedirectKind::HereDoc { quoted } => {
                    if *quoted {
                        eff = r.target.clone();
                    } else {
                        eff = self.expand_heredoc_text(&r.target)?;
                    }
                }
                _ => {}
            }
        }
        Ok(eff)
    }

    fn apply_output_redirects(
        &mut self,
        redirects: &[Redirect],
        out: &mut BuiltinOutcome,
    ) -> Result<(), EvalError> {
        for r in redirects {
            match r.kind {
                RedirectKind::Out | RedirectKind::Clobber => {
                    let target = self.expand_word_to_string(&r.target)?;
                    let full = resolve_posix_path(self.cwd, &target);
                    let payload = std::mem::take(&mut out.stdout);
                    if let Err(e) = self.fs.write_file(&full, &stream_string_to_bytes(&payload)) {
                        out.stderr.push_str(&format!("{target}: {}\n", e));
                        out.exit_code = 1;
                    }
                }
                RedirectKind::Append => {
                    let target = self.expand_word_to_string(&r.target)?;
                    let full = resolve_posix_path(self.cwd, &target);
                    let payload = std::mem::take(&mut out.stdout);
                    if let Err(e) = self.fs.append_file(&full, &stream_string_to_bytes(&payload)) {
                        out.stderr.push_str(&format!("{target}: {}\n", e));
                        out.exit_code = 1;
                    }
                }
                RedirectKind::ErrOut => {
                    let target = self.expand_word_to_string(&r.target)?;
                    let full = resolve_posix_path(self.cwd, &target);
                    let payload = std::mem::take(&mut out.stderr);
                    let _ = self.fs.write_file(&full, &stream_string_to_bytes(&payload));
                }
                RedirectKind::ErrAppend => {
                    let target = self.expand_word_to_string(&r.target)?;
                    let full = resolve_posix_path(self.cwd, &target);
                    let payload = std::mem::take(&mut out.stderr);
                    let _ = self.fs.append_file(&full, &stream_string_to_bytes(&payload));
                }
                RedirectKind::ErrToOut => {
                    let err_payload = std::mem::take(&mut out.stderr);
                    out.stdout.push_str(&err_payload);
                }
                RedirectKind::OutToErr => {
                    let out_payload = std::mem::take(&mut out.stdout);
                    out.stderr.push_str(&out_payload);
                }
                RedirectKind::BothOut => {
                    let target = self.expand_word_to_string(&r.target)?;
                    let full = resolve_posix_path(self.cwd, &target);
                    let mut combined = std::mem::take(&mut out.stdout);
                    combined.push_str(&std::mem::take(&mut out.stderr));
                    let _ = self.fs.write_file(&full, &stream_string_to_bytes(&combined));
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn expand_heredoc_text(&mut self, text: &str) -> Result<String, EvalError> {
        let mut out = String::new();
        let chars: Vec<char> = text.chars().collect();
        let mut idx = 0usize;
        while idx < chars.len() {
            if chars[idx] == '\\' && idx + 1 < chars.len() {
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
            out.push(chars[idx]);
            idx += 1;
        }
        Ok(out)
    }

    pub fn expand_word_to_string(&mut self, word: &str) -> Result<String, EvalError> {
        let fields = self.expand_word_internal(word, false)?;
        Ok(fields.join(" "))
    }

    pub fn expand_word_to_fields(&mut self, word: &str) -> Result<Vec<String>, EvalError> {
        let brace_expanded = expand_braces(word);
        let mut final_fields = Vec::new();
        for bw in brace_expanded {
            let fields = self.expand_word_internal(&bw, true)?;
            final_fields.extend(fields);
        }
        Ok(final_fields)
    }

    fn expand_word_internal(
        &mut self,
        word: &str,
        split_and_glob: bool,
    ) -> Result<Vec<String>, EvalError> {
        if split_and_glob && (word == "\"$@\"" || word == "\"${@}\"") {
            return Ok(self.pos_args.clone());
        }

        let chars: Vec<char> = word.chars().collect();
        let mut idx = 0usize;
        let mut segments: Vec<(String, bool)> = Vec::new();
        let mut saw_quotes = false;

        if idx < chars.len() && chars[idx] == '~' && (idx + 1 == chars.len() || chars[idx + 1] == '/') {
            let home = self
                .env
                .get("HOME")
                .cloned()
                .unwrap_or_else(|| "/root".to_string());
            segments.push((home, false));
            idx += 1;
        }

        while idx < chars.len() {
            let c = chars[idx];
            if c == '\'' {
                saw_quotes = true;
                idx += 1;
                let mut lit = String::new();
                while idx < chars.len() && chars[idx] != '\'' {
                    lit.push(chars[idx]);
                    idx += 1;
                }
                if idx < chars.len() {
                    idx += 1;
                }
                segments.push((lit, true));
                continue;
            }
            if c == '$' && idx + 1 < chars.len() && chars[idx + 1] == '\'' {
                saw_quotes = true;
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
                segments.push((decode_ansi_c_escapes(&raw), true));
                continue;
            }
            if c == '"' {
                saw_quotes = true;
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
                        let exp = self.expand_dollar(&chars, &mut idx)?;
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
                segments.push((dq, true));
                continue;
            }
            if c == '\\' && idx + 1 < chars.len() {
                segments.push((chars[idx + 1].to_string(), true));
                idx += 2;
                continue;
            }
            if c == '$' {
                let exp = self.expand_dollar(&chars, &mut idx)?;
                segments.push((exp, false));
                continue;
            }
            if c == '`' {
                let exp = self.expand_backticks(&chars, &mut idx)?;
                segments.push((exp, false));
                continue;
            }
            let mut plain = String::new();
            while idx < chars.len()
                && !matches!(chars[idx], '\'' | '"' | '\\' | '$' | '`')
            {
                plain.push(chars[idx]);
                idx += 1;
            }
            segments.push((plain, true));
        }

        if !split_and_glob {
            let mut s = String::new();
            for (part, _) in segments {
                s.push_str(&part);
            }
            return Ok(vec![s]);
        }

        let ifs = self
            .env
            .get("IFS")
            .cloned()
            .unwrap_or_else(|| " \t\n".to_string());
        let mut words: Vec<String> = Vec::new();
        let mut cur = String::new();
        let mut has_token = saw_quotes;

        for (text, is_quoted) in &segments {
            if *is_quoted || ifs.is_empty() {
                cur.push_str(text);
                if !text.is_empty() {
                    has_token = true;
                }
            } else {
                for ch in text.chars() {
                    if ifs.contains(ch) {
                        if !cur.is_empty() {
                            words.push(std::mem::take(&mut cur));
                            has_token = false;
                        }
                    } else {
                        cur.push(ch);
                        has_token = true;
                    }
                }
            }
        }
        if !cur.is_empty() || has_token {
            words.push(cur);
        }

        if saw_quotes {
            return Ok(words);
        }

        let mut globbed = Vec::new();
        for w in words {
            globbed.extend(expand_globs_in_word(&w, self.cwd, self.fs));
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
            let mut depth = 1i32;
            let mut expr = String::new();
            while *idx < chars.len() {
                if *idx + 1 < chars.len() && chars[*idx] == '(' && chars[*idx + 1] == '(' {
                    depth += 1;
                    expr.push_str("((");
                    *idx += 2;
                    continue;
                }
                if *idx + 1 < chars.len() && chars[*idx] == ')' && chars[*idx + 1] == ')' {
                    depth -= 1;
                    if depth == 0 {
                        *idx += 2;
                        break;
                    }
                    expr.push_str("))");
                    *idx += 2;
                    continue;
                }
                expr.push(chars[*idx]);
                *idx += 1;
            }
            let expanded_expr = self.expand_heredoc_text(&expr)?;
            let val = eval_arith(&expanded_expr, self.env).unwrap_or(0);
            return Ok(val.to_string());
        }
        if chars[*idx] == '(' {
            *idx += 1;
            let mut depth = 1i32;
            let mut cmd_str = String::new();
            let mut q: Option<char> = None;
            while *idx < chars.len() && depth > 0 {
                let c = chars[*idx];
                if let Some(qc) = q {
                    if c == qc {
                        q = None;
                    }
                    cmd_str.push(c);
                    *idx += 1;
                    continue;
                }
                if c == '\'' || c == '"' {
                    q = Some(c);
                    cmd_str.push(c);
                    *idx += 1;
                    continue;
                }
                if c == '(' {
                    depth += 1;
                } else if c == ')' {
                    depth -= 1;
                    if depth == 0 {
                        *idx += 1;
                        break;
                    }
                }
                cmd_str.push(c);
                *idx += 1;
            }
            return self.run_command_substitution(&cmd_str);
        }
        if chars[*idx] == '{' {
            *idx += 1;
            let mut depth = 1i32;
            let mut expr = String::new();
            while *idx < chars.len() && depth > 0 {
                if chars[*idx] == '{' {
                    depth += 1;
                } else if chars[*idx] == '}' {
                    depth -= 1;
                    if depth == 0 {
                        *idx += 1;
                        break;
                    }
                }
                expr.push(chars[*idx]);
                *idx += 1;
            }
            return expand_parameter_expr(&expr, self.env, self.last_exit, &self.pos_args)
                .map_err(EvalError::Syntax);
        }
        let first = chars[*idx];
        if matches!(first, '?' | '#' | '@' | '*' | '$' | '!') || first.is_ascii_digit() {
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
            if self.nounset && !self.env.contains_key(&name) {
                return Err(EvalError::Syntax(format!("{name}: unbound variable")));
            }
            return Ok(self.env.get(&name).cloned().unwrap_or_default());
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
        if *idx < chars.len() {
            *idx += 1;
        }
        self.run_command_substitution(&cmd_str)
    }

    fn run_command_substitution(&mut self, cmd_str: &str) -> Result<String, EvalError> {
        self.budget.enter_recursion().map_err(EvalError::Budget)?;
        let mut sub_cwd = self.cwd.clone();
        let mut sub_env = self.env.clone();
        let mut sub = EvalState {
            cwd: &mut sub_cwd,
            env: &mut sub_env,
            fs: self.fs,
            budget: self.budget,
            custom_commands: self.custom_commands,
            functions: self.functions.clone(),
            pos_args: self.pos_args.clone(),
            last_exit: self.last_exit,
            errexit: self.errexit,
            nounset: self.nounset,
            pipefail: self.pipefail,
            exit_requested: None,
            return_requested: None,
            break_count: 0,
            continue_count: 0,
            allow_unported_fallback: self.allow_unported_fallback,
        };
        let res = sub.eval_script_str(cmd_str, "");
        self.budget.leave_recursion();
        let out = res?;
        self.last_exit = out.exit_code;
        Ok(out.stdout.trim_end_matches('\n').to_string())
    }
}

fn expand_braces(word: &str) -> Vec<String> {
    if word.starts_with('\'') || word.starts_with('"') || word.contains("${") {
        return vec![word.to_string()];
    }
    let Some(open) = word.find('{') else {
        return vec![word.to_string()];
    };
    let Some(rel_close) = word[open + 1..].find('}') else {
        return vec![word.to_string()];
    };
    let close = open + 1 + rel_close;
    let prefix = &word[..open];
    let inner = &word[open + 1..close];
    let suffix = &word[close + 1..];

    if let Some((a, b)) = inner.split_once("..") {
        if let (Ok(start), Ok(end)) = (a.parse::<i64>(), b.parse::<i64>()) {
            let mut out = Vec::new();
            let step = if start <= end { 1 } else { -1 };
            let mut cur = start;
            loop {
                for tail in expand_braces(suffix) {
                    out.push(format!("{prefix}{cur}{tail}"));
                }
                if cur == end {
                    break;
                }
                cur += step;
            }
            return out;
        }
        if a.len() == 1 && b.len() == 1 {
            let ca = a.chars().next().unwrap();
            let cb = b.chars().next().unwrap();
            if ca.is_ascii_alphabetic() && cb.is_ascii_alphabetic() {
                let mut out = Vec::new();
                let start = ca as i16;
                let end = cb as i16;
                let step = if start <= end { 1 } else { -1 };
                let mut cur = start;
                loop {
                    let ch = (cur as u8) as char;
                    for tail in expand_braces(suffix) {
                        out.push(format!("{prefix}{ch}{tail}"));
                    }
                    if cur == end {
                        break;
                    }
                    cur += step;
                }
                return out;
            }
        }
    }

    if inner.contains(',') {
        let mut out = Vec::new();
        for alt in inner.split(',') {
            for tail in expand_braces(suffix) {
                out.push(format!("{prefix}{alt}{tail}"));
            }
        }
        return out;
    }

    vec![word.to_string()]
}
