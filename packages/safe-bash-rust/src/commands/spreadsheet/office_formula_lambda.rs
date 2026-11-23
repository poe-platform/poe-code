// LAMBDA call/reference semantics adapted from IronCalc logical/lambda.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
// Bodies are shared ASTs; captured locals retain sparse references and formats.
use super::super::{case_fold::same_name, editor_tables::valid_table_name};
use super::let_bindings::{identifier, unprefixed};
use super::{Calculation, Coord, Expr, Format, Parser, Value};
use std::sync::Arc;

pub(super) struct Closure<'a> {
    pub(super) parameters: Vec<bool>,
    body: Arc<Expr>,
    locals: Vec<Arc<(Value, Option<Format<'a>>)>>,
    origin: Option<Coord>,
}
impl<'a, S: Iterator<Item = &'a str> + Clone> Parser<'a, S> {
    pub(super) fn lambda_expression(&mut self, depth: usize) -> Option<Expr> {
        let frame = self.locals.len();
        let result = (|| {
            let mut parameters = Vec::new();
            let separator = if self.odf { ";" } else { "," };
            if self.take(")") {
                self.error.get_or_insert("#ERROR!");
                return Some(Expr::Value(Value::Error("#ERROR!")));
            }
            loop {
                self.space();
                let bracket = self.source.starts_with('[');
                let raw = identifier(if bracket {
                    &self.source[1..]
                } else {
                    self.source
                });
                let length = raw.len() + usize::from(bracket) * 2;
                let declaration = !raw.is_empty()
                    && (!bracket
                        || self
                            .source
                            .get(raw.len() + 1..)
                            .is_some_and(|s| s.starts_with(']')))
                    && self
                        .source
                        .get(length..)
                        .is_some_and(|tail| tail.trim_ascii_start().starts_with(separator));
                if !declaration {
                    break;
                }
                let optional = bracket
                    || raw
                        .get(..6)
                        .is_some_and(|s| s.eq_ignore_ascii_case("_xlop."));
                let name = unprefixed(raw);
                let valid = (name.eq_ignore_ascii_case("r")
                    || name.eq_ignore_ascii_case("c")
                    || valid_table_name(name))
                    && !name.contains('.')
                    && !name.eq_ignore_ascii_case("TRUE")
                    && !name.eq_ignore_ascii_case("FALSE")
                    && !self.locals[frame..]
                        .iter()
                        .any(|other| same_name(other, name));
                self.nodes = self
                    .nodes
                    .checked_sub(length.div_ceil(std::mem::size_of::<Expr>()) * 2 + 1)
                    .or_else(|| {
                        self.limited = true;
                        None
                    })?;
                if !valid {
                    self.error.get_or_insert("#VALUE!");
                }
                if parameters.len() >= 253 {
                    self.error.get_or_insert("#VALUE!");
                    return None;
                }
                if let Some(tokens) = &mut self.local_tokens {
                    tokens.push((self.source.len(), length));
                }
                self.locals.push(name.to_owned());
                parameters.push(optional);
                self.source = &self.source[length..];
                self.take(separator);
            }
            self.lambda_depth += 1;
            let body = self.expression(0, depth + 1, true);
            self.lambda_depth -= 1;
            let Some(body) = body else {
                self.error.get_or_insert("#ERROR!");
                return None;
            };
            if !self.take(")") {
                self.error.get_or_insert("#VALUE!");
                return None;
            }
            Some(Expr::Lambda(parameters, Arc::new(body)))
        })();
        self.locals.truncate(frame);
        result
    }
    pub(super) fn lambda_call_arguments(&mut self, depth: usize) -> Option<Vec<Expr>> {
        let mut args = Vec::new();
        let separator = if self.odf { ";" } else { "," };
        if self.take(")") {
            return Some(args);
        }
        loop {
            self.space();
            if args.len() >= 253 {
                self.error.get_or_insert("#VALUE!");
                return None;
            }
            let value = if self.source.starts_with(')') || self.source.starts_with(separator) {
                self.nodes = self.nodes.checked_sub(1).or_else(|| {
                    self.limited = true;
                    None
                })?;
                Expr::Value(Value::Omitted)
            } else {
                self.expression(0, depth + 1, true).or_else(|| {
                    self.error.get_or_insert("#ERROR!");
                    None
                })?
            };
            args.push(value);
            if self.take(")") {
                break;
            }
            if !self.take(separator) {
                self.error.get_or_insert("#VALUE!");
                return None;
            }
        }
        Some(args)
    }
}
impl<'a> Calculation<'a> {
    pub(super) fn lambda_value(&mut self, parameters: &[bool], body: &Arc<Expr>) -> Option<Value> {
        self.work = self
            .work
            .checked_sub(std::mem::size_of::<Closure>() + parameters.len() + 64)?;
        self.work = self.work.checked_sub(
            self.locals
                .len()
                .checked_mul(std::mem::size_of::<Arc<(Value, Option<Format>)>>())?,
        )?;
        self.lambdas.push(Arc::new(Closure {
            parameters: parameters.to_vec(),
            body: body.clone(),
            locals: self.locals.clone(),
            origin: self.name_origin,
        }));
        Some(Value::Lambda(self.lambdas.len() - 1))
    }
    pub(super) fn invoke(
        &mut self,
        callee: &Expr,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if depth > 96 {
            return Some(Value::Error("#NUM!"));
        }
        let value = self.eval(callee, pos, depth + 1, true)?;
        let Value::Lambda(index) = value else {
            return Some(match value {
                Value::Error(_) | Value::LiteralError(_) => value,
                _ => Value::Error("#VALUE!"),
            });
        };
        let closure = self.lambdas.get(index)?.clone();
        if args.len() > closure.parameters.len()
            || closure.parameters[args.len()..]
                .iter()
                .any(|optional| !*optional)
        {
            return Some(Value::Error("#VALUE!"));
        }
        self.work = self.work.checked_sub(
            args.len()
                .checked_mul(std::mem::size_of::<(Value, Option<Format>)>())?,
        )?;
        let mut values = Vec::with_capacity(args.len());
        for arg in args {
            let value = self.eval(arg, pos, depth + 1, true)?;
            values.push((value, self.result_format));
        }
        self.invoke_values(index, values, pos, depth + 1)
    }

    // Both ordinary calls and array helpers execute the same shared body.
    // Captured bindings are immutable Arc entries, so a mapping iteration does
    // not copy every surrounding array even when the body never reads it.
    pub(super) fn invoke_values(
        &mut self,
        index: usize,
        values: Vec<(Value, Option<Format<'a>>)>,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if depth > 96 {
            return Some(Value::Error("#NUM!"));
        }
        let closure = self.lambdas.get(index)?.clone();
        self.work = self.work.checked_sub(
            closure
                .locals
                .len()
                .checked_mul(std::mem::size_of::<Arc<(Value, Option<Format>)>>())?
                .checked_add(
                    closure
                        .parameters
                        .len()
                        .checked_mul(std::mem::size_of::<(Value, Option<Format>)>() + 32)?,
                )?,
        )?;
        let mut locals = Vec::with_capacity(closure.locals.len() + closure.parameters.len());
        locals.extend(closure.locals.iter().cloned());
        let count = values.len();
        for value in values {
            locals.push(Arc::new(value));
        }
        for _ in count..closure.parameters.len() {
            locals.push(Arc::new((Value::Omitted, None)));
        }
        let previous = std::mem::replace(&mut self.locals, locals);
        let origin = std::mem::replace(&mut self.name_origin, closure.origin);
        let result = self.eval(&closure.body, pos, depth + 1, true);
        self.name_origin = origin;
        self.locals = previous;
        result
    }
}
