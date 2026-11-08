use napi_derive::napi;
use toolcraft_design_rust::frame_writer::{self, FrameWriter};

#[napi]
pub struct NativeFrameWriter {
    inner: FrameWriter,
}
#[napi]
impl NativeFrameWriter {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: FrameWriter::default(),
        }
    }
    #[napi]
    pub fn open(&mut self) -> bool {
        self.inner.open()
    }
    #[napi]
    pub fn close(&mut self) -> bool {
        self.inner.close()
    }
    #[napi]
    pub fn is_open(&self) -> bool {
        self.inner.is_open()
    }
}
impl Default for NativeFrameWriter {
    fn default() -> Self {
        Self::new()
    }
}
#[napi]
pub fn design_frame_controls() -> Vec<&'static str> {
    vec![
        frame_writer::open_sequence(true),
        frame_writer::open_sequence(false),
        frame_writer::close_sequence(true),
        frame_writer::close_sequence(false),
        frame_writer::FRAME_START,
        frame_writer::FRAME_END,
    ]
}
