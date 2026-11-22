//! Optional Rust OCR engine. Models and images enter as bytes; no host file or network access.
use image::ImageReader;
use kreuzberg_tesseract::{TessPageSegMode, TesseractAPI};
use std::{
    ffi::{CString, c_void},
    io::Cursor,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

pub mod cli;
#[cfg(feature = "pdf")]
pub mod pdf;

pub const ENGLISH: &[u8] = include_bytes!("../assets/eng.traineddata");

#[derive(Clone, Copy)]
pub struct Model<'a> {
    pub language: &'a str,
    pub data: &'a [u8],
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_input_bytes: usize,
    pub max_model_bytes: usize,
    pub max_pixels: usize,
    pub max_output_bytes: usize,
    pub timeout_ms: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_bytes: 64 << 20,
            max_model_bytes: 64 << 20,
            max_pixels: 40_000_000,
            max_output_bytes: 16 << 20,
            timeout_ms: 30_000,
        }
    }
}

pub struct Options<'a> {
    pub model: Model<'a>,
    pub psm: u32,
    pub dpi: u32,
    pub limits: Limits,
    pub cancellation: Option<&'a AtomicBool>,
}

impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            model: Model {
                language: "eng",
                data: ENGLISH,
            },
            psm: 3,
            dpi: 300,
            limits: Limits::default(),
            cancellation: None,
        }
    }
}

#[derive(Debug)]
pub struct Recognition {
    pub text: String,
    pub tsv: String,
    pub hocr: String,
    pub width: u32,
    pub height: u32,
    pub confidence: i32,
}

pub fn version() -> String {
    TesseractAPI::version()
}

pub fn recognize(bytes: &[u8], options: &Options<'_>) -> Result<Recognition, String> {
    validate_options(options)?;
    let started = Instant::now();
    let limits = options.limits;
    if bytes.len() > limits.max_input_bytes {
        return Err("OCR input byte limit exceeded".into());
    }
    let language = options.model.language;
    let image_error = |error: image::ImageError| format!("Invalid OCR image: {error}");
    let reader = || {
        ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| e.to_string())
    };
    let (width, height) = reader()?.into_dimensions().map_err(image_error)?;
    let pixels = u64::from(width) * u64::from(height);
    if pixels == 0
        || pixels > limits.max_pixels as u64
        || width > i32::MAX as u32 / 3
        || height > i32::MAX as u32
    {
        return Err("OCR pixel limit exceeded".into());
    }
    let mut decoder = reader()?;
    let mut decode_limits = image::Limits::default();
    decode_limits.max_alloc = Some((limits.max_pixels as u64).saturating_mul(8));
    decode_limits.max_image_width = Some(width);
    decode_limits.max_image_height = Some(height);
    decoder.limits(decode_limits);
    let mut rgba = decoder.decode().map_err(image_error)?.to_rgba8();
    // Composite transparency onto white so transparent document backgrounds remain readable.
    for pixel in rgba.pixels_mut() {
        let alpha = u32::from(pixel[3]);
        for channel in &mut pixel.0[..3] {
            *channel = ((u32::from(*channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        }
        pixel[3] = 255;
    }
    let rgb = image::DynamicImage::ImageRgba8(rgba).into_rgb8();
    remaining_time(options, started)?;
    let engine = TesseractAPI::new().map_err(|e| e.to_string())?;
    let language_name = CString::new(language).map_err(|e| e.to_string())?;
    let handle = engine
        .handle
        .lock()
        .map_err(|_| "OCR engine lock poisoned")?;
    // The pinned upstream C++ API supplies a denying FileReader, absent from the C API.
    let status = unsafe {
        PoeTesseractInit(
            *handle,
            options.model.data.as_ptr(),
            options.model.data.len() as i32,
            language_name.as_ptr(),
        )
    };
    drop(handle);
    if status != 0 {
        return Err(format!("Could not initialize OCR model '{language}'"));
    }
    engine
        .set_page_seg_mode(TessPageSegMode::from_int(options.psm as i32))
        .map_err(|e| e.to_string())?;
    engine
        .set_image(
            rgb.as_raw(),
            width as i32,
            height as i32,
            3,
            width as i32 * 3,
        )
        .map_err(|e| e.to_string())?;
    engine
        .set_source_resolution(options.dpi as i32)
        .map_err(|e| e.to_string())?;
    let monitor = Monitor::new(options, remaining_time(options, started)?)?;
    let handle = engine
        .handle
        .lock()
        .map_err(|_| "OCR engine lock poisoned")?;
    // The engine and monitor live through this synchronous call; the borrowed cancellation flag
    // remains valid until recognition returns. Tesseract calls the callback only during recognition.
    let status = unsafe { TessBaseAPIRecognize(*handle, monitor.0) };
    drop(handle);
    if options
        .cancellation
        .is_some_and(|c| c.load(Ordering::Relaxed))
    {
        return Err("OCR cancelled".into());
    }
    if status != 0 {
        return Err("OCR recognition failed or exceeded its deadline".into());
    }
    let text = engine.get_utf8_text().map_err(|e| e.to_string())?;
    let tsv = format!(
        "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n{}",
        engine.get_tsv_text(0).map_err(|e| e.to_string())?
    );
    let hocr = engine.get_hocr_text(0).map_err(|e| e.to_string())?;
    remaining_time(options, started)?;
    if text
        .len()
        .saturating_add(tsv.len())
        .saturating_add(hocr.len())
        > limits.max_output_bytes
    {
        return Err("OCR output byte limit exceeded".into());
    }
    Ok(Recognition {
        text,
        tsv,
        hocr,
        width,
        height,
        confidence: engine.mean_text_conf().map_err(|e| e.to_string())?,
    })
}

fn remaining_time(options: &Options<'_>, started: Instant) -> Result<u32, String> {
    if options
        .cancellation
        .is_some_and(|c| c.load(Ordering::Relaxed))
    {
        return Err("OCR cancelled".into());
    }
    let elapsed = started.elapsed().as_millis();
    if elapsed >= u128::from(options.limits.timeout_ms) {
        return Err("OCR recognition exceeded its deadline".into());
    }
    Ok(options.limits.timeout_ms - elapsed as u32)
}

fn validate_options(options: &Options<'_>) -> Result<(), String> {
    let limits = options.limits;
    if [
        limits.max_input_bytes,
        limits.max_model_bytes,
        limits.max_pixels,
        limits.max_output_bytes,
    ]
    .contains(&0)
        || limits.timeout_ms == 0
        || limits.timeout_ms > i32::MAX as u32
    {
        return Err("OCR limits must be positive and timeout must fit in signed 32 bits".into());
    }
    if options
        .cancellation
        .is_some_and(|c| c.load(Ordering::Relaxed))
    {
        return Err("OCR cancelled".into());
    }
    if options.model.data.len() > limits.max_model_bytes
        || options.model.data.len() > i32::MAX as usize
    {
        return Err("OCR model byte limit exceeded".into());
    }
    validate_model(options.model.data)?;
    let language = options.model.language;
    if language.is_empty()
        || !language
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err("Expected a single Tesseract language identifier".into());
    }
    if options.psm > 13 || matches!(options.psm, 0 | 1 | 2 | 12) {
        return Err("Supported page segmentation modes are 3–11 and 13; orientation detection requires a separate OSD model".into());
    }
    if !(70..=2400).contains(&options.dpi) {
        return Err("OCR DPI must be between 70 and 2400".into());
    }
    Ok(())
}

fn validate_model(data: &[u8]) -> Result<(), String> {
    let invalid = "Invalid Tesseract model component table";
    let header: [u8; 4] = data.get(..4).ok_or(invalid)?.try_into().unwrap();
    let swapped = u32::from_le_bytes(header) > 1000;
    let count = if swapped {
        u32::from_be_bytes(header)
    } else {
        u32::from_le_bytes(header)
    } as usize;
    if count == 0 || count > 1000 {
        return Err(invalid.into());
    }
    let header_size = 4 + count * 8;
    let table = data.get(4..header_size).ok_or(invalid)?;
    let mut offsets = Vec::with_capacity(count);
    let mut previous = None;
    for &bytes in table.as_chunks::<8>().0 {
        let offset = if swapped {
            i64::from_be_bytes(bytes)
        } else {
            i64::from_le_bytes(bytes)
        };
        if offset == -1 {
            offsets.push(None);
            continue;
        }
        let offset = usize::try_from(offset).map_err(|_| invalid)?;
        if offset >= data.len() || previous.map_or(offset != header_size, |p| offset <= p) {
            return Err(invalid.into());
        }
        previous = Some(offset);
        offsets.push(Some(offset));
    }
    if previous.is_none() {
        return Err(invalid.into());
    }
    // Upstream loads this component without its non-debug constraint, and some
    // parameters write host files during Init. Admit only the spacing setting
    // used by official Chinese and Korean models, before invoking native code.
    if let Some(start) = offsets[0] {
        let end = offsets
            .iter()
            .skip(1)
            .flatten()
            .copied()
            .next()
            .unwrap_or(data.len());
        let config = std::str::from_utf8(&data[start..end])
            .map_err(|_| "Invalid Tesseract model configuration")?;
        for line in config.lines() {
            // Bound comment lines too: native FGets splits overlong lines and
            // could interpret the tail of a comment as another parameter.
            if line.len() > 128 || line.bytes().any(|b| b < 32 && b != b'\t') {
                return Err("Invalid Tesseract model configuration".into());
            }
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let fields: Vec<_> = line.split_ascii_whitespace().collect();
            if !matches!(fields.as_slice(), ["preserve_interword_spaces", "0" | "1"])
                || line.as_bytes().first().is_some_and(u8::is_ascii_whitespace)
            {
                return Err("Unsupported Tesseract model configuration; only preserve_interword_spaces is allowed".into());
            }
        }
    }
    Ok(())
}

unsafe extern "C-unwind" {
    fn PoeTesseractInit(
        handle: *mut c_void,
        data: *const u8,
        size: i32,
        language: *const std::ffi::c_char,
    ) -> i32;
    fn TessBaseAPIRecognize(handle: *mut c_void, monitor: *mut c_void) -> i32;
    fn TessMonitorCreate() -> *mut c_void;
    fn TessMonitorDelete(monitor: *mut c_void);
    fn TessMonitorSetDeadlineMSecs(monitor: *mut c_void, deadline: i32);
    fn TessMonitorSetCancelThis(monitor: *mut c_void, data: *mut c_void);
    fn TessMonitorSetCancelFunc(
        monitor: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, i32) -> bool,
    );
}

struct Monitor(*mut c_void);
impl Monitor {
    fn new(options: &Options<'_>, timeout_ms: u32) -> Result<Self, String> {
        // The C API allocates the monitor, and Drop releases exactly this allocation.
        let monitor = Self(unsafe { TessMonitorCreate() });
        if monitor.0.is_null() {
            return Err("Could not allocate OCR monitor".into());
        }
        unsafe {
            TessMonitorSetDeadlineMSecs(monitor.0, timeout_ms as i32);
            if let Some(cancel) = options.cancellation {
                TessMonitorSetCancelThis(monitor.0, std::ptr::from_ref(cancel).cast_mut().cast());
                TessMonitorSetCancelFunc(monitor.0, cancelled);
            }
        }
        Ok(monitor)
    }
}
impl Drop for Monitor {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { TessMonitorDelete(self.0) };
        }
    }
}
unsafe extern "C" fn cancelled(data: *mut c_void, _words: i32) -> bool {
    // Installed only with a live AtomicBool by Monitor::new.
    unsafe { &*data.cast::<AtomicBool>() }.load(Ordering::Relaxed)
}
