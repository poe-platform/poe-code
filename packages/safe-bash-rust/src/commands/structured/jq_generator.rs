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
    if s.starts_with("if") && super::is_jq_if_expr(s) {
        let (clauses, fallback) = super::jq_if_clauses(s);
        if clauses.len() > 128 {
            return Err("maxAstDepth limit exceeded".into());
        }
        let mut remaining = crate::ShellLimits::default().max_loop_iterations;
        return conditional(
            &clauses,
            fallback.as_deref().unwrap_or("."),
            input,
            vars,
            &mut remaining,
            emit,
        );
    }
    if !vars.functions.is_empty() || s.starts_with("range") || s.starts_with("limit") {
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
        if let Some(args) = args
            && matches!(name, "range" | "limit")
        {
            let parts = split_jq_top(args, ';').unwrap_or_else(|| vec![args.to_owned()]);
            if name == "range" && (1..=3).contains(&parts.len()) {
                let (start, end) = if parts.len() == 1 {
                    ("0", &parts[0])
                } else {
                    (parts[0].as_str(), &parts[1])
                };
                let step = parts.get(2).map_or("1", String::as_str);
                let mut remaining = crate::ShellLimits::default().max_loop_iterations;
                return visit_jq(start, input, vars, &mut |a| {
                    visit_jq(end, input, vars, &mut |b| {
                        visit_jq(step, input, vars, &mut |increment| {
                            let (JVal::Number(start), JVal::Number(stop), JVal::Number(step)) =
                                (&a, &b, increment)
                            else {
                                return Err("range requires numbers".into());
                            };
                            let mut value = *start;
                            while (step > 0.0 && value < *stop) || (step < 0.0 && value > *stop) {
                                remaining =
                                    remaining.checked_sub(1).ok_or("maxSteps limit exceeded")?;
                                if emit(JVal::Number(value))?.is_break() {
                                    return Ok(Break(()));
                                }
                                let next = value + step;
                                if !next.is_finite() {
                                    return Err("nonfinite range increment".into());
                                }
                                if next == value {
                                    return Err("range increment makes no progress".into());
                                }
                                value = next;
                            }
                            Ok(Continue(()))
                        })
                    })
                });
            }
            if name == "limit"
                && let [count, filter] = parts.as_slice()
            {
                return visit_jq(count, input, vars, &mut |n| {
                    let JVal::Number(n) = n else {
                        return Err("limit requires a nonnegative integer".into());
                    };
                    if !(0.0..=9_007_199_254_740_991.0).contains(&n) || n.fract() != 0.0 {
                        return Err("limit requires a nonnegative integer".into());
                    }
                    if n == 0.0 {
                        return Ok(Continue(()));
                    }
                    let mut remaining = n as u64;
                    let mut downstream = Continue(());
                    let _ = visit_jq(filter, input, vars, &mut |value| {
                        downstream = emit(value)?;
                        remaining -= 1;
                        Ok(if remaining == 0 {
                            Break(())
                        } else {
                            downstream
                        })
                    })?;
                    Ok(downstream)
                });
            }
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

fn conditional(
    clauses: &[(String, String)],
    fallback: &str,
    input: &JVal,
    vars: &JqScope<'_>,
    remaining: &mut usize,
    emit: &mut Emit<'_>,
) -> Flow {
    let Some(((condition, yes), tail)) = clauses.split_first() else {
        return visit_jq(fallback, input, vars, emit);
    };
    visit_jq(condition, input, vars, &mut |value| {
        *remaining = remaining.checked_sub(1).ok_or("maxSteps limit exceeded")?;
        if value.is_truthy() {
            visit_jq(yes, input, vars, emit)
        } else {
            conditional(tail, fallback, input, vars, remaining, emit)
        }
    })
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
