pub const HELP: &str = "Usage: tesseract INPUT OUTPUTBASE [options] [txt|tsv|hocr]\n\nRecognize text using the original Tesseract engine.\nUse stdin for INPUT and stdout or - for OUTPUTBASE to pipe bytes.\n\n  -l LANG             Language (default: eng)\n  --tessdata-dir DIR  Read LANG.traineddata from this directory\n  --psm MODE          Page segmentation mode (default: 3)\n  --dpi DPI           Image resolution (default: 300)\n  --list-langs        List bundled languages\n  --version          Show the Tesseract engine version\n  --help             Show this help\n\nEnglish is bundled. Additional languages require model files.\nTSV and hOCR include block, line, and word positions.\n";

#[derive(Debug)]
pub enum Action {
    Help,
    Version,
    Languages,
    Recognize(Request),
}

#[derive(Debug)]
pub struct Request {
    pub input: String,
    pub output: String,
    pub language: String,
    pub tessdata_dir: Option<String>,
    pub psm: u32,
    pub dpi: u32,
    pub format: String,
}

pub fn parse_tesseract(args: &[String]) -> Result<Action, String> {
    if args.len() == 1 {
        match args[0].as_str() {
            "--help" | "-h" => return Ok(Action::Help),
            "--version" | "-v" => return Ok(Action::Version),
            "--list-langs" => return Ok(Action::Languages),
            _ => {}
        }
    }
    let mut request = Request {
        input: String::new(),
        output: String::new(),
        language: "eng".into(),
        tessdata_dir: None,
        psm: 3,
        dpi: 300,
        format: "txt".into(),
    };
    let mut positionals = Vec::new();
    let mut options = true;
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if options && arg == "--" {
            options = false;
            i += 1;
            continue;
        }
        if options && matches!(arg, "-l" | "--psm" | "--dpi" | "--tessdata-dir") {
            i += 1;
            let value = args
                .get(i)
                .ok_or_else(|| format!("{arg} requires a value"))?;
            match arg {
                "-l" => request.language = value.clone(),
                "--tessdata-dir" => request.tessdata_dir = Some(value.clone()),
                "--psm" => {
                    request.psm = value
                        .parse()
                        .map_err(|_| "Invalid page segmentation mode")?
                }
                "--dpi" => request.dpi = value.parse().map_err(|_| "Invalid DPI")?,
                _ => unreachable!(),
            }
        } else if options && arg.starts_with('-') && arg != "-" {
            return Err(format!("Unsupported tesseract option: {arg}"));
        } else {
            positionals.push(arg);
        }
        i += 1;
    }
    if !(2..=3).contains(&positionals.len()) {
        return Err("Expected INPUT OUTPUTBASE and at most one output format".into());
    }
    request.input = positionals[0].into();
    request.output = positionals[1].into();
    if let Some(format) = positionals.get(2) {
        if !matches!(*format, "txt" | "tsv" | "hocr") {
            return Err(format!("Unsupported tesseract output format: {format}"));
        }
        request.format = (*format).into();
    }
    if request.psm > 13 || matches!(request.psm, 0 | 1 | 2 | 12) {
        return Err("Supported page segmentation modes are 3–11 and 13".into());
    }
    if !(70..=2400).contains(&request.dpi) {
        return Err("DPI must be between 70 and 2400".into());
    }
    if request.language.is_empty()
        || !request
            .language
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err("Expected a single language identifier".into());
    }
    Ok(Action::Recognize(request))
}

pub const PDF_HELP: &str = "Usage: ocrmypdf [options] INPUT.pdf OUTPUT.pdf\n\nAdd searchable text to scanned PDF pages using Rust and Tesseract.\nUse - for stdin or stdout. Existing text is rejected unless --skip-text.\n\n  -l, --language LANG Language (default: eng)\n  --tessdata-dir DIR   Read LANG.traineddata from this directory\n  --skip-text          Preserve pages that already contain text\n  --sidecar FILE       Write recognized text separately\n  --oversample DPI     Rasterization resolution, 70–600 (default: 300)\n  --output-type pdf    Only standard PDF output is supported\n  --version           Show engine version\n  --help              Show this help\n\nThis is a focused Rust implementation, not the Python OCRmyPDF package.\nPDF/A, deskew, force-ocr and image optimization are not supported.\n";

#[derive(Debug)]
pub enum PdfAction {
    Help,
    Version,
    Recognize(PdfRequest),
}

#[derive(Debug)]
pub struct PdfRequest {
    pub input: String,
    pub output: String,
    pub language: String,
    pub tessdata_dir: Option<String>,
    pub dpi: u32,
    pub skip_text: bool,
    pub sidecar: Option<String>,
}

pub fn parse_ocrmypdf(args: &[String]) -> Result<PdfAction, String> {
    if args.len() == 1 {
        match args[0].as_str() {
            "--help" | "-h" => return Ok(PdfAction::Help),
            "--version" => return Ok(PdfAction::Version),
            _ => {}
        }
    }
    let mut request = PdfRequest {
        input: String::new(),
        output: String::new(),
        language: "eng".into(),
        tessdata_dir: None,
        dpi: 300,
        skip_text: false,
        sidecar: None,
    };
    let mut positional = Vec::new();
    let mut options = true;
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if options && arg == "--" {
            options = false;
        } else if options && arg == "--skip-text" {
            request.skip_text = true;
        } else if options
            && matches!(
                arg,
                "-l" | "--language"
                    | "--tessdata-dir"
                    | "--sidecar"
                    | "--oversample"
                    | "--output-type"
            )
        {
            i += 1;
            let value = args
                .get(i)
                .ok_or_else(|| format!("{arg} requires a value"))?;
            match arg {
                "-l" | "--language" => request.language = value.clone(),
                "--tessdata-dir" => request.tessdata_dir = Some(value.clone()),
                "--sidecar" => request.sidecar = Some(value.clone()),
                "--oversample" => request.dpi = value.parse().map_err(|_| "Invalid DPI")?,
                "--output-type" if value != "pdf" => {
                    return Err("Only --output-type pdf is supported".into());
                }
                _ => {}
            }
        } else if options && arg.starts_with('-') && arg != "-" {
            return Err(format!("Unsupported ocrmypdf option: {arg}"));
        } else {
            positional.push(arg);
        }
        i += 1;
    }
    if positional.len() != 2 {
        return Err("Expected INPUT.pdf OUTPUT.pdf".into());
    }
    request.input = positional[0].into();
    request.output = positional[1].into();
    if !(70..=600).contains(&request.dpi) {
        return Err("PDF DPI must be between 70 and 600".into());
    }
    if request.language.is_empty()
        || !request
            .language
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err("Expected a single language identifier".into());
    }
    if request
        .sidecar
        .as_ref()
        .is_some_and(|path| path == &request.output || path == &request.input)
    {
        return Err("Sidecar must differ from input and PDF output".into());
    }
    Ok(PdfAction::Recognize(request))
}
