//! Terminal lifecycle, history and automation policies, independent of the host runtime.
use crate::{buffer::Buffer, strip_ansi};

pub fn geometry(cols: f64, rows: f64) -> Result<(usize, usize), String> {
    if [cols, rows]
        .iter()
        .any(|n| !n.is_finite() || *n <= 0.0 || n.fract() != 0.0)
    {
        return Err("Terminal columns and rows must be positive integers.".into());
    }
    if cols > 1000.0 || rows > 1000.0 {
        return Err("Terminal columns and rows must not exceed 1000.".into());
    }
    Ok((cols as usize, rows as usize))
}
pub fn timeout(value: f64) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 {
        Err("Timeout must be a finite non-negative number.".into())
    } else {
        Ok(())
    }
}
fn normalize(input: &[u16]) -> Vec<u16> {
    let mut output = vec![];
    let mut line = Vec::new();
    let mut cursor = 0usize;
    let mut i = 0;
    while i < input.len() {
        let c = input[i];
        match c {
            13 => cursor = 0,
            8 => cursor = cursor.saturating_sub(1),
            10 => {
                output.append(&mut line);
                output.push(10);
                cursor = 0;
            }
            _ => {
                let length = if (0xd800..=0xdbff).contains(&c)
                    && input
                        .get(i + 1)
                        .is_some_and(|c| (0xdc00..=0xdfff).contains(c))
                {
                    2
                } else {
                    1
                };
                // Preserve the SDK's scalar iteration with UTF-16 slice offsets.
                let start = cursor.min(line.len());
                let end = (cursor + 1).min(line.len());
                line.splice(start..end, input[i..i + length].iter().copied());
                cursor += 1;
                i += length - 1;
            }
        }
        i += 1;
    }
    output.extend(line);
    output
}
#[derive(Debug, PartialEq)]
pub enum CloseAction {
    Wait(f64),
    Signal(i32),
    Done(i32),
}
struct Closing {
    stage: u8,
    since: f64,
}
pub struct Session {
    id: Vec<u16>,
    buffer: Buffer,
    raw: Vec<u16>,
    cols: usize,
    rows: usize,
    last_data: f64,
    exit_code: Option<i32>,
    closing: Option<Closing>,
}
impl Session {
    pub fn new(id: Vec<u16>, cols: f64, rows: f64, now: f64) -> Result<Self, String> {
        let (cols, rows) = geometry(cols, rows)?;
        Ok(Self {
            id,
            buffer: Buffer::new(cols, rows)?,
            raw: vec![],
            cols,
            rows,
            last_data: now,
            exit_code: None,
            closing: None,
        })
    }
    pub fn retained_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            + self.buffer.retained_bytes()
            + (self.id.capacity() + self.raw.capacity()) * 2
    }
    pub fn data(&mut self, chunk: &[u16], now: f64) -> Result<(), String> {
        if self.exit_code.is_some() {
            return Ok(());
        }
        self.buffer.write(chunk)?;
        self.raw.extend(chunk);
        self.last_data = now;
        Ok(())
    }
    pub fn input(&self, raw: &[u16]) -> Result<Vec<u16>, String> {
        if self.exit_code.is_some() {
            return Err(format!(
                "Terminal session \"{}\" has already exited.",
                String::from_utf16_lossy(&self.id)
            ));
        }
        Ok(raw.to_vec())
    }
    pub fn fill(&self, text: &[u16]) -> Result<Vec<u16>, String> {
        let mut result = Vec::with_capacity(text.len());
        for (i, c) in text.iter().enumerate() {
            if *c == 13 && text.get(i + 1) == Some(&10) {
                continue;
            }
            result.push(if *c == 10 { 13 } else { *c });
        }
        self.input(&result)
    }
    pub fn resize(&mut self, cols: f64, rows: f64) -> Result<(), String> {
        let (cols, rows) = geometry(cols, rows)?;
        self.buffer.resize(cols, rows)?;
        self.cols = cols;
        self.rows = rows;
        Ok(())
    }
    pub fn size(&self) -> (usize, usize) {
        (self.cols, self.rows)
    }
    pub fn cursor(&self) -> (usize, usize) {
        self.buffer.cursor()
    }
    pub fn screen_lines(&self) -> Vec<Vec<u16>> {
        (0..self.rows).map(|r| self.buffer.render_line(r)).collect()
    }
    pub fn history(&self, last: Option<f64>) -> Result<Vec<Vec<u16>>, String> {
        if last.is_some_and(|n| !n.is_finite() || n < 0.0 || n.fract() != 0.0) {
            return Err("History last must be a non-negative integer.".into());
        }
        let clean = normalize(&strip_ansi(&self.raw));
        let mut lines = clean
            .split(|c| *c == 10)
            .map(<[u16]>::to_vec)
            .collect::<Vec<_>>();
        if lines.last().is_some_and(Vec::is_empty) {
            lines.pop();
        }
        if let Some(last) = last {
            let start = lines.len().saturating_sub(last as usize);
            lines.drain(..start);
        }
        Ok(lines)
    }
    pub fn match_lines(&self, screen: bool) -> Vec<Vec<u16>> {
        let raw = if screen {
            self.screen_lines()
                .into_iter()
                .enumerate()
                .flat_map(|(i, line)| {
                    let mut result = Vec::new();
                    if i > 0 {
                        result.push(10);
                    }
                    result.extend(line);
                    result
                })
                .collect()
        } else {
            self.raw.clone()
        };
        normalize(&strip_ansi(&raw))
            .split(|c| *c == 10)
            .map(<[u16]>::to_vec)
            .collect()
    }
    pub fn match_string(&self, pattern: &[u16], screen: bool) -> Option<Vec<u16>> {
        self.match_lines(screen)
            .into_iter()
            .find(|line| pattern.is_empty() || line.windows(pattern.len()).any(|s| s == pattern))
    }
    pub fn validate_wait(&self, duration: f64, scope: &str) -> Result<(), String> {
        timeout(duration)?;
        if scope != "history" && scope != "screen" {
            return Err("Wait scope must be either \"history\" or \"screen\".".into());
        }
        Ok(())
    }
    pub fn wait_error(&self, elapsed: f64, duration: f64, pattern: &[u16]) -> Option<Vec<u16>> {
        let pattern = String::from_utf16_lossy(pattern);
        let error = if elapsed > duration {
            format!("Timed out waiting for pattern after {duration}ms: {pattern}")
        } else if self.exit_code.is_some() {
            format!(
                "Terminal session \"{}\" exited before matching pattern: {pattern}",
                String::from_utf16_lossy(&self.id)
            )
        } else {
            return None;
        };
        Some(error.encode_utf16().collect())
    }
    pub fn quiet_remaining(&self, duration: f64, now: f64) -> Result<f64, String> {
        if !duration.is_finite() || duration < 0.0 {
            return Err("Quiet period must be a finite non-negative number.".into());
        }
        Ok((duration - (now - self.last_data)).max(0.0))
    }
    pub fn mark_exit(&mut self, code: i32) -> bool {
        if self.exit_code.is_some() {
            false
        } else {
            self.exit_code = Some(code);
            true
        }
    }
    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code
    }
    pub fn begin_close(&mut self, now: f64) {
        self.closing.get_or_insert(Closing {
            stage: 0,
            since: now,
        });
    }
    pub fn abort_close(&mut self) {
        self.closing = None;
    }
    pub fn close_step(&self, now: f64) -> Result<CloseAction, String> {
        if let Some(code) = self.exit_code {
            return Ok(CloseAction::Done(code));
        }
        let c = self.closing.as_ref().ok_or("Close has not started.")?;
        let duration = if c.stage == 0 { 250.0 } else { 1000.0 };
        let remaining = duration - (now - c.since);
        if remaining > 0.0 {
            return Ok(CloseAction::Wait(remaining));
        }
        match c.stage {
            0 => Ok(CloseAction::Signal(15)),
            1 => Ok(CloseAction::Signal(9)),
            _ => Err("Timed out waiting for process to exit after SIGKILL.".into()),
        }
    }
    pub fn signal_sent(&mut self, now: f64) {
        if let Some(c) = &mut self.closing {
            c.stage += 1;
            c.since = now;
        }
    }
}
#[derive(Default)]
pub struct Pilot {
    sessions: Vec<(Vec<u16>, bool)>,
}
impl Pilot {
    pub fn register(&mut self, id: Vec<u16>) -> Result<(), String> {
        if self.contains(&id) {
            return Err("Session ID already exists.".into());
        }
        self.sessions.push((id, true));
        Ok(())
    }
    pub fn contains(&self, id: &[u16]) -> bool {
        self.sessions.iter().any(|(key, _)| key == id)
    }
    pub fn exited(&mut self, id: &[u16]) {
        if let Some((_, live)) = self.sessions.iter_mut().find(|(key, _)| key == id) {
            *live = false;
        }
    }
    pub fn remove(&mut self, id: &[u16]) {
        self.sessions.retain(|(key, _)| key != id);
    }
    pub fn ids(&self, active: bool) -> Vec<Vec<u16>> {
        self.sessions
            .iter()
            .filter(|(_, live)| !active || *live)
            .map(|(key, _)| key.clone())
            .collect()
    }
}
