//! Lua 5.3 compilation and dumping, following the existing Pandoc compiler.
//! Serialization follows Lua/Fengari; see LICENSE.LUA.
use crate::{
    Error, Result, Value, numbers,
    syntax::{Block, Expr, Node, Stmt},
};
use std::{collections::HashMap, sync::Arc};

#[derive(Debug)]
pub(crate) struct Prototype {
    parameters: usize,
    vararg: bool,
    registers: usize,
    code: Vec<(u32, usize)>,
    constants: Vec<Value>,
    captures: Vec<(bool, usize)>,
    children: Vec<Arc<Prototype>>,
}
#[derive(Clone, Copy)]
struct Binding {
    register: bool,
    index: usize,
    declaration: usize,
}
struct Declaration {
    binding: Binding,
    scope: usize,
}
struct Jump {
    name: Vec<u8>,
    pc: usize,
    active: usize,
    close: Option<usize>,
}
struct Scope {
    parent: Option<usize>,
    owner: usize,
    base: usize,
    close: Option<usize>,
    names: HashMap<Vec<u8>, usize>,
    labels: HashMap<Vec<u8>, (usize, usize)>,
    pending: Vec<Jump>,
}
struct State {
    prototype: Prototype,
    scope: usize,
    outer: Option<usize>,
    active: usize,
    captures: HashMap<usize, usize>,
}
#[derive(Default)]
struct Compiler {
    states: Vec<State>,
    scopes: Vec<Scope>,
    declarations: Vec<Declaration>,
}

pub(crate) fn compile(body: &mut Block) -> Result<()> {
    Compiler::default().function(body, &[], true, None)?;
    Ok(())
}
impl Compiler {
    fn reserve(&mut self, f: usize, end: usize) -> Result<()> {
        if end >= 255 {
            return Err(Error::unlocated(
                "function or expression needs too many registers",
            ));
        }
        self.states[f].prototype.registers = self.states[f].prototype.registers.max(end);
        Ok(())
    }
    fn emit(&mut self, f: usize, code: u32, line: usize) -> usize {
        let pc = self.states[f].prototype.code.len();
        self.states[f].prototype.code.push((code, line));
        pc
    }
    fn abc(
        &mut self,
        f: usize,
        op: u32,
        a: usize,
        b: usize,
        c: usize,
        line: usize,
    ) -> Result<usize> {
        if a > 255 || b > 511 || c > 511 {
            return Err(Error::unlocated("instruction operand out of range"));
        }
        Ok(self.emit(
            f,
            op | (a as u32) << 6 | (c as u32) << 14 | (b as u32) << 23,
            line,
        ))
    }
    fn bx(&mut self, f: usize, op: u32, a: usize, b: usize, line: usize) -> Result<usize> {
        if a > 255 || b > 262143 {
            return Err(Error::unlocated("instruction operand out of range"));
        }
        Ok(self.emit(f, op | (a as u32) << 6 | (b as u32) << 14, line))
    }
    fn pc(&self, f: usize) -> usize {
        self.states[f].prototype.code.len()
    }
    fn patch(&mut self, f: usize, pc: usize, target: usize, op: u32, a: usize) -> Result<()> {
        let offset = target as i64 - pc as i64 - 1;
        if !(-131071..=131071).contains(&offset) {
            return Err(Error::unlocated("control structure too long"));
        }
        self.states[f].prototype.code[pc].0 =
            op | (a as u32) << 6 | ((offset + 131071) as u32) << 14;
        Ok(())
    }
    fn constant(&mut self, f: usize, value: Value) -> usize {
        let constants = &mut self.states[f].prototype.constants;
        if let Some(i) = constants.iter().position(|v| {
            std::mem::discriminant(v) == std::mem::discriminant(&value) && v == &value
        }) {
            return i;
        }
        let index = constants.len();
        constants.push(value);
        index
    }
    fn load(&mut self, f: usize, target: usize, index: usize, line: usize) -> Result<()> {
        self.reserve(f, target + 1)?;
        if index > 67108863 {
            return Err(Error::unlocated("too many constants"));
        }
        if index <= 262143 {
            self.bx(f, 1, target, index, line)?;
        } else {
            self.bx(f, 2, target, 0, line)?;
            self.emit(f, 46 | (index as u32) << 6, line);
        }
        Ok(())
    }
    fn key(&mut self, f: usize, value: Value, temp: usize, line: usize) -> Result<usize> {
        let index = self.constant(f, value);
        if index <= 255 {
            Ok(256 + index)
        } else {
            self.load(f, temp, index, line)?;
            Ok(temp)
        }
    }
    fn scope(&mut self, owner: usize, parent: Option<usize>) -> usize {
        let index = self.scopes.len();
        self.scopes.push(Scope {
            parent,
            owner,
            base: self.states[owner].active,
            close: None,
            names: HashMap::new(),
            labels: HashMap::new(),
            pending: Vec::new(),
        });
        index
    }
    fn declare(&mut self, f: usize, name: &[u8]) -> Result<Binding> {
        let index = self.states[f].active;
        if index >= 200 {
            return Err(Error::unlocated("too many local variables (limit is 200)"));
        }
        self.states[f].active += 1;
        Ok(self.declaration(self.states[f].scope, name, index, true))
    }
    fn declaration(&mut self, scope: usize, name: &[u8], index: usize, register: bool) -> Binding {
        let declaration = self.declarations.len();
        let binding = Binding {
            index,
            register,
            declaration,
        };
        self.declarations.push(Declaration { binding, scope });
        self.scopes[scope].names.insert(name.to_vec(), declaration);
        binding
    }
    fn resolve(&mut self, scope: usize, name: &[u8]) -> Result<Option<Binding>> {
        let f = self.scopes[scope].owner;
        let mut current = Some(scope);
        while let Some(s) = current {
            if let Some(&d) = self.scopes[s].names.get(name) {
                return Ok(Some(self.declarations[d].binding));
            }
            current = self.scopes[s].parent;
        }
        let Some(outer) = self.states[f].outer else {
            return Ok(None);
        };
        let Some(binding) = self.resolve(outer, name)? else {
            return Ok(None);
        };
        if binding.register {
            let declared = self.declarations[binding.declaration].scope;
            let close = &mut self.scopes[declared].close;
            *close = Some(close.unwrap_or(binding.index).min(binding.index));
        }
        let index = if let Some(&i) = self.states[f].captures.get(&binding.declaration) {
            i
        } else {
            let i = self.states[f].prototype.captures.len();
            if i >= 255 {
                return Err(Error::unlocated("too many upvalues (limit is 255)"));
            }
            self.states[f]
                .prototype
                .captures
                .push((binding.register, binding.index));
            self.states[f].captures.insert(binding.declaration, i);
            i
        };
        Ok(Some(Binding {
            register: false,
            index,
            ..binding
        }))
    }
    fn env(&mut self, f: usize) -> Result<Binding> {
        self.resolve(self.states[f].scope, b"_ENV")?
            .ok_or_else(|| Error::unlocated("missing lexical environment"))
    }
    fn enter(&mut self, f: usize) {
        let scope = self.scope(f, Some(self.states[f].scope));
        self.states[f].scope = scope;
    }
    fn resolve_jump(&mut self, f: usize, jump: Jump, label: (usize, usize)) -> Result<()> {
        if jump.active < label.1 {
            return Err(Error::unlocated(
                "goto jumps into the scope of a local variable",
            ));
        }
        let close = if jump.active > label.1 {
            Some(jump.close.unwrap_or(label.1).min(label.1))
        } else {
            jump.close
        };
        self.patch(f, jump.pc, label.0, 30, close.map_or(0, |c| c + 1))
    }
    fn queue(&mut self, scope: usize, jump: Jump) -> Result<()> {
        if let Some(&label) = self.scopes[scope].labels.get(&jump.name) {
            self.resolve_jump(self.scopes[scope].owner, jump, label)
        } else {
            self.scopes[scope].pending.push(jump);
            Ok(())
        }
    }
    fn label(&mut self, f: usize, name: &[u8], active: usize) -> Result<()> {
        let scope = self.states[f].scope;
        let label = (self.pc(f), active);
        if self.scopes[scope]
            .labels
            .insert(name.to_vec(), label)
            .is_some()
        {
            return Err(Error::unlocated("label already defined in this block"));
        }
        let pending = std::mem::take(&mut self.scopes[scope].pending);
        for jump in pending {
            if jump.name == name {
                self.resolve_jump(f, jump, label)?;
            } else {
                self.scopes[scope].pending.push(jump);
            }
        }
        Ok(())
    }
    fn leave(&mut self, f: usize, line: usize, emit: bool) -> Result<Option<usize>> {
        let scope = self.states[f].scope;
        let parent = self.scopes[scope].parent;
        let base = self.scopes[scope].base;
        let close = self.scopes[scope].close;
        for mut jump in std::mem::take(&mut self.scopes[scope].pending) {
            let Some(parent) = parent else {
                return Err(Error::unlocated(
                    "no visible label for goto or break outside loop",
                ));
            };
            if jump.active > base {
                jump.close = Some(jump.close.unwrap_or(base).min(base));
                jump.active = base;
            }
            self.queue(parent, jump)?;
        }
        if let Some(parent) = parent {
            self.states[f].scope = parent;
            self.states[f].active = base;
        }
        if emit && let Some(close) = close {
            self.bx(f, 30, close + 1, 131071, line)?;
        }
        Ok(close)
    }
    fn function(
        &mut self,
        body: &mut Block,
        names: &[Vec<u8>],
        vararg: bool,
        outer: Option<usize>,
    ) -> Result<Arc<Prototype>> {
        let f = self.states.len();
        self.states.push(State {
            prototype: Prototype {
                parameters: names.len(),
                vararg,
                registers: 2,
                code: Vec::new(),
                constants: Vec::new(),
                captures: Vec::new(),
                children: Vec::new(),
            },
            scope: 0,
            outer,
            active: 0,
            captures: HashMap::new(),
        });
        let scope = self.scope(f, None);
        self.states[f].scope = scope;
        if outer.is_none() {
            self.states[f].prototype.captures.push((true, 0));
            self.declaration(scope, b"_ENV", 0, false);
        }
        for name in names {
            self.declare(f, name)?;
        }
        self.reserve(f, names.len())?;
        self.block(f, body, false, true)?;
        self.abc(f, 38, 0, 1, 0, body.line)?;
        self.leave(f, body.line, false)?;
        // Children finish before their parent resumes, so completed states can be removed.
        let state = self.states.pop().unwrap();
        debug_assert_eq!(f, self.states.len());
        Ok(Arc::new(state.prototype))
    }
    fn block(&mut self, f: usize, body: &mut Block, scoped: bool, trailing: bool) -> Result<()> {
        if scoped {
            self.enter(f);
        }
        let base = self.states[f].active;
        let last = if trailing {
            body.statements
                .iter()
                .rposition(|(_, s)| !matches!(s, Stmt::Label(_)))
                .map_or(0, |i| i + 1)
        } else {
            body.statements.len()
        };
        for (i, (line, stmt)) in body.statements.iter_mut().enumerate() {
            self.statement(f, stmt, *line, (i >= last).then_some(base))?;
        }
        if scoped {
            self.leave(f, body.line, true)?;
        }
        Ok(())
    }
    fn values(
        &mut self,
        f: usize,
        values: &mut [Expr],
        target: usize,
        wanted: i32,
        line: usize,
    ) -> Result<bool> {
        if values.is_empty() && wanted > 0 {
            self.reserve(f, target + wanted as usize)?;
            self.abc(f, 4, target, wanted as usize - 1, 0, line)?;
        }
        let count = values.len();
        let mut open = false;
        for (i, e) in values.iter_mut().enumerate() {
            open = i == count - 1 && wanted < 0 && multi(e);
            let n = if i == count - 1 {
                if wanted < 0 {
                    if open { -1 } else { 1 }
                } else {
                    (wanted - i as i32).max(0)
                }
            } else {
                1
            };
            self.expression(f, e, target + i, n)?;
        }
        Ok(open)
    }
    fn branch(&mut self, f: usize, e: &mut Expr) -> Result<usize> {
        let target = self.states[f].active;
        self.expression(f, e, target, 1)?;
        self.abc(f, 34, target, 0, 0, e.0)?;
        self.bx(f, 30, 0, 131071, e.0)
    }
    fn statement(
        &mut self,
        f: usize,
        stmt: &mut Stmt,
        line: usize,
        label_active: Option<usize>,
    ) -> Result<()> {
        let active = self.states[f].active;
        match stmt {
            Stmt::Local(names, values) => {
                self.values(f, values, active, names.len() as i32, line)?;
                for name in names {
                    self.declare(f, name)?;
                }
            }
            Stmt::LocalFunction(name, e) => {
                let binding = self.declare(f, name)?;
                self.expression(f, e, binding.index, 1)?;
            }
            Stmt::Assign(targets, values) => self.store(f, targets, values, line)?,
            Stmt::Call(e) => self.expression(f, e, active, 0)?,
            Stmt::Return(values) => {
                let count = values.len();
                let open = self.values(f, values, active, -1, line)?;
                if count == 1 && open && !matches!(values[0].1, Node::Vararg) {
                    let code = &mut self.states[f].prototype.code.last_mut().unwrap().0;
                    *code = (*code & !63) | 37;
                }
                self.abc(f, 38, active, if open { 0 } else { count + 1 }, 0, line)?;
            }
            Stmt::Do(body) => self.block(f, body, true, true)?,
            Stmt::If(clauses) => {
                let mut ends = Vec::new();
                let count = clauses.len();
                for (i, (condition, body)) in clauses.iter_mut().enumerate() {
                    let skip = condition.as_mut().map(|e| self.branch(f, e)).transpose()?;
                    self.block(f, body, true, true)?;
                    if i < count - 1 {
                        ends.push(self.bx(f, 30, 0, 131071, line)?);
                    }
                    if let Some(skip) = skip {
                        self.patch(f, skip, self.pc(f), 30, 0)?;
                    }
                }
                for end in ends {
                    self.patch(f, end, self.pc(f), 30, 0)?;
                }
            }
            Stmt::While(condition, body) => {
                self.enter(f);
                let start = self.pc(f);
                let skip = self.branch(f, condition)?;
                self.block(f, body, true, true)?;
                let back = self.bx(f, 30, 0, 131071, line)?;
                self.patch(f, back, start, 30, 0)?;
                self.patch(f, skip, self.pc(f), 30, 0)?;
                self.label(f, b"break", active)?;
                self.leave(f, line, true)?;
            }
            Stmt::Repeat(body, condition) => {
                self.enter(f);
                let start = self.pc(f);
                self.enter(f);
                self.block(f, body, false, false)?;
                let back = self.branch(f, condition)?;
                let close = self.leave(f, line, false)?;
                self.patch(f, back, start, 30, close.map_or(0, |c| c + 1))?;
                if let Some(close) = close {
                    self.bx(f, 30, close + 1, 131071, line)?;
                }
                self.label(f, b"break", active)?;
                self.leave(f, line, true)?;
            }
            Stmt::For(name, start, limit, step, body) => {
                self.enter(f);
                self.expression(f, start, active, 1)?;
                self.expression(f, limit, active + 1, 1)?;
                if let Some(step) = step {
                    self.expression(f, step, active + 2, 1)?;
                } else {
                    let index = self.constant(f, Value::Integer(1));
                    self.load(f, active + 2, index, line)?;
                }
                self.loop_body(f, std::slice::from_ref(name), body, active, line, true)?;
            }
            Stmt::ForIn(names, values, body) => {
                self.enter(f);
                self.values(f, values, active, 3, line)?;
                self.loop_body(f, names, body, active, line, false)?;
            }
            Stmt::Break | Stmt::Goto(_) | Stmt::Label(_) => {
                let name = match stmt {
                    Stmt::Break => b"break".as_slice(),
                    Stmt::Goto(name) | Stmt::Label(name) => name,
                    _ => unreachable!(),
                };
                let name = name.to_vec();
                if matches!(stmt, Stmt::Label(_)) {
                    self.label(f, &name, label_active.unwrap_or(active))?;
                } else {
                    let pc = self.bx(f, 30, 0, 131071, line)?;
                    self.queue(
                        self.states[f].scope,
                        Jump {
                            name,
                            pc,
                            active,
                            close: None,
                        },
                    )?;
                }
            }
        }
        Ok(())
    }
    fn loop_body(
        &mut self,
        f: usize,
        names: &[Vec<u8>],
        body: &mut Block,
        active: usize,
        line: usize,
        numeric: bool,
    ) -> Result<()> {
        for name in [b"(for control)".as_slice(), b"(for state)", b"(for step)"] {
            self.declare(f, name)?;
        }
        let prep = self.bx(
            f,
            if numeric { 40 } else { 30 },
            if numeric { active } else { 0 },
            131071,
            line,
        )?;
        let start = self.pc(f);
        self.enter(f);
        for name in names {
            self.declare(f, name)?;
        }
        self.reserve(f, active + 3 + names.len())?;
        self.block(f, body, false, true)?;
        self.leave(f, line, true)?;
        let call = self.pc(f);
        if !numeric {
            self.abc(f, 41, active, 0, names.len(), line)?;
        }
        let op = if numeric { 39 } else { 42 };
        let a = if numeric { active } else { active + 2 };
        let back = self.bx(f, op, a, 131071, line)?;
        self.patch(f, back, start, op, a)?;
        self.patch(
            f,
            prep,
            if numeric { back } else { call },
            if numeric { 40 } else { 30 },
            if numeric { active } else { 0 },
        )?;
        self.label(f, b"break", active)?;
        self.leave(f, line, true)?;
        Ok(())
    }
    fn store(
        &mut self,
        f: usize,
        targets: &mut [Expr],
        values: &mut [Expr],
        line: usize,
    ) -> Result<()> {
        // kind: local, upvalue, indexed register, indexed upvalue.
        let mut descriptors: Vec<(u32, usize, usize)> = Vec::new();
        let mut temp = self.states[f].active;
        for target in targets.iter_mut() {
            let mut variable = None;
            let descriptor = match &mut target.1 {
                Node::Name(name) => {
                    variable = self.resolve(self.states[f].scope, name)?;
                    if let Some(binding) = variable {
                        (u32::from(!binding.register), binding.index, 0)
                    } else {
                        let env = self.env(f)?;
                        let key = self.key(f, Value::String(name.clone()), temp, line)?;
                        if key == temp {
                            temp += 1;
                        }
                        (if env.register { 2 } else { 3 }, env.index, key)
                    }
                }
                Node::Index(base, key) => {
                    let binding = if let Node::Name(name) = &base.1 {
                        self.resolve(self.states[f].scope, name)?
                    } else {
                        None
                    };
                    let base = if let Some(binding) = binding {
                        binding.index
                    } else {
                        let b = temp;
                        temp += 1;
                        self.expression(f, base, b, 1)?;
                        b
                    };
                    let key = if let Some(k) = self.direct(f, key)? {
                        k
                    } else {
                        let k = temp;
                        temp += 1;
                        self.expression(f, key, k, 1)?;
                        k
                    };
                    (
                        if binding.is_some_and(|b| !b.register) {
                            3
                        } else {
                            2
                        },
                        base,
                        key,
                    )
                }
                _ => return Err(Error::unlocated("Invalid assignment target")),
            };
            if let Some(variable) = variable {
                for (kind, base, key) in &mut descriptors {
                    if *kind < 2 {
                        continue;
                    }
                    let base_conflict =
                        *base == variable.index && (*kind == 2) == variable.register;
                    let key_conflict = *kind == 2 && variable.register && *key == variable.index;
                    if base_conflict || key_conflict {
                        self.reserve(f, temp + 1)?;
                        self.abc(
                            f,
                            if variable.register { 0 } else { 5 },
                            temp,
                            variable.index,
                            0,
                            line,
                        )?;
                        if base_conflict {
                            *kind = 2;
                            *base = temp;
                        }
                        if key_conflict {
                            *key = temp;
                        }
                        temp += 1;
                    }
                }
            }
            descriptors.push(descriptor);
        }
        self.values(f, values, temp, targets.len() as i32, line)?;
        for (i, (kind, base, key)) in descriptors.into_iter().enumerate().rev() {
            match kind {
                0 => {
                    self.abc(f, 0, base, temp + i, 0, line)?;
                }
                1 => {
                    self.abc(f, 9, temp + i, base, 0, line)?;
                }
                _ => {
                    self.abc(f, if kind == 2 { 10 } else { 8 }, base, key, temp + i, line)?;
                }
            }
        }
        Ok(())
    }
    fn direct(&mut self, f: usize, e: &Expr) -> Result<Option<usize>> {
        if let Some(v) = fold(e) {
            let i = self.constant(f, v);
            return Ok((i <= 255).then_some(256 + i));
        }
        match &e.1 {
            Node::Literal(v) => {
                let i = self.constant(f, v.clone());
                Ok((i <= 255).then_some(256 + i))
            }
            Node::Name(name) => Ok(self
                .resolve(self.states[f].scope, name)?
                .filter(|b| b.register)
                .map(|b| b.index)),
            _ => Ok(None),
        }
    }
    fn expression(&mut self, f: usize, e: &mut Expr, target: usize, wanted: i32) -> Result<()> {
        let line = e.0;
        self.reserve(f, target + wanted.max(1) as usize)?;
        if let Some(value) = fold(e) {
            let i = self.constant(f, value);
            self.load(f, target, i, line)?;
        } else {
            match &mut e.1 {
                Node::Literal(value) => match value {
                    Value::Nil => {
                        self.abc(f, 4, target, 0, 0, line)?;
                    }
                    Value::Bool(b) => {
                        self.abc(f, 3, target, usize::from(*b), 0, line)?;
                    }
                    _ => {
                        let i = self.constant(f, value.clone());
                        self.load(f, target, i, line)?;
                    }
                },
                Node::Name(name) => {
                    if let Some(binding) = self.resolve(self.states[f].scope, name)? {
                        if !binding.register || binding.index != target {
                            self.abc(
                                f,
                                if binding.register { 0 } else { 5 },
                                target,
                                binding.index,
                                0,
                                line,
                            )?;
                        }
                    } else {
                        let env = self.env(f)?;
                        let key = self.key(f, Value::String(name.clone()), target + 1, line)?;
                        self.abc(
                            f,
                            if env.register { 7 } else { 6 },
                            target,
                            env.index,
                            key,
                            line,
                        )?;
                    }
                }
                Node::Vararg => {
                    if !self.states[f].prototype.vararg {
                        return Err(Error::unlocated(
                            "cannot use '...' outside a vararg function",
                        ));
                    }
                    self.abc(
                        f,
                        45,
                        target,
                        if wanted < 0 { 0 } else { wanted as usize + 1 },
                        0,
                        line,
                    )?;
                    return Ok(());
                }
                Node::Paren(value) => self.expression(f, value, target, 1)?,
                Node::Unary(op, value) => {
                    self.expression(f, value, target, 1)?;
                    self.abc(
                        f,
                        match op.as_str() {
                            "-" => 25,
                            "~" => 26,
                            "not" => 27,
                            _ => 28,
                        },
                        target,
                        target,
                        0,
                        line,
                    )?;
                }
                Node::Binary(op, left, right) => {
                    if op == "and" || op == "or" {
                        self.expression(f, left, target, 1)?;
                        self.abc(f, 34, target, 0, usize::from(op == "or"), line)?;
                        let jump = self.bx(f, 30, 0, 131071, line)?;
                        self.expression(f, right, target, 1)?;
                        self.patch(f, jump, self.pc(f), 30, 0)?;
                    } else {
                        let direct = if op == ".." {
                            None
                        } else {
                            self.direct(f, left)?
                        };
                        let mut left = if let Some(direct) = direct {
                            direct
                        } else {
                            self.expression(f, left, target, 1)?;
                            target
                        };
                        let temp = if left == target { target + 1 } else { target };
                        let direct = if op == ".." {
                            None
                        } else {
                            self.direct(f, right)?
                        };
                        let mut right = if let Some(direct) = direct {
                            direct
                        } else {
                            self.expression(f, right, temp, 1)?;
                            temp
                        };
                        if op == ".." {
                            self.abc(f, 29, target, left, right, line)?;
                        } else if let Some(code) = binary_opcode(op) {
                            self.abc(f, code, target, left, right, line)?;
                        } else {
                            if op == ">" || op == ">=" {
                                std::mem::swap(&mut left, &mut right);
                            }
                            let code = match op.as_str() {
                                "==" | "~=" => 31,
                                "<" | ">" => 32,
                                _ => 33,
                            };
                            self.abc(f, code, usize::from(op != "~="), left, right, line)?;
                            self.bx(f, 30, 0, 131072, line)?;
                            self.abc(f, 3, target, 0, 1, line)?;
                            self.abc(f, 3, target, 1, 0, line)?;
                        }
                    }
                }
                Node::Index(base, key) => {
                    let binding = if let Node::Name(name) = &base.1 {
                        self.resolve(self.states[f].scope, name)?
                    } else {
                        None
                    };
                    let base = if let Some(binding) = binding {
                        binding.index
                    } else {
                        self.expression(f, base, target, 1)?;
                        target
                    };
                    let open = binding.is_some_and(|b| !b.register);
                    let temp = if !open && base == target {
                        target + 1
                    } else {
                        target
                    };
                    let key = if let Some(direct) = self.direct(f, key)? {
                        direct
                    } else {
                        self.expression(f, key, temp, 1)?;
                        temp
                    };
                    self.abc(f, if open { 6 } else { 7 }, target, base, key, line)?;
                }
                Node::Call(callee, args) => {
                    self.call(f, callee, None, args, target, wanted, line)?;
                    return Ok(());
                }
                Node::Method(callee, method, args) => {
                    self.call(f, callee, Some(method), args, target, wanted, line)?;
                    return Ok(());
                }
                Node::Table(fields) => {
                    self.abc(f, 11, target, 0, 0, line)?;
                    let mut pending = 0;
                    let mut block = 1;
                    let count = fields.len();
                    for (i, (key, value)) in fields.iter_mut().enumerate() {
                        if let Some(key) = key {
                            let key = if let Some(direct) = self.direct(f, key)? {
                                direct
                            } else {
                                self.expression(f, key, target + pending + 1, 1)?;
                                target + pending + 1
                            };
                            self.expression(f, value, target + pending + 2, 1)?;
                            self.abc(f, 10, target, key, target + pending + 2, line)?;
                        } else {
                            let open = i == count - 1 && multi(value);
                            self.expression(
                                f,
                                value,
                                target + pending + 1,
                                if open { -1 } else { 1 },
                            )?;
                            pending += 1;
                            if pending == 50 || i == count - 1 {
                                self.set_list(
                                    f,
                                    target,
                                    if open { 0 } else { pending },
                                    block,
                                    line,
                                )?;
                                pending = 0;
                                block += 1;
                            }
                        }
                    }
                    if pending > 0 {
                        self.set_list(f, target, pending, block, line)?;
                    }
                }
                Node::Function(names, vararg, body, prototype) => {
                    let child = self.function(body, names, *vararg, Some(self.states[f].scope))?;
                    *prototype = Some(child.clone());
                    let index = self.states[f].prototype.children.len();
                    self.states[f].prototype.children.push(child);
                    self.bx(f, 44, target, index, line)?;
                }
            }
        }
        if wanted > 1 {
            self.abc(f, 4, target + 1, wanted as usize - 2, 0, line)?;
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    fn call(
        &mut self,
        f: usize,
        callee: &mut Expr,
        method: Option<&[u8]>,
        args: &mut [Expr],
        target: usize,
        wanted: i32,
        line: usize,
    ) -> Result<()> {
        self.expression(f, callee, target, 1)?;
        let offset = if method.is_some() { 2 } else { 1 };
        if let Some(method) = method {
            self.reserve(f, target + 2)?;
            let key = self.key(f, Value::String(method.to_vec()), target + 2, line)?;
            self.abc(f, 12, target, target, key, line)?;
        }
        let count = args.len();
        let mut open = false;
        for (i, arg) in args.iter_mut().enumerate() {
            open = i == count - 1 && multi(arg);
            self.expression(f, arg, target + offset + i, if open { -1 } else { 1 })?;
        }
        self.abc(
            f,
            36,
            target,
            if open { 0 } else { count + offset },
            if wanted < 0 { 0 } else { wanted as usize + 1 },
            line,
        )?;
        Ok(())
    }
    fn set_list(
        &mut self,
        f: usize,
        target: usize,
        count: usize,
        block: usize,
        line: usize,
    ) -> Result<()> {
        self.abc(
            f,
            43,
            target,
            count,
            if block <= 511 { block } else { 0 },
            line,
        )?;
        if block > 511 {
            self.emit(f, 46 | (block as u32) << 6, line);
        }
        Ok(())
    }
}
fn multi(e: &Expr) -> bool {
    matches!(e.1, Node::Call(..) | Node::Method(..) | Node::Vararg)
}
fn binary_opcode(op: &str) -> Option<u32> {
    Some(match op {
        "+" => 13,
        "-" => 14,
        "*" => 15,
        "%" => 16,
        "^" => 17,
        "/" => 18,
        "//" => 19,
        "&" => 20,
        "|" => 21,
        "~" => 22,
        "<<" => 23,
        ">>" => 24,
        _ => return None,
    })
}
fn fold(e: &Expr) -> Option<Value> {
    let value = match &e.1 {
        Node::Literal(v @ (Value::Integer(_) | Value::Number(_))) => return Some(v.clone()),
        Node::Paren(e) => return fold(e),
        Node::Unary(op, e) => {
            let v = fold(e)?;
            match op.as_str() {
                "-" => match v {
                    Value::Integer(n) => Value::Integer(n.wrapping_neg()),
                    Value::Number(n) => Value::Number(-n),
                    _ => return None,
                },
                "~" => Value::Integer(!numbers::integral(v.number().ok()?).ok()?),
                _ => return None,
            }
        }
        Node::Binary(op, a, b) if binary_opcode(op).is_some() => {
            let a = fold(a)?;
            let b = fold(b)?;
            if matches!(op.as_str(), "%" | "/" | "//") && b.number().ok()? == 0.0 {
                return None;
            }
            numbers::arithmetic(op, &a, &b).ok()?
        }
        _ => return None,
    };
    if matches!(value,Value::Number(n) if n.is_nan() || n==0.0) {
        None
    } else {
        Some(value)
    }
}

pub(crate) fn serialize(prototype: &Prototype, source: &str, strip: bool) -> Vec<u8> {
    let mut out = vec![
        27, 76, 117, 97, 0x53, 0, 25, 147, 13, 10, 26, 10, 4, 4, 4, 4, 8,
    ];
    out.extend(0x5678_i32.to_le_bytes());
    out.extend(370.5_f64.to_le_bytes());
    out.push(prototype.captures.len() as u8);
    write_prototype(&mut out, prototype, Some(source.as_bytes()), strip);
    out
}
fn word(out: &mut Vec<u8>, value: usize) {
    out.extend((value as u32).to_le_bytes());
}
fn string(out: &mut Vec<u8>, value: Option<&[u8]>) {
    let Some(value) = value else {
        out.push(0);
        return;
    };
    let size = value.len() + 1;
    if size < 255 {
        out.push(size as u8);
    } else {
        out.push(255);
        word(out, size);
    }
    out.extend(value);
}
fn write_prototype(out: &mut Vec<u8>, p: &Prototype, source: Option<&[u8]>, strip: bool) {
    string(out, if strip { None } else { source });
    word(out, 0);
    word(out, 0);
    out.extend([p.parameters as u8, u8::from(p.vararg), p.registers as u8]);
    word(out, p.code.len());
    for (code, _) in &p.code {
        out.extend(code.to_le_bytes());
    }
    word(out, p.constants.len());
    for value in &p.constants {
        match value {
            Value::Nil => out.push(0),
            Value::Bool(b) => out.extend([1, u8::from(*b)]),
            Value::Integer(n) => {
                out.push(19);
                out.extend(n.to_le_bytes());
            }
            Value::Number(n) => {
                out.push(3);
                out.extend(n.to_le_bytes());
            }
            Value::String(s) => {
                out.push(if s.len() <= 40 { 4 } else { 20 });
                string(out, Some(s));
            }
            _ => unreachable!("compiler constants are scalar values"),
        }
    }
    word(out, p.captures.len());
    for (register, index) in &p.captures {
        out.extend([u8::from(*register), *index as u8]);
    }
    word(out, p.children.len());
    for child in &p.children {
        write_prototype(out, child, None, strip);
    }
    word(out, if strip { 0 } else { p.code.len() });
    if !strip {
        for (_, line) in &p.code {
            word(out, *line);
        }
    }
    word(out, 0);
    word(out, 0);
}
