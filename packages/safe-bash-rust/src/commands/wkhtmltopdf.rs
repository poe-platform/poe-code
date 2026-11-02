use super::*;

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
    let mut page_offset: i64 = 0;
    let mut hdr_left = String::new();
    let mut hdr_center = String::new();
    let mut hdr_right = String::new();
    let mut ftr_left = String::new();
    let mut ftr_center = String::new();
    let mut ftr_right = String::new();
    let mut replacements: Vec<(String, String)> = Vec::new();
    struct Source {
        path: String,
        uncounted: bool,
        cover: bool,
        links: bool,
    }
    let mut links = true;
    let mut pos_args: Vec<Source> = Vec::new();
    let mut next_is_cover = false;
    let mut next_is_cover_obj = false;
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
                page_offset = args[i + 1].parse().unwrap_or(0);
                i += 2;
            }
            "--header-left" if i + 1 < args.len() => {
                hdr_left = args[i + 1].clone();
                i += 2;
            }
            "--header-center" if i + 1 < args.len() => {
                hdr_center = args[i + 1].clone();
                i += 2;
            }
            "--header-right" if i + 1 < args.len() => {
                hdr_right = args[i + 1].clone();
                i += 2;
            }
            "--footer-left" if i + 1 < args.len() => {
                ftr_left = args[i + 1].clone();
                i += 2;
            }
            "--footer-center" if i + 1 < args.len() => {
                ftr_center = args[i + 1].clone();
                i += 2;
            }
            "--footer-right" if i + 1 < args.len() => {
                ftr_right = args[i + 1].clone();
                i += 2;
            }
            "--replace" if i + 2 < args.len() => {
                replacements.push((args[i + 1].clone(), args[i + 2].clone()));
                i += 3;
            }
            "--disable-external-links" | "--enable-external-links" => {
                let enabled = args[i] == "--enable-external-links";
                if let Some(source) = pos_args.last_mut() {
                    source.links = enabled;
                } else {
                    links = enabled;
                }
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
            | "--disable-plugins"
            | "--header-line"
            | "--no-header-line"
            | "--footer-line"
            | "--no-footer-line"
            | "--default-header" => {
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
            | "--header-font-size"
            | "--footer-font-size"
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
                next_is_cover = true;
                i += 1;
            }
            "cover" => {
                next_is_cover_obj = true;
                i += 1;
            }
            "page" => {
                next_is_cover = false;
                next_is_cover_obj = false;
                i += 1;
            }
            a if a == "-" || !a.starts_with('-') => {
                pos_args.push(Source {
                    path: a.to_string(),
                    uncounted: next_is_cover,
                    cover: next_is_cover_obj,
                    links,
                });
                next_is_cover = false;
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
    let mut all_headings: Vec<(String, String, usize)> = Vec::new();
    let mut page_meta = Vec::new();
    let output_version = fs.generation();
    let out_arg = &pos_args.last().unwrap().path;
    for source in &pos_args[..pos_args.len() - 1] {
        let src = &source.path;
        let raw_and_dir = if src == "-" {
            Some((stdin.to_string(), cwd.to_string()))
        } else {
            let full = resolve_posix_path(cwd, src);
            fs.read_file(&full).ok().map(|b| {
                let bd = full
                    .rsplit_once('/')
                    .map(|(d, _)| if d.is_empty() { "/" } else { d })
                    .unwrap_or(cwd)
                    .to_string();
                (String::from_utf8_lossy(&b).to_string(), bd)
            })
        };
        let Some((mut raw_html, base_dir_str)) = raw_and_dir else {
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
        for (rk, rv) in &replacements {
            if !rk.is_empty() {
                raw_html = raw_html.replace(rk, rv);
            }
        }
        let base_dir = base_dir_str.as_str();
        if doc.title.is_empty()
            && let Some(t) = extract_html_title(&raw_html)
        {
            doc.title = t;
        }
        for page_html in split_html_pages(&raw_html) {
            let page_num = doc.pages.len() + 1;
            if !source.cover {
                for (ht, hl) in extract_html_headings(&page_html) {
                    all_headings.push((ht, hl, page_num));
                }
            }
            let text = strip_html_tags(&page_html);
            let images = extract_html_images(&page_html, base_dir, fs);
            let urls = extract_html_urls(&page_html);
            doc.pages.push(PdfPage {
                rot: 0,
                text,
                html: page_html,
                images,
                urls,
            });
            page_meta.push(source);
        }
    }
    if let Some(t) = title_opt {
        doc.title = t;
    }
    if doc.title.is_empty() {
        doc.title = "Document".to_string();
    }
    let counted_total = page_meta.iter().filter(|s| !s.uncounted).count() as i64;
    let topage_val = counted_total + page_offset;
    let mut logical_page = 1 + page_offset;
    let sub_tokens = |tmpl: &str, pno: i64, webpage: &str, title: &str| -> String {
        let mut out = tmpl
            .replace("[page]", &pno.to_string())
            .replace("[topage]", &topage_val.to_string())
            .replace("[toPage]", &topage_val.to_string())
            .replace("[webpage]", webpage)
            .replace("[title]", title);
        for (rk, rv) in &replacements {
            out = out.replace(&format!("[{rk}]"), rv);
        }
        out
    };
    for (idx, pg) in doc.pages.iter_mut().enumerate() {
        let source = page_meta[idx];
        let wp = &source.path;
        let cur_pno = logical_page;
        if !source.uncounted {
            logical_page += 1;
        }
        if !source.cover {
            let mut hdr_parts = Vec::new();
            for t in [&hdr_left, &hdr_center, &hdr_right] {
                if !t.is_empty() {
                    hdr_parts.push(sub_tokens(t, cur_pno, wp, &doc.title));
                }
            }
            let mut ftr_parts = Vec::new();
            for t in [&ftr_left, &ftr_center, &ftr_right] {
                if !t.is_empty() {
                    ftr_parts.push(sub_tokens(t, cur_pno, wp, &doc.title));
                }
            }
            if !hdr_parts.is_empty() {
                pg.text = format!("{}\n{}", hdr_parts.join(" "), pg.text);
            }
            if !ftr_parts.is_empty() {
                pg.text = format!("{}\n{}", pg.text, ftr_parts.join(" "));
            }
        }
    }
    if outline {
        for (ht, hl, pno) in &all_headings {
            doc.bookmarks
                .push((ht.clone(), hl.clone(), pno.to_string()));
        }
    }
    if !doc
        .info
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("Creator"))
    {
        doc.info.push((
            "Creator".to_string(),
            "wkhtmltopdf (pdf-ast-static)".to_string(),
        ));
    }
    if !doc
        .info
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("Producer"))
    {
        doc.info
            .push(("Producer".to_string(), "@poe-code/pdf-ast".to_string()));
    }
    let out_arg = &pos_args.last().unwrap().path;
    let furniture = [
        &hdr_left,
        &hdr_center,
        &hdr_right,
        &ftr_left,
        &ftr_center,
        &ftr_right,
    ];
    let rendered = if furniture.iter().all(|s| s.is_empty()) {
        pdf_reader::render_html(&doc, margins, copies, collate, grayscale, |i| {
            let depth = if outline && !page_meta[i].cover {
                outline_depth
            } else {
                0
            };
            (depth, page_meta[i].links)
        })
    } else {
        Ok(None)
    };
    let serialized = match rendered {
        Ok(Some(pdf)) => Some(pdf),
        Ok(None) => doc.serialize_with_copies(
            copies,
            collate,
            crate::budget::ShellLimits::default().max_output_bytes,
        ),
        Err(message) => return err_out(message, 1),
    };
    let Some(serialized) = serialized else {
        return err_out("wkhtmltopdf: PDF output exceeds resource limits\n", 1);
    };
    if out_arg == "-" {
        return ok_out(&crate::vfs::bytes_to_stream_string(&serialized));
    }
    let dst = resolve_posix_path(cwd, out_arg);
    let inputs = pos_args[..pos_args.len() - 1]
        .iter()
        .filter(|s| s.path != "-")
        .map(|s| resolve_posix_path(cwd, &s.path))
        .collect::<Vec<_>>();
    if let Err(message) = fs.publish_file(&dst, &serialized, &inputs, output_version) {
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
