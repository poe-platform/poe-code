use napi::{Task, bindgen_prelude::*};
use napi_derive::napi;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[napi]
#[derive(Default)]
pub struct Cancellation(Arc<AtomicBool>);

#[napi]
impl Cancellation {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
    #[napi]
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

#[napi(object)]
pub struct OcrLimits {
    pub max_input_bytes: Option<u32>,
    pub max_model_bytes: Option<u32>,
    pub max_pixels: Option<u32>,
    pub max_output_bytes: Option<u32>,
    pub timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct OcrOptions {
    pub language: Option<String>,
    pub model: Option<Uint8Array>,
    pub psm: Option<u32>,
    pub dpi: Option<u32>,
    pub limits: Option<OcrLimits>,
}

#[napi(object)]
pub struct OcrResult {
    pub text: String,
    pub tsv: String,
    pub hocr: String,
    pub width: u32,
    pub height: u32,
    pub confidence: i32,
}

pub struct RecognizeTask {
    image: Vec<u8>,
    model: Option<Vec<u8>>,
    language: String,
    psm: u32,
    dpi: u32,
    limits: poe_tesseract::Limits,
    cancellation: Arc<AtomicBool>,
}

impl Task for RecognizeTask {
    type Output = poe_tesseract::Recognition;
    type JsValue = OcrResult;
    fn compute(&mut self) -> Result<Self::Output> {
        poe_tesseract::recognize(
            &self.image,
            &poe_tesseract::Options {
                model: poe_tesseract::Model {
                    language: &self.language,
                    data: self.model.as_deref().unwrap_or(poe_tesseract::ENGLISH),
                },
                psm: self.psm,
                dpi: self.dpi,
                limits: self.limits,
                cancellation: Some(&self.cancellation),
            },
        )
        .map_err(Error::from_reason)
    }
    fn resolve(&mut self, _env: Env, result: Self::Output) -> Result<Self::JsValue> {
        Ok(OcrResult {
            text: result.text,
            tsv: result.tsv,
            hocr: result.hocr,
            width: result.width,
            height: result.height,
            confidence: result.confidence,
        })
    }
}

#[napi]
pub fn recognize(
    image: Uint8Array,
    options: OcrOptions,
    cancellation: &Cancellation,
) -> Result<AsyncTask<RecognizeTask>> {
    Ok(AsyncTask::new(RecognizeTask::new(
        image,
        options,
        cancellation,
    )?))
}

impl RecognizeTask {
    fn new(image: Uint8Array, options: OcrOptions, cancellation: &Cancellation) -> Result<Self> {
        let mut limits = poe_tesseract::Limits::default();
        if let Some(input) = options.limits {
            if let Some(value) = input.max_input_bytes {
                limits.max_input_bytes = value as usize;
            }
            if let Some(value) = input.max_model_bytes {
                limits.max_model_bytes = value as usize;
            }
            if let Some(value) = input.max_pixels {
                limits.max_pixels = value as usize;
            }
            if let Some(value) = input.max_output_bytes {
                limits.max_output_bytes = value as usize;
            }
            if let Some(value) = input.timeout_ms {
                limits.timeout_ms = value;
            }
        }
        let language = options.language.unwrap_or_else(|| "eng".into());
        if language != "eng" && options.model.is_none() {
            return Err(Error::from_reason(
                "Additional languages require model bytes",
            ));
        }
        if image.len() > limits.max_input_bytes {
            return Err(Error::from_reason("OCR input byte limit exceeded"));
        }
        if options
            .model
            .as_ref()
            .is_some_and(|model| model.len() > limits.max_model_bytes)
        {
            return Err(Error::from_reason("OCR model byte limit exceeded"));
        }
        Ok(RecognizeTask {
            image: image.to_vec(),
            model: options.model.map(|model| model.to_vec()),
            language,
            psm: options.psm.unwrap_or(3),
            dpi: options.dpi.unwrap_or(300),
            limits,
            cancellation: cancellation.0.clone(),
        })
    }
}

#[napi(object)]
pub struct PdfResult {
    pub pdf: Buffer,
    pub text: String,
    pub pages: u32,
}

pub struct PdfTask {
    input: RecognizeTask,
    options: poe_tesseract::pdf::PdfOptions,
}

impl Task for PdfTask {
    type Output = poe_tesseract::pdf::PdfRecognition;
    type JsValue = PdfResult;
    fn compute(&mut self) -> Result<Self::Output> {
        let input = &self.input;
        poe_tesseract::pdf::recognize_pdf(
            &input.image,
            &poe_tesseract::Options {
                model: poe_tesseract::Model {
                    language: &input.language,
                    data: input.model.as_deref().unwrap_or(poe_tesseract::ENGLISH),
                },
                psm: input.psm,
                dpi: input.dpi,
                limits: input.limits,
                cancellation: Some(&input.cancellation),
            },
            &self.options,
        )
        .map_err(Error::from_reason)
    }
    fn resolve(&mut self, _env: Env, result: Self::Output) -> Result<Self::JsValue> {
        Ok(PdfResult {
            pdf: result.pdf.into(),
            text: result.text,
            pages: result.pages as u32,
        })
    }
}

#[napi]
pub fn recognize_pdf(
    image: Uint8Array,
    options: OcrOptions,
    skip_text: bool,
    max_pages: u32,
    cancellation: &Cancellation,
) -> Result<AsyncTask<PdfTask>> {
    Ok(AsyncTask::new(PdfTask {
        input: RecognizeTask::new(image, options, cancellation)?,
        options: poe_tesseract::pdf::PdfOptions {
            skip_text,
            max_pages: max_pages as usize,
        },
    }))
}

#[napi(object)]
pub struct TesseractRequest {
    pub input: String,
    pub output: Option<String>,
    pub model_path: Option<String>,
    pub language: String,
    pub psm: u32,
    pub dpi: u32,
    pub format: String,
}

#[napi]
pub fn parse_tesseract(args: Vec<String>) -> Result<Either<String, TesseractRequest>> {
    use poe_tesseract::cli::Action;
    match poe_tesseract::cli::parse_tesseract(&args).map_err(Error::from_reason)? {
        Action::Help => Ok(Either::A(poe_tesseract::cli::HELP.into())),
        Action::Version => Ok(Either::A(format!(
            "tesseract {}\n",
            poe_tesseract::version()
        ))),
        Action::Languages => Ok(Either::A("List of bundled languages (1):\neng\n".into())),
        Action::Recognize(request) => {
            let model_path = request
                .tessdata_dir
                .map(|dir| format!("{dir}/{}.traineddata", request.language));
            let output = if matches!(request.output.as_str(), "stdout" | "-") {
                None
            } else {
                Some(format!("{}.{}", request.output, request.format))
            };
            Ok(Either::B(TesseractRequest {
                input: request.input,
                output,
                model_path,
                language: request.language,
                psm: request.psm,
                dpi: request.dpi,
                format: request.format,
            }))
        }
    }
}

#[napi(object)]
pub struct OcrMyPdfRequest {
    pub input: String,
    pub output: Option<String>,
    pub model_path: Option<String>,
    pub language: String,
    pub dpi: u32,
    pub skip_text: bool,
    pub sidecar: Option<String>,
}

#[napi]
pub fn parse_ocrmypdf(args: Vec<String>) -> Result<Either<String, OcrMyPdfRequest>> {
    use poe_tesseract::cli::PdfAction;
    match poe_tesseract::cli::parse_ocrmypdf(&args).map_err(Error::from_reason)? {
        PdfAction::Help => Ok(Either::A(poe_tesseract::cli::PDF_HELP.into())),
        PdfAction::Version => Ok(Either::A(format!(
            "poe ocrmypdf (Tesseract {})\n",
            poe_tesseract::version()
        ))),
        PdfAction::Recognize(request) => Ok(Either::B(OcrMyPdfRequest {
            model_path: request
                .tessdata_dir
                .map(|dir| format!("{dir}/{}.traineddata", request.language)),
            input: request.input,
            output: if request.output == "-" {
                None
            } else {
                Some(request.output)
            },
            language: request.language,
            dpi: request.dpi,
            skip_text: request.skip_text,
            sidecar: request.sidecar,
        })),
    }
}
