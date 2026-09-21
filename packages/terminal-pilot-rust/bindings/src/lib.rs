use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
fn string(value: &[u16]) -> Value {
    Value::String(value.to_vec())
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
#[napi]
pub fn strip_ansi(input: Utf16String) -> Utf16String {
    terminal_pilot_rust::strip_ansi(&input).into()
}
#[napi]
pub fn terminal_key_sequence(input: Utf16String) -> NativeJson {
    NativeJson(match terminal_pilot_rust::key_sequence(&input) {
        Ok(value) => object(vec![("value", string(&value))]),
        Err(error) => object(vec![("fault", string(&error))]),
    })
}
fn dimension(value: f64) -> Result<usize> {
    if !value.is_finite() || value < 1.0 || value > 1000.0 || value.fract() != 0.0 {
        return Err(Error::from_reason(
            "Terminal dimensions must be integers between 1 and 1000.",
        ));
    }
    Ok(value as usize)
}
#[napi(custom_finalize)]
pub struct NativeTerminalBuffer {
    inner: terminal_pilot_rust::buffer::Buffer,
    reported: i64,
}
#[napi]
impl NativeTerminalBuffer {
    #[napi(constructor)]
    pub fn new(env: Env, cols: f64, rows: f64) -> Result<Self> {
        let inner = terminal_pilot_rust::buffer::Buffer::new(dimension(cols)?, dimension(rows)?)
            .map_err(Error::from_reason)?;
        let reported = inner.retained_bytes() as i64;
        env.adjust_external_memory(reported)?;
        Ok(Self { inner, reported })
    }
    #[napi]
    pub fn write(&mut self, env: Env, data: Utf16String) -> Result<()> {
        let result = self.inner.write(&data);
        self.account(env)?;
        result.map_err(Error::from_reason)
    }
    #[napi]
    pub fn resize(&mut self, env: Env, cols: f64, rows: f64) -> Result<()> {
        let result = self.inner.resize(dimension(cols)?, dimension(rows)?);
        self.account(env)?;
        result.map_err(Error::from_reason)
    }
    #[napi]
    pub fn render_line(&self, row: f64) -> Utf16String {
        if row.is_finite() && row >= 0.0 && row.fract() == 0.0 {
            self.inner.render_line(row as usize).into()
        } else {
            Vec::<u16>::new().into()
        }
    }
    #[napi(getter)]
    pub fn cursor_x(&self) -> u32 {
        self.inner.cursor().0 as u32
    }
    #[napi(getter)]
    pub fn cursor_y(&self) -> u32 {
        self.inner.cursor().1 as u32
    }
    #[napi(getter)]
    pub fn native_cells(&self) -> NativeJson {
        NativeJson(Value::Array(
            self.inner
                .cells()
                .map(|row| {
                    Value::Array(
                        row.iter()
                            .map(|cell| {
                                cell.as_ref().map_or(Value::Null, |c| {
                                    object(vec![
                                        ("text", string(&c.text)),
                                        ("code", Value::Number(f64::from(c.text[0]))),
                                        ("style", string(&c.style)),
                                        ("width", Value::Number(c.width as f64)),
                                    ])
                                })
                            })
                            .collect(),
                    )
                })
                .collect(),
        ))
    }
}
impl NativeTerminalBuffer {
    fn account(&mut self, env: Env) -> Result<()> {
        let bytes = self.inner.retained_bytes() as i64;
        if bytes != self.reported {
            env.adjust_external_memory(bytes - self.reported)?;
            self.reported = bytes;
        }
        Ok(())
    }
}
impl ObjectFinalize for NativeTerminalBuffer {
    fn finalize(self, env: Env) -> Result<()> {
        env.adjust_external_memory(-self.reported)?;
        Ok(())
    }
}
#[napi(object)]
pub struct ScreenCursor {
    pub row: f64,
    pub col: f64,
}
#[napi(object)]
pub struct ScreenSize {
    pub rows: f64,
    pub cols: f64,
}
#[napi(custom_finalize)]
pub struct NativeTerminalScreen {
    inner: terminal_pilot_rust::screen::Screen,
    reported: i64,
}
#[napi]
impl NativeTerminalScreen {
    #[napi(constructor)]
    pub fn new(
        env: Env,
        lines: Vec<Utf16String>,
        raw_lines: Vec<Utf16String>,
        cursor: ScreenCursor,
        size: ScreenSize,
    ) -> Result<Self> {
        let inner = terminal_pilot_rust::screen::Screen::new(
            lines.into_iter().map(|s| s.to_vec()).collect(),
            raw_lines.into_iter().map(|s| s.to_vec()).collect(),
            (cursor.row, cursor.col),
            (size.rows, size.cols),
        );
        let reported = inner.retained_bytes() as i64;
        env.adjust_external_memory(reported)?;
        Ok(Self { inner, reported })
    }
    #[napi(getter)]
    pub fn text(&self) -> Utf16String {
        self.inner.text().into()
    }
    #[napi]
    pub fn contains(&self, substring: Utf16String) -> bool {
        self.inner.contains(&substring)
    }
    #[napi]
    pub fn line(&self, env: Env, index: f64) -> Result<Utf16String> {
        if let Some(line) = self.inner.line(index) {
            Ok(line.to_vec().into())
        } else {
            let number = if index == f64::INFINITY {
                "Infinity".to_string()
            } else if index == f64::NEG_INFINITY {
                "-Infinity".to_string()
            } else {
                index.to_string()
            };
            env.throw_range_error(&format!("Line index out of bounds: {number}"), None)?;
            Err(Error::new(
                Status::PendingException,
                "Line index out of bounds",
            ))
        }
    }
    #[napi(getter)]
    pub fn native_lines(&self) -> Vec<Utf16String> {
        self.inner.lines.iter().map(|s| s.clone().into()).collect()
    }
    #[napi(getter)]
    pub fn native_raw_lines(&self) -> Vec<Utf16String> {
        self.inner
            .raw_lines
            .iter()
            .map(|s| s.clone().into())
            .collect()
    }
    #[napi(getter)]
    pub fn native_cursor(&self) -> ScreenCursor {
        ScreenCursor {
            row: self.inner.cursor.0,
            col: self.inner.cursor.1,
        }
    }
    #[napi(getter)]
    pub fn native_size(&self) -> ScreenSize {
        ScreenSize {
            rows: self.inner.size.0,
            cols: self.inner.size.1,
        }
    }
}
impl ObjectFinalize for NativeTerminalScreen {
    fn finalize(self, env: Env) -> Result<()> {
        env.adjust_external_memory(-self.reported)?;
        Ok(())
    }
}
#[napi(custom_finalize)]
pub struct NativeTerminalSession {
    inner: terminal_pilot_rust::session::Session,
    reported: i64,
}
#[napi]
impl NativeTerminalSession {
    #[napi(constructor)]
    pub fn new(env: Env, id: Utf16String, cols: f64, rows: f64, now: f64) -> Result<Self> {
        let inner = terminal_pilot_rust::session::Session::new(id.to_vec(), cols, rows, now)
            .map_err(Error::from_reason)?;
        let reported = inner.retained_bytes() as i64;
        env.adjust_external_memory(reported)?;
        Ok(Self { inner, reported })
    }
    #[napi]
    pub fn data(&mut self, env: Env, data: Utf16String, now: f64) -> Result<()> {
        let result = self.inner.data(&data, now);
        self.account(env)?;
        result.map_err(Error::from_reason)
    }
    #[napi]
    pub fn input(&self, data: Utf16String) -> Result<Utf16String> {
        self.inner
            .input(&data)
            .map(Into::into)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn fill(&self, data: Utf16String) -> Result<Utf16String> {
        self.inner
            .fill(&data)
            .map(Into::into)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn resize(&mut self, env: Env, cols: f64, rows: f64) -> Result<()> {
        let result = self.inner.resize(cols, rows);
        self.account(env)?;
        result.map_err(Error::from_reason)
    }
    #[napi]
    pub fn validate_geometry(&self, cols: f64, rows: f64) -> Result<()> {
        terminal_pilot_rust::session::geometry(cols, rows)
            .map(|_| ())
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn history(&self, last: Option<f64>) -> Result<Vec<Utf16String>> {
        self.inner
            .history(last)
            .map(|lines| lines.into_iter().map(Into::into).collect())
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn screen_lines(&self) -> Vec<Utf16String> {
        self.inner
            .screen_lines()
            .into_iter()
            .map(Into::into)
            .collect()
    }
    #[napi(getter)]
    pub fn cursor(&self) -> ScreenCursor {
        let (col, row) = self.inner.cursor();
        ScreenCursor {
            row: row as f64,
            col: col as f64,
        }
    }
    #[napi(getter)]
    pub fn size(&self) -> ScreenSize {
        let (cols, rows) = self.inner.size();
        ScreenSize {
            rows: rows as f64,
            cols: cols as f64,
        }
    }
    #[napi]
    pub fn validate_wait(&self, duration: f64, scope: String) -> Result<()> {
        self.inner
            .validate_wait(duration, &scope)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn validate_timeout(&self, duration: f64) -> Result<()> {
        terminal_pilot_rust::session::timeout(duration).map_err(Error::from_reason)
    }
    #[napi]
    pub fn match_string(&self, pattern: Utf16String, screen: bool) -> Option<Utf16String> {
        self.inner.match_string(&pattern, screen).map(Into::into)
    }
    #[napi]
    pub fn match_lines(&self, screen: bool) -> Vec<Utf16String> {
        self.inner
            .match_lines(screen)
            .into_iter()
            .map(Into::into)
            .collect()
    }
    #[napi]
    pub fn wait_error(
        &self,
        elapsed: f64,
        duration: f64,
        pattern: Utf16String,
    ) -> Option<Utf16String> {
        self.inner
            .wait_error(elapsed, duration, &pattern)
            .map(Into::into)
    }
    #[napi]
    pub fn quiet_remaining(&self, duration: f64, now: f64) -> Result<f64> {
        self.inner
            .quiet_remaining(duration, now)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn mark_exit(&mut self, code: i32) -> bool {
        self.inner.mark_exit(code)
    }
    #[napi(getter)]
    pub fn exit_code(&self) -> Option<i32> {
        self.inner.exit_code()
    }
    #[napi]
    pub fn begin_close(&mut self, now: f64) {
        self.inner.begin_close(now);
    }
    #[napi]
    pub fn abort_close(&mut self) {
        self.inner.abort_close();
    }
    #[napi]
    pub fn close_step(&self, now: f64) -> Result<NativeJson> {
        use terminal_pilot_rust::session::CloseAction;
        let (key, value) = match self.inner.close_step(now).map_err(Error::from_reason)? {
            CloseAction::Wait(ms) => ("wait", ms),
            CloseAction::Signal(sig) => ("signal", f64::from(sig)),
            CloseAction::Done(code) => ("done", f64::from(code)),
        };
        Ok(NativeJson(object(vec![(key, Value::Number(value))])))
    }
    #[napi]
    pub fn signal_sent(&mut self, now: f64) {
        self.inner.signal_sent(now);
    }
}
impl NativeTerminalSession {
    fn account(&mut self, env: Env) -> Result<()> {
        let bytes = self.inner.retained_bytes() as i64;
        if bytes != self.reported {
            env.adjust_external_memory(bytes - self.reported)?;
            self.reported = bytes;
        }
        Ok(())
    }
}
impl ObjectFinalize for NativeTerminalSession {
    fn finalize(self, env: Env) -> Result<()> {
        env.adjust_external_memory(-self.reported)?;
        Ok(())
    }
}
#[napi]
#[derive(Default)]
pub struct NativeTerminalPilot {
    inner: terminal_pilot_rust::session::Pilot,
}
#[napi]
impl NativeTerminalPilot {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn register(&mut self, id: Utf16String) -> Result<()> {
        self.inner.register(id.to_vec()).map_err(Error::from_reason)
    }
    #[napi]
    pub fn contains(&self, id: Utf16String) -> bool {
        self.inner.contains(&id)
    }
    #[napi]
    pub fn exited(&mut self, id: Utf16String) {
        self.inner.exited(&id);
    }
    #[napi]
    pub fn remove(&mut self, id: Utf16String) {
        self.inner.remove(&id);
    }
    #[napi]
    pub fn ids(&self, active: bool) -> Vec<Utf16String> {
        self.inner.ids(active).into_iter().map(Into::into).collect()
    }
}
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[napi]
pub struct NativeTerminalPty {
    inner: Option<terminal_pilot_rust::pty::Pty>,
}
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[napi]
impl NativeTerminalPty {
    #[napi(constructor)]
    pub fn new(
        command: String,
        args: Vec<String>,
        cwd: Option<String>,
        environment: Utf16String,
        cols: f64,
        rows: f64,
    ) -> Result<Self> {
        let value = mcp_protocol_rust::json::parse_utf16(&environment, Default::default())
            .map_err(|_| Error::from_reason("Invalid PTY environment"))?;
        let Value::Object(fields) = value else {
            return Err(Error::from_reason("PTY environment must be an object"));
        };
        let mut env = vec![];
        for (key, value) in fields {
            if let Value::String(text) = value {
                env.push((
                    String::from_utf16_lossy(&key),
                    String::from_utf16_lossy(&text),
                ));
            } else {
                return Err(Error::from_reason("PTY environment values must be strings"));
            }
        }
        let inner = terminal_pilot_rust::pty::Pty::spawn(terminal_pilot_rust::pty::Options {
            command,
            args,
            cwd,
            env,
            cols: dimension(cols)?,
            rows: dimension(rows)?,
        })
        .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Self { inner: Some(inner) })
    }
    #[napi(getter)]
    pub fn pid(&self) -> Result<u32> {
        Ok(self
            .inner
            .as_ref()
            .ok_or_else(|| Error::from_reason("PTY has been disposed."))?
            .pid())
    }
    #[napi]
    pub fn read(&mut self) -> Result<Buffer> {
        self.inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("PTY has been disposed."))?
            .read()
            .map(Into::into)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    #[napi]
    pub fn write(&mut self, data: Buffer) -> Result<()> {
        self.inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("PTY has been disposed."))?
            .write(&data)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    #[napi]
    pub fn resize(&self, cols: f64, rows: f64) -> Result<()> {
        self.inner
            .as_ref()
            .ok_or_else(|| Error::from_reason("PTY has been disposed."))?
            .resize(dimension(cols)?, dimension(rows)?)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    #[napi]
    pub fn signal(&mut self, signal: i32) -> Result<()> {
        self.inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("PTY has been disposed."))?
            .signal(signal)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    #[napi(getter)]
    pub fn exit_code(&mut self) -> Result<Option<i32>> {
        self.inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("PTY has been disposed."))?
            .exit_code()
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    #[napi]
    pub fn dispose(&mut self) {
        self.inner.take();
    }
}
