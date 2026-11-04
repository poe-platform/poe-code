use super::*;
use std::rc::Rc;

struct Length(f64, &'static str);

impl Length {
    fn parse(text: &str) -> Result<Self, &'static str> {
        let bytes = text.as_bytes();
        let mut end = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
        if bytes.get(end) == Some(&b'.') {
            end += 1 + bytes[end + 1..]
                .iter()
                .take_while(|b| b.is_ascii_digit())
                .count();
        }
        let value: f64 = text[..end]
            .parse()
            .ok()
            .filter(|n: &f64| n.is_finite())
            .ok_or("Expected an unsigned finite length")?;
        let (unit, factor) = match text[end..].to_ascii_lowercase().as_str() {
            "" | "mm" | "millimeter" => ("mm", 1.),
            "cm" | "centimeter" => ("mm", 10.),
            "m" | "meter" => ("mm", 1000.),
            "in" | "inch" => ("in", 1.),
            "pt" | "point" => ("pt", 1.),
            "px" | "pixel" => ("px", 1.),
            "pc" | "pica" => ("pc", 1.),
            "didot" => ("didot", 1.),
            "cicero" => ("cicero", 1.),
            _ => return Err("Unknown or overflowing length unit"),
        };
        let n = value * factor;
        if !n.is_finite() {
            return Err("Unknown or overflowing length unit");
        }
        Ok(Self(n, unit))
    }

    fn points(&self, dpi: i32) -> f64 {
        self.0
            * match self.1 {
                "mm" => 72. / 25.4,
                "in" => 72.,
                "px" => 72. / f64::from(dpi),
                "pc" => 12.,
                "didot" => 1.07,
                "cicero" => 12.84,
                _ => 1.,
            }
    }
}

fn integer(text: &str, min: i32) -> Result<i32, &'static str> {
    let s = text.trim();
    let digits = s.strip_prefix(['+', '-']).unwrap_or(s);
    if digits.is_empty() {
        return Err("Expected an integer");
    }
    if !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Expected a decimal integer");
    }
    s.parse()
        .ok()
        .filter(|&n| n >= min)
        .ok_or("Integer is outside the admitted range")
}

#[derive(Clone, Default)]
pub(super) struct Furniture<'a> {
    pub(super) text: [&'a str; 3],
    pub(super) line: bool,
    pub(super) size: Option<i32>,
}

impl Furniture<'_> {
    pub(super) fn has_text(&self) -> bool {
        self.text.iter().any(|text| !text.is_empty())
    }
}

#[derive(Clone, Default)]
pub(super) struct Source<'a> {
    pub(super) path: &'a str,
    pub(super) title: String,
    pub(super) uncounted: bool,
    cover: bool,
    pub(super) links: bool,
    pub(super) outline_depth: usize,
    pub(super) furniture: [Furniture<'a>; 2],
    replacements: Rc<Vec<(&'a str, &'a str)>>,
}

impl Source<'_> {
    pub(super) fn substitute(&self, template: &str, page: i64, total: i64) -> String {
        let mut text = template
            .replace("[page]", &page.to_string())
            .replace("[topage]", &total.to_string())
            .replace("[toPage]", &total.to_string())
            .replace("[webpage]", self.path)
            .replace("[title]", &self.title)
            .replace("[section]", &self.title)
            .replace("[subsection]", "");
        if text.contains("[date]") || text.contains("[isodate]") {
            let days = (crate::vfs::now_ms() / 86_400_000.).floor() as i64;
            let (year, month, day) = crate::commands::coreutils::civil_from_days(days);
            let date = format!("{year:04}-{month:02}-{day:02}");
            text = text.replace("[isodate]", &date).replace("[date]", &date);
        }
        for &(key, value) in self.replacements.iter() {
            if !key.is_empty() {
                text = text.replace(&format!("[{key}]"), value);
            }
        }
        text
    }
}

pub(super) fn wkhtmltopdf(
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    batch_job: bool,
) -> BuiltinOutcome {
    let mut read_jobs = false;
    let mut information = None;
    let mut title_opt: Option<String> = None;
    let (mut pw, mut ph) = (595.28, 841.89);
    let mut landscape = false;
    let mut width = Length(0., "mm");
    let mut height = Length(0., "mm");
    let mut margins = [
        Length(-1., "mm"),
        Length(10., "mm"),
        Length(-1., "mm"),
        Length(10., "mm"),
    ];
    let mut dpi = 96;
    let mut outline = true;
    let mut outline_depth = 4;
    let mut copies: usize = 1;
    let mut collate = true;
    let mut grayscale = false;
    let mut page_offset = 0i32;
    let mut defaults = Source {
        links: true,
        ..Source::default()
    };
    let mut pos_args: Vec<Source> = Vec::new();
    let mut next_is_cover_obj = false;
    let mut next_uncounted = false;
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "--read-args-from-stdin" => {
                read_jobs = true;
                i += 1;
            }
            "-V" | "--version" => {
                information = Some(
                    "wkhtmltopdf safe static adapter (source 024b2b2bb459dd904d15b911d04c6df4ff2c9031; Qt compatibility unqualified)\n",
                );
                i += 1;
            }
            "-h" | "-help" | "--help" => {
                information = Some(
                    "Usage: wkhtmltopdf [options] [page|cover input|toc]... output\nBuilt-in PDF AST static renderer; trusted overrides are optional. Input/output '-' use stdin/stdout.\n",
                );
                i += 1;
            }
            "--title" if i + 1 < args.len() => {
                title_opt = Some(args[i + 1].clone());
                i += 2;
            }
            opt @ ("-s" | "--page-size" | "-O" | "--orientation" | "-T" | "--margin-top" | "-R"
            | "--margin-right" | "-B" | "--margin-bottom" | "-L" | "--margin-left"
            | "--page-width" | "--page-height" | "-d" | "--dpi" | "--copies") => {
                let name = match opt {
                    "-s" => "--page-size",
                    "-O" => "--orientation",
                    "-d" => "--dpi",
                    "-T" => "--margin-top",
                    "-R" => "--margin-right",
                    "-B" => "--margin-bottom",
                    "-L" => "--margin-left",
                    name => name,
                };
                if !pos_args.is_empty() && i + 1 < args.len() {
                    return err_out(
                        &format!(
                            "wkhtmltopdf: OPTION_LOCATION ({name}): Switch is in an incorrect object scope\n"
                        ),
                        1,
                    );
                }
                let Some(value) = args.get(i + 1) else {
                    return err_out(
                        &format!(
                            "wkhtmltopdf: MISSING_OPERAND ({name}): Switch is missing an operand\n"
                        ),
                        1,
                    );
                };
                let invalid = |message: &str| {
                    err_out(
                        &format!("wkhtmltopdf: INVALID_VALUE ({name}): {message}\n"),
                        1,
                    )
                };
                match name {
                    "--page-size" => {
                        (pw, ph) = match value.to_ascii_lowercase().as_str() {
                            "letter" => (612., 792.),
                            "legal" => (612., 1008.),
                            "executive" => (522., 756.),
                            "ledger" | "tabloid" => (792., 1224.),
                            "a3" => (841.89, 1190.55),
                            "a5" => (419.53, 595.28),
                            "b4" => (708.66, 1000.63),
                            "b5" => (498.9, 708.66),
                            "a0" | "a1" | "a2" | "a4" | "a6" | "a7" | "a8" | "a9" | "b0" | "b1"
                            | "b2" | "b3" | "b6" | "b7" | "b8" | "b9" | "b10" | "c5e"
                            | "comm10e" | "dle" | "folio" => (595.28, 841.89),
                            _ => return invalid("Unknown enumerated value"),
                        }
                    }
                    "--orientation" => {
                        landscape = match value.to_ascii_lowercase().as_str() {
                            "landscape" => true,
                            "portrait" => false,
                            _ => return invalid("Unknown enumerated value"),
                        }
                    }
                    "--copies" => {
                        copies = match integer(value, 1) {
                            Ok(n) => n as usize,
                            Err(e) => return invalid(e),
                        }
                    }
                    "--dpi" => {
                        dpi = match integer(value, 1) {
                            Ok(n) => n,
                            Err(e) => return invalid(e),
                        }
                    }
                    _ => {
                        let length = match Length::parse(value) {
                            Ok(n) => n,
                            Err(e) => return invalid(e),
                        };
                        match name {
                            "--page-width" => width = length,
                            "--page-height" => height = length,
                            "--margin-top" => margins[0] = length,
                            "--margin-right" => margins[1] = length,
                            "--margin-bottom" => margins[2] = length,
                            _ => margins[3] = length,
                        }
                    }
                }
                i += 2;
            }
            "--outline-depth" if i + 1 < args.len() => {
                outline_depth = args[i + 1].parse().unwrap_or(4);
                i += 2;
            }
            "--outline" => {
                outline = true;
                i += 1;
            }
            "--no-outline" => {
                outline = false;
                i += 1;
            }
            "--collate" => {
                collate = true;
                i += 1;
            }
            "--no-collate" => {
                collate = false;
                i += 1;
            }
            "--page-offset" if i + 1 < args.len() => {
                page_offset = match integer(&args[i + 1], i32::MIN) {
                    Ok(n) => n,
                    Err(e) => {
                        return err_out(
                            &format!("wkhtmltopdf: INVALID_VALUE (--page-offset): {e}\n"),
                            1,
                        );
                    }
                };
                i += 2;
            }
            opt @ ("--header-left" | "--header-center" | "--header-right" | "--footer-left"
            | "--footer-center" | "--footer-right" | "--header-font-size"
            | "--footer-font-size")
                if i + 1 < args.len() =>
            {
                let source = pos_args.last_mut().unwrap_or(&mut defaults);
                let item = &mut source.furniture[usize::from(opt.starts_with("--footer"))];
                if opt.ends_with("-size") {
                    item.size = match integer(&args[i + 1], 1) {
                        Ok(n) => Some(n),
                        Err(e) => {
                            return err_out(
                                &format!("wkhtmltopdf: INVALID_VALUE ({opt}): {e}\n"),
                                1,
                            );
                        }
                    };
                } else {
                    let slot = if opt.ends_with("-left") {
                        0
                    } else if opt.ends_with("-center") {
                        1
                    } else {
                        2
                    };
                    item.text[slot] = &args[i + 1];
                }
                i += 2;
            }
            opt @ ("--header-line" | "--no-header-line" | "--footer-line" | "--no-footer-line") => {
                pos_args.last_mut().unwrap_or(&mut defaults).furniture
                    [usize::from(opt.contains("footer"))]
                .line = !opt.starts_with("--no-");
                i += 1;
            }
            "--default-header" => {
                let header = &mut pos_args.last_mut().unwrap_or(&mut defaults).furniture[0];
                header.text[0] = "[webpage]";
                header.text[2] = "[page]/[topage]";
                header.line = true;
                margins[0] = Length(20., "mm");
                i += 1;
            }
            "--replace" if i + 2 < args.len() => {
                Rc::make_mut(&mut pos_args.last_mut().unwrap_or(&mut defaults).replacements)
                    .push((&args[i + 1], &args[i + 2]));
                i += 3;
            }
            "--disable-external-links" | "--enable-external-links" => {
                pos_args.last_mut().unwrap_or(&mut defaults).links =
                    args[i] == "--enable-external-links";
                i += 1;
            }
            "-g" | "--grayscale" => {
                if !pos_args.is_empty() {
                    return err_out(
                        "wkhtmltopdf: OPTION_LOCATION (--grayscale): Switch is in an incorrect object scope\n",
                        1,
                    );
                }
                grayscale = true;
                i += 1;
            }
            "-q"
            | "--quiet"
            | "-l"
            | "--lowquality"
            | "-n"
            | "--disable-javascript"
            | "--no-images"
            | "--images"
            | "--no-background"
            | "--background"
            | "--disable-smart-shrinking"
            | "--enable-smart-shrinking"
            | "--print-media-type"
            | "--no-print-media-type"
            | "--disable-internal-links"
            | "--enable-internal-links"
            | "--resolve-relative-links"
            | "--keep-relative-links"
            | "--enable-toc-back-links"
            | "--disable-toc-back-links"
            | "--disable-local-file-access"
            | "--no-pdf-compression"
            | "--disable-plugins" => {
                i += 1;
            }
            "--encoding"
            | "--zoom"
            | "--log-level"
            | "--image-quality"
            | "--image-dpi"
            | "--load-error-handling"
            | "--load-media-error-handling"
            | "--user-style-sheet"
            | "--xsl-style-sheet"
            | "--header-html"
            | "--footer-html"
            | "--header-spacing"
            | "--footer-spacing"
            | "--header-font-name"
            | "--footer-font-name"
            | "--minimum-font-size"
            | "--javascript-delay"
            | "--window-status"
            | "--viewport-size"
            | "--cookie-jar"
                if i + 1 < args.len() =>
            {
                i += 2;
            }
            "toc" => {
                return err_out(
                    "wkhtmltopdf: UNSUPPORTED_CAPABILITY: TOC requires a qualified outline/XSLT engine\n",
                    1,
                );
            }
            "--no-pages-count" => {
                next_uncounted = true;
                i += 1;
            }
            "cover" => {
                next_is_cover_obj = true;
                i += 1;
            }
            "page" => {
                next_uncounted = false;
                next_is_cover_obj = false;
                i += 1;
            }
            a if a == "-" || !a.starts_with('-') => {
                pos_args.push(Source {
                    path: a,
                    uncounted: std::mem::take(&mut next_uncounted),
                    cover: next_is_cover_obj,
                    ..defaults.clone()
                });
                next_is_cover_obj = false;
                i += 1;
            }
            a => {
                return err_out(
                    &format!("wkhtmltopdf: UNKNOWN_OPTION ({a}): Unknown switch\n"),
                    1,
                );
            }
        }
    }
    if let Some(text) = information {
        return if batch_job {
            err_out(
                "wkhtmltopdf: UNSUPPORTED_CAPABILITY: Batch lines must describe conversion jobs\n",
                1,
            )
        } else {
            ok_out(text)
        };
    }
    if read_jobs && !batch_job {
        return run_batch(args, stdin, cwd, fs);
    }
    if pos_args.len() < 2 {
        return err_out(
            "wkhtmltopdf: MISSING_OBJECT: Expected at least one input object and exactly one output\n",
            1,
        );
    }
    if batch_job && pos_args[..pos_args.len() - 1].iter().any(|s| s.path == "-") {
        return err_out(
            "wkhtmltopdf: UNSUPPORTED_CAPABILITY: Batch conversion cannot share stdin with HTML input\n",
            1,
        );
    }
    if margins.iter().any(|l| l.1 != margins[3].1) {
        return err_out(
            "wkhtmltopdf: MARGIN_UNITS: All margins must use the same normalized unit\n",
            1,
        );
    }
    let margins = margins.map(|l| if l.0 < 0. { 36. } else { l.points(dpi) });
    if width.0 > 0. {
        pw = width.points(dpi);
    }
    if height.0 > 0. {
        ph = height.points(dpi);
    }
    if landscape {
        std::mem::swap(&mut pw, &mut ph);
    }
    let mut doc = PdfDoc::new();
    doc.page_w = pw;
    doc.page_h = ph;
    doc.title = title_opt.clone().unwrap_or_default();
    let out_arg = pos_args.pop().unwrap().path;
    let output_version = if out_arg == "-" {None} else {
        match fs.observe_publication(&resolve_posix_path(cwd,out_arg),fs.generation(),false) {
            Ok(stamp)=>Some(stamp),Err(e)=>return err_out(&format!("wkhtmltopdf: {e}\n"),1)
        }
    };
    for source in &mut pos_args {
        let src = source.path;
        let raw_html = if src == "-" {
            Some(stdin.to_owned())
        } else {
            fs.read_file(&resolve_posix_path(cwd, src))
                .ok()
                .map(|b| String::from_utf8_lossy(&b).into_owned())
        };
        let Some(mut raw_html) = raw_html else {
            let full = resolve_posix_path(cwd, src);
            if out_arg == "-" {
                return err_out(
                    &format!(
                        "wkhtmltopdf: ENOENT: ENOENT: no such file or directory, openReadFile '{full}'\n"
                    ),
                    1,
                );
            }
            return err_out(
                &format!(
                    "wkhtmltopdf: ENOENT: ENOENT: no such file or directory, realpath '{full}'\n"
                ),
                1,
            );
        };
        if src.ends_with(".txt") {
            return err_out("wkhtmltopdf: unsupported .txt input\n", 1);
        }
        for &(rk, rv) in source.replacements.iter() {
            if !rk.is_empty() {
                raw_html = raw_html.replace(rk, rv);
            }
        }
        let title = extract_html_title(&raw_html).unwrap_or_default();
        if doc.title.is_empty() {
            doc.title = title.clone();
        }
        source.title = [title_opt.as_deref().unwrap_or(""), &title, &doc.title]
            .into_iter()
            .find(|s| !s.is_empty())
            .unwrap_or("Document")
            .into();
        if source.cover {
            source.furniture = Default::default();
        }
        if outline && !source.cover {
            source.outline_depth = outline_depth;
        }
        doc.pages.push(PdfPage {
            html: raw_html,
            ..PdfPage::default()
        });
    }
    if doc.title.is_empty() {
        doc.title = "Document".into();
    }
    let serialized = match pdf_reader::render_html(
        &doc,
        margins,
        copies,
        collate,
        grayscale,
        &pos_args,
        page_offset,
    ) {
        Ok(Some(pdf)) => pdf,
        Err(message) => return err_out(message, 1),
        Ok(None) => {
            // Preserve the text fallback for documents beyond the DOM nesting limit.
            let mut meta = Vec::new();
            for (page, source) in std::mem::take(&mut doc.pages).into_iter().zip(&pos_args) {
                let dir = if source.path == "-" {
                    cwd.to_owned()
                } else {
                    crate::vfs::dirname_posix_path(&resolve_posix_path(cwd, source.path))
                };
                for html in split_html_pages(&page.html) {
                    if outline && !source.cover {
                        for (title, level) in extract_html_headings(&html) {
                            doc.bookmarks
                                .push((title, level, (doc.pages.len() + 1).to_string()));
                        }
                    }
                    doc.pages.push(PdfPage {
                        rot: 0,
                        text: strip_html_tags(&html),
                        images: extract_html_images(&html, &dir, fs),
                        urls: extract_html_urls(&html),
                        html,
                    });
                    meta.push(source);
                }
            }
            let total =
                meta.iter().filter(|s| !s.uncounted).count() as i64 + i64::from(page_offset);
            let mut number = 1 + i64::from(page_offset);
            for (page, source) in doc.pages.iter_mut().zip(meta) {
                let parts = source.furniture.each_ref().map(|f| {
                    f.text
                        .iter()
                        .filter(|t| !t.is_empty())
                        .map(|t| source.substitute(t, number, total))
                        .collect::<Vec<_>>()
                        .join(" ")
                });
                if !parts[0].is_empty() {
                    page.text = format!("{}\n{}", parts[0], page.text);
                }
                if !parts[1].is_empty() {
                    page.text = format!("{}\n{}", page.text, parts[1]);
                }
                if !source.uncounted {
                    number += 1;
                }
            }
            doc.info
                .push(("Creator".into(), "wkhtmltopdf (pdf-ast-static)".into()));
            doc.info
                .push(("Producer".into(), "@poe-code/pdf-ast".into()));
            let Some(pdf) = doc.serialize_with_copies(
                copies,
                collate,
                crate::budget::ShellLimits::default().max_output_bytes,
            ) else {
                return err_out("wkhtmltopdf: PDF output exceeds resource limits\n", 1);
            };
            pdf
        }
    };
    if out_arg == "-" {
        return ok_out(&crate::vfs::bytes_to_stream_string(&serialized));
    }
    let dst = resolve_posix_path(cwd, out_arg);
    let inputs = pos_args
        .iter()
        .filter(|s| s.path != "-")
        .map(|s| resolve_posix_path(cwd, s.path))
        .collect::<Vec<_>>();
    if let Err(message) = fs.publish_file(&dst, &serialized, &inputs, output_version.as_ref().unwrap().version) {
        return err_out(&format!("wkhtmltopdf: {message}\n"), 1);
    }
    ok_out("")
}

fn run_batch(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let bytes = crate::vfs::stream_string_to_bytes(stdin);
    let Ok(jobs) = std::str::from_utf8(&bytes) else {
        return err_out(
            "wkhtmltopdf: INVALID_VALUE: Batch input must be valid UTF-8\n",
            1,
        );
    };
    let mut result = ok_out("");
    let mut remaining = crate::budget::ShellLimits::default().max_output_bytes;
    for line in jobs.split_terminator('\n') {
        let mut argv = args.to_vec();
        let mut token = String::new();
        let mut quote = None;
        let mut escaped = false;
        for c in line.chars() {
            if escaped {
                token.push(c);
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if let Some(q) = quote {
                if c == q {
                    quote = None;
                } else {
                    token.push(c);
                }
            } else if c == '\'' || c == '"' {
                quote = Some(c);
            } else if matches!(c, ' ' | '\t' | '\r') {
                if !token.is_empty() {
                    argv.push(std::mem::take(&mut token));
                }
            } else {
                token.push(c);
            }
        }
        if !token.is_empty() {
            argv.push(token);
        }
        let job = wkhtmltopdf(&argv, "", cwd, fs, true);
        let bytes: usize = job
            .stdout
            .chars()
            .map(|c| {
                if ('\u{e080}'..='\u{e0ff}').contains(&c) {
                    1
                } else {
                    c.len_utf8()
                }
            })
            .sum();
        let Some(left) = remaining.checked_sub(bytes) else {
            result.exit_code = 1;
            result
                .stderr
                .push_str("wkhtmltopdf: LIMIT_EXCEEDED: PDF output stage limit exceeded\n");
            break;
        };
        remaining = left;
        result.stdout.push_str(&job.stdout);
        result.stderr.push_str(&job.stderr);
        result.exit_code = job.exit_code;
        if result.exit_code != 0 {
            break;
        }
    }
    result
}
