//! Source windows and UTF-16 rendering with caller-owned styling and options.

pub trait SourceSnippetHost {
    type Error;

    fn lines(&mut self) -> Result<Vec<Vec<u16>>, Self::Error>;
    fn line(&mut self) -> Result<f64, Self::Error>;
    fn context(&mut self) -> Result<f64, Self::Error>;
    fn header(&mut self, line: usize) -> Result<Option<Vec<u16>>, Self::Error>;
    fn muted(&mut self, value: Vec<u16>) -> Result<Vec<u16>, Self::Error>;
    fn caret(&mut self, gutter_width: usize) -> Result<Option<Vec<u16>>, Self::Error>;
}

pub fn render_source_snippet<H: SourceSnippetHost>(host: &mut H) -> Result<Vec<u16>, H::Error> {
    let lines = host.lines()?;
    let requested_line = host.line()?;
    let line = if requested_line.is_finite() {
        requested_line.floor().clamp(1.0, lines.len().max(1) as f64) as usize
    } else {
        1
    };
    let context = host.context()?;
    // JS Math.max propagates NaN: the original window has no rows and a
    // three-character gutter (String(NaN)), while retaining its header.
    let (start, end, gutter_width) = if context.is_nan() {
        (1, 0, 3)
    } else {
        let context = context.floor().max(0.0);
        let start = (line as f64 - context).max(1.0) as usize;
        let end = (line as f64 + context).min(lines.len() as f64) as usize;
        (start, end, end.to_string().len())
    };
    let mut output = Vec::new();
    if let Some(header) = host.header(line)? {
        output.push(header);
    }
    output.push(divider(host, gutter_width)?);
    for current in start..=end {
        let gutter = format!("{current:>gutter_width$}");
        let mut row = host.muted(gutter.encode_utf16().collect())?;
        row.extend(" | ".encode_utf16());
        row.extend_from_slice(&lines[current - 1]);
        output.push(row);
        if current == line
            && let Some(caret) = host.caret(gutter_width)?
        {
            output.push(caret);
        }
    }
    output.push(divider(host, gutter_width)?);
    Ok(output.join(&10))
}

fn divider<H: SourceSnippetHost>(host: &mut H, width: usize) -> Result<Vec<u16>, H::Error> {
    let mut line = host.muted(vec![32; width])?;
    line.extend(" |".encode_utf16());
    Ok(line)
}
