//! Pull input only until the downstream filter stops requesting results.
use super::jq_index::{index_value, indices, path_slice};
use super::{
    JVal, JqScope, bind_jq_alternatives, eval_jq_atom, is_matching_outer_delim,
    parse_single_json_strict, split_jq_binary, split_jq_binary_right, split_jq_def_semi,
    split_jq_top,
};
use std::ops::ControlFlow::{self, Break, Continue};

#[derive(Debug)]
pub(super) enum JqFault {
    Error(JVal),
    Limit(&'static str),
    Halt(i32, String),
}
impl From<String> for JqFault {
    fn from(s: String) -> Self {
        Self::Error(JVal::Str(s))
    }
}
impl From<&str> for JqFault {
    fn from(s: &str) -> Self {
        Self::Error(JVal::Str(s.into()))
    }
}

type Flow = Result<ControlFlow<()>, JqFault>;
type Emit<'a> = dyn FnMut(JVal) -> Flow + 'a;

pub(super) fn eval_jq(expr: &str, input: &JVal, vars: &JqScope<'_>) -> Result<Vec<JVal>, JqFault> {
    let mut out = Vec::new();
    let _ = visit_jq(expr, input, vars, &mut |value| {
        out.push(value);
        Ok(Continue(()))
    })?;
    Ok(out)
}

pub(super) fn visit_jq(expr: &str, input: &JVal, vars: &JqScope<'_>, emit: &mut Emit<'_>) -> Flow {
    let s = expr.trim();
    if s == "." || s.is_empty() {
        return emit(input.clone());
    }
    if super::jq_parser::starts_number(s) && let Some(value) = super::jq_number::literal(s) {
        return emit(value);
    }
    visit_filter(s, input, vars, emit)
}

fn visit_filter(s: &str, input: &JVal, vars: &JqScope<'_>, emit: &mut Emit<'_>) -> Flow {
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

    if let Some(rest) = s
        .strip_prefix("label")
        .and_then(|s| s.trim_start().strip_prefix('$'))
        && let Some((name, body)) = rest.split_once('|')
    {
        let target = vars.next_label.get();
        vars.next_label.set(target + 1);
        let mut bound = vars.clone();
        bound.labels.insert(name.trim().into(), target);
        return protected(body, input, &bound, emit, |e, _| {
            if e == JVal::Object(vec![("__jq".into(), JVal::Number(target as f64, None))]) {
                Ok(Continue(()))
            } else {
                Err(JqFault::Error(e))
            }
        });
    }
    if s.contains('|')
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
            return Err(JqFault::Limit("maxAstDepth"));
        }
        return pipeline(&pipes, input, vars, emit);
    }
    if let Some(rest) = s.strip_prefix("try ") {
        let pair = split_jq_binary(rest, " catch ");
        let body = pair.as_ref().map_or(rest, |(body, _)| body);
        return protected(body, input, vars, emit, |e, emit| {
            if let Some((_, handler)) = &pair {
                visit_jq(handler, &e, vars, emit)
            } else {
                Ok(Continue(()))
            }
        });
    }
    if s.contains(',')
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
    if s.starts_with('{') && s.ends_with('}') && is_matching_outer_delim(s, '{', '}') {
        let body = s[1..s.len() - 1].trim();
        if body.is_empty() {
            return emit(JVal::Object(Vec::new()));
        }
        let fields = split_jq_top(body, ',').unwrap_or_else(|| vec![body.to_owned()]);
        let fields: Vec<_> = fields
            .into_iter()
            .map(|f| split_jq_binary(&f, ":").map_or_else(|| (f, None), |(k, v)| (k, Some(v))))
            .collect();
        let mut remaining = crate::ShellLimits::default().max_loop_iterations;
        return object(&fields, Vec::new(), input, vars, 0, &mut remaining, emit);
    }
    if s.starts_with("if") && super::is_jq_if_expr(s) {
        let (clauses, fallback) = super::jq_if_clauses(s);
        if clauses.len() > 128 {
            return Err(JqFault::Limit("maxAstDepth"));
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
    if let Some(binary) = super::jq_parser::binary(s) {
        use super::jq_parser::Binary;
        let (left, op, right) = match binary {
            Binary::Pair(left, op, right) => (left, op, right),
            Binary::LiteralChain { left, suffix } => {
                let mut remaining = crate::ShellLimits::default().max_loop_iterations;
                return visit_jq(left, input, vars, &mut |v| {
                    remaining = remaining.checked_sub(1).ok_or(JqFault::Limit("maxSteps"))?;
                    emit(super::jq_parser::apply_literal_chain(v, suffix)?)
                });
            }
        };
        if op == "//" {
            let mut found = false;
            let flow = visit_jq(left, input, vars, &mut |v| {
                if v.is_truthy() {
                    found = true;
                    emit(v)
                } else {
                    Ok(Continue(()))
                }
            })?;
            return if found {
                Ok(flow)
            } else {
                visit_jq(right, input, vars, emit)
            };
        }
        if matches!(op, "and" | "or") {
            return visit_jq(left, input, vars, &mut |v| {
                if v.is_truthy() == (op == "or") {
                    emit(JVal::Bool(v.is_truthy()))
                } else {
                    visit_jq(right, input, vars, &mut |r| emit(JVal::Bool(r.is_truthy())))
                }
            });
        }
        if op == "|=" {
            let mut updated = input.clone();
            let mut deletions = Vec::new();
            for path in super::resolve_jq_lhs_paths(left, input, vars)? {
                let old = super::get_jq_jval_path(&updated, &path);
                let mut first = None;
                let _ = visit_jq(right, &old, vars, &mut |v| {
                    first = Some(v);
                    Ok(Break(()))
                })?;
                if let Some(new) = first {
                    super::set_jq_jval_path(&mut updated, &path, new)?;
                } else {
                    deletions.push(path);
                }
            }
            super::delete_jq_paths_sorted(&mut updated, deletions);
            return emit(updated);
        }
        if matches!(op, "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "//=") {
            return visit_jq(right, input, vars, &mut |rhs| {
                let mut updated = input.clone();
                for path in super::resolve_jq_lhs_paths(left, input, vars)? {
                    let value = if op == "=" {
                        rhs.clone()
                    } else {
                        let old = super::get_jq_jval_path(&updated, &path);
                        if op == "//=" {
                            if old.is_truthy() {
                                continue;
                            }
                            rhs.clone()
                        } else {
                            super::apply_jq_arith(&old, &rhs, &op[..1])?
                        }
                    };
                    super::set_jq_jval_path(&mut updated, &path, value)?;
                }
                emit(updated)
            });
        }
        let mut remaining = crate::ShellLimits::default().max_loop_iterations;
        return visit_jq(right, input, vars, &mut |r| {
            visit_jq(left, input, vars, &mut |l| {
                remaining = remaining.checked_sub(1).ok_or(JqFault::Limit("maxSteps"))?;
                let value = match op {
                    "==" | "!=" => {
                        let equal = match (&l, &r) {
                            (JVal::Str(a), JVal::Str(b))
                                if vars.yq.is_some() && b.contains(['*', '?']) =>
                            {
                                super::yq_glob_match(a, b)
                            }
                            _ => super::jval_eq(&l, &r),
                        };
                        JVal::Bool(equal == (op == "=="))
                    }
                    "<" | "<=" | ">" | ">=" => {
                        let order = super::compare_jval(&l, &r);
                        JVal::Bool(match op {
                            "<" => order.is_lt(),
                            "<=" => order.is_le(),
                            ">" => order.is_gt(),
                            _ => order.is_ge(),
                        })
                    }
                    _ => super::apply_jq_arith(&l, &r, op)?,
                };
                emit(value)
            })
        });
    }
    if let Some(inner) = s.strip_prefix('-') {
        return visit_jq(inner, input, vars, &mut |v| match v {
            JVal::Number(n, _) => emit(JVal::Number(-n, None)),
            _ => Err("negation requires a number".into()),
        });
    }
    let operand = s.strip_suffix('?').unwrap_or(s).trim_end();
    use super::jq_parser::Subscript;
    if operand != s {
        return protected(operand, input, vars, emit, |_, _| Ok(Continue(())));
    }
    if let Some((base, op)) = super::jq_parser::subscript(s)? {
        let bases = |each: &mut dyn FnMut(&JVal) -> Flow| {
            if base == "." {
                each(input)
            } else {
                visit_jq(base, input, vars, &mut |v| each(&v))
            }
        };
        return match op {
            Subscript::Field(key) => {
                let key = JVal::Str(key.into());
                bases(&mut |v| emit(index_value(v, &key)?.clone()))
            }
            Subscript::Iterate => bases(&mut |v| iterate(v, emit)),
            Subscript::Index(filter) => visit_jq(filter, input, vars, &mut |key| {
                bases(&mut |v| {
                    if (matches!(key, JVal::Object(_))
                        && matches!(v, JVal::Null | JVal::Str(_) | JVal::Array(_)))
                        || (matches!(key, JVal::Array(_)) && matches!(v, JVal::Array(_)))
                    {
                        emit(indices(v, &key)?)
                    } else {
                        emit(index_value(v, &key)?.clone())
                    }
                })
            }),
            Subscript::Slice(start, end) => {
                let start = if start.is_empty() { "null" } else { start };
                let end = if end.is_empty() { "null" } else { end };
                visit_jq(start, input, vars, &mut |lo| {
                    visit_jq(end, input, vars, &mut |hi| {
                        bases(&mut |v| emit(super::jq_index::slice_value(v, &lo, &hi)?))
                    })
                })
            }
        };
    }
    if (s.starts_with("reduce") || s.starts_with("foreach"))
        && let Some((source, variable, body)) = super::jq_parser::fold(s)
        && let Some(stages) = split_jq_top(body, ';')
        && stages.len() >= 2
    {
        let reduce = s.starts_with("reduce");
        let mut source_input = input;
        let mut remaining = crate::ShellLimits::default().max_loop_iterations;
        return visit_jq(&stages[0], input, vars, &mut |initial| {
            let mut acc = initial;
            let flow = visit_jq(source, source_input, vars, &mut |item| {
                remaining = remaining.checked_sub(1).ok_or(JqFault::Limit("maxSteps"))?;
                let mut bound = vars.clone();
                bound.bindings.insert(variable.to_owned(), item);
                let previous = std::mem::replace(&mut acc, JVal::Null);
                visit_jq(&stages[1], &previous, &bound, &mut |value| {
                    acc = value;
                    if reduce {
                        Ok(Continue(()))
                    } else if let Some(extract) = stages.get(2) {
                        visit_jq(extract, &acc, &bound, emit)
                    } else {
                        emit(acc.clone())
                    }
                })
            })?;
            if !reduce || flow.is_break() {
                return Ok(flow);
            }
            source_input = &JVal::Null;
            emit(acc)
        });
    }
    if !vars.functions.is_empty()
        || s.ends_with(')')
        || matches!(s, "error" | "halt" | "halt_error")
    {
        let (name, args) = s
            .find('(')
            .filter(|&pos| s.ends_with(')') && is_matching_outer_delim(&s[pos..], '(', ')'))
            .map_or((s, None), |pos| {
                (s[..pos].trim(), Some(&s[pos + 1..s.len() - 1]))
            });
        if let Some(flow) = invoke(name, args, input, vars, &mut |body, bound| {
            visit_jq(body, input, bound, emit)
        }) {
            return flow;
        }
        if let Some(filter) = args
            && matches!(name, "indices" | "index" | "rindex")
        {
            return visit_jq(filter, input, vars, &mut |needle| {
                let found = indices(input, &needle)?;
                if name == "indices" {
                    emit(found)
                } else {
                    let offset = if name == "index" { 0.0 } else { -1.0 };
                    emit(index_value(&found, &JVal::Number(offset, None))?.clone())
                }
            });
        }
        match (name, args.filter(|arg| !arg.trim().is_empty())) {
            ("error", None) => return Err(JqFault::Error(input.clone())),
            ("error", Some(filter)) => {
                return visit_jq(filter, input, vars, &mut |v| Err(JqFault::Error(v)));
            }
            ("halt", None) => return Err(JqFault::Halt(0, String::new())),
            ("halt_error", None) => return halt_error(input, JVal::Number(5.0, None)),
            ("halt_error", Some(filter)) => {
                return visit_jq(filter, input, vars, &mut |code| halt_error(input, code));
            }
            _ => {}
        }
        if let ("getpath", Some(filter)) = (name, args) {
            return visit_jq(filter, input, vars, &mut |candidate| {
                let JVal::Array(path) = candidate else {
                    return Err("Path must be specified as an array".into());
                };
                let mut value = input;
                let mut slice;
                for key in &path {
                    if let JVal::Object(bounds) = key {
                        if matches!(value, JVal::Null) {
                            continue;
                        }
                        if matches!(value, JVal::Str(_) | JVal::Array(_)) {
                            slice = path_slice(value, bounds, false)?;
                            value = &slice;
                            continue;
                        }
                    }
                    value = index_value(value, key)?;
                }
                emit(value.clone())
            });
        }
        if let ("setpath", Some(args)) = (name, args)
            && let Some((path, replacement)) = split_jq_binary(args, ";")
        {
            return visit_jq(&replacement, input, vars, &mut |new| {
                visit_jq(&path, input, vars, &mut |candidate| {
                    let JVal::Array(path) = candidate else {
                        return Err("Path must be specified as an array".into());
                    };
                    let mut base = input;
                    for key in &path {
                        let old = index_value(base, key)?;
                        if let JVal::Number(n, _) = key {
                            let len = if let JVal::Array(items) = base {
                                items.len()
                            } else {
                                0
                            };
                            if n.trunc() < -(len as f64) {
                                return Err("Out of bounds negative array index".into());
                            }
                        }
                        base = old;
                    }
                    let mut result = input.clone();
                    super::set_jq_jval_path(&mut result, &path, new.clone())?;
                    emit(result)
                })
            });
        }
        if let ("select", Some(predicate)) = (name, args) {
            return visit_jq(predicate, input, vars, &mut |v| {
                if v.is_truthy() {
                    emit(input.clone())
                } else {
                    Ok(Continue(()))
                }
            });
        }
        if let Some(args) = args
            && matches!(
                name,
                "range" | "limit" | "first" | "last" | "isempty" | "nth"
            )
        {
            let parts = split_jq_top(args, ';').unwrap_or_else(|| vec![args.to_owned()]);
            if let [filter] = parts.as_slice()
                && matches!(name, "first" | "last" | "isempty")
            {
                let mut selected = None;
                let _ = visit_jq(filter, input, vars, &mut |value| {
                    selected = Some(value);
                    Ok(if name == "last" {
                        Continue(())
                    } else {
                        Break(())
                    })
                })?;
                return match name {
                    "isempty" => emit(JVal::Bool(selected.is_none())),
                    "last" => emit(selected.unwrap_or(JVal::Null)),
                    _ => selected.map_or(Ok(Continue(())), emit),
                };
            }
            if name == "nth" && (1..=2).contains(&parts.len()) {
                return visit_jq(&parts[0], input, vars, &mut |index| {
                    if let Some(filter) = parts.get(1) {
                        let JVal::Number(n, _) = index else {
                            return Err("nth doesn't support negative indices".into());
                        };
                        if n < 0.0 {
                            return Err("nth doesn't support negative indices".into());
                        }
                        let mut n = n.ceil();
                        let mut selected = None;
                        let _ = visit_jq(filter, input, vars, &mut |v| {
                            if n == 0.0 {
                                selected = Some(v);
                                Ok(Break(()))
                            } else {
                                n -= 1.0;
                                Ok(Continue(()))
                            }
                        })?;
                        selected.map_or(Ok(Continue(())), &mut *emit)
                    } else {
                        emit(index_value(input, &index)?.clone())
                    }
                });
            }
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
                            let (
                                JVal::Number(start, _),
                                JVal::Number(stop, _),
                                JVal::Number(step, _),
                            ) = (&a, &b, increment)
                            else {
                                return Err("range requires numbers".into());
                            };
                            let mut value = *start;
                            while (step > 0.0 && value < *stop) || (step < 0.0 && value > *stop) {
                                remaining =
                                    remaining.checked_sub(1).ok_or(JqFault::Limit("maxSteps"))?;
                                if emit(if value == *start {
                                    a.clone()
                                } else {
                                    JVal::Number(value, None)
                                })?
                                .is_break()
                                {
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
                    let JVal::Number(n, _) = n else {
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
    if let Some(name) = s
        .strip_prefix("break")
        .and_then(|s| s.trim_start().strip_prefix('$'))
        && let Some(id) = vars.labels.get(name.trim())
    {
        return Err(JqFault::Error(JVal::Object(vec![(
            "__jq".into(),
            JVal::Number(*id as f64, None),
        )])));
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

fn iterate(value: &JVal, emit: &mut Emit<'_>) -> Flow {
    match value {
        JVal::Array(items) => {
            for item in items {
                if emit(item.clone())?.is_break() {
                    return Ok(Break(()));
                }
            }
        }
        JVal::Object(fields) => {
            for (_, item) in fields {
                if emit(item.clone())?.is_break() {
                    return Ok(Break(()));
                }
            }
        }
        scalar => return Err(format!("Cannot iterate over {}", describe(scalar)).into()),
    }
    Ok(Continue(()))
}

fn describe(scalar: &JVal) -> String {
    let prefix;
    let printable = if let JVal::Str(s) = scalar {
        prefix = JVal::Str(s.chars().take(15).collect());
        &prefix
    } else {
        scalar
    };
    let mut text = String::new();
    super::JsonFormat {
        indent: "",
        strings: super::JsonStrings::Jq,
        color: false,
        sort_keys: false,
    }
    .write(printable, 0, &mut text);
    if text.len() >= 15 {
        text = format!("{}...", String::from_utf8_lossy(&text.as_bytes()[..11]));
    }
    format!("{} ({text})", scalar.type_name())
}

fn halt_error(input: &JVal, code: JVal) -> Flow {
    let JVal::Number(n, _) = code else {
        return Err(format!("{} halt_error/1: number required", describe(input)).into());
    };
    let message = match input {
        JVal::Null => String::new(),
        JVal::Str(s) => s.clone(),
        v => {
            let mut out = String::new();
            super::JsonFormat {
                indent: "",
                strings: super::JsonStrings::Jq,
                color: false,
                sort_keys: false,
            }
            .write(v, 0, &mut out);
            out.push('\n');
            out
        }
    };
    Err(JqFault::Halt((n.trunc().max(0.0) % 256.0) as i32, message))
}

pub(super) fn invoke<'a>(
    name: &str,
    args: Option<&str>,
    input: &JVal,
    caller: &JqScope<'a>,
    run: &mut dyn FnMut(&str, &JqScope<'a>) -> Flow,
) -> Option<Flow> {
    let overloads = caller.functions.get(name)?;
    let args = args
        .filter(|s| !s.trim().is_empty())
        .map_or_else(Vec::new, |s| {
            split_jq_top(s, ';').unwrap_or_else(|| vec![s.to_owned()])
        });
    let filter = overloads.get(&args.len())?;
    let marker = 0u8;
    let frame = (&raw const marker).addr();
    // Debug and optimized builds use different amounts of stack per filter.
    // Bound the live interpreter frames as well as the logical call depth.
    if caller.call_depth >= 256 || frame.abs_diff(caller.stack_origin) > 960 * 1024 {
        return Some(Err(JqFault::Limit("maxDepth")));
    }
    #[cfg(target_arch = "wasm32")]
    {
        // The generator's Rust frames share linear memory with the module.
        // Leave room for the next filter's parser, callbacks and diagnostics.
        unsafe extern "C" { static __stack_low: u8; }
        if frame.saturating_sub((&raw const __stack_low).addr()) < 64 * 1024 {
            return Some(Err(JqFault::Limit("maxDepth")));
        }
    }
    let mut bound = filter.scope.clone();
    bound.call_depth = caller.call_depth + 1;
    if let Some(original) = &filter.recursive_name {
        bound
            .functions
            .entry(original.clone())
            .or_default()
            .insert(args.len(), filter.clone());
    }
    let mut values = Vec::new();
    for (param, arg) in filter.params.iter().zip(args) {
        if let Some(variable) = param.strip_prefix('$') {
            values.push((variable, arg));
        } else {
            bound.define(param, Vec::new(), &arg, caller.clone(), false);
        }
    }
    if values.len() > 128 {
        return Some(Err(JqFault::Limit("maxAstDepth")));
    }
    fn bind<'a>(
        values: &[(&str, String)],
        input: &JVal,
        caller: &JqScope<'a>,
        bound: &mut JqScope<'a>,
        run: &mut dyn FnMut(&JqScope<'a>) -> Flow,
    ) -> Flow {
        let Some(((variable, arg), rest)) = values.split_first() else {
            return run(bound);
        };
        visit_jq(arg, input, caller, &mut |v| {
            bound.bindings.insert((*variable).into(), v);
            bind(rest, input, caller, bound, run)
        })
    }
    Some(bind(&values, input, caller, &mut bound, &mut |scope| {
        run(&filter.body, scope)
    }))
}

// Catch failures in this filter. A failure raised by its consumer belongs outside the handler.
fn protected(
    body: &str,
    input: &JVal,
    vars: &JqScope<'_>,
    emit: &mut Emit<'_>,
    handle: impl FnOnce(JVal, &mut Emit<'_>) -> Flow,
) -> Flow {
    let mut downstream = None;
    let result = visit_jq(body, input, vars, &mut |v| match emit(v) {
        Err(e) => {
            downstream = Some(e);
            Ok(Break(()))
        }
        other => other,
    });
    if let Some(e) = downstream {
        return Err(e);
    }
    match result {
        Err(JqFault::Error(e)) if vars.inputs.borrow().file_error.is_none() => handle(e, emit),
        other => other,
    }
}

fn object(
    mut fields: &[(String, Option<String>)],
    mut entries: Vec<(String, JVal)>,
    input: &JVal,
    vars: &JqScope<'_>,
    depth: usize,
    remaining: &mut usize,
    emit: &mut Emit<'_>,
) -> Flow {
    fn put(entries: &mut Vec<(String, JVal)>, key: String, value: JVal) {
        if let Some((_, old)) = entries.iter_mut().find(|(k, _)| k == &key) {
            *old = value;
        } else {
            entries.push((key, value));
        }
    }
    while let Some(((raw, expr), tail)) = fields.split_first() {
        let key = raw.trim();
        let shorthand = key.starts_with('$') && expr.is_none();
        let literal = if shorthand {
            key.strip_prefix('$').map(str::to_owned)
        } else if key.starts_with('"') {
            match parse_single_json_strict(key) {
                Ok(JVal::Str(s)) => Some(s),
                _ => None,
            }
        } else if key.starts_with(['(', '$']) {
            None
        } else {
            Some(key.trim_start_matches('.').into())
        };
        let filter = expr.as_deref().map(str::trim).or(shorthand.then_some(key));
        // Common single-valued fields need no suspended generator or object copy.
        if let Some(ref name) = literal {
            let value = match filter {
                None => Some(index_value(input, &JVal::Str(name.clone()))?.clone()),
                Some(".") => Some(input.clone()),
                Some(f)
                    if f.starts_with(['.', '$'])
                        && f[1..]
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'_') =>
                {
                    eval_jq(f, input, vars)?.pop()
                }
                Some(f)
                    if (f.starts_with('"')
                        || f.as_bytes().first().is_some_and(u8::is_ascii_digit))
                        || matches!(f, "true" | "false" | "null") =>
                {
                    parse_single_json_strict(f).ok()
                }
                _ => None,
            };
            if let Some(value) = value {
                put(&mut entries, name.clone(), value);
                fields = tail;
                continue;
            }
        }
        if depth >= 128 {
            return Err(JqFault::Limit("maxAstDepth"));
        }
        let mut field = |key| {
            let JVal::Str(name) = key else {
                return Err("object keys must be strings".into());
            };
            let mut extend = |value| {
                *remaining = remaining.checked_sub(1).ok_or(JqFault::Limit("maxSteps"))?;
                let mut next = entries.clone();
                put(&mut next, name.clone(), value);
                object(tail, next, input, vars, depth + 1, remaining, emit)
            };
            if let Some(f) = filter {
                visit_jq(f, input, vars, &mut extend)
            } else {
                extend(index_value(input, &JVal::Str(name.clone()))?.clone())
            }
        };
        return if let Some(name) = literal {
            field(JVal::Str(name))
        } else {
            visit_jq(key, input, vars, &mut field)
        };
    }
    emit(JVal::Object(entries))
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
        *remaining = remaining.checked_sub(1).ok_or(JqFault::Limit("maxSteps"))?;
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
