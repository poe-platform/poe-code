//! In-process Lua evaluation used by native and WebAssembly document filters.
mod format;
mod library;
mod numbers;
mod pattern;
mod syntax;
mod utf8;
use std::collections::HashMap;
use syntax::{Expr, Node, Stmt};

#[derive(Clone, Debug, Default)]
pub enum Value {
    #[default]
    Nil,
    Bool(bool),
    Integer(i32),
    Number(f64),
    String(Vec<u8>),
    Table(usize),
    Function(usize),
    Native(&'static str),
}
impl Value {
    fn truth(&self) -> bool {
        !matches!(self, Self::Nil | Self::Bool(false))
    }
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Nil => "nil",
            Self::Bool(_) => "boolean",
            Self::Integer(_) | Self::Number(_) => "number",
            Self::String(_) => "string",
            Self::Table(_) => "table",
            Self::Function(_) | Self::Native(_) => "function",
        }
    }
    pub fn text(&self) -> String {
        match self {
            Self::Nil => "nil".into(),
            Self::Bool(v) => v.to_string(),
            Self::Integer(v) => v.to_string(),
            Self::Number(v) => numbers::text(*v),
            Self::String(v) => String::from_utf8_lossy(v).into_owned(),
            Self::Table(n) => format!("table: {n:x}"),
            Self::Function(n) => format!("function: {n:x}"),
            Self::Native(n) => format!("function: {n}"),
        }
    }
    fn bytes(&self) -> Vec<u8> {
        match self {
            Self::String(v) => v.clone(),
            _ => self.text().into_bytes(),
        }
    }
    fn number(&self) -> Result<f64> {
        match self {
            Self::Integer(n) => Ok(*n as f64),
            Self::Number(n) => Ok(*n),
            Self::String(s) => numbers::parse(s)
                .ok_or_else(|| Error::new("Expected Lua number"))?
                .number(),
            _ => Err(Error::new("number expected")),
        }
    }
}
impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Nil, Self::Nil) => true,
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Integer(a), Self::Integer(b)) => a == b,
            (Self::Number(a), Self::Number(b)) => a == b,
            (Self::Integer(a), Self::Number(b)) | (Self::Number(b), Self::Integer(a)) => {
                *a as f64 == *b
            }
            (Self::String(a), Self::String(b)) => a == b,
            (Self::Table(a), Self::Table(b)) | (Self::Function(a), Self::Function(b)) => a == b,
            (Self::Native(a), Self::Native(b)) => a == b,
            _ => false,
        }
    }
}
#[derive(Debug)]
pub struct Error {
    pub message: String,
    pub location: Option<(String, usize)>,
    unlocated: bool,
}
impl Error {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            location: None,
            unlocated: false,
        }
    }
    fn unlocated(message: impl Into<String>) -> Self {
        Self {
            unlocated: true,
            ..Self::new(message)
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some((path, line)) = &self.location {
            write!(f, "[string \"{path}\"]:{line}: ")?;
        }
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for Error {}
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Default)]
struct Table {
    entries: Vec<(Value, Value)>,
    meta: Value,
}
struct Environment {
    parent: Option<usize>,
    bindings: HashMap<Vec<u8>, usize>,
    varargs: Option<Vec<Value>>,
}
#[derive(Clone)]
struct Function {
    names: Vec<Vec<u8>>,
    vararg: bool,
    body: Vec<Stmt>,
    env: usize,
    source: String,
}
enum Flow {
    Next(usize),
    Return(Vec<Value>),
    Break,
    Goto(Vec<u8>),
}
enum Target {
    Cell(usize),
    Global(Vec<u8>),
    Index(Value, Value),
}
pub struct Runtime {
    tables: Vec<Table>,
    functions: Vec<Function>,
    environments: Vec<Environment>,
    cells: Vec<Value>,
    globals: Value,
    string_meta: Value,
    source: String,
    steps: usize,
    depth: usize,
}
impl Runtime {
    pub fn new(max_steps: usize) -> Self {
        let mut vm = Self {
            tables: Vec::new(),
            functions: Vec::new(),
            environments: Vec::new(),
            cells: Vec::new(),
            globals: Value::Nil,
            string_meta: Value::Nil,
            source: String::new(),
            steps: usize::MAX,
            depth: 0,
        };
        vm.globals = vm.table();
        vm.install();
        vm.steps = max_steps;
        vm
    }
    fn tick(&mut self) -> Result<()> {
        self.steps = self
            .steps
            .checked_sub(1)
            .ok_or_else(|| Error::new("Lua instruction limit exceeded"))?;
        Ok(())
    }
    pub fn table(&mut self) -> Value {
        let n = self.tables.len();
        self.tables.push(Table::default());
        Value::Table(n)
    }
    pub fn raw_get(&self, table: &Value, key: &Value) -> Value {
        if let Value::Table(n) = table {
            self.tables[*n]
                .entries
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.clone())
                .unwrap_or(Value::Nil)
        } else {
            Value::Nil
        }
    }
    pub fn raw_set(&mut self, table: &Value, key: Value, value: Value) -> Result<()> {
        let Value::Table(n) = table else {
            return Err(Error::new("table expected"));
        };
        if key == Value::Nil || matches!(key,Value::Number(n) if n.is_nan()) {
            return Err(Error::new("table index is nil or NaN"));
        }
        let entries = &mut self.tables[*n].entries;
        if let Some(i) = entries.iter().position(|(k, _)| k == &key) {
            if value == Value::Nil {
                entries.remove(i);
            } else {
                entries[i].1 = value;
            }
        } else if value != Value::Nil {
            entries.push((key, value));
        }
        Ok(())
    }
    pub fn entries(&self, table: &Value) -> Result<Vec<(Value, Value)>> {
        if let Value::Table(n) = table {
            Ok(self.tables[*n].entries.clone())
        } else {
            Err(Error::new("table expected"))
        }
    }
    pub fn set_global(&mut self, name: &str, value: Value) {
        let globals = self.globals.clone();
        self.raw_set(&globals, Value::String(name.into()), value)
            .unwrap();
    }
    pub fn global(&self, name: &str) -> Value {
        self.raw_get(&self.globals, &Value::String(name.into()))
    }
    fn meta(&self, value: &Value, name: &str) -> Value {
        let table = match value {
            Value::Table(n) => &self.tables[*n].meta,
            Value::String(_) => &self.string_meta,
            _ => return Value::Nil,
        };
        self.raw_get(table, &Value::String(name.into()))
    }
    pub fn get(&mut self, table: &Value, key: &Value) -> Result<Value> {
        let mut table = table.clone();
        for _ in 0..2000 {
            self.tick()?;
            let value = self.raw_get(&table, key);
            if value != Value::Nil {
                return Ok(value);
            }
            let index = self.meta(&table, "__index");
            match index {
                Value::Nil => {
                    return if matches!(table, Value::Table(_)) {
                        Ok(Value::Nil)
                    } else {
                        Err(Error::new(format!(
                            "attempt to index a {} value",
                            table.kind()
                        )))
                    };
                }
                Value::Function(_) | Value::Native(_) => {
                    return Ok(first(self.call(index, vec![table, key.clone()])?));
                }
                _ => table = index,
            }
        }
        Err(Error::new("'__index' chain too long; possible loop"))
    }
    fn set(&mut self, mut table: Value, key: Value, value: Value) -> Result<()> {
        for _ in 0..2000 {
            self.tick()?;
            let setter = self.meta(&table, "__newindex");
            if matches!(table, Value::Table(_))
                && (self.raw_get(&table, &key) != Value::Nil || setter == Value::Nil)
            {
                return self.raw_set(&table, key, value);
            }
            match setter {
                Value::Nil => return Err(Error::new("Expected Lua table for assignment")),
                Value::Function(_) | Value::Native(_) => {
                    self.call(setter, vec![table, key, value])?;
                    return Ok(());
                }
                _ => table = setter,
            }
        }
        Err(Error::new("'__newindex' chain too long; possible loop"))
    }
    fn length(&self, value: &Value) -> Result<usize> {
        match value {
            Value::String(s) => Ok(s.len()),
            Value::Table(_) => {
                let mut n = 0;
                while self.raw_get(value, &Value::Number((n + 1) as f64)) != Value::Nil {
                    n += 1;
                }
                Ok(n)
            }
            _ => Err(Error::new("attempt to get length of a non-table value")),
        }
    }
    fn env(&mut self, parent: Option<usize>, varargs: Option<Vec<Value>>) -> usize {
        let n = self.environments.len();
        self.environments.push(Environment {
            parent,
            bindings: HashMap::new(),
            varargs,
        });
        n
    }
    fn bind(&mut self, env: usize, name: &[u8], value: Value) {
        let cell = self.cells.len();
        self.cells.push(value);
        self.environments[env].bindings.insert(name.into(), cell);
    }
    fn lookup(&self, mut env: usize, name: &[u8]) -> Option<usize> {
        loop {
            let e = &self.environments[env];
            if let Some(c) = e.bindings.get(name) {
                return Some(*c);
            }
            env = e.parent?;
        }
    }
    fn variable(&self, env: usize, name: &[u8]) -> Value {
        self.lookup(env, name)
            .map(|c| self.cells[c].clone())
            .unwrap_or_else(|| self.raw_get(&self.globals, &Value::String(name.to_vec())))
    }
    pub fn run(&mut self, source: impl AsRef<[u8]>, path: &str) -> Result<Vec<Value>> {
        let body = syntax::parse(source.as_ref())?;
        let old = std::mem::replace(&mut self.source, path.into());
        let env = self.env(None, Some(Vec::new()));
        let result = self.block(&body, env).and_then(|flow| match flow {
            Flow::Return(v) => Ok(v),
            Flow::Next(_) => Ok(Vec::new()),
            Flow::Break => Err(Error::new("break outside loop")),
            Flow::Goto(n) => Err(Error::new(format!(
                "no visible label '{}'",
                String::from_utf8_lossy(&n)
            ))),
        });
        self.source = old;
        result
    }
    pub fn call(&mut self, function: Value, mut args: Vec<Value>) -> Result<Vec<Value>> {
        self.tick()?;
        self.depth += 1;
        if self.depth > 200 {
            self.depth -= 1;
            return Err(Error::new("Lua call depth exceeded"));
        }
        let result = (|| match function {
            Value::Native(name) => self.native(name, args),
            Value::Function(n) => {
                let f = self.functions[n].clone();
                let varargs = if f.vararg {
                    args.get(f.names.len()..).unwrap_or_default().to_vec()
                } else {
                    Vec::new()
                };
                let env = self.env(Some(f.env), Some(varargs));
                for (i, name) in f.names.iter().enumerate() {
                    self.bind(env, name, args.get(i).cloned().unwrap_or_default());
                }
                let old = std::mem::replace(&mut self.source, f.source);
                let result = self.block(&f.body, env);
                self.source = old;
                match result? {
                    Flow::Return(values) => Ok(values),
                    Flow::Next(_) => Ok(Vec::new()),
                    Flow::Break => Err(Error::new("break outside loop")),
                    Flow::Goto(n) => Err(Error::new(format!(
                        "no visible label '{}'",
                        String::from_utf8_lossy(&n)
                    ))),
                }
            }
            _ => {
                let callback = self.meta(&function, "__call");
                if !matches!(callback, Value::Function(_) | Value::Native(_)) {
                    return Err(Error::new(format!(
                        "attempt to call a {} value",
                        function.kind()
                    )));
                }
                args.insert(0, function);
                self.call(callback, args)
            }
        })();
        self.depth -= 1;
        result
    }
    fn eval_list(&mut self, expressions: &[Expr], env: usize) -> Result<Vec<Value>> {
        let mut values = Vec::new();
        for (i, e) in expressions.iter().enumerate() {
            let v = self.eval(e, env)?;
            if i + 1 == expressions.len() {
                values.extend(v);
            } else {
                values.push(first(v));
            }
        }
        Ok(values)
    }
    fn one(&mut self, expr: &Expr, env: usize) -> Result<Value> {
        Ok(first(self.eval(expr, env)?))
    }
    fn eval(&mut self, expr: &Expr, env: usize) -> Result<Vec<Value>> {
        self.tick()?;
        let result = (|| {
            let value = match &expr.1 {
                Node::Literal(v) => v.clone(),
                Node::Name(n) => self.variable(env, n),
                Node::Vararg => {
                    let mut e = env;
                    loop {
                        if let Some(values) = &self.environments[e].varargs {
                            return Ok(values.clone());
                        }
                        match self.environments[e].parent {
                            Some(p) => e = p,
                            None => return Ok(Vec::new()),
                        }
                    }
                }
                Node::Paren(e) => self.one(e, env)?,
                Node::Function(names, vararg, body) => {
                    let n = self.functions.len();
                    self.functions.push(Function {
                        names: names.clone(),
                        vararg: *vararg,
                        body: body.clone(),
                        env,
                        source: self.source.clone(),
                    });
                    Value::Function(n)
                }
                Node::Table(fields) => {
                    let table = self.table();
                    let mut index = 1;
                    for (i, (key, e)) in fields.iter().enumerate() {
                        if let Some(key) = key {
                            let key = self.one(key, env)?;
                            let value = self.one(e, env)?;
                            self.raw_set(&table, key, value)?;
                        } else {
                            let values = self.eval(e, env)?;
                            let values = if i + 1 == fields.len() {
                                values
                            } else {
                                vec![first(values)]
                            };
                            for value in values {
                                self.raw_set(&table, Value::Integer(index), value)?;
                                index += 1;
                            }
                        }
                    }
                    table
                }
                Node::Index(base, key) => {
                    let base = self.one(base, env)?;
                    let key = self.one(key, env)?;
                    self.get(&base, &key)?
                }
                Node::Call(callee, args) => {
                    let function = self.one(callee, env)?;
                    let args = self.eval_list(args, env)?;
                    return self.call(function, args);
                }
                Node::Method(base, name, args) => {
                    let base = self.one(base, env)?;
                    let function = self.get(&base, &Value::String(name.clone()))?;
                    let mut values = vec![base];
                    values.extend(self.eval_list(args, env)?);
                    return self.call(function, values);
                }
                Node::Unary(op, e) => {
                    let value = self.one(e, env)?;
                    match op.as_str() {
                        "not" => Value::Bool(!value.truth()),
                        "#" if matches!(value, Value::String(_)) => {
                            Value::Integer(self.length(&value)? as i32)
                        }
                        "#" => {
                            let method = self.meta(&value, "__len");
                            if method != Value::Nil {
                                first(self.call(method, vec![value.clone(), value])?)
                            } else {
                                Value::Integer(self.length(&value)? as i32)
                            }
                        }
                        "-" | "~" => {
                            let result = match (&value, op.as_str()) {
                                (Value::Integer(n), "-") => Ok(Value::Integer(n.wrapping_neg())),
                                (_, "-") => value.number().map(|n| Value::Number(-n)),
                                _ => value
                                    .number()
                                    .and_then(numbers::integral)
                                    .map(|n| Value::Integer(!n)),
                            };
                            match result {
                                Ok(value) => value,
                                Err(error) => {
                                    let method = self
                                        .meta(&value, if op == "-" { "__unm" } else { "__bnot" });
                                    if method == Value::Nil {
                                        return Err(error);
                                    }
                                    first(self.call(method, vec![value.clone(), value])?)
                                }
                            }
                        }
                        _ => unreachable!(),
                    }
                }
                Node::Binary(op, left, right) => {
                    let left = self.one(left, env)?;
                    if op == "and" && !left.truth() || op == "or" && left.truth() {
                        left
                    } else {
                        let right = self.one(right, env)?;
                        self.binary(op, left, right)?
                    }
                }
            };
            Ok(vec![value])
        })();
        result.map_err(|mut error: Error| {
            if !error.unlocated && error.location.is_none() {
                error.location = Some((self.source.clone(), expr.0));
            }
            error
        })
    }
    fn binary(&mut self, op: &str, left: Value, right: Value) -> Result<Value> {
        if matches!(op, "and" | "or") {
            return Ok(right);
        }
        let (op, left, right) = match op {
            ">" => ("<", right, left),
            ">=" => ("<=", right, left),
            _ => (op, left, right),
        };
        if matches!(op, "==" | "~=") {
            let mut equal = left == right;
            if !equal && matches!((&left, &right), (Value::Table(_), Value::Table(_))) {
                let mut method = self.meta(&left, "__eq");
                if method == Value::Nil {
                    method = self.meta(&right, "__eq");
                }
                if method != Value::Nil {
                    equal = first(self.call(method, vec![left, right])?).truth();
                }
            }
            return Ok(Value::Bool(if op == "==" { equal } else { !equal }));
        }
        let result = if op == ".." {
            if matches!(
                left,
                Value::String(_) | Value::Integer(_) | Value::Number(_)
            ) && matches!(
                right,
                Value::String(_) | Value::Integer(_) | Value::Number(_)
            ) {
                let mut bytes = left.bytes();
                bytes.extend(right.bytes());
                Ok(Value::String(bytes))
            } else {
                Err(Error::new("attempt to concatenate a non-string value"))
            }
        } else if matches!(op, "<" | "<=") {
            let order = match (&left, &right) {
                (Value::String(a), Value::String(b)) => {
                    // The existing Lua engine compares unpadded hexadecimal bytes.
                    let digits = |byte: &u8| {
                        [(*byte >= 16).then_some(*byte >> 4), Some(*byte & 15)]
                            .into_iter()
                            .flatten()
                    };
                    Ok(Some(
                        a.iter().flat_map(digits).cmp(b.iter().flat_map(digits)),
                    ))
                }
                (Value::Integer(_) | Value::Number(_), Value::Integer(_) | Value::Number(_)) => {
                    Ok(left.number()?.partial_cmp(&right.number()?))
                }
                _ => Err(Error::new("attempt to compare incompatible values")),
            };
            order.map(|order| {
                Value::Bool(order.is_some_and(|o| if op == "<" { o.is_lt() } else { o.is_le() }))
            })
        } else {
            numbers::arithmetic(op, &left, &right)
        };
        let error = match result {
            Ok(value) => return Ok(value),
            Err(error) => error,
        };
        let method = match op {
            "+" => "__add",
            "-" => "__sub",
            "*" => "__mul",
            "/" => "__div",
            "//" => "__idiv",
            "%" => "__mod",
            "^" => "__pow",
            "&" => "__band",
            "|" => "__bor",
            "~" => "__bxor",
            "<<" => "__shl",
            ">>" => "__shr",
            ".." => "__concat",
            "<" => "__lt",
            "<=" => "__le",
            _ => return Err(error),
        };
        let mut callback = self.meta(&left, method);
        if callback == Value::Nil {
            callback = self.meta(&right, method);
        }
        if callback != Value::Nil {
            let value = first(self.call(callback, vec![left, right])?);
            return Ok(if matches!(op, "<" | "<=") {
                Value::Bool(value.truth())
            } else {
                value
            });
        }
        if op == "<=" {
            let mut callback = self.meta(&right, "__lt");
            if callback == Value::Nil {
                callback = self.meta(&left, "__lt");
            }
            if callback != Value::Nil {
                return Ok(Value::Bool(
                    !first(self.call(callback, vec![right, left])?).truth(),
                ));
            }
        }
        Err(error)
    }
    fn target(&mut self, expr: &Expr, env: usize) -> Result<Target> {
        match &expr.1 {
            Node::Name(n) => Ok(if let Some(c) = self.lookup(env, n) {
                Target::Cell(c)
            } else {
                Target::Global(n.clone())
            }),
            Node::Index(base, key) => Ok(Target::Index(self.one(base, env)?, self.one(key, env)?)),
            _ => Err(Error::new("Invalid assignment target")),
        }
    }
    fn block(&mut self, body: &[Stmt], mut env: usize) -> Result<Flow> {
        let mut pc = 0;
        while pc < body.len() {
            self.tick()?;
            let stmt = &body[pc];
            pc += 1;
            let flow = match stmt {
                Stmt::Assign(targets, expressions) => {
                    let targets = targets
                        .iter()
                        .map(|e| self.target(e, env))
                        .collect::<Result<Vec<_>>>()?;
                    let values = self.eval_list(expressions, env)?;
                    for (i, t) in targets.into_iter().enumerate() {
                        let value = values.get(i).cloned().unwrap_or_default();
                        match t {
                            Target::Cell(c) => self.cells[c] = value,
                            Target::Global(n) => {
                                self.raw_set(&self.globals.clone(), Value::String(n), value)?
                            }
                            Target::Index(t, k) => self.set(t, k, value)?,
                        }
                    }
                    Flow::Next(env)
                }
                Stmt::Local(names, expressions) => {
                    let values = self.eval_list(expressions, env)?;
                    env = self.env(Some(env), None);
                    for (i, n) in names.iter().enumerate() {
                        self.bind(env, n, values.get(i).cloned().unwrap_or_default());
                    }
                    Flow::Next(env)
                }
                Stmt::LocalFunction(name, e) => {
                    env = self.env(Some(env), None);
                    self.bind(env, name, Value::Nil);
                    let value = self.one(e, env)?;
                    let cell = self.lookup(env, name).unwrap();
                    self.cells[cell] = value;
                    Flow::Next(env)
                }
                Stmt::Call(e) => {
                    self.eval(e, env)?;
                    Flow::Next(env)
                }
                Stmt::Do(body) => self.block(body, env)?,
                Stmt::If(clauses) => {
                    let mut flow = Flow::Next(env);
                    for (cond, body) in clauses {
                        if cond
                            .as_ref()
                            .map(|c| self.one(c, env))
                            .transpose()?
                            .is_none_or(|v| v.truth())
                        {
                            flow = self.block(body, env)?;
                            break;
                        }
                    }
                    flow
                }
                Stmt::While(cond, body) => {
                    let mut result = Flow::Next(env);
                    while self.one(cond, env)?.truth() {
                        match self.block(body, env)? {
                            Flow::Next(_) => (),
                            Flow::Break => break,
                            f => {
                                result = f;
                                break;
                            }
                        }
                    }
                    result
                }
                Stmt::Repeat(body, cond) => {
                    let mut result = Flow::Next(env);
                    loop {
                        let mut scope = self.env(Some(env), None);
                        match self.block(body, scope)? {
                            Flow::Next(end) => scope = end,
                            Flow::Break => break,
                            f => {
                                result = f;
                                break;
                            }
                        }
                        if self.one(cond, scope)?.truth() {
                            break;
                        }
                    }
                    result
                }
                Stmt::For(name, start, limit, step, body) => {
                    let initial = self.one(start, env)?;
                    let mut end = self.one(limit, env)?.number()?;
                    let step = if let Some(s) = step {
                        self.one(s, env)?
                    } else {
                        Value::Integer(1)
                    };
                    let integer =
                        matches!((&initial, &step), (Value::Integer(_), Value::Integer(_)));
                    let step = step.number()?;
                    let mut n = initial.number()?;
                    if integer {
                        let rounded = if step < 0.0 { end.ceil() } else { end.floor() };
                        if !(i32::MIN as f64..=i32::MAX as f64).contains(&rounded) {
                            if if end > 0.0 { step < 0.0 } else { step >= 0.0 } {
                                n = 0.0;
                            }
                            end = if end > 0.0 {
                                i32::MAX as f64
                            } else {
                                i32::MIN as f64
                            };
                        } else {
                            end = rounded;
                        }
                        n = (n as i32).wrapping_sub(step as i32) as f64;
                    } else {
                        n -= step;
                    }
                    let mut result = Flow::Next(env);
                    loop {
                        n = if integer {
                            (n as i32).wrapping_add(step as i32) as f64
                        } else {
                            n + step
                        };
                        if !(if step > 0.0 { n <= end } else { n >= end }) {
                            break;
                        }
                        self.tick()?;
                        let scope = self.env(Some(env), None);
                        self.bind(
                            scope,
                            name,
                            if integer {
                                Value::Integer(n as i32)
                            } else {
                                Value::Number(n)
                            },
                        );
                        match self.block(body, scope)? {
                            Flow::Next(_) => (),
                            Flow::Break => break,
                            f => {
                                result = f;
                                break;
                            }
                        }
                    }
                    result
                }
                Stmt::ForIn(names, expressions, body) => {
                    let values = self.eval_list(expressions, env)?;
                    let iter = values.first().cloned().unwrap_or_default();
                    let state = values.get(1).cloned().unwrap_or_default();
                    let mut control = values.get(2).cloned().unwrap_or_default();
                    let mut result = Flow::Next(env);
                    loop {
                        let row = self.call(iter.clone(), vec![state.clone(), control])?;
                        control = row.first().cloned().unwrap_or_default();
                        if control == Value::Nil {
                            break;
                        }
                        let scope = self.env(Some(env), None);
                        for (i, n) in names.iter().enumerate() {
                            self.bind(scope, n, row.get(i).cloned().unwrap_or_default());
                        }
                        match self.block(body, scope)? {
                            Flow::Next(_) => (),
                            Flow::Break => break,
                            f => {
                                result = f;
                                break;
                            }
                        }
                    }
                    result
                }
                Stmt::Return(values) => Flow::Return(self.eval_list(values, env)?),
                Stmt::Break => Flow::Break,
                Stmt::Goto(n) => Flow::Goto(n.clone()),
                Stmt::Label(_) => Flow::Next(env),
            };
            match flow {
                Flow::Next(_) => (),
                Flow::Goto(ref name) => {
                    if let Some(index) = body
                        .iter()
                        .position(|s| matches!(s,Stmt::Label(n) if n==name))
                    {
                        pc = index + 1;
                    } else {
                        return Ok(flow);
                    }
                }
                _ => return Ok(flow),
            }
        }
        Ok(Flow::Next(env))
    }
}
fn first(values: Vec<Value>) -> Value {
    values.into_iter().next().unwrap_or_default()
}
