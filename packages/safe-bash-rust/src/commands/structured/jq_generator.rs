//! Pull input only until the downstream filter stops requesting results.
use super::{
    JVal, JqScope, bind_jq_alternatives, eval_jq_atom, is_matching_outer_delim,
    parse_single_json_strict, split_jq_binary, split_jq_binary_right, split_jq_def_semi,
    split_jq_top,
};
use std::ops::ControlFlow::{self, Break, Continue};

type Flow = Result<ControlFlow<()>, String>;
type Emit<'a> = dyn FnMut(JVal) -> Flow + 'a;

pub(super) fn eval_jq(expr: &str, input: &JVal, vars: &JqScope<'_>) -> Result<Vec<JVal>, String> {
    let mut out = Vec::new();
    let result = visit_jq(expr, input, vars, &mut |value| {
        out.push(value);
        Ok(Continue(()))
    });
    match result {
        Err(e) if e.starts_with("__jq_break:") && !out.is_empty() => {
            let label = if let Some((label, tail)) = e.split_once("::") {
                if let Ok(JVal::Array(values)) = parse_single_json_strict(tail) {
                    out.extend(values);
                }
                label
            } else {
                &e
            };
            Err(format!(
                "{label}::{}",
                JVal::Array(out).to_json_string(true, false, 0)
            ))
        }
        Err(e) => Err(e),
        Ok(_) => Ok(out),
    }
}

pub(super) fn visit_jq(expr: &str, input: &JVal, vars: &JqScope<'_>, emit: &mut Emit<'_>) -> Flow {
    let s = expr.trim();
    if s == "." || s.is_empty() {
        return emit(input.clone());
    }
    if let Some(def_rest) = s.strip_prefix("def ")
        && let Some((sig_and_body, after_semi)) = split_jq_def_semi(def_rest)
        && let Some((sig, body)) = sig_and_body.split_once(':')
    {
        let sig = sig.trim();
        let (fname, param) = if let Some(open) = sig.find('(')
            && sig.ends_with(')')
        {
            (sig[..open].trim(), sig[open + 1..sig.len() - 1].trim())
        } else {
            (sig, "")
        };
        let mut next_vars = vars.clone();
        let params = param
            .split(';')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(str::to_owned)
            .collect();
        next_vars.define(fname, params, body.trim(), vars.clone(), true);
        return visit_jq(after_semi.trim(), input, &next_vars, emit);
    }

    if !s.starts_with("label $")
        && s.contains('|')
        && let Some(pipes) = split_jq_top(s, '|')
    {
        if pipes.len() == 2
            && vars.yq.is_some()
            && matches!(pipes[1].as_str(), "anchor" | "alias" | "style")
            && pipes[0].starts_with('.')
        {
            return emit(JVal::Str(vars.yq_path_meta(&pipes[1], &pipes[0])));
        }
        if pipes.len() > 128 {
            return Err("maxAstDepth limit exceeded".into());
        }
        return pipeline(&pipes, input, vars, emit);
    }
    if let Some(rest) = s.strip_prefix("try ") {
        let pair = split_jq_binary(rest, " catch ");
        let body = pair.as_ref().map_or(rest, |(body, _)| body);
        // A catch handles this generator's errors, never a consumer's error.
        let mut downstream = None;
        let result = visit_jq(body, input, vars, &mut |v| match emit(v) {
            Err(e) => {
                downstream = Some(e);
                Ok(Break(()))
            }
            r => r,
        });
        if let Some(e) = downstream {
            return Err(e);
        }
        return match result {
            Err(e) if e.starts_with("__jq_break:") || vars.inputs.borrow().file_error.is_some() => {
                Err(e)
            }
            Err(e) => {
                if let Some((_, handler)) = pair {
                    let value = e
                        .strip_prefix("__jq_err:")
                        .and_then(|s| parse_single_json_strict(s).ok())
                        .unwrap_or(JVal::Str(e));
                    visit_jq(&handler, &value, vars, emit)
                } else {
                    Ok(Continue(()))
                }
            }
            r => r,
        };
    }
    if !s.starts_with("label $")
        && s.contains(',')
        && let Some(parts) = split_jq_top(s, ',')
    {
        for part in parts {
            if visit_jq(&part, input, vars, emit)?.is_break() {
                return Ok(Break(()));
            }
        }
        return Ok(Continue(()));
    }
    if s.starts_with('(') && s.ends_with(')') && is_matching_outer_delim(s, '(', ')') {
        return visit_jq(&s[1..s.len() - 1], input, vars, emit);
    }
    if !vars.functions.is_empty() {
        let (name, args) = s
            .find('(')
            .filter(|&pos| s.ends_with(')') && is_matching_outer_delim(&s[pos..], '(', ')'))
            .map_or((s, None), |pos| {
                (s[..pos].trim(), Some(&s[pos + 1..s.len() - 1]))
            });
        if let Some((filter, scopes)) = vars.invocation(name, args, input)? {
            for scope in scopes {
                if visit_jq(&filter.body, input, &scope, emit)?.is_break() {
                    return Ok(Break(()));
                }
            }
            return Ok(Continue(()));
        }
    }
    if s == "inputs" {
        while let Some(value) = vars.pop_input().map_err(|(_, e)| e)? {
            if emit(value)?.is_break() {
                return Ok(Break(()));
            }
        }
    } else {
        for value in eval_jq_atom(s, input, vars)? {
            if emit(value)?.is_break() {
                return Ok(Break(()));
            }
        }
    }
    Ok(Continue(()))
}

fn pipeline(stages: &[String], input: &JVal, vars: &JqScope<'_>, emit: &mut Emit<'_>) -> Flow {
    let Some((stage, tail)) = stages.split_first() else {
        return emit(input.clone());
    };
    if tail.is_empty() {
        return visit_jq(stage, input, vars, emit);
    }
    if stage.starts_with("def ") {
        return visit_jq(&stages.join(" | "), input, vars, emit);
    }
    if let Some((expr, pattern)) = split_jq_binary_right(stage, " as ") {
        let pattern = pattern.trim();
        if !pattern.contains('(')
            && ((pattern.starts_with('$') && !pattern.contains(' '))
                || pattern.starts_with(['[', '{']))
        {
            return visit_jq(&expr, input, vars, &mut |value| {
                let mut bound = vars.clone();
                bind_jq_alternatives(pattern, &value, &mut bound.bindings);
                pipeline(tail, input, &bound, emit)
            });
        }
    }
    visit_jq(stage, input, vars, &mut |value| {
        pipeline(tail, &value, vars, emit)
    })
}
