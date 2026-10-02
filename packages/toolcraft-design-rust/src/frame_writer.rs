//! Terminal mode lifecycle. State transitions precede fallible host I/O.
#[derive(Default)]
pub struct FrameWriter {
    opened: bool,
}
impl FrameWriter {
    pub fn open(&mut self) -> bool {
        !std::mem::replace(&mut self.opened, true)
    }
    pub fn close(&mut self) -> bool {
        std::mem::replace(&mut self.opened, false)
    }
    pub fn is_open(&self) -> bool {
        self.opened
    }
}
pub fn open_sequence(mouse: bool) -> &'static str {
    if mouse {
        "\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?7l"
    } else {
        "\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[?1006l\x1b[?1000l\x1b[?7l"
    }
}
pub fn close_sequence(mouse: bool) -> &'static str {
    if mouse {
        "\x1b[0m\x1b[?7h\x1b[?1006l\x1b[?1000l\x1b[?2004l\x1b[?25h\x1b[?1049l"
    } else {
        "\x1b[0m\x1b[?7h\x1b[?2004l\x1b[?25h\x1b[?1049l"
    }
}
pub const FRAME_START: &str = "\x1b[?2026h";
pub const FRAME_END: &str = "\x1b[?2026l";
