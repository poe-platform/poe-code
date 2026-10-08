#[derive(Clone, Debug)]
struct ImageMeta {
    fmt: String,
    w: u32,
    h: u32,
    cs: String,
    exif: BTreeMap<String, String>,
}

fn format_from_path(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "JPEG"
    } else if lower.ends_with(".webp") {
        "WEBP"
    } else if lower.ends_with(".gif") {
        "GIF"
    } else if lower.ends_with(".bmp") {
        "BMP"
    } else if lower.ends_with(".tif") || lower.ends_with(".tiff") {
        "TIFF"
    } else if lower.ends_with(".ppm") {
        "PPM"
    } else if lower.ends_with(".pgm") {
        "PGM"
    } else if lower.ends_with(".pbm") {
        "PBM"
    } else {
        "PNG"
    }
}

fn try_magick_list_option(args: &[String]) -> Option<BuiltinOutcome> {
    let limit = args.iter().position(|a| a == "--").unwrap_or(args.len());
    for i in 0..limit {
        let a = args[i].as_str();
        if a == "-list" || a == "--list" {
            let lt = args.get(i + 1).map(|s| s.to_ascii_lowercase()).unwrap_or_else(|| "list".to_string());
            if lt == "font" || lt == "type" {
                return Some(ok_out(concat!(
                    "  Font: DejaVu-Sans\n    family: DejaVu Sans\n    style: Normal\n    stretch: Normal\n    weight: 400\n",
                    "  Font: DejaVu-Sans-Bold\n    family: DejaVu Sans\n    style: Normal\n    stretch: Normal\n    weight: 700\n",
                    "  Font: DejaVu-Sans-Mono\n    family: DejaVu Sans Mono\n    style: Normal\n    stretch: Normal\n    weight: 400\n",
                    "  Font: Arial\n    family: Arial\n    style: Normal\n    stretch: Normal\n    weight: 400\n",
                    "  Font: Helvetica\n    family: Helvetica\n    style: Normal\n    stretch: Normal\n    weight: 400\n",
                    "  Font: Liberation-Sans\n    family: Liberation Sans\n    style: Normal\n    stretch: Normal\n    weight: 400\n"
                )));
            }
            if lt == "format" {
                return Some(ok_out(concat!(
                    "   Format  Module    Mode  Description\n",
                    "-------------------------------------------------------------------------------\n",
                    "      BMP* BMP       rw-   Microsoft Windows bitmap image\n",
                    "      GIF* GIF       rw+   CompuServe graphics interchange format\n",
                    "     JPEG* JPEG      rw-   Joint Photographic Experts Group JFIF format\n",
                    "      JPG* JPEG      rw-   Joint Photographic Experts Group JFIF format\n",
                    "      PNG* PNG       rw-   Portable Network Graphics\n",
                    "      PPM* PNM       rw+   Portable pixmap format (color)\n",
                    "      SVG* SVG       r--   Scalable Vector Graphics\n",
                    "     TIFF* TIFF      rw+   Tagged Image File Format\n",
                    "     WEBP* WEBP      rw-   WebP Image Format\n"
                )));
            }
            if lt == "color" {
                return Some(ok_out(concat!(
                    "Name                  Color                   Compliance\n",
                    "-------------------------------------------------------------------------------\n",
                    "black                 srgb(0,0,0)             SVG, X11, XPM\n",
                    "white                 srgb(255,255,255)       SVG, X11, XPM\n",
                    "red                   srgb(255,0,0)           SVG, X11, XPM\n",
                    "green                 srgb(0,128,0)           SVG\n",
                    "blue                  srgb(0,0,255)           SVG, X11, XPM\n",
                    "transparent           srgba(0,0,0,0)          SVG, X11, XPM\n"
                )));
            }
            if lt == "configure" {
                return Some(ok_out(concat!(
                    "Name                  Value\n",
                    "-------------------------------------------------------------------------------\n",
                    "DELEGATES             png jpeg webp tiff gif svg freetype\n",
                    "FEATURES              Cipher DPC\n",
                    "NAME                  ImageMagick\n",
                    "VERSION               7.1.1\n"
                )));
            }
            return Some(ok_out("color\nconfigure\ndelegate\nfont\nformat\nlocale\nlog\nmagic\nmodule\nresource\nthreshold\ntype\n"));
        }
    }
    None
}

fn normalize_magick_rgb(raw: &str) -> (u8, u8, u8) {
    let s = raw.trim().to_ascii_lowercase();
    match s.as_str() {
        "black" => (0, 0, 0),
        "white" | "" => (255, 255, 255),
        "red" => (255, 0, 0),
        "lime" => (0, 255, 0),
        "green" => (0, 128, 0),
        "blue" => (0, 0, 255),
        "yellow" => (255, 255, 0),
        "cyan" | "aqua" => (0, 255, 255),
        "magenta" | "fuchsia" => (255, 0, 255),
        "gray" | "grey" => (126, 126, 126),
        "navy" => (0, 0, 128),
        "orange" => (255, 165, 0),
        "coral" => (255, 127, 80),
        "skyblue" => (135, 206, 235),
        _ if s.starts_with('#') && s.len() == 7 => {
            let r = u8::from_str_radix(&s[1..3], 16).unwrap_or(255);
            let g = u8::from_str_radix(&s[3..5], 16).unwrap_or(255);
            let b = u8::from_str_radix(&s[5..7], 16).unwrap_or(255);
            (r, g, b)
        }
        _ if s.starts_with('#') && s.len() == 4 => {
            let r = u8::from_str_radix(&s[1..2], 16).unwrap_or(15) * 17;
            let g = u8::from_str_radix(&s[2..3], 16).unwrap_or(15) * 17;
            let b = u8::from_str_radix(&s[3..4], 16).unwrap_or(15) * 17;
            (r, g, b)
        }
        _ => (255, 255, 255),
    }
}

fn apply_magick_resize_geom(w: u32, h: u32, spec: &str) -> (u32, u32) {
    let s = spec.trim();
    if let Some(pct_str) = s.strip_suffix('%') {
        let pct: f64 = pct_str.parse().unwrap_or(100.0);
        let nw = ((w as f64) * pct / 100.0).round().max(1.0) as u32;
        let nh = ((h as f64) * pct / 100.0).round().max(1.0) as u32;
        return (nw, nh);
    }
    let exact = s.contains('!');
    let fill = s.contains('^');
    let shrink_only = s.contains('>');
    let enlarge_only = s.contains('<');
    let clean = s
        .trim_end_matches(['!', '^', '>', '<', '@'])
        .split(['+', '-'])
        .next()
        .unwrap_or("");
    if let Some((ws, hs)) = clean.split_once('x') {
        let tw_opt = if ws.is_empty() { None } else { ws.parse::<u32>().ok() };
        let th_opt = if hs.is_empty() { None } else { hs.parse::<u32>().ok() };
        match (tw_opt, th_opt) {
            (Some(tw), Some(th)) => {
                if exact {
                    return (tw.max(1), th.max(1));
                }
                if shrink_only && w <= tw && h <= th {
                    return (w, h);
                }
                if enlarge_only && (w >= tw || h >= th) {
                    return (w, h);
                }
                let sx = (tw as f64) / (w.max(1) as f64);
                let sy = (th as f64) / (h.max(1) as f64);
                let scale = if fill { sx.max(sy) } else { sx.min(sy) };
                let nw = ((w as f64) * scale).round().max(1.0) as u32;
                let nh = ((h as f64) * scale).round().max(1.0) as u32;
                (nw, nh)
            }
            (Some(tw), None) => {
                let scale = (tw as f64) / (w.max(1) as f64);
                let nh = ((h as f64) * scale).round().max(1.0) as u32;
                (tw.max(1), nh)
            }
            (None, Some(th)) => {
                let scale = (th as f64) / (h.max(1) as f64);
                let nw = ((w as f64) * scale).round().max(1.0) as u32;
                (nw, th.max(1))
            }
            (None, None) => (w, h),
        }
    } else if let Ok(tw) = clean.parse::<u32>() {
        let scale = (tw as f64) / (w.max(1) as f64);
        let nh = ((h as f64) * scale).round().max(1.0) as u32;
        (tw.max(1), nh)
    } else {
        (w, h)
    }
}

fn read_image_meta(bytes: &[u8], path: &str) -> ImageMeta {
    let mut meta = ImageMeta {
        fmt: format_from_path(path).to_string(),
        w: 32,
        h: 32,
        cs: "sRGB".to_string(),
        exif: BTreeMap::new(),
    };
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        meta.fmt = "PNG".to_string();
        meta.w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        meta.h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        meta.fmt = "JPEG".to_string();
    } else if bytes.starts_with(b"GIF8") {
        meta.fmt = "GIF".to_string();
    }
    let text = String::from_utf8_lossy(bytes);
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("__IMG__:") {
            for kv in rest.split(';') {
                if let Some((k, v)) = kv.split_once('=') {
                    match k {
                        "fmt" => meta.fmt = v.to_string(),
                        "w" => meta.w = v.parse().unwrap_or(meta.w),
                        "h" => meta.h = v.parse().unwrap_or(meta.h),
                        "cs" => meta.cs = v.to_string(),
                        _ => {}
                    }
                }
            }
        } else if let Some(rest) = line.strip_prefix("__EXIF__:")
            && let Some((k, v)) = rest.split_once('=')
        {
            if v.is_empty() {
                if k.eq_ignore_ascii_case("all") {
                    meta.exif.clear();
                } else {
                    meta.exif.remove(k);
                }
            } else {
                meta.exif.insert(k.to_string(), v.to_string());
            }
        }
    }
    meta
}

fn write_image_bytes(meta: &ImageMeta) -> Vec<u8> {
    let mut buf = match meta.fmt.as_str() {
        "PNG" => {
            let mut b = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
            b.extend_from_slice(&meta.w.to_be_bytes());
            b.extend_from_slice(&meta.h.to_be_bytes());
            b.extend_from_slice(b"\x08\x02\x00\x00\x00");
            b
        }
        "JPEG" => b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00".to_vec(),
        "GIF" => b"GIF89a".to_vec(),
        "WEBP" => b"RIFF\x24\x00\x00\x00WEBP".to_vec(),
        "BMP" => b"BM\x36\x00\x00\x00".to_vec(),
        "TIFF" => b"II*\x00\x08\x00\x00\x00".to_vec(),
        "PPM" => format!("P6\n{} {}\n255\n", meta.w, meta.h).into_bytes(),
        "PGM" => format!("P5\n{} {}\n255\n", meta.w, meta.h).into_bytes(),
        "PBM" => format!("P4\n{} {}\n", meta.w, meta.h).into_bytes(),
        _ => {
            let mut b = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
            b.extend_from_slice(&meta.w.to_be_bytes());
            b.extend_from_slice(&meta.h.to_be_bytes());
            b.extend_from_slice(b"\x08\x02\x00\x00\x00");
            b
        }
    };
    buf.extend_from_slice(
        format!("\n__IMG__:fmt={};w={};h={};cs={}", meta.fmt, meta.w, meta.h, meta.cs).as_bytes(),
    );
    for (k, v) in &meta.exif {
        buf.extend_from_slice(format!("\n__EXIF__:{k}={v}").as_bytes());
    }
    buf
}

fn hex_enc(data: &[u8]) -> String {
    let mut s = String::with_capacity(data.len() * 2);
    for &b in data {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn hex_dec(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if let Ok(st) = std::str::from_utf8(&bytes[i..i + 2])
            && let Ok(v) = u8::from_str_radix(st, 16)
        {
            out.push(v);
        }
        i += 2;
    }
    out
}

fn hex_dec_str(s: &str) -> String {
    String::from_utf8_lossy(&hex_dec(s)).to_string()
}

#[derive(Clone, Debug, Default)]
struct PdfPage {
    rot: i32,
    text: String,
    html: String,
    images: Vec<(u32, u32, String)>,
    urls: Vec<String>,
}

#[derive(Clone, Debug)]
struct PdfDoc {
    version: String,
    title: String,
    author: String,
    pdf_id0: String,
    pdf_id1: String,
    encrypted: Option<String>,
    linearized: bool,
    page_w: f64,
    page_h: f64,
    page_media: BTreeMap<usize, (f64, f64, Option<[f64; 4]>)>,
    info: Vec<(String, String)>,
    bookmarks: Vec<(String, String, String)>,
    page_labels: Vec<(String, String, String, String)>,
    attachments: Vec<(String, String, String, Vec<u8>)>,
    pages: Vec<PdfPage>,
    exif: BTreeMap<String, String>,
}

impl PdfDoc {
    fn new() -> Self {
        Self {
            version: "1.4".to_string(),
            title: String::new(),
            author: String::new(),
            pdf_id0: "00000000000000000000000000000000".to_string(),
            pdf_id1: "00000000000000000000000000000000".to_string(),
            encrypted: None,
            linearized: false,
            page_w: 612.0,
            page_h: 792.0,
            page_media: BTreeMap::new(),
            info: Vec::new(),
            bookmarks: Vec::new(),
            page_labels: Vec::new(),
            attachments: Vec::new(),
            pages: Vec::new(),
            exif: BTreeMap::new(),
        }
    }

    fn parse(bytes: &[u8]) -> Self {
        let raw = String::from_utf8_lossy(bytes);
        let mut doc = Self::new();
        for line in raw.lines() {
            if let Some(rest) = line.strip_prefix("%PDF-") {
                doc.version = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("__EXIF__:")
                && let Some((k, v)) = rest.split_once('=')
            {
                if v.is_empty() {
                    if k.eq_ignore_ascii_case("all") {
                        doc.exif.clear();
                    } else {
                        doc.exif.remove(k);
                    }
                } else {
                    doc.exif.insert(k.to_string(), v.to_string());
                }
            }
        }
        if raw.contains("%%SAFE_PDF_V2%%") {
            for line in raw.lines() {
                if let Some(v) = line.strip_prefix("VER:") {
                    doc.version = v.to_string();
                } else if let Some(v) = line.strip_prefix("TITLE:") {
                    doc.title = hex_dec_str(v);
                } else if let Some(v) = line.strip_prefix("AUTHOR:") {
                    doc.author = hex_dec_str(v);
                } else if line == "LIN:1" {
                    doc.linearized = true;
                } else if let Some(v) = line.strip_prefix("ID0:") {
                    doc.pdf_id0 = v.to_string();
                } else if let Some(v) = line.strip_prefix("ID1:") {
                    doc.pdf_id1 = v.to_string();
                } else if let Some(v) = line.strip_prefix("SIZE:") {
                    if let Some((ws, hs)) = v.split_once(':') {
                        doc.page_w = ws.parse().unwrap_or(612.0);
                        doc.page_h = hs.parse().unwrap_or(792.0);
                    }
                } else if let Some(v) = line.strip_prefix("PMEDIA:") {
                    let parts: Vec<&str> = v.splitn(4, ':').collect();
                    if parts.len() == 4
                        && let Ok(pno) = parts[0].parse::<usize>()
                    {
                        let pw = parts[1].parse::<f64>().unwrap_or(doc.page_w);
                        let ph = parts[2].parse::<f64>().unwrap_or(doc.page_h);
                        let crop = if parts[3].is_empty() {
                            None
                        } else {
                            let nums: Vec<f64> = parts[3]
                                .split(',')
                                .filter_map(|s| s.parse::<f64>().ok())
                                .collect();
                            if nums.len() == 4 {
                                Some([nums[0], nums[1], nums[2], nums[3]])
                            } else {
                                None
                            }
                        };
                        doc.page_media.insert(pno, (pw, ph, crop));
                    }
                } else if let Some(v) = line.strip_prefix("ENC:") {
                    if !v.is_empty() {
                        doc.encrypted = Some(hex_dec_str(v));
                    }
                } else if let Some(v) = line.strip_prefix("INFO:") {
                    if let Some((kh, vh)) = v.split_once(':') {
                        doc.info.push((hex_dec_str(kh), hex_dec_str(vh)));
                    }
                } else if let Some(v) = line.strip_prefix("BM:") {
                    let parts: Vec<&str> = v.splitn(3, ':').collect();
                    if parts.len() == 3 {
                        doc.bookmarks.push((
                            hex_dec_str(parts[0]),
                            parts[1].to_string(),
                            parts[2].to_string(),
                        ));
                    }
                } else if let Some(v) = line.strip_prefix("PL:") {
                    let parts: Vec<&str> = v.splitn(4, ':').collect();
                    if parts.len() == 4 {
                        doc.page_labels.push((
                            parts[0].to_string(),
                            parts[1].to_string(),
                            hex_dec_str(parts[2]),
                            hex_dec_str(parts[3]),
                        ));
                    }
                } else if let Some(v) = line.strip_prefix("ATT:") {
                    let parts: Vec<&str> = v.splitn(4, ':').collect();
                    if parts.len() == 4 {
                        doc.attachments.push((
                            hex_dec_str(parts[0]),
                            hex_dec_str(parts[1]),
                            hex_dec_str(parts[2]),
                            hex_dec(parts[3]),
                        ));
                    }
                } else if let Some(v) = line.strip_prefix("PAGE:") {
                    let parts: Vec<&str> = v.splitn(5, ':').collect();
                    if parts.len() == 5 {
                        let rot = parts[0].parse().unwrap_or(0);
                        let text = hex_dec_str(parts[1]);
                        let html = hex_dec_str(parts[2]);
                        let mut images = Vec::new();
                        if !parts[3].is_empty() {
                            for im in parts[3].split(';') {
                                let ip: Vec<&str> = im.split(',').collect();
                                if ip.len() == 3 {
                                    images.push((
                                        ip[0].parse().unwrap_or(24),
                                        ip[1].parse().unwrap_or(24),
                                        ip[2].to_string(),
                                    ));
                                }
                            }
                        }
                        let mut urls = Vec::new();
                        if !parts[4].is_empty() {
                            for u in parts[4].split(';') {
                                urls.push(hex_dec_str(u));
                            }
                        }
                        doc.pages.push(PdfPage {
                            rot,
                            text,
                            html,
                            images,
                            urls,
                        });
                    }
                }
            }
            if doc.pages.is_empty() {
                doc.pages.push(PdfPage {
                    rot: 0,
                    text: String::new(),
                    html: String::new(),
                    images: Vec::new(),
                    urls: Vec::new(),
                });
            }
            for (k, v) in &doc.info {
                if k.eq_ignore_ascii_case("Title") && !v.is_empty() {
                    doc.title = v.clone();
                } else if k.eq_ignore_ascii_case("Author") && !v.is_empty() {
                    doc.author = v.clone();
                }
            }
            if let Some(t) = doc.exif.get("Title")
                && !t.is_empty()
            {
                doc.title = t.clone();
            }
            if let Some(a) = doc.exif.get("Author")
                && !a.is_empty()
            {
                doc.author = a.clone();
            }
            return doc;
        }
        // Fallback for legacy %%PAGE%% PDFs
        let chunks: Vec<&str> = if raw.contains("%%PAGE%%") {
            raw.split("%%PAGE%%").skip(1).collect()
        } else {
            vec![raw.as_ref()]
        };
        for c in chunks {
            let text = strip_html_tags(c);
            doc.pages.push(PdfPage {
                rot: 0,
                text,
                html: c.to_string(),
                images: Vec::new(),
                urls: extract_html_urls(c),
            });
        }
        if doc.pages.is_empty() {
            doc.pages.push(PdfPage {
                rot: 0,
                text: String::new(),
                html: String::new(),
                images: Vec::new(),
                urls: Vec::new(),
            });
        }
        doc
    }

    fn serialize(&self) -> Vec<u8> {
        let mut out = format!("%PDF-{}\n%%SAFE_PDF_V2%%\n", self.version);
        out.push_str(&format!("VER:{}\n", self.version));
        out.push_str(&format!("TITLE:{}\n", hex_enc(self.title.as_bytes())));
        out.push_str(&format!("AUTHOR:{}\n", hex_enc(self.author.as_bytes())));
        if self.linearized {
            out.push_str("LIN:1\n");
        }
        if self.pdf_id0 != "00000000000000000000000000000000" {
            out.push_str(&format!("ID0:{}\n", self.pdf_id0));
        }
        if self.pdf_id1 != "00000000000000000000000000000000" {
            out.push_str(&format!("ID1:{}\n", self.pdf_id1));
        }
        if (self.page_w - 612.0).abs() > 1e-6 || (self.page_h - 792.0).abs() > 1e-6 {
            out.push_str(&format!("SIZE:{}:{}\n", self.page_w, self.page_h));
        }
        for (pno, (pw, ph, crop)) in &self.page_media {
            let crop_str = match crop {
                Some([c0, c1, c2, c3]) => format!("{c0},{c1},{c2},{c3}"),
                None => String::new(),
            };
            out.push_str(&format!("PMEDIA:{pno}:{pw}:{ph}:{crop_str}\n"));
        }
        if let Some(ref pw) = self.encrypted {
            out.push_str(&format!("ENC:{}\n", hex_enc(pw.as_bytes())));
        }
        for (k, v) in &self.info {
            out.push_str(&format!(
                "INFO:{}:{}\n",
                hex_enc(k.as_bytes()),
                hex_enc(v.as_bytes())
            ));
        }
        for (t, l, p) in &self.bookmarks {
            out.push_str(&format!("BM:{}:{}:{}\n", hex_enc(t.as_bytes()), l, p));
        }
        for (ni, st, pf, sy) in &self.page_labels {
            out.push_str(&format!(
                "PL:{}:{}:{}:{}\n",
                ni,
                st,
                hex_enc(pf.as_bytes()),
                hex_enc(sy.as_bytes())
            ));
        }
        for (k, f, d, b) in &self.attachments {
            out.push_str(&format!(
                "ATT:{}:{}:{}:{}\n",
                hex_enc(k.as_bytes()),
                hex_enc(f.as_bytes()),
                hex_enc(d.as_bytes()),
                hex_enc(b)
            ));
        }
        for p in &self.pages {
            let imgs: Vec<String> = p
                .images
                .iter()
                .map(|(w, h, fmt)| format!("{w},{h},{fmt}"))
                .collect();
            let urls: Vec<String> = p.urls.iter().map(|u| hex_enc(u.as_bytes())).collect();
            out.push_str(&format!(
                "PAGE:{}:{}:{}:{}:{}\n",
                p.rot,
                hex_enc(p.text.as_bytes()),
                hex_enc(p.html.as_bytes()),
                imgs.join(";"),
                urls.join(";")
            ));
        }
        for (k, v) in &self.exif {
            out.push_str(&format!("__EXIF__:{k}={v}\n"));
        }
        out.push_str("%%EOF\n");
        out.into_bytes()
    }
}

fn strip_html_tags(html: &str) -> String {
    let mut s = html.to_string();
    while let Some(start) = s.find("<head") {
        if let Some(end) = s[start..].find("</head>") {
            s.replace_range(start..start + end + 7, "");
        } else {
            break;
        }
    }
    while let Some(start) = s.find("<style") {
        if let Some(end) = s[start..].find("</style>") {
            s.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }
    let mut out = String::new();
    let mut in_tag = false;
    let mut tag_buf = String::new();
    for ch in s.chars() {
        if ch == '<' {
            in_tag = true;
            tag_buf.clear();
        } else if ch == '>' {
            in_tag = false;
            let t = tag_buf.trim().to_ascii_lowercase();
            if matches!(
                t.split_whitespace().next().unwrap_or(""),
                "h1" | "/h1" | "h2" | "/h2" | "h3" | "/h3" | "p" | "/p" | "div" | "/div" | "br" | "br/" | "li" | "/li" | "tr" | "/tr"
            ) {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
            }
        } else if in_tag {
            tag_buf.push(ch);
        } else {
            out.push(ch);
        }
    }
    let decoded = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    let mut lines = Vec::new();
    for l in decoded.lines() {
        let trimmed = l.trim();
        if !trimmed.is_empty() && !trimmed.starts_with("%PDF-") {
            lines.push(trimmed.to_string());
        }
    }
    lines.join("\n")
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    if let Some(s) = lower.find("<title>")
        && let Some(e) = lower[s + 7..].find("</title>")
    {
        return Some(html[s + 7..s + 7 + e].trim().to_string());
    }
    None
}

fn extract_html_urls(html: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut rest = html;
    while let Some(pos) = rest.find("href=") {
        rest = &rest[pos + 5..];
        let q = rest.chars().next().unwrap_or(' ');
        if (q == '"' || q == '\'')
            && let Some(end) = rest[1..].find(q)
        {
            urls.push(rest[1..1 + end].to_string());
            rest = &rest[1 + end + 1..];
        }
    }
    urls
}

fn extract_html_images(html: &str, base_dir: &str, fs: &dyn SafeBashFs) -> Vec<(u32, u32, String)> {
    let mut imgs = Vec::new();
    let mut rest = html;
    while let Some(pos) = rest.find("<img") {
        rest = &rest[pos + 4..];
        let end = rest.find('>').unwrap_or(rest.len());
        let tag = &rest[..end];
        let mut w = 24u32;
        let mut h = 24u32;
        if let Some(wp) = tag.find("width=\"") {
            let r = &tag[wp + 7..];
            if let Some(we) = r.find('"') {
                w = r[..we].parse().unwrap_or(24);
            }
        }
        if let Some(hp) = tag.find("height=\"") {
            let r = &tag[hp + 8..];
            if let Some(he) = r.find('"') {
                h = r[..he].parse().unwrap_or(24);
            }
        }
        let mut fmt = "PNG".to_string();
        if let Some(sp) = tag.find("src=\"") {
            let r = &tag[sp + 5..];
            if let Some(se) = r.find('"') {
                let src = &r[..se];
                if let Some(rest_data) = src.strip_prefix("data:") {
                    if rest_data.starts_with("image/jpeg") || rest_data.starts_with("image/jpg") {
                        fmt = "JPEG".to_string();
                    } else if rest_data.starts_with("image/tiff") {
                        fmt = "TIFF".to_string();
                    }
                    if let Some(b64_pos) = rest_data.find(";base64,") {
                        let b64 = &rest_data[b64_pos + 8..];
                        if let Ok(b) = base64_decode(b64) {
                            let m = read_image_meta(&b, if fmt == "JPEG" { "inline.jpg" } else { "inline.png" });
                            w = m.w;
                            h = m.h;
                            if !m.fmt.is_empty() {
                                fmt = m.fmt;
                            }
                        }
                    }
                } else {
                    let full = resolve_posix_path(base_dir, src);
                    if let Ok(b) = fs.read_file(&full) {
                        let m = read_image_meta(&b, &full);
                        w = m.w;
                        h = m.h;
                        if !m.fmt.is_empty() {
                            fmt = m.fmt;
                        }
                    }
                }
            }
        }
        imgs.push((w, h, fmt));
        rest = &rest[end..];
    }
    imgs
}

fn split_html_pages(html: &str) -> Vec<String> {
    let mut pages = Vec::new();
    let mut cur = String::new();
    let mut rest = html;
    loop {
        let next_before = rest.find("page-break-before");
        let next_after = rest.find("page-break-after");
        match (next_before, next_after) {
            (Some(pb), Some(pa)) if pb <= pa => {
                let before = &rest[..pb];
                let div_start = before.rfind("<div").unwrap_or(pb);
                cur.push_str(&rest[..div_start]);
                if !strip_html_tags(&cur).trim().is_empty() {
                    pages.push(cur.clone());
                    cur.clear();
                }
                let after_pb = &rest[pb..];
                if let Some(gt) = after_pb.find('>') {
                    rest = &after_pb[gt + 1..];
                } else {
                    break;
                }
            }
            (_, Some(pa)) => {
                let after_pa = &rest[pa..];
                let split_offset = if let Some(close_div) = after_pa.find("</div>") {
                    pa + close_div + 6
                } else if let Some(gt) = after_pa.find('>') {
                    pa + gt + 1
                } else {
                    break;
                };
                cur.push_str(&rest[..split_offset]);
                if !strip_html_tags(&cur).trim().is_empty() {
                    pages.push(cur.clone());
                    cur.clear();
                }
                rest = &rest[split_offset..];
            }
            (Some(pb), None) => {
                let before = &rest[..pb];
                let div_start = before.rfind("<div").unwrap_or(pb);
                cur.push_str(&rest[..div_start]);
                if !strip_html_tags(&cur).trim().is_empty() {
                    pages.push(cur.clone());
                    cur.clear();
                }
                let after_pb = &rest[pb..];
                if let Some(gt) = after_pb.find('>') {
                    rest = &after_pb[gt + 1..];
                } else {
                    break;
                }
            }
            (None, None) => break,
        }
    }
    cur.push_str(rest);
    if !strip_html_tags(&cur).trim().is_empty() || pages.is_empty() {
        pages.push(cur);
    }
    pages
}

#[derive(Clone, Debug)]
struct MediaDoc {
    codec_type: String,
    codec_name: String,
    format_name: String,
    width: u32,
    height: u32,
    nb_frames: u32,
    fps: u32,
    duration: f64,
    sample_rate: u32,
    channels: u32,
    has_audio: bool,
    title: String,
    tags: BTreeMap<String, String>,
    subtitles: String,
    chapters: Vec<(usize, String)>,
}

impl MediaDoc {
    fn default_video() -> Self {
        Self {
            codec_type: "video".to_string(),
            codec_name: "h264".to_string(),
            format_name: "mp4".to_string(),
            width: 64,
            height: 48,
            nb_frames: 4,
            fps: 10,
            duration: 0.4,
            sample_rate: 16000,
            channels: 1,
            has_audio: false,
            title: String::new(),
            tags: BTreeMap::new(),
            subtitles: String::new(),
            chapters: Vec::new(),
        }
    }

    fn parse(bytes: &[u8], path: &str) -> Self {
        let mut d = Self::default_video();
        let lower_path = path.to_ascii_lowercase();
        if lower_path.ends_with(".wav") || (bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE") {
            d.codec_type = "audio".to_string();
            d.codec_name = "pcm_s16le".to_string();
            d.format_name = "wav".to_string();
            if let Ok(info) = probe_wav_info(bytes) {
                d.sample_rate = info.sample_rate;
                d.channels = info.channels as u32;
                d.duration = info.duration;
                d.codec_name = if info.codec == "pcm_float" {
                    format!("pcm_f{}le", info.bits_per_sample)
                } else if info.bits_per_sample == 8 {
                    "pcm_u8".to_string()
                } else {
                    format!("pcm_s{}le", info.bits_per_sample)
                };
            }
        } else if lower_path.ends_with(".png")
            || lower_path.ends_with(".jpg")
            || lower_path.ends_with(".jpeg")
            || lower_path.ends_with(".webp")
            || lower_path.ends_with(".bmp")
            || lower_path.ends_with(".ppm")
            || lower_path.ends_with(".pgm")
            || lower_path.ends_with(".pbm")
            || bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || bytes.starts_with(b"\xff\xd8\xff")
        {
            let im = read_image_meta(bytes, path);
            d.codec_type = "video".to_string();
            d.codec_name = match im.fmt.as_str() {
                "JPEG" => "mjpeg",
                "GIF" => "gif",
                "WEBP" => "webp",
                "BMP" => "bmp",
                _ => "png",
            }
            .to_string();
            d.format_name = "image2".to_string();
            d.width = im.w;
            d.height = im.h;
            d.nb_frames = 1;
            d.duration = 0.04;
        }
        let text = String::from_utf8_lossy(bytes);
        for line in text.lines() {
            if let Some(rest) = line.trim_start_matches("# ").strip_prefix("__MEDIA__:") {
                for kv in rest.split(';') {
                    if let Some((k, v)) = kv.split_once('=') {
                        match k {
                            "type" => d.codec_type = v.to_string(),
                            "codec" => d.codec_name = v.to_string(),
                            "fmt" => d.format_name = v.to_string(),
                            "w" => d.width = v.parse().unwrap_or(d.width),
                            "h" => d.height = v.parse().unwrap_or(d.height),
                            "n" => d.nb_frames = v.parse().unwrap_or(d.nb_frames),
                            "fps" => d.fps = v.parse().unwrap_or(d.fps),
                            "dur" => d.duration = v.parse().unwrap_or(d.duration),
                            "sr" => d.sample_rate = v.parse().unwrap_or(d.sample_rate),
                            "ch" => d.channels = v.parse().unwrap_or(d.channels),
                            "ha" => d.has_audio = v == "1",
                            "title" => {
                                d.title = hex_dec_str(v);
                                if !d.title.is_empty() {
                                    d.tags.insert("title".to_string(), d.title.clone());
                                }
                            }
                            "tags" => {
                                if !v.is_empty() {
                                    for item in v.split(',') {
                                        if let Some((kh, vh)) = item.split_once(':') {
                                            let key = hex_dec_str(kh);
                                            let val = hex_dec_str(vh);
                                            if key == "title" {
                                                d.title = val.clone();
                                            }
                                            d.tags.insert(key, val);
                                        }
                                    }
                                }
                            }
                            "subs" => d.subtitles = hex_dec_str(v),
                            "chaps" => {
                                d.chapters.clear();
                                if !v.is_empty() {
                                    for item in v.split(',') {
                                        if let Some((id_s, th)) = item.split_once(':') {
                                            d.chapters.push((
                                                id_s.parse().unwrap_or(0),
                                                hex_dec_str(th),
                                            ));
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        d
    }

    fn serialize(&self, m3u8: bool) -> Vec<u8> {
        let chaps: Vec<String> = self
            .chapters
            .iter()
            .map(|(id, t)| format!("{id}:{}", hex_enc(t.as_bytes())))
            .collect();
        let tags_encoded: Vec<String> = self
            .tags
            .iter()
            .map(|(k, v)| format!("{}:{}", hex_enc(k.as_bytes()), hex_enc(v.as_bytes())))
            .collect();
        let meta_line = format!(
            "__MEDIA__:type={};codec={};fmt={};w={};h={};n={};fps={};dur={:.6};sr={};ch={};ha={};title={};tags={};subs={};chaps={}\n",
            self.codec_type,
            self.codec_name,
            self.format_name,
            self.width,
            self.height,
            self.nb_frames,
            self.fps,
            self.duration,
            self.sample_rate,
            self.channels,
            if self.has_audio { 1 } else { 0 },
            hex_enc(self.title.as_bytes()),
            tags_encoded.join(","),
            hex_enc(self.subtitles.as_bytes()),
            chaps.join(",")
        );
        if m3u8 {
            let mut s = String::from("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\nseg0.ts\n#EXT-X-ENDLIST\n# ");
            s.push_str(&meta_line);
            return s.into_bytes();
        }
        let mut out = if self.format_name == "wav" {
            let ch = self.channels.max(1) as u16;
            let sr = self.sample_rate.max(1);
            let block_align = ch * 2;
            let byte_rate = sr * (block_align as u32);
            let total_frames = ((self.duration.max(0.0) * (sr as f64)).round() as usize).min(262_144);
            let data_len = total_frames * (block_align as usize);
            let riff_size = (36 + data_len) as u32;
            let mut wav = Vec::with_capacity(44 + data_len + meta_line.len() + 2);
            wav.extend_from_slice(b"RIFF");
            wav.extend_from_slice(&riff_size.to_le_bytes());
            wav.extend_from_slice(b"WAVEfmt ");
            wav.extend_from_slice(&16u32.to_le_bytes());
            wav.extend_from_slice(&1u16.to_le_bytes());
            wav.extend_from_slice(&ch.to_le_bytes());
            wav.extend_from_slice(&sr.to_le_bytes());
            wav.extend_from_slice(&byte_rate.to_le_bytes());
            wav.extend_from_slice(&block_align.to_le_bytes());
            wav.extend_from_slice(&16u16.to_le_bytes());
            wav.extend_from_slice(b"data");
            wav.extend_from_slice(&(data_len as u32).to_le_bytes());
            wav.resize(44 + data_len, 0u8);
            wav
        } else if self.format_name == "gif" {
            b"GIF89a".to_vec()
        } else {
            b"\x00\x00\x00\x18ftypmp42".to_vec()
        };
        out.push(b'\n');
        out.extend_from_slice(meta_line.as_bytes());
        out
    }
}

fn parse_rtf_paragraphs(rtf: &str, fs: &dyn SafeBashFs) -> Vec<String> {
    let res = crate::commands::structured::try_run_structured_command(
        "unrtf",
        &["--text".to_string()],
        rtf,
        "/",
        &BTreeMap::new(),
        fs,
    );
    let txt = res.map(|o| o.stdout).unwrap_or_default();
    txt.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

fn html_escape_str(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

fn xml_unescape_str(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
}

fn parse_markdown_pipe_table_rows(source: &str) -> Vec<Vec<String>> {
    let pipe_cells = |line: &str| -> Option<Vec<String>> {
        let mut cells = Vec::new();
        let mut cell = String::new();
        let chars: Vec<char> = line.chars().collect();
        let mut idx = 0usize;
        while idx < chars.len() {
            let ch = chars[idx];
            if ch == '\\' && idx + 1 < chars.len() && chars[idx + 1] == '|' {
                cell.push('|');
                idx += 2;
            } else if ch == '|' {
                cells.push(cell.trim().to_string());
                cell.clear();
                idx += 1;
            } else {
                cell.push(ch);
                idx += 1;
            }
        }
        if cells.is_empty() {
            return None;
        }
        cells.push(cell.trim().to_string());
        if line.trim_start().starts_with('|') && !cells.is_empty() {
            cells.remove(0);
        }
        if line.trim_end().ends_with('|') && cells.last().is_some_and(|c| c.is_empty()) {
            cells.pop();
        }
        Some(cells)
    };

    let lines: Vec<&str> = source.lines().collect();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut index = 0usize;
    while index + 1 < lines.len() {
        let header = pipe_cells(lines[index]);
        let delimiter = pipe_cells(lines[index + 1]);
        if let (Some(hdr), Some(delim)) = (header, delimiter)
            && !hdr.is_empty()
            && delim.len() == hdr.len()
            && delim.iter().all(|c| {
                let s = c.trim_start_matches(':').trim_end_matches(':');
                !s.is_empty() && s.chars().all(|ch| ch == '-')
            })
        {
            let col_len = hdr.len();
            rows.push(hdr);
            index += 2;
            while index < lines.len() {
                if let Some(cells) = pipe_cells(lines[index]) {
                    let mut row = Vec::with_capacity(col_len);
                    for col in 0..col_len {
                        row.push(cells.get(col).cloned().unwrap_or_default());
                    }
                    rows.push(row);
                    index += 1;
                } else {
                    break;
                }
            }
            continue;
        }
        index += 1;
    }
    rows
}

fn read_office_source(
    full_path: &str,
    bytes: &[u8],
    fs: &dyn SafeBashFs,
) -> (Vec<String>, Option<Vec<Vec<String>>>) {
    let lower = full_path.to_ascii_lowercase();
    if lower.ends_with(".csv") || lower.ends_with(".tsv") {
        let delim = if lower.ends_with(".tsv") { '\t' } else { ',' };
        let text = String::from_utf8_lossy(bytes);
        let rows: Vec<Vec<String>> = text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|line| {
                let mut row: Vec<String> = Vec::new();
                let mut field = String::new();
                let mut quoted = false;
                let chars: Vec<char> = line.chars().collect();
                let mut idx = 0usize;
                while idx < chars.len() {
                    let ch = chars[idx];
                    if ch == '"' {
                        if quoted && idx + 1 < chars.len() && chars[idx + 1] == '"' {
                            field.push('"');
                            idx += 2;
                            continue;
                        } else if quoted || field.is_empty() {
                            quoted = !quoted;
                            idx += 1;
                            continue;
                        } else {
                            field.push(ch);
                        }
                    } else if !quoted && ch == delim {
                        row.push(field.clone());
                        field.clear();
                    } else {
                        field.push(ch);
                    }
                    idx += 1;
                }
                row.push(field);
                row
            })
            .collect();
        let paras: Vec<String> = rows.iter().map(|r| r.join(",")).collect();
        return (paras, Some(rows));
    }
    if lower.ends_with(".xlsx") || lower.ends_with(".ods") {
        let entries = parse_ustar_archive(bytes);
        let mut shared_strings: Vec<String> = Vec::new();
        for e in &entries {
            if e.name == "xl/sharedStrings.xml" {
                let sst_xml = String::from_utf8_lossy(&e.content);
                let mut rest = sst_xml.as_ref();
                while let Some(si_pos) = rest.find("<si") {
                    rest = &rest[si_pos + 3..];
                    if let Some(si_end) = rest.find("</si>") {
                        let si_body = &rest[..si_end];
                        let mut val = String::new();
                        let mut s_rest = si_body;
                        while let Some(t_pos) = s_rest.find("<t") {
                            let after_t = &s_rest[t_pos + 2..];
                            if !after_t.starts_with('>') && !after_t.starts_with(' ') {
                                s_rest = after_t;
                                continue;
                            }
                            if let Some(gt) = after_t.find('>') {
                                let inner = &after_t[gt + 1..];
                                if let Some(te) = inner.find("</t>") {
                                    val.push_str(&xml_unescape_str(&inner[..te]));
                                    s_rest = &inner[te + 4..];
                                    continue;
                                }
                            }
                            break;
                        }
                        shared_strings.push(val);
                        rest = &rest[si_end + 5..];
                    } else {
                        break;
                    }
                }
            }
        }
        for e in &entries {
            if e.name == "xl/worksheets/sheet1.xml" || e.name.starts_with("xl/worksheets/sheet") {
                let xml = String::from_utf8_lossy(&e.content);
                let mut rows = Vec::new();
                let mut rest = xml.as_ref();
                while let Some(rs) = rest.find("<row") {
                    rest = &rest[rs + 4..];
                    if let Some(re) = rest.find("</row>") {
                        let row_xml = &rest[..re];
                        let mut cells: Vec<String> = Vec::new();
                        let mut rcell = row_xml;
                        while let Some(cs) = rcell.find("<c") {
                            let after_c = &rcell[cs + 2..];
                            if !after_c.starts_with(' ') && !after_c.starts_with('>') && !after_c.starts_with('/') {
                                rcell = after_c;
                                continue;
                            }
                            if let Some(gt) = after_c.find('>') {
                                let attrs = &after_c[..gt];
                                if let Some(r_pos) = attrs.find("r=\"") {
                                    let r_rest = &attrs[r_pos + 3..];
                                    if let Some(r_end) = r_rest.find('"') {
                                        let ref_str = &r_rest[..r_end];
                                        let mut col_idx = 0usize;
                                        for ch in ref_str.chars() {
                                            if ch.is_ascii_alphabetic() {
                                                col_idx = col_idx * 26 + ((ch.to_ascii_uppercase() as u8 - b'A') as usize + 1);
                                            } else {
                                                break;
                                            }
                                        }
                                        if col_idx > 0 {
                                            let target_col = col_idx - 1;
                                            while cells.len() < target_col {
                                                cells.push(String::new());
                                            }
                                        }
                                    }
                                }
                                if attrs.ends_with('/') {
                                    cells.push(String::new());
                                    rcell = &after_c[gt + 1..];
                                    continue;
                                }
                                let body_rest = &after_c[gt + 1..];
                                if let Some(ce) = body_rest.find("</c>") {
                                    let cell_body = &body_rest[..ce];
                                    let is_shared = attrs.contains("t=\"s\"");
                                    let is_inline = attrs.contains("t=\"inlineStr\"");
                                    let val = if is_inline {
                                        if let Some(ts) = cell_body.find("<t")
                                            && let Some(tgt) = cell_body[ts + 2..].find('>')
                                        {
                                            let inner = &cell_body[ts + 2 + tgt + 1..];
                                            if let Some(te) = inner.find("</t>") {
                                                xml_unescape_str(&inner[..te])
                                            } else {
                                                String::new()
                                            }
                                        } else {
                                            String::new()
                                        }
                                    } else if let Some(vs) = cell_body.find("<v>")
                                        && let Some(ve) = cell_body[vs + 3..].find("</v>")
                                    {
                                        let raw = xml_unescape_str(&cell_body[vs + 3..vs + 3 + ve]);
                                        if is_shared {
                                            let idx: usize = raw.trim().parse().unwrap_or(usize::MAX);
                                            shared_strings.get(idx).cloned().unwrap_or_default()
                                        } else {
                                            raw
                                        }
                                    } else if let Some(ts) = cell_body.find("<t>")
                                        && let Some(te) = cell_body[ts + 3..].find("</t>")
                                    {
                                        xml_unescape_str(&cell_body[ts + 3..ts + 3 + te])
                                    } else {
                                        String::new()
                                    };
                                    cells.push(val);
                                    rcell = &body_rest[ce + 4..];
                                } else {
                                    break;
                                }
                            } else {
                                break;
                            }
                        }
                        if !cells.is_empty() {
                            rows.push(cells);
                        }
                        rest = &rest[re + 6..];
                    } else {
                        break;
                    }
                }
                let paras: Vec<String> = rows.iter().map(|r| r.join("\t")).collect();
                return (paras, Some(rows));
            }
        }
        for e in &entries {
            if e.name == "content.xml" {
                let xml = String::from_utf8_lossy(&e.content);
                let mut rows = Vec::new();
                let mut rest = xml.as_ref();
                while let Some(rs) = rest.find("<table:table-row") {
                    rest = &rest[rs + 16..];
                    if let Some(re) = rest.find("</table:table-row>") {
                        let row_xml = &rest[..re];
                        let mut cells = Vec::new();
                        let mut rcell = row_xml;
                        while let Some(cs) = rcell.find("<table:table-cell") {
                            rcell = &rcell[cs + 17..];
                            if let Some(gt) = rcell.find('>') {
                                let inner = &rcell[gt + 1..];
                                if let Some(ce) = inner.find("</table:table-cell>") {
                                    let cell_txt = strip_html_tags(&inner[..ce]).trim().to_string();
                                    cells.push(cell_txt);
                                    rcell = &inner[ce + 19..];
                                } else {
                                    break;
                                }
                            } else {
                                break;
                            }
                        }
                        if !cells.is_empty() {
                            rows.push(cells);
                        }
                        rest = &rest[re + 18..];
                    } else {
                        break;
                    }
                }
                let paras: Vec<String> = rows.iter().map(|r| r.join("\t")).collect();
                return (paras, Some(rows));
            }
        }
    }
    if lower.ends_with(".docx") || lower.ends_with(".odt") || lower.ends_with(".pptx") {
        let entries = parse_ustar_archive(bytes);
        for e in &entries {
            if e.name == "word/document.xml" {
                let xml = String::from_utf8_lossy(&e.content);
                let mut paras = Vec::new();
                let mut rest = xml.as_ref();
                while let Some(ps) = rest.find("<w:p") {
                    let after_p = &rest[ps + 4..];
                    if !after_p.starts_with('>') && !after_p.starts_with(' ') && !after_p.starts_with('/') {
                        rest = after_p;
                        continue;
                    }
                    if let Some(pe) = after_p.find("</w:p>") {
                        let p_xml = &after_p[..pe];
                        let mut line = String::new();
                        let mut p_rest = p_xml;
                        while let Some(ts) = p_rest.find("<w:t") {
                            let after_t = &p_rest[ts + 4..];
                            if let Some(gt) = after_t.find('>') {
                                let t_inner = &after_t[gt + 1..];
                                if let Some(te) = t_inner.find("</w:t>") {
                                    line.push_str(&xml_unescape_str(&t_inner[..te]));
                                    p_rest = &t_inner[te + 6..];
                                    continue;
                                }
                            }
                            break;
                        }
                        if !line.trim().is_empty() {
                            paras.push(line.trim().to_string());
                        }
                        rest = &after_p[pe + 6..];
                    } else {
                        break;
                    }
                }
                return (paras, None);
            }
            if e.name == "content.xml" {
                let xml = String::from_utf8_lossy(&e.content);
                let stripped = strip_html_tags(&xml);
                let paras: Vec<String> = stripped
                    .lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect();
                return (paras, None);
            }
        }
        let mut slide_entries: Vec<&TarEntry> = entries
            .iter()
            .filter(|e| e.name.starts_with("ppt/slides/slide") && e.name.ends_with(".xml"))
            .collect();
        if !slide_entries.is_empty() {
            slide_entries.sort_by(|a, b| a.name.cmp(&b.name));
            let mut paras = Vec::new();
            for se in slide_entries {
                let xml = String::from_utf8_lossy(&se.content);
                let mut rest = xml.as_ref();
                while let Some(ts) = rest.find("<a:t") {
                    let after_t = &rest[ts + 4..];
                    if let Some(gt) = after_t.find('>') {
                        let inner = &after_t[gt + 1..];
                        if let Some(te) = inner.find("</a:t>") {
                            let val = xml_unescape_str(&inner[..te]);
                            if !val.trim().is_empty() {
                                paras.push(val.trim().to_string());
                            }
                            rest = &inner[te + 6..];
                            continue;
                        }
                    }
                    break;
                }
            }
            return (paras, None);
        }
    }
    if lower.ends_with(".pdf") || bytes.starts_with(b"%PDF-") {
        let doc = PdfDoc::parse(bytes);
        let mut paras = Vec::new();
        for p in doc.pages {
            for l in p.text.lines() {
                if !l.trim().is_empty() {
                    paras.push(l.trim().to_string());
                }
            }
        }
        return (paras, None);
    }
    let text = String::from_utf8_lossy(bytes);
    if lower.ends_with(".rtf") || text.trim_start().starts_with("{\\rtf") {
        return (parse_rtf_paragraphs(&text, fs), None);
    }
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        let stripped = strip_html_tags(&text);
        let paras = stripped
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        return (paras, None);
    }
    if lower.ends_with(".md") {
        let md_rows = parse_markdown_pipe_table_rows(&text);
        let paras = text
            .lines()
            .map(|l| l.trim().trim_start_matches("# ").to_string())
            .filter(|l| !l.is_empty())
            .collect();
        return (paras, if md_rows.is_empty() { None } else { Some(md_rows) });
    }
    let paras = text
        .lines()
        .map(|l| l.trim().trim_start_matches("# ").to_string())
        .filter(|l| !l.is_empty())
        .collect();
    (paras, None)
}

fn parse_qpdf_page_spec(spec: &str, total: usize) -> Vec<usize> {
    let mut selected: Vec<usize> = Vec::new();
    for tok in spec.split(',') {
        let tok = tok.trim();
        if tok.is_empty() {
            continue;
        }
        let is_excl = tok.starts_with('x');
        let rest = if is_excl { &tok[1..] } else { tok };
        let (range_part, parity) = if let Some(r) = rest.strip_suffix(":odd") {
            (r, Some(1usize))
        } else if let Some(r) = rest.strip_suffix(":even") {
            (r, Some(0usize))
        } else {
            (rest, None)
        };
        let resolve_idx = |s: &str| -> usize {
            if s == "z" || s == "end" {
                total.max(1)
            } else if let Some(r) = s.strip_prefix('r') {
                let off: usize = r.parse().unwrap_or(1);
                total.saturating_sub(off.saturating_sub(1)).max(1)
            } else {
                s.parse::<usize>().unwrap_or(1).clamp(1, total.max(1))
            }
        };
        let mut pages = Vec::new();
        if let Some((a, b)) = range_part.split_once('-') {
            let start = resolve_idx(a);
            let end = resolve_idx(b);
            if start <= end {
                for p in start..=end {
                    pages.push(p);
                }
            } else {
                let mut p = start;
                while p >= end {
                    pages.push(p);
                    if p == 1 {
                        break;
                    }
                    p -= 1;
                }
            }
        } else {
            pages.push(resolve_idx(range_part));
        }
        if let Some(par) = parity {
            pages = pages
                .into_iter()
                .enumerate()
                .filter(|(idx, _)| (idx + 1) % 2 == par)
                .map(|(_, p)| p)
                .collect();
        }
        if is_excl {
            selected.retain(|p| !pages.contains(p));
        } else {
            selected.extend(pages);
        }
    }
    selected
}

fn extract_html_headings(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut pos = 0usize;
    while pos < lower.len() {
        let mut best: Option<(usize, &str, &str)> = None;
        for (tag, lvl) in [("h1", "1"), ("h2", "2"), ("h3", "3")] {
            let open = format!("<{tag}");
            if let Some(rel) = lower[pos..].find(&open) {
                let abs = pos + rel;
                let after_ch = lower[abs + open.len()..].chars().next().unwrap_or('>');
                if after_ch == '>' || after_ch.is_ascii_whitespace() {
                    if best.is_none() || abs < best.unwrap().0 {
                        best = Some((abs, tag, lvl));
                    }
                }
            }
        }
        let Some((abs, tag, lvl)) = best else {
            break;
        };
        let Some(gt_rel) = lower[abs..].find('>') else {
            break;
        };
        let content_start = abs + gt_rel + 1;
        let close = format!("</{tag}>");
        let Some(close_rel) = lower[content_start..].find(&close) else {
            pos = content_start;
            continue;
        };
        let inner = strip_html_tags(&html[content_start..content_start + close_rel]);
        let trimmed = inner.split_whitespace().collect::<Vec<_>>().join(" ");
        if !trimmed.is_empty() {
            out.push((trimmed, lvl.to_string()));
        }
        pos = content_start + close_rel + close.len();
    }
    out
}

fn format_qpdf_split_name(template: &str, total: usize, group: usize, start: usize, end: usize) -> String {
    let pad_len = total.max(1).to_string().len();
    let bytes = template.as_bytes();
    let mut out = String::new();
    let mut replaced = false;
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'%' {
            out.push(bytes[i] as char);
            i += 1;
            continue;
        }
        if i + 1 < bytes.len() && bytes[i + 1] == b'%' {
            out.push('%');
            i += 2;
            continue;
        }
        if !replaced {
            let mut j = i + 1;
            let mut zero_pad = false;
            if j < bytes.len() && bytes[j] == b'0' {
                zero_pad = true;
                j += 1;
            }
            let mut digits = String::new();
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                digits.push(bytes[j] as char);
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'd' {
                let width = if digits.is_empty() {
                    pad_len
                } else {
                    digits.parse::<usize>().unwrap_or(pad_len)
                };
                let fmt_n = |n: usize| -> String {
                    if zero_pad || digits.is_empty() {
                        format!("{n:0>width$}")
                    } else {
                        format!("{n}")
                    }
                };
                if group == 1 {
                    out.push_str(&fmt_n(start));
                } else {
                    out.push_str(&format!("{}-{}", fmt_n(start), fmt_n(end)));
                }
                replaced = true;
                i = j + 1;
                continue;
            }
        }
        out.push('%');
        i += 1;
    }
    if replaced {
        return out;
    }
    let stem = if template.to_ascii_lowercase().ends_with(".pdf") {
        &template[..template.len() - 4]
    } else {
        template
    };
    let first = format!("{start:0>pad_len$}");
    let last = format!("{end:0>pad_len$}");
    if group == 1 {
        format!("{stem}-{first}.pdf")
    } else {
        format!("{stem}-{first}-{last}.pdf")
    }
}

fn decode_pdftk_entities(raw: &str) -> String {
    let mut out = String::new();
    let mut rest = raw;
    while let Some(amp) = rest.find("&#") {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 2..];
        if let Some(semi) = after.find(';') {
            let token = &after[..semi];
            let cp_opt = if let Some(hex) = token.strip_prefix('x').or_else(|| token.strip_prefix('X')) {
                u32::from_str_radix(hex, 16).ok()
            } else {
                token.parse::<u32>().ok()
            };
            if let Some(cp) = cp_opt
                && let Some(ch) = char::from_u32(cp)
            {
                out.push(ch);
                rest = &after[semi + 1..];
                continue;
            }
        }
        out.push_str("&#");
        rest = after;
    }
    out.push_str(rest);
    out
}

fn encode_pdftk_text(s: &str, utf8: bool) -> String {
    if utf8 {
        return s.to_string();
    }
    let mut out = String::new();
    for ch in s.chars() {
        let cp = ch as u32;
        if cp > 127 {
            out.push_str(&format!("&#{cp};"));
        } else {
            out.push(ch);
        }
    }
    out
}

fn format_pdf_date(raw: &str, mode: &str) -> String {
    if mode == "raw" {
        return raw.to_string();
    }
    let trimmed = raw.strip_prefix("D:").unwrap_or(raw);
    let bytes = trimmed.as_bytes();
    if bytes.len() < 4 || !bytes[..4].iter().all(|b| b.is_ascii_digit()) {
        return raw.to_string();
    }
    let year = &trimmed[0..4];
    let mut pos = 4usize;
    let take_pair = |p: &mut usize| -> Option<&str> {
        if *p + 2 <= bytes.len() && bytes[*p].is_ascii_digit() && bytes[*p + 1].is_ascii_digit() {
            let s = &trimmed[*p..*p + 2];
            *p += 2;
            Some(s)
        } else {
            None
        }
    };
    let month = take_pair(&mut pos).unwrap_or("01");
    let day = take_pair(&mut pos).unwrap_or("01");
    let hour = take_pair(&mut pos).unwrap_or("00");
    let minute = take_pair(&mut pos).unwrap_or("00");
    let second = take_pair(&mut pos).unwrap_or("00");
    let mut tz_sign: Option<char> = None;
    let mut tz_hour = "00";
    let mut tz_min = "00";
    if pos < bytes.len() {
        let sc = bytes[pos] as char;
        if matches!(sc, 'Z' | 'z' | '+' | '-') {
            tz_sign = Some(sc);
            pos += 1;
            if let Some(th) = take_pair(&mut pos) {
                tz_hour = th;
                if pos < bytes.len() && bytes[pos] == b'\'' {
                    pos += 1;
                }
                if let Some(tm) = take_pair(&mut pos) {
                    tz_min = tm;
                }
            }
        }
    }
    if mode == "iso" {
        let suffix = match tz_sign {
            None | Some('Z') | Some('z') => "Z".to_string(),
            Some(_) if tz_hour == "00" && tz_min == "00" => "Z".to_string(),
            Some(s) if tz_min == "00" => format!("{s}{tz_hour}"),
            Some(s) => format!("{s}{tz_hour}:{tz_min}"),
        };
        return format!("{year}-{month}-{day}T{hour}:{minute}:{second}{suffix}");
    }
    let y_num = year.parse::<i64>().unwrap_or(1970);
    let m_num = month.parse::<usize>().unwrap_or(1).clamp(1, 12);
    let d_num = day.parse::<i64>().unwrap_or(1).clamp(1, 31);
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let t: [i64; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y_adj = if m_num < 3 { y_num - 1 } else { y_num };
    let dow = ((y_adj + y_adj / 4 - y_adj / 100 + y_adj / 400 + t[m_num - 1] + d_num)
        .rem_euclid(7)) as usize;
    format!(
        "{} {} {:2} {hour}:{minute}:{second} {year} UTC",
        days[dow], months[m_num - 1], d_num
    )
}

fn paper_size_label(w: f64, h: f64) -> &'static str {
    let matches_dim = |cw: f64, ch: f64, tol: f64| -> bool {
        ((w - cw).abs() <= tol && (h - ch).abs() <= tol)
            || ((w - ch).abs() <= tol && (h - cw).abs() <= tol)
    };
    if matches_dim(612.0, 792.0, 1.0) {
        " (letter)"
    } else if matches_dim(595.28, 841.89, 2.5) {
        " (A4)"
    } else if matches_dim(841.89, 1190.55, 3.0) {
        " (A3)"
    } else if matches_dim(419.53, 595.28, 2.0) {
        " (A5)"
    } else if matches_dim(612.0, 1008.0, 2.0) {
        " (legal)"
    } else if matches_dim(498.9, 708.66, 2.5) {
        " (B5)"
    } else {
        ""
    }
}

fn has_pdfseparate_spec(pattern: &str) -> bool {
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != '%' {
            i += 1;
            continue;
        }
        if chars.get(i + 1) == Some(&'%') {
            i += 2;
            continue;
        }
        let mut j = i + 1;
        while j < chars.len() && chars[j].is_ascii_digit() {
            j += 1;
        }
        if chars.get(j) == Some(&'d') {
            return true;
        }
        i += 1;
    }
    false
}

fn format_printf_num(pattern: &str, num: usize) -> String {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::new();
    let mut replaced = false;
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != '%' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        if chars.get(i + 1) == Some(&'%') {
            out.push('%');
            i += 2;
            continue;
        }
        if !replaced {
            let mut j = i + 1;
            let mut digits = String::new();
            while j < chars.len() && chars[j].is_ascii_digit() {
                digits.push(chars[j]);
                j += 1;
            }
            if chars.get(j) == Some(&'d') {
                let width: usize = digits.parse().unwrap_or(0);
                if width > 0 {
                    if digits.starts_with('0') {
                        out.push_str(&format!("{num:0width$}", width = width));
                    } else {
                        out.push_str(&format!("{num:>width$}", width = width));
                    }
                } else {
                    out.push_str(&num.to_string());
                }
                replaced = true;
                i = j + 1;
                continue;
            }
        }
        out.push('%');
        i += 1;
    }
    out
}

#[derive(Clone, Debug)]
struct SvgEl {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<SvgChild>,
}

#[derive(Clone, Debug)]
enum SvgChild {
    El(SvgEl),
    Text(String),
}

impl SvgEl {
    fn get_attr(&self, key: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
    fn set_attr(&mut self, key: &str, val: String) {
        if let Some(pair) = self.attrs.iter_mut().find(|(k, _)| k == key) {
            pair.1 = val;
        } else {
            self.attrs.push((key.to_string(), val));
        }
    }
}

fn parse_svg_xml(source: &str) -> Result<SvgEl, String> {
    parse_svg_xml_impl(source, true)
}

fn parse_svg_xml_impl(source: &str, require_svg_root: bool) -> Result<SvgEl, String> {
    let bytes = source.as_bytes();
    let mut roots: Vec<SvgEl> = Vec::new();
    let mut stack: Vec<SvgEl> = Vec::new();
    let mut i = 0usize;
    let is_ws = |b: u8| matches!(b, b' ' | b'\n' | b'\t' | b'\r');
    let skip_ws = |idx: &mut usize| {
        while *idx < bytes.len() && is_ws(bytes[*idx]) {
            *idx += 1;
        }
    };
    let read_name = |idx: &mut usize| -> Result<String, String> {
        let start = *idx;
        while *idx < bytes.len() && !is_ws(bytes[*idx]) && !b"/=<>\"'".contains(&bytes[*idx]) {
            *idx += 1;
        }
        if *idx == start {
            return Err(format!("Malformed SVG at offset {}", *idx));
        }
        Ok(source[start..*idx].to_string())
    };
    while i < bytes.len() {
        if bytes[i] != b'<' {
            let start = i;
            while i < bytes.len() && bytes[i] != b'<' {
                i += 1;
            }
            let txt = &source[start..i];
            if let Some(top) = stack.last_mut() {
                top.children.push(SvgChild::Text(txt.to_string()));
            } else if !txt.trim().is_empty() {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            continue;
        }
        if source[i..].starts_with("<!--") {
            let Some(rel) = source[i + 4..].find("-->") else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            i += 4 + rel + 3;
            continue;
        }
        if source[i..].starts_with("<?") {
            let Some(rel) = source[i + 2..].find("?>") else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            i += 2 + rel + 2;
            continue;
        }
        if source[i..].starts_with("<![CDATA[") {
            let Some(rel) = source[i + 9..].find("]]>") else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            let end = i + 9 + rel + 3;
            let Some(top) = stack.last_mut() else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            top.children.push(SvgChild::Text(source[i..end].to_string()));
            i = end;
            continue;
        }
        if source[i..].starts_with("<!DOCTYPE") {
            let mut quote = 0u8;
            let mut brackets = 0i32;
            i += 9;
            while i < bytes.len() {
                let c = bytes[i];
                i += 1;
                if quote != 0 {
                    if c == quote {
                        quote = 0;
                    }
                } else if c == b'"' || c == b'\'' {
                    quote = c;
                } else if c == b'[' {
                    brackets += 1;
                } else if c == b']' {
                    brackets -= 1;
                } else if c == b'>' && brackets == 0 {
                    break;
                }
            }
            continue;
        }
        i += 1;
        if i < bytes.len() && bytes[i] == b'/' {
            i += 1;
            let closing = read_name(&mut i)?;
            skip_ws(&mut i);
            if i >= bytes.len() || bytes[i] != b'>' {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            i += 1;
            let Some(popped) = stack.pop() else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            if popped.name != closing {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            if let Some(parent) = stack.last_mut() {
                parent.children.push(SvgChild::El(popped));
            } else {
                roots.push(popped);
            }
            continue;
        }
        let el_name = read_name(&mut i)?;
        let mut attrs: Vec<(String, String)> = Vec::new();
        skip_ws(&mut i);
        while i < bytes.len() && bytes[i] != b'>' && bytes[i] != b'/' {
            let key = read_name(&mut i)?;
            skip_ws(&mut i);
            if i >= bytes.len() || bytes[i] != b'=' {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            i += 1;
            skip_ws(&mut i);
            if i >= bytes.len() || (bytes[i] != b'"' && bytes[i] != b'\'') {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            let quote = bytes[i];
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i] != quote {
                if bytes[i] == b'<' {
                    return Err(format!("Malformed SVG at offset {i}"));
                }
                i += 1;
            }
            if i >= bytes.len() || attrs.iter().any(|(k, _)| k == &key) {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            let val = source[start..i].replace('"', "&quot;");
            attrs.push((key, val));
            i += 1;
            skip_ws(&mut i);
        }
        let el = SvgEl {
            name: el_name,
            attrs,
            children: Vec::new(),
        };
        if i < bytes.len() && bytes[i] == b'/' {
            i += 1;
            if i >= bytes.len() || bytes[i] != b'>' {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            i += 1;
            if let Some(parent) = stack.last_mut() {
                parent.children.push(SvgChild::El(el));
            } else {
                roots.push(el);
            }
        } else {
            if i >= bytes.len() || bytes[i] != b'>' {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            i += 1;
            stack.push(el);
            if stack.len() > 256 {
                return Err("SVG nesting exceeds 256".to_string());
            }
        }
    }
    if !stack.is_empty() || roots.len() != 1 || (require_svg_root && roots[0].name != "svg") {
        return Err(format!("Malformed SVG at offset {i}"));
    }
    Ok(roots.remove(0))
}

fn svg_read_number(source: &str, start: usize) -> Option<(f64, usize)> {
    let bytes = source.as_bytes();
    let mut i = start;
    if i < bytes.len() && (bytes[i] == b'-' || bytes[i] == b'+') {
        i += 1;
    }
    let mut digits = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        digits += 1;
        i += 1;
    }
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            digits += 1;
            i += 1;
        }
    }
    if digits == 0 {
        return None;
    }
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        let before = i;
        i += 1;
        if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
            i += 1;
        }
        let exp = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp {
            i = before;
        }
    }
    let val: f64 = source[start..i].parse().ok()?;
    if val.is_finite() { Some((val, i)) } else { None }
}

fn svg_format_num(n: f64, precision: usize) -> String {
    let s = format!("{n:.precision$}", precision = precision);
    let parsed: f64 = s.parse().unwrap_or(0.0);
    if parsed == 0.0 {
        "0".to_string()
    } else {
        format!("{parsed}")
    }
}

fn svg_round_list(source: &str, precision: usize) -> String {
    let mut result = String::new();
    let mut i = 0usize;
    while i < source.len() {
        if let Some((val, end)) = svg_read_number(source, i) {
            result.push_str(&svg_format_num(val, precision));
            i = end;
        } else {
            let ch = source[i..].chars().next().unwrap();
            result.push(ch);
            i += ch.len_utf8();
        }
    }
    result
}

fn svg_compact_path(source: &str, precision: usize) -> String {
    let arity = |c: char| -> Option<usize> {
        match c.to_ascii_uppercase() {
            'M' | 'L' | 'T' => Some(2),
            'H' | 'V' => Some(1),
            'S' | 'Q' => Some(4),
            'C' => Some(6),
            'A' => Some(7),
            'Z' => Some(0),
            _ => None,
        }
    };
    let bytes = source.as_bytes();
    let is_sep = |b: u8| matches!(b, b' ' | b'\n' | b'\t' | b'\r' | b',');
    let mut result = String::new();
    let mut command: Option<char> = None;
    let mut i = 0usize;
    let mut x = 0.0f64;
    let mut y = 0.0f64;
    let mut sx = 0.0f64;
    let mut sy = 0.0f64;
    while i < bytes.len() {
        while i < bytes.len() && is_sep(bytes[i]) {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let ch = bytes[i] as char;
        if arity(ch).is_some() {
            command = Some(ch);
            i += 1;
            if ch.eq_ignore_ascii_case(&'Z') {
                result.push('Z');
                x = sx;
                y = sy;
                command = None;
                continue;
            }
        }
        let Some(cmd_ch) = command else {
            return source.to_string();
        };
        let count = arity(cmd_ch).unwrap_or(0);
        let mut values: Vec<f64> = Vec::with_capacity(count);
        for _ in 0..count {
            while i < bytes.len() && is_sep(bytes[i]) {
                i += 1;
            }
            let Some((val, end)) = svg_read_number(source, i) else {
                return source.to_string();
            };
            values.push(val);
            i = end;
        }
        let upper = cmd_ch.to_ascii_uppercase();
        let relative = cmd_ch != upper;
        let mut emitted = cmd_ch;
        if matches!(upper, 'M' | 'L' | 'T') {
            let nx = values[0] + if relative { x } else { 0.0 };
            let ny = values[1] + if relative { y } else { 0.0 };
            if upper == 'L' && svg_format_num(ny, precision) == svg_format_num(y, precision) {
                emitted = 'H';
                values = vec![nx];
            } else if upper == 'L' && svg_format_num(nx, precision) == svg_format_num(x, precision) {
                emitted = 'V';
                values = vec![ny];
            }
            x = nx;
            y = ny;
            if upper == 'M' {
                sx = x;
                sy = y;
            }
        } else if upper == 'H' {
            x = values[0] + if relative { x } else { 0.0 };
        } else if upper == 'V' {
            y = values[0] + if relative { y } else { 0.0 };
        } else if values.len() >= 2 {
            x = values[values.len() - 2] + if relative { x } else { 0.0 };
            y = values[values.len() - 1] + if relative { y } else { 0.0 };
        }
        result.push(emitted);
        let formatted: Vec<String> = values.into_iter().map(|v| svg_format_num(v, precision)).collect();
        result.push_str(&formatted.join(" "));
        if upper == 'M' {
            command = Some(if relative { 'l' } else { 'L' });
        }
    }
    result
}

fn optimize_svg_str(source: &str, precision: usize, pretty: bool, indent: usize) -> Result<String, String> {
    let mut root = parse_svg_xml(source)?;
    let is_num_attr = |k: &str| {
        matches!(
            k,
            "x" | "y"
                | "x1"
                | "y1"
                | "x2"
                | "y2"
                | "cx"
                | "cy"
                | "r"
                | "rx"
                | "ry"
                | "width"
                | "height"
                | "stroke-width"
                | "stroke-opacity"
                | "fill-opacity"
                | "opacity"
                | "font-size"
                | "offset"
        )
    };
    fn visit_el(
        mut el: SvgEl,
        precision: usize,
        is_num_attr: &dyn Fn(&str) -> bool,
    ) -> Vec<SvgChild> {
        if el.name == "metadata" {
            return Vec::new();
        }
        for (k, v) in &mut el.attrs {
            if k == "d" {
                *v = svg_compact_path(v, precision);
            } else if k == "viewBox" || k == "points" || k == "transform" {
                *v = svg_round_list(v, precision);
            } else if is_num_attr(k)
                && let Some((num, end)) = svg_read_number(v, 0)
            {
                *v = format!("{}{}", svg_format_num(num, precision), &v[end..]);
            }
        }
        let old_children = std::mem::take(&mut el.children);
        for ch in old_children {
            match ch {
                SvgChild::Text(t) => el.children.push(SvgChild::Text(t)),
                SvgChild::El(sub) => el.children.extend(visit_el(sub, precision, is_num_attr)),
            }
        }
        if el.name == "g" && el.attrs.is_empty() {
            return el.children;
        }
        vec![SvgChild::El(el)]
    }
    if let Some(SvgChild::El(r)) = visit_el(root, precision, &is_num_attr).into_iter().next() {
        root = r;
    } else {
        return Err("Malformed SVG".to_string());
    }
    if root.get_attr("viewBox").is_none() {
        let w_str = root.get_attr("width").unwrap_or("").to_string();
        let h_str = root.get_attr("height").unwrap_or("").to_string();
        if let (Some((wv, we)), Some((hv, he))) = (svg_read_number(&w_str, 0), svg_read_number(&h_str, 0)) {
            let wu = &w_str[we..];
            let hu = &h_str[he..];
            if wv > 0.0 && hv > 0.0 && (wu.is_empty() || wu == "px") && (hu.is_empty() || hu == "px") {
                root.set_attr(
                    "viewBox",
                    format!("0 0 {} {}", svg_format_num(wv, precision), svg_format_num(hv, precision)),
                );
            }
        }
    } else if let Some(vb) = root.get_attr("viewBox").map(|s| s.to_string()) {
        let vals: Vec<&str> = vb
            .split(|c: char| matches!(c, ',' | ' ' | '\t' | '\r' | '\n'))
            .filter(|s| !s.is_empty())
            .collect();
        if vals.len() == 4 {
            let parsed: Vec<Option<f64>> = vals.iter().map(|v| v.parse::<f64>().ok().filter(|n| n.is_finite())).collect();
            if parsed.iter().all(|o| o.is_some()) {
                let formatted: Vec<String> = parsed
                    .into_iter()
                    .map(|o| svg_format_num(o.unwrap(), precision))
                    .collect();
                root.set_attr("viewBox", formatted.join(" "));
            }
        }
    }
    fn serialize_svg(el: &SvgEl, depth: usize, pretty: bool, indent: usize) -> String {
        let mut attrs = String::new();
        for (k, v) in &el.attrs {
            attrs.push_str(&format!(" {k}=\"{v}\""));
        }
        if pretty
            && !el.children.is_empty()
            && el.children.iter().all(|c| matches!(c, SvgChild::El(_)))
            && el.name != "text"
            && el.name != "tspan"
        {
            let mut inner = Vec::new();
            for ch in &el.children {
                if let SvgChild::El(sub) = ch {
                    inner.push(format!(
                        "{}{}",
                        " ".repeat((depth + 1) * indent),
                        serialize_svg(sub, depth + 1, pretty, indent)
                    ));
                }
            }
            return format!(
                "<{}{}>\n{}\n{}</{}>",
                el.name,
                attrs,
                inner.join("\n"),
                " ".repeat(depth * indent),
                el.name
            );
        }
        if el.children.is_empty() {
            format!("<{}{}/>", el.name, attrs)
        } else {
            let mut inner = String::new();
            for ch in &el.children {
                match ch {
                    SvgChild::Text(t) => inner.push_str(t),
                    SvgChild::El(sub) => inner.push_str(&serialize_svg(sub, depth + 1, pretty, indent)),
                }
            }
            format!("<{}{}>{}</{}>", el.name, attrs, inner, el.name)
        }
    }
    Ok(serialize_svg(&root, 0, pretty, indent))
}

fn parse_svg_length_px(val: Option<&str>, fallback: f64) -> Result<f64, String> {
    let Some(v) = val else {
        return Ok(fallback);
    };
    let (scale, num_str) = if let Some(s) = v.strip_suffix("px") {
        (1.0, s)
    } else if let Some(s) = v.strip_suffix("pt") {
        (96.0 / 72.0, s)
    } else if let Some(s) = v.strip_suffix("in") {
        (96.0, s)
    } else if let Some(s) = v.strip_suffix("cm") {
        (96.0 / 2.54, s)
    } else if let Some(s) = v.strip_suffix("mm") {
        (96.0 / 25.4, s)
    } else if let Some(s) = v.strip_suffix("pc") {
        (16.0, s)
    } else {
        (1.0, v)
    };
    let n: f64 = num_str
        .trim()
        .parse()
        .map_err(|_| format!("Unsupported SVG length {v}"))?;
    if !n.is_finite() {
        return Err(format!("Unsupported SVG length {v}"));
    }
    Ok(n * scale)
}

fn collect_svg_texts(el: &SvgEl, out: &mut Vec<String>) {
    if el.name == "text" {
        let mut t = String::new();
        for ch in &el.children {
            if let SvgChild::Text(s) = ch {
                t.push_str(&xml_unescape_str(s));
            }
        }
        if !t.is_empty() {
            out.push(t);
        }
        return;
    }
    for ch in &el.children {
        if let SvgChild::El(sub) = ch {
            collect_svg_texts(sub, out);
        }
    }
}

fn svg_tokens(source: &str) -> Result<Vec<Result<f64, char>>, String> {
    let bytes = source.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_whitespace() || b == b',' {
            i += 1;
            continue;
        }
        if !b"0123456789.+-".contains(&b) {
            let ch = source[i..].chars().next().unwrap();
            out.push(Err(ch));
            i += ch.len_utf8();
            continue;
        }
        let start = i;
        i += 1;
        while i < bytes.len() && b"0123456789.".contains(&bytes[i]) {
            i += 1;
        }
        if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
            i += 1;
            if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
                i += 1;
            }
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
        }
        let num: f64 = source[start..i]
            .parse()
            .map_err(|_| "Invalid SVG number".to_string())?;
        if !num.is_finite() {
            return Err("Invalid SVG number".to_string());
        }
        out.push(Ok(num));
    }
    Ok(out)
}

fn svg_numbers(source: &str) -> Result<Vec<f64>, String> {
    let mut out = Vec::new();
    for tok in svg_tokens(source)? {
        match tok {
            Ok(n) => out.push(n),
            Err(_) => return Err("Expected SVG number".to_string()),
        }
    }
    Ok(out)
}

fn svg_validate_path(source: &str) -> Result<(), String> {
    let input = svg_tokens(source)?;
    if !input.is_empty() && !matches!(input[0], Err('M') | Err('m')) {
        return Err("SVG path must begin with moveto".to_string());
    }
    let mut i = 0usize;
    let mut command = '\0';
    let take_num = |idx: &mut usize| -> Result<f64, String> {
        let Some(tok) = input.get(*idx) else {
            return Err("Invalid SVG path".to_string());
        };
        *idx += 1;
        match tok {
            Ok(n) => Ok(*n),
            Err(_) => Err("Invalid SVG path".to_string()),
        }
    };
    while i < input.len() {
        if let Err(ch) = input[i] {
            command = ch;
            i += 1;
        }
        let upper = command.to_ascii_uppercase();
        match upper {
            'Z' => {
                command = '\0';
            }
            'M' | 'L' | 'T' => {
                take_num(&mut i)?;
                take_num(&mut i)?;
                if upper == 'M' {
                    command = if command == 'm' { 'l' } else { 'L' };
                }
            }
            'H' | 'V' => {
                take_num(&mut i)?;
            }
            'C' => {
                for _ in 0..6 {
                    take_num(&mut i)?;
                }
            }
            'S' | 'Q' => {
                for _ in 0..4 {
                    take_num(&mut i)?;
                }
            }
            _ => return Err(format!("Unsupported SVG path command {command}")),
        }
    }
    Ok(())
}

fn svg_validate_transforms(source: &str) -> Result<(), String> {
    let bytes = source.as_bytes();
    let mut offset = 0usize;
    while offset < bytes.len() {
        while offset < bytes.len() && (bytes[offset].is_ascii_whitespace() || bytes[offset] == b',') {
            offset += 1;
        }
        if offset == bytes.len() {
            break;
        }
        let Some(open_rel) = source[offset..].find('(') else {
            return Err("Invalid SVG transform".to_string());
        };
        let open = offset + open_rel;
        let Some(close_rel) = source[open..].find(')') else {
            return Err("Invalid SVG transform".to_string());
        };
        let close = open + close_rel;
        let name = source[offset..open].trim();
        let args = svg_numbers(&source[open + 1..close])?;
        let ok = match name {
            "matrix" => args.len() == 6,
            "translate" | "scale" => (1..=2).contains(&args.len()),
            "rotate" => args.len() == 1 || args.len() == 3,
            _ => false,
        };
        if !ok {
            return Err(format!("Unsupported SVG transform {name}"));
        }
        offset = close + 1;
    }
    Ok(())
}

fn validate_and_extract_svg_render(source: &str) -> Result<(f64, f64, Vec<String>), String> {
    let root = parse_svg_xml_impl(source, false)?;
    let root_local = root.name.rsplit(':').next().unwrap_or(&root.name);
    if root_local != "svg" {
        return Err("Expected SVG document".to_string());
    }
    let root_attrs: BTreeMap<String, String> = root
        .attrs
        .iter()
        .map(|(k, v)| (k.rsplit(':').next().unwrap_or(k).to_string(), xml_unescape_str(v)))
        .collect();
    if let Some(par) = root_attrs.get("preserveAspectRatio")
        && par != "xMidYMid meet"
        && par != "xMidYMid"
    {
        return Err("Unsupported SVG preserveAspectRatio".to_string());
    }
    let vbox = if let Some(vb) = root_attrs.get("viewBox") {
        let nums = svg_numbers(vb)?;
        if nums.len() != 4 || nums[2] <= 0.0 || nums[3] <= 0.0 {
            return Err("Invalid SVG viewBox".to_string());
        }
        Some(nums)
    } else {
        None
    };
    let width = parse_svg_length_px(
        root_attrs.get("width").map(|s| s.as_str()),
        vbox.as_ref().map(|b| b[2]).unwrap_or(300.0),
    )?;
    let height = parse_svg_length_px(
        root_attrs.get("height").map(|s| s.as_str()),
        vbox.as_ref().map(|b| b[3]).unwrap_or(150.0),
    )?;
    let pixels = width.ceil() * height.ceil();
    if !(width > 0.0 && height > 0.0) || !pixels.is_finite() || pixels > 16_000_000.0 {
        return Err("SVG pixel limit exceeded".to_string());
    }

    fn visit(
        node: &SvgEl,
        inherited: &BTreeMap<String, String>,
        is_root: bool,
        texts: &mut Vec<String>,
    ) -> Result<(), String> {
        let local_name = node.name.rsplit(':').next().unwrap_or(&node.name);
        let mut own: BTreeMap<String, String> = BTreeMap::new();
        for (k, v) in &node.attrs {
            own.insert(k.rsplit(':').next().unwrap_or(k).to_string(), xml_unescape_str(v));
        }
        let mut a = inherited.clone();
        for (k, v) in &own {
            a.insert(k.clone(), v.clone());
        }
        if let Some(style) = own.get("style") {
            for decl in style.split(';') {
                if let Some((sk, sv)) = decl.split_once(':') {
                    a.insert(sk.trim().to_string(), sv.trim().to_string());
                }
            }
        }
        if a.get("display").map(|s| s.as_str()) == Some("none")
            || a.get("visibility").map(|s| s.as_str()) == Some("hidden")
        {
            return Ok(());
        }
        if matches!(local_name, "defs" | "title" | "desc" | "metadata") {
            return Ok(());
        }
        for key in ["clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end"] {
            if let Some(v) = a.get(key)
                && !v.is_empty()
                && v != "none"
            {
                return Err(format!("Unsupported SVG {key}"));
            }
        }
        for key in ["opacity", "fill-opacity", "stroke-opacity"] {
            if let Some(v) = a.get(key)
                && v.trim().parse::<f64>().ok() != Some(1.0)
            {
                return Err(format!("Unsupported SVG {key}"));
            }
        }
        if !is_root && local_name == "svg" {
            return Err("Unsupported nested SVG viewport".to_string());
        }
        if let Some(tf) = own.get("transform") {
            svg_validate_transforms(tf)?;
        }
        if let Some(da) = a.get("stroke-dasharray")
            && !da.is_empty()
            && da != "none"
        {
            let dash = svg_numbers(da)?;
            if dash.is_empty() || dash.iter().any(|&v| v < 0.0) {
                return Err("Invalid SVG dash array".to_string());
            }
            parse_svg_length_px(a.get("stroke-dashoffset").map(|s| s.as_str()), 0.0)?;
        }
        if let Some(lc) = a.get("stroke-linecap")
            && !lc.is_empty()
            && !matches!(lc.as_str(), "butt" | "round" | "square")
        {
            return Err("Invalid SVG stroke-linecap".to_string());
        }
        if let Some(lj) = a.get("stroke-linejoin")
            && !lj.is_empty()
            && !matches!(lj.as_str(), "miter" | "round" | "bevel")
        {
            return Err("Invalid SVG stroke-linejoin".to_string());
        }
        let n = |key: &str, fallback: f64| -> Result<f64, String> {
            parse_svg_length_px(a.get(key).map(|s| s.as_str()), fallback)
        };
        match local_name {
            "svg" | "g" | "a" => {}
            "rect" => {
                let _ = (n("x", 0.0)?, n("y", 0.0)?);
                let rw = n("width", 0.0)?;
                let rh = n("height", 0.0)?;
                let ry_def = n("ry", 0.0)?;
                let rx = n("rx", ry_def)?;
                let ry = n("ry", rx)?;
                if rw < 0.0 || rh < 0.0 || rx < 0.0 || ry < 0.0 {
                    return Err("Negative SVG rectangle size".to_string());
                }
            }
            "line" => {
                let _ = (n("x1", 0.0)?, n("y1", 0.0)?, n("x2", 0.0)?, n("y2", 0.0)?);
            }
            "path" => {
                svg_validate_path(a.get("d").map(|s| s.as_str()).unwrap_or(""))?;
            }
            "polygon" | "polyline" => {
                let pts = svg_numbers(a.get("points").map(|s| s.as_str()).unwrap_or(""))?;
                if pts.len() % 2 != 0 {
                    return Err("Invalid SVG points".to_string());
                }
            }
            "ellipse" | "circle" => {
                let _ = (n("cx", 0.0)?, n("cy", 0.0)?);
                let rx = n(if local_name == "circle" { "r" } else { "rx" }, 0.0)?;
                let ry = n(if local_name == "circle" { "r" } else { "ry" }, 0.0)?;
                if rx < 0.0 || ry < 0.0 {
                    return Err("Negative SVG radius".to_string());
                }
            }
            "text" => {
                if node.children.iter().any(|c| matches!(c, SvgChild::El(_))) {
                    return Err("Unsupported SVG text children".to_string());
                }
                if a.get("fill").map(|s| s.as_str()) != Some("none") {
                    if let Some(st) = a.get("stroke")
                        && !st.is_empty()
                        && st != "none"
                    {
                        return Err("Unsupported SVG text stroke".to_string());
                    }
                    let _ = (n("font-size", 16.0)?, n("x", 0.0)?, n("y", 0.0)?);
                    let mut t = String::new();
                    for ch in &node.children {
                        if let SvgChild::Text(s) = ch {
                            t.push_str(&xml_unescape_str(s));
                        }
                    }
                    if !t.is_empty() {
                        texts.push(t);
                    }
                }
            }
            other => return Err(format!("Unsupported SVG element {other}")),
        }
        if local_name != "text" {
            let mut styles = BTreeMap::new();
            for key in [
                "fill",
                "stroke",
                "stroke-width",
                "fill-rule",
                "font-size",
                "text-anchor",
                "visibility",
                "stroke-dasharray",
                "stroke-dashoffset",
                "stroke-linecap",
                "stroke-linejoin",
            ] {
                if let Some(v) = a.get(key) {
                    styles.insert(key.to_string(), v.clone());
                }
            }
            for ch in &node.children {
                if let SvgChild::El(sub) = ch {
                    visit(sub, &styles, false, texts)?;
                }
            }
        }
        Ok(())
    }

    let mut texts = Vec::new();
    visit(&root, &BTreeMap::new(), true, &mut texts)?;
    Ok((width, height, texts))
}


fn js_math_round(v: f64) -> f64 {
    if !v.is_finite() || v == 0.0 {
        return v;
    }
    if v > 0.0 {
        let f = v.floor();
        if v - f >= 0.5 { f + 1.0 } else { f }
    } else {
        let c = v.ceil();
        if c - v > 0.5 { c - 1.0 } else { c }
    }
}

fn fmt_js_precision_3(val: f64) -> String {
    if !val.is_finite() || val == 0.0 {
        return "0.00".to_string();
    }
    let abs = val.abs();
    let mut exp = abs.log10().floor() as i32;
    let scale = 10f64.powi(exp - 2);
    let mut mant = js_math_round(abs / scale) as i64;
    if mant >= 1000 {
        mant = 100;
        exp += 1;
    }
    let d0 = (mant / 100) % 10;
    let d1 = (mant / 10) % 10;
    let d2 = mant % 10;
    let sign = if val < 0.0 { "-" } else { "" };
    if exp < -6 || exp >= 3 {
        let esign = if exp >= 0 { "+" } else { "-" };
        format!("{sign}{d0}.{d1}{d2}e{esign}{}", exp.abs())
    } else if exp == 2 {
        format!("{sign}{d0}{d1}{d2}")
    } else if exp == 1 {
        format!("{sign}{d0}{d1}.{d2}")
    } else if exp == 0 {
        format!("{sign}{d0}.{d1}{d2}")
    } else {
        let zeros = "0".repeat((-exp - 1) as usize);
        format!("{sign}0.{zeros}{d0}{d1}{d2}")
    }
}

#[derive(Clone, Debug)]
struct WavStreamInfo {
    format_name: String,
    codec: String,
    sample_rate: u32,
    channels: usize,
    bits_per_sample: u32,
    samples: usize,
    duration: f64,
    bitrate: f64,
    tags: Vec<(String, String)>,
}

#[derive(Clone, Debug)]
struct PcmAudio {
    sample_rate: u32,
    channels: Vec<Vec<f64>>,
}

fn probe_wav_info(bytes: &[u8]) -> Result<WavStreamInfo, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Unsupported audio container".to_string());
    }
    let riff_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let end = if riff_size == 0xffffffff {
        bytes.len()
    } else {
        riff_size.saturating_add(8)
    };
    if end > bytes.len() {
        return Err("Truncated binary input".to_string());
    }
    let mut format = 0u16;
    let mut sample_rate = 0u32;
    let mut channels = 0usize;
    let mut bits = 0u32;
    let mut valid_bits = 0u32;
    let mut align = 0usize;
    let mut data_size = 0usize;
    let mut tags: Vec<(String, String)> = Vec::new();
    let mut offset = 12usize;
    while offset < end {
        if offset + 8 > end {
            return Err("WAV chunk exceeds RIFF bounds".to_string());
        }
        let ctype = &bytes[offset..offset + 4];
        let decl_size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let size = if ctype == b"data" && decl_size == 0xffffffff {
            end - start
        } else {
            decl_size
        };
        if size > end - start {
            return Err("WAV chunk exceeds RIFF bounds".to_string());
        }
        if ctype == b"fmt " {
            if size < 16 {
                return Err("Short WAV fmt chunk".to_string());
            }
            format = u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap());
            channels = u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap()) as usize;
            sample_rate = u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap());
            align = u16::from_le_bytes(bytes[start + 12..start + 14].try_into().unwrap()) as usize;
            bits = u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()) as u32;
            valid_bits = bits;
            if format == 0xfffe {
                if size < 40 || u16::from_le_bytes(bytes[start + 16..start + 18].try_into().unwrap()) < 22 {
                    return Err("Short extensible WAV fmt".to_string());
                }
                let vb = u16::from_le_bytes(bytes[start + 18..start + 20].try_into().unwrap()) as u32;
                valid_bits = if vb == 0 { bits } else { vb };
                let guid_tail = &bytes[start + 26..start + 40];
                if guid_tail != [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113] {
                    return Err("Unsupported WAV subformat GUID".to_string());
                }
                format = u16::from_le_bytes(bytes[start + 24..start + 26].try_into().unwrap());
            }
        } else if ctype == b"data" {
            data_size += size;
        } else if ctype == b"LIST" && size >= 4 && &bytes[start..start + 4] == b"INFO" {
            let mut pos = start + 4;
            while pos < start + size {
                if pos + 8 > start + size {
                    return Err("WAV INFO exceeds LIST bounds".to_string());
                }
                let id = String::from_utf8_lossy(&bytes[pos..pos + 4]).to_string();
                let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
                if len > start + size - pos - 8 {
                    return Err("WAV INFO exceeds LIST bounds".to_string());
                }
                let raw_val = &bytes[pos + 8..pos + 8 + len];
                let val = String::from_utf8_lossy(raw_val)
                    .trim_end_matches('\0')
                    .to_string();
                let key = match id.as_str() {
                    "INAM" => "title".to_string(),
                    "IART" => "artist".to_string(),
                    "IPRD" => "album".to_string(),
                    "ITRK" => "track".to_string(),
                    "ICMT" => "comment".to_string(),
                    "ICRD" => "date".to_string(),
                    "IGNR" => "genre".to_string(),
                    "ISFT" => "encoder".to_string(),
                    "ICOP" => "copyright".to_string(),
                    _ => id,
                };
                if let Some(existing) = tags.iter_mut().find(|(k, _)| k == &key) {
                    existing.1 = val;
                } else {
                    tags.push((key, val));
                }
                pos += 8 + len + (len % 2);
            }
        }
        offset = start + size + (size % 2);
    }
    if channels == 0
        || sample_rate == 0
        || align == 0
        || align * 8 != channels * (bits as usize)
        || data_size % align != 0
        || valid_bits > bits
        || valid_bits == 0
    {
        return Err("Inconsistent WAV sample layout".to_string());
    }
    if (format != 1 && format != 3)
        || (format == 1 && !matches!(bits, 8 | 16 | 24 | 32))
        || (format == 3 && !matches!(bits, 32 | 64))
    {
        return Err("Unsupported WAV encoding".to_string());
    }
    let samples = data_size / align;
    let duration = samples as f64 / sample_rate as f64;
    let bitrate = if duration > 0.0 { (bytes.len() as f64 * 8.0) / duration } else { 0.0 };
    Ok(WavStreamInfo {
        format_name: "wav".to_string(),
        codec: if format == 3 { "pcm_float".to_string() } else { "pcm".to_string() },
        sample_rate,
        channels,
        bits_per_sample: bits,
        samples,
        duration,
        bitrate,
        tags,
    })
}

fn decode_wav_pcm(bytes: &[u8]) -> Result<(PcmAudio, WavStreamInfo), String> {
    let info = probe_wav_info(bytes)?;
    let width = (info.bits_per_sample / 8) as usize;
    let mut channels = vec![vec![0.0f64; info.samples]; info.channels];
    let riff_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let end = if riff_size == 0xffffffff {
        bytes.len()
    } else {
        riff_size.saturating_add(8)
    };
    let mut frame = 0usize;
    let mut offset = 12usize;
    while offset < end {
        let ctype = &bytes[offset..offset + 4];
        let decl_size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let size = if ctype == b"data" && decl_size == 0xffffffff {
            end - start
        } else {
            decl_size
        };
        if ctype == b"data" {
            let chunk = &bytes[start..start + size];
            let step = width * info.channels;
            let mut pos_frame = 0usize;
            while pos_frame < chunk.len() {
                for ch in 0..info.channels {
                    let pos = pos_frame + ch * width;
                    let sample = if info.codec == "pcm_float" {
                        if info.bits_per_sample == 32 {
                            f32::from_le_bytes(chunk[pos..pos + 4].try_into().unwrap()) as f64
                        } else {
                            f64::from_le_bytes(chunk[pos..pos + 8].try_into().unwrap())
                        }
                    } else if info.bits_per_sample == 8 {
                        (chunk[pos] as f64 - 128.0) / 128.0
                    } else if info.bits_per_sample == 16 {
                        i16::from_le_bytes(chunk[pos..pos + 2].try_into().unwrap()) as f64 / 32768.0
                    } else if info.bits_per_sample == 24 {
                        let raw = (chunk[pos] as i32)
                            | ((chunk[pos + 1] as i32) << 8)
                            | ((chunk[pos + 2] as i32) << 16);
                        let signed = if raw >= 0x800000 { raw - 0x1000000 } else { raw };
                        signed as f64 / 8388608.0
                    } else {
                        i32::from_le_bytes(chunk[pos..pos + 4].try_into().unwrap()) as f64 / 2147483648.0
                    };
                    if !sample.is_finite() {
                        return Err("Non-finite PCM sample".to_string());
                    }
                    channels[ch][frame] = sample;
                }
                pos_frame += step;
                frame += 1;
            }
        }
        offset = start + size + (size % 2);
    }
    Ok((
        PcmAudio {
            sample_rate: info.sample_rate,
            channels,
        },
        info,
    ))
}

fn encode_wav_pcm(pcm: &PcmAudio, bits: u32, floating: bool) -> Result<Vec<u8>, String> {
    if (floating && !matches!(bits, 32 | 64)) || (!floating && !matches!(bits, 8 | 16 | 24 | 32)) {
        return Err("Unsupported WAV precision".to_string());
    }
    let ch_count = pcm.channels.len();
    let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
    let align = (ch_count * (bits as usize)) / 8;
    let mut fmt = Vec::with_capacity(16);
    fmt.extend_from_slice(&(if floating { 3u16 } else { 1u16 }).to_le_bytes());
    fmt.extend_from_slice(&(ch_count as u16).to_le_bytes());
    fmt.extend_from_slice(&pcm.sample_rate.to_le_bytes());
    fmt.extend_from_slice(&(pcm.sample_rate * (align as u32)).to_le_bytes());
    fmt.extend_from_slice(&(align as u16).to_le_bytes());
    fmt.extend_from_slice(&(bits as u16).to_le_bytes());

    let width = (bits / 8) as usize;
    let mut data = vec![0u8; frames * align];
    let scale = 2f64.powi((bits as i32) - 1);
    for frame in 0..frames {
        for ch in 0..ch_count {
            let pos = frame * align + ch * width;
            let value = pcm.channels[ch][frame];
            if floating {
                if bits == 32 {
                    data[pos..pos + 4].copy_from_slice(&(value as f32).to_le_bytes());
                } else {
                    data[pos..pos + 8].copy_from_slice(&value.to_le_bytes());
                }
            } else {
                let sample = js_math_round(value * scale).clamp(-scale, scale - 1.0) as i64;
                if bits == 8 {
                    data[pos] = (sample + 128) as u8;
                } else if bits == 16 {
                    data[pos..pos + 2].copy_from_slice(&(sample as i16).to_le_bytes());
                } else if bits == 24 {
                    data[pos] = (sample & 0xff) as u8;
                    data[pos + 1] = ((sample >> 8) & 0xff) as u8;
                    data[pos + 2] = ((sample >> 16) & 0xff) as u8;
                } else {
                    data[pos..pos + 4].copy_from_slice(&(sample as i32).to_le_bytes());
                }
            }
        }
    }

    let push_chunk = |out: &mut Vec<u8>, tag: &[u8; 4], payload: &[u8]| {
        out.extend_from_slice(tag);
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(payload);
        if payload.len() % 2 == 1 {
            out.push(0);
        }
    };
    let mut body = Vec::new();
    body.extend_from_slice(b"WAVE");
    push_chunk(&mut body, b"fmt ", &fmt);
    if floating {
        push_chunk(&mut body, b"fact", &(frames as u32).to_le_bytes());
    }
    push_chunk(&mut body, b"data", &data);
    let mut riff = Vec::with_capacity(8 + body.len());
    riff.extend_from_slice(b"RIFF");
    riff.extend_from_slice(&(body.len() as u32).to_le_bytes());
    riff.extend_from_slice(&body);
    Ok(riff)
}

fn sox_numeric(text: Option<&str>, label: &str) -> Result<f64, String> {
    let Some(t) = text else {
        return Err(format!("Missing {label}"));
    };
    let trimmed = t.trim();
    if trimmed.is_empty() {
        return Err(format!("Missing {label}"));
    }
    match trimmed.parse::<f64>() {
        Ok(v) if v.is_finite() => Ok(v),
        _ => Err(format!("Invalid {label}: {t}")),
    }
}

fn sox_seconds(text: Option<&str>, rate: u32) -> Result<f64, String> {
    let Some(t) = text else {
        return Err("Missing time".to_string());
    };
    let val = if let Some(prefix) = t.strip_suffix('s') {
        sox_numeric(Some(prefix), "sample position")? / (rate as f64)
    } else if t.contains(':') {
        let mut sum = 0.0f64;
        for part in t.split(':') {
            sum = sum * 60.0 + sox_numeric(Some(part), "time")?;
        }
        sum
    } else {
        sox_numeric(Some(t), "time")?
    };
    if val < 0.0 {
        return Err("Negative time".to_string());
    }
    Ok(val)
}

fn sox_stats(pcm: &PcmAudio) -> (f64, f64, f64, f64, f64, f64) {
    let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
    let mut peak = 0.0f64;
    let mut sum = 0.0f64;
    let mut squares = 0.0f64;
    for ch in &pcm.channels {
        for &v in ch {
            if v.abs() > peak {
                peak = v.abs();
            }
            sum += v;
            squares += v * v;
        }
    }
    let count = (frames * pcm.channels.len()) as f64;
    let rms = if count > 0.0 { (squares / count).sqrt() } else { 0.0 };
    let peak_dbfs = 20.0 * peak.log10();
    let rms_dbfs = 20.0 * rms.log10();
    let dc_offset = if count > 0.0 { sum / count } else { 0.0 };
    let crest = if rms > 0.0 { peak / rms } else { 0.0 };
    (peak, rms, peak_dbfs, rms_dbfs, dc_offset, crest)
}

fn sox_remix(pcm: &PcmAudio, count: usize, matrix: Option<Vec<Vec<f64>>>) -> Result<PcmAudio, String> {
    if count == 0 || count > 64 {
        return Err("Invalid output channel count".to_string());
    }
    let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
    let in_ch = pcm.channels.len();
    let weights = match matrix {
        Some(m) => m,
        None => (0..count)
            .map(|out_i| {
                (0..in_ch)
                    .map(|in_i| {
                        if count == 1 {
                            1.0 / (in_ch as f64)
                        } else if in_ch == 1 || out_i == in_i {
                            1.0
                        } else {
                            0.0
                        }
                    })
                    .collect()
            })
            .collect(),
    };
    let channels = weights
        .into_iter()
        .map(|row| {
            (0..frames)
                .map(|i| {
                    row.iter()
                        .enumerate()
                        .fold(0.0, |acc, (ch, &w)| acc + w * pcm.channels[ch][i])
                })
                .collect()
        })
        .collect();
    Ok(PcmAudio {
        sample_rate: pcm.sample_rate,
        channels,
    })
}

fn sox_resample(pcm: &PcmAudio, target_rate: u32) -> PcmAudio {
    let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
    let ratio = (target_rate as f64) / (pcm.sample_rate as f64);
    let length = js_math_round((frames as f64) * ratio) as usize;
    let cutoff = ratio.min(1.0);
    let radius = (24.0 / cutoff).ceil();
    let channels = pcm
        .channels
        .iter()
        .map(|ch| {
            (0..length)
                .map(|i| {
                    if frames == 0 {
                        return 0.0;
                    }
                    let position = (i as f64) / ratio;
                    let j_min = (position - radius).ceil().max(0.0) as usize;
                    let j_max = (position + radius).floor().min((frames - 1) as f64) as usize;
                    let mut sum = 0.0f64;
                    let mut weight = 0.0f64;
                    for j in j_min..=j_max {
                        let distance = position - (j as f64);
                        let x = std::f64::consts::PI * distance * cutoff;
                        let sinc = if x == 0.0 { 1.0 } else { x.sin() / x };
                        let win = 0.5 + 0.5 * ((std::f64::consts::PI * distance) / radius).cos();
                        let w = sinc * win;
                        sum += ch[j] * w;
                        weight += w;
                    }
                    if weight != 0.0 { sum / weight } else { 0.0 }
                })
                .collect()
        })
        .collect();
    PcmAudio {
        sample_rate: target_rate,
        channels,
    }
}

fn run_audio_info(
    prefix: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut flag: Option<&str> = None;
    let mut files: Vec<&str> = Vec::new();
    for arg in args {
        if arg.starts_with('-') && arg != "-" {
            if flag.is_some()
                || !matches!(
                    arg.as_str(),
                    "-t" | "-r" | "-c" | "-s" | "-d" | "-D" | "-b" | "-B" | "-a"
                )
            {
                return err_out(&format!("{prefix}: Unsupported info option {arg}\n"), 1);
            }
            flag = Some(arg.as_str());
        } else {
            files.push(arg.as_str());
        }
    }
    if files.is_empty() || files.len() > 64 {
        return err_out(&format!("{prefix}: Expected bounded input files\n"), 1);
    }
    let mut text = String::new();
    for file in files {
        let data = if file == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, file);
            let Ok(b) = fs.read_file(&full) else {
                return err_out(&format!("{prefix}: {file}: No such file or directory\n"), 1);
            };
            b
        };
        let info = match probe_wav_info(&data) {
            Ok(i) => i,
            Err(e) => return err_out(&format!("{prefix}: {e}\n"), 1),
        };
        let hh = (info.duration / 3600.0).floor() as u64;
        let mm = ((info.duration / 60.0).floor() as u64) % 60;
        let ss = info.duration % 60.0;
        let duration = format!("{hh:02}:{mm:02}:{ss:05.2}");
        let bitrate_str = format!("{}k", fmt_js_precision_3(info.bitrate / 1000.0));
        let comments = info
            .tags
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("\n");
        if let Some(fl) = flag {
            let v = match fl {
                "-t" => info.format_name,
                "-r" => info.sample_rate.to_string(),
                "-c" => info.channels.to_string(),
                "-s" => info.samples.to_string(),
                "-d" => duration,
                "-D" => format!("{:.6}", info.duration),
                "-b" => info.bits_per_sample.to_string(),
                "-B" => bitrate_str,
                "-a" => comments,
                _ => String::new(),
            };
            text.push_str(&v);
            text.push('\n');
        } else {
            text.push_str(&format!(
                "\nInput File     : '{file}'\nChannels       : {}\nSample Rate    : {}\nPrecision      : {}-bit\nDuration       : {duration} = {} samples\nBit Rate       : {bitrate_str}\n",
                info.channels, info.sample_rate, info.bits_per_sample, info.samples
            ));
        }
    }
    ok_out(&text)
}

const QR_CAPACITIES: [(usize, [usize; 4]); 41] = [
    (0, [0, 0, 0, 0]),
    (26, [7, 10, 13, 17]),
    (44, [10, 16, 22, 28]),
    (70, [15, 26, 36, 44]),
    (100, [20, 36, 52, 64]),
    (134, [26, 48, 72, 88]),
    (172, [36, 64, 96, 112]),
    (196, [40, 72, 108, 130]),
    (242, [48, 88, 132, 156]),
    (292, [60, 110, 160, 192]),
    (346, [72, 130, 192, 224]),
    (404, [80, 150, 224, 264]),
    (466, [96, 176, 260, 308]),
    (532, [104, 198, 288, 352]),
    (581, [120, 216, 320, 384]),
    (655, [132, 240, 360, 432]),
    (733, [144, 280, 408, 480]),
    (815, [168, 308, 448, 532]),
    (901, [180, 338, 504, 588]),
    (991, [196, 364, 546, 650]),
    (1085, [224, 416, 600, 700]),
    (1156, [224, 442, 644, 750]),
    (1258, [252, 476, 690, 816]),
    (1364, [270, 504, 750, 900]),
    (1474, [300, 560, 810, 960]),
    (1588, [312, 588, 870, 1050]),
    (1706, [336, 644, 952, 1110]),
    (1828, [360, 700, 1020, 1200]),
    (1921, [390, 728, 1050, 1260]),
    (2051, [420, 784, 1140, 1350]),
    (2185, [450, 812, 1200, 1440]),
    (2323, [480, 868, 1290, 1530]),
    (2465, [510, 924, 1350, 1620]),
    (2611, [540, 980, 1440, 1710]),
    (2761, [570, 1036, 1530, 1800]),
    (2876, [570, 1064, 1590, 1890]),
    (3034, [600, 1120, 1680, 1980]),
    (3196, [630, 1204, 1770, 2100]),
    (3362, [660, 1260, 1860, 2220]),
    (3532, [720, 1316, 1950, 2310]),
    (3706, [750, 1372, 2040, 2430]),
];

const QR_BLOCKS: [[usize; 4]; 41] = [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 2, 2],
    [1, 2, 2, 4],
    [1, 2, 4, 4],
    [2, 4, 4, 4],
    [2, 4, 6, 5],
    [2, 4, 6, 6],
    [2, 5, 8, 8],
    [4, 5, 8, 8],
    [4, 5, 8, 11],
    [4, 8, 10, 11],
    [4, 9, 12, 16],
    [4, 9, 16, 16],
    [6, 10, 12, 18],
    [6, 10, 17, 16],
    [6, 11, 16, 19],
    [6, 13, 18, 21],
    [7, 14, 21, 25],
    [8, 16, 20, 25],
    [8, 17, 23, 25],
    [9, 17, 23, 34],
    [9, 18, 25, 30],
    [10, 20, 27, 32],
    [12, 21, 29, 35],
    [12, 23, 34, 37],
    [12, 25, 34, 40],
    [13, 26, 35, 42],
    [14, 28, 38, 45],
    [15, 29, 40, 48],
    [16, 31, 43, 51],
    [17, 33, 45, 54],
    [18, 35, 48, 57],
    [19, 37, 51, 60],
    [19, 38, 53, 63],
    [20, 40, 56, 66],
    [21, 43, 59, 70],
    [22, 45, 62, 74],
    [24, 47, 65, 77],
    [25, 49, 68, 81],
];

const QR_MICRO_ECC: [[usize; 4]; 5] = [
    [0, 0, 0, 0],
    [2, 0, 0, 0],
    [5, 6, 0, 0],
    [6, 8, 0, 0],
    [8, 10, 14, 0],
];

fn qr_gf_mul(mut a: u16, mut b: u16) -> u8 {
    let mut res = 0u16;
    while b != 0 {
        if (b & 1) != 0 {
            res ^= a;
        }
        a <<= 1;
        if (a & 256) != 0 {
            a ^= 0x11d;
        }
        b >>= 1;
    }
    res as u8
}

fn qr_reed_solomon(data: &[u8], degree: usize) -> Vec<u8> {
    let mut poly = vec![0u8; degree + 1];
    poly[0] = 1;
    let mut root = 1u8;
    for n in 0..degree {
        for j in (1..=n + 1).rev() {
            poly[j] = poly[j - 1] ^ qr_gf_mul(poly[j] as u16, root as u16);
        }
        poly[0] = qr_gf_mul(poly[0] as u16, root as u16);
        root = qr_gf_mul(root as u16, 2);
    }
    let mut rem = vec![0u8; degree];
    for &byte in data {
        let factor = byte ^ rem[0];
        rem.copy_within(1..degree, 0);
        rem[degree - 1] = 0;
        for j in 0..degree {
            rem[j] ^= qr_gf_mul(factor as u16, poly[degree - j - 1] as u16);
        }
    }
    rem
}

fn qr_put_bits(bits: &mut Vec<u8>, value: usize, length: usize) {
    for i in (0..length).rev() {
        bits.push(((value >> i) & 1) as u8);
    }
}

fn qr_kanji_value(data: &[u8], offset: usize) -> i32 {
    if offset + 1 >= data.len() {
        return -1;
    }
    let lead = data[offset] as u32;
    let trail = data[offset + 1] as u32;
    let pair = lead * 256 + trail;
    if trail < 0x40
        || trail > 0xfc
        || trail == 0x7f
        || !((0x8140..=0x9ffc).contains(&pair) || (0xe040..=0xebbf).contains(&pair))
    {
        return -1;
    }
    let reduced = pair - if pair <= 0x9ffc { 0x8140 } else { 0xc140 };
    (((reduced >> 8) * 192) + (reduced & 0xff)) as i32
}

fn qr_count_bits(mode: usize, version: usize, micro: bool) -> usize {
    if micro {
        [[3, 4, 5, 6], [0, 3, 4, 5], [0, 0, 4, 5], [0, 0, 3, 4]][mode][version - 1]
    } else {
        let grp = if version < 10 { 0 } else if version < 27 { 1 } else { 2 };
        [[10, 12, 14], [9, 11, 13], [8, 16, 16], [8, 10, 12]][mode][grp]
    }
}

fn qr_payload_bits(mode: usize, count: usize) -> usize {
    match mode {
        0 => (count / 3) * 10 + [0, 4, 7][count % 3],
        1 => (count / 2) * 11 + (count % 2) * 6,
        2 => count * 8,
        _ => count * 13,
    }
}

#[derive(Clone, Copy)]
struct QrEncodeOpts {
    version: usize,
    level: usize,
    byte_mode: bool,
    kanji: bool,
    micro: bool,
    strict: bool,
    append: Option<(usize, usize, u8)>,
}

fn qr_capacity(version: usize, level: usize, micro: bool) -> (usize, usize, usize) {
    if micro {
        let ecc = QR_MICRO_ECC[version][level];
        let bits = if ecc > 0 {
            (version * 2 + 8).pow(2) - 64 - ecc * 8
        } else {
            0
        };
        (bits, ecc, 1)
    } else {
        let (total, eccs) = QR_CAPACITIES[version];
        let ecc = eccs[level];
        ((total - ecc) * 8, ecc, QR_BLOCKS[version][level])
    }
}

fn qr_segments(data: &[u8], version: usize, opts: QrEncodeOpts) -> Result<Vec<u8>, String> {
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    let n = data.len();
    let mut costs = vec![f64::INFINITY; n + 1];
    let mut starts = vec![0usize; n + 1];
    let mut modes = vec![0usize; n + 1];
    costs[0] = 0.0;
    for start in 0..n {
        if !costs[start].is_finite() {
            continue;
        }
        for mode in 0..4usize {
            if (opts.byte_mode && mode != 2) || (mode == 3 && !opts.kanji) {
                continue;
            }
            let cb = qr_count_bits(mode, version, opts.micro);
            if cb == 0 {
                continue;
            }
            let step = if mode == 3 { 2 } else { 1 };
            let max_count = 1usize << cb;
            let mut end = start + step;
            let mut count = 1usize;
            while end <= n && count < max_count {
                let b = data[end - step];
                if (mode == 0 && !b.is_ascii_digit())
                    || (mode == 1 && !ALPHABET.contains(&b))
                    || (mode == 3 && qr_kanji_value(data, end - 2) < 0)
                {
                    break;
                }
                let header = if opts.micro { version - 1 } else { 4 };
                let cost = costs[start] + ((header + cb + qr_payload_bits(mode, count)) as f64);
                if cost < costs[end] {
                    costs[end] = cost;
                    starts[end] = start;
                    modes[end] = mode;
                }
                end += step;
                count += 1;
            }
        }
    }
    if !costs[n].is_finite() {
        return Err("Input is not supported by this symbol version".to_string());
    }
    let mut parts: Vec<(usize, usize, usize)> = Vec::new();
    let mut cur = n;
    while cur > 0 {
        let st = starts[cur];
        parts.push((st, cur, modes[cur]));
        cur = st;
    }
    parts.reverse();
    let mut bits = Vec::new();
    if let Some((idx, total, parity)) = opts.append {
        qr_put_bits(&mut bits, 3, 4);
        qr_put_bits(&mut bits, idx, 4);
        qr_put_bits(&mut bits, total - 1, 4);
        qr_put_bits(&mut bits, parity as usize, 8);
    }
    for (start, end, mode) in parts {
        let mode_ind = if opts.micro { mode } else { [1, 2, 4, 8][mode] };
        let mode_len = if opts.micro { version - 1 } else { 4 };
        qr_put_bits(&mut bits, mode_ind, mode_len);
        let char_count = (end - start) / if mode == 3 { 2 } else { 1 };
        qr_put_bits(&mut bits, char_count, qr_count_bits(mode, version, opts.micro));
        let mut i = start;
        while i < end {
            match mode {
                0 => {
                    let cnt = (end - i).min(3);
                    let mut val = 0usize;
                    for _ in 0..cnt {
                        val = val * 10 + (data[i] - b'0') as usize;
                        i += 1;
                    }
                    qr_put_bits(&mut bits, val, [0, 4, 7, 10][cnt]);
                }
                1 => {
                    let a = ALPHABET.iter().position(|&c| c == data[i]).unwrap();
                    i += 1;
                    if i < end {
                        let b = ALPHABET.iter().position(|&c| c == data[i]).unwrap();
                        i += 1;
                        qr_put_bits(&mut bits, a * 45 + b, 11);
                    } else {
                        qr_put_bits(&mut bits, a, 6);
                    }
                }
                2 => {
                    qr_put_bits(&mut bits, data[i] as usize, 8);
                    i += 1;
                }
                _ => {
                    qr_put_bits(&mut bits, qr_kanji_value(data, i) as usize, 13);
                    i += 2;
                }
            }
        }
    }
    Ok(bits)
}

fn qr_codewords(mut bits: Vec<u8>, version: usize, level: usize, micro: bool) -> Vec<u8> {
    let (cap_bits, cap_ecc, cap_blocks) = qr_capacity(version, level, micro);
    let term = (cap_bits - bits.len()).min(if micro { version * 2 + 1 } else { 4 });
    qr_put_bits(&mut bits, 0, term);
    while bits.len() < cap_bits && bits.len() % 8 != 0 {
        bits.push(0);
    }
    let mut pad = 0usize;
    while bits.len() + 8 <= cap_bits {
        qr_put_bits(&mut bits, if pad % 2 == 1 { 0x11 } else { 0xec }, 8);
        pad += 1;
    }
    while bits.len() < cap_bits {
        bits.push(0);
    }
    let mut bytes = vec![0u8; bits.len().div_ceil(8)];
    for (i, &b) in bits.iter().enumerate() {
        bytes[i >> 3] |= b << (7 - (i & 7));
    }
    if micro {
        for byte in qr_reed_solomon(&bytes, cap_ecc) {
            qr_put_bits(&mut bits, byte as usize, 8);
        }
        return bits;
    }
    let mut data_blocks: Vec<Vec<u8>> = Vec::with_capacity(cap_blocks);
    let mut ecc_blocks: Vec<Vec<u8>> = Vec::with_capacity(cap_blocks);
    let short_len = bytes.len() / cap_blocks;
    let long_cnt = bytes.len() % cap_blocks;
    let mut offset = 0usize;
    for i in 0..cap_blocks {
        let len = short_len + usize::from(i >= cap_blocks - long_cnt);
        let blk = bytes[offset..offset + len].to_vec();
        offset += len;
        ecc_blocks.push(qr_reed_solomon(&blk, cap_ecc / cap_blocks));
        data_blocks.push(blk);
    }
    let mut result = Vec::new();
    for group in [&data_blocks, &ecc_blocks] {
        let max_len = group.iter().map(|b| b.len()).max().unwrap_or(0);
        for i in 0..max_len {
            for blk in group {
                if i < blk.len() {
                    qr_put_bits(&mut result, blk[i] as usize, 8);
                }
            }
        }
    }
    result
}

fn qr_bch(value: usize, poly: usize, degree: usize) -> usize {
    let mut rem = value << degree;
    for bit in (degree..=30).rev() {
        if ((rem >> bit) & 1) != 0 {
            rem ^= poly << (bit - degree);
        }
    }
    (value << degree) | rem
}

fn qr_mask_bit(mask: usize, x: usize, y: usize) -> bool {
    let v = match mask {
        0 => (x + y) % 2,
        1 => y % 2,
        2 => x % 3,
        3 => (x + y) % 3,
        4 => ((y / 2) + (x / 3)) % 2,
        5 => ((x * y) % 2) + ((x * y) % 3),
        6 => (((x * y) % 2) + ((x * y) % 3)) % 2,
        _ => (((x + y) % 2) + ((x * y) % 3)) % 2,
    };
    v == 0
}

fn qr_penalty(grid: &[Vec<bool>]) -> i64 {
    let n = grid.len();
    let mut score = 0i64;
    let mut dark = 0i64;
    for y in 0..n {
        for x in 0..n {
            if grid[y][x] {
                dark += 1;
            }
            if x > 0
                && y > 0
                && grid[y][x] == grid[y - 1][x]
                && grid[y][x] == grid[y][x - 1]
                && grid[y][x] == grid[y - 1][x - 1]
            {
                score += 3;
            }
        }
    }
    for axis in 0..2 {
        for i in 0..n {
            let line: Vec<bool> = (0..n).map(|j| if axis == 1 { grid[j][i] } else { grid[i][j] }).collect();
            let mut run = 1i64;
            for j in 1..=n {
                if j < n && line[j] == line[j - 1] {
                    run += 1;
                } else {
                    if run >= 5 {
                        score += run - 2;
                    }
                    run = 1;
                }
            }
            let mut runs: Vec<(bool, usize)> = vec![(false, n)];
            for &color in &line {
                let last = runs.last_mut().unwrap();
                if last.0 == color {
                    last.1 += 1;
                } else {
                    runs.push((color, 1));
                }
            }
            if !runs.last().unwrap().0 {
                runs.last_mut().unwrap().1 += n;
            } else {
                runs.push((false, n));
            }
            let mut j = 1usize;
            while j + 5 < runs.len() {
                let unit = runs[j].1;
                if runs[j].0
                    && runs[j + 1].1 == unit
                    && runs[j + 2].1 == unit * 3
                    && runs[j + 3].1 == unit
                    && runs[j + 4].1 == unit
                    && (runs[j - 1].1 >= unit * 4 || runs[j + 5].1 >= unit * 4)
                {
                    score += 40;
                }
                j += 1;
            }
        }
    }
    let ratio_penalty = ((((100.0 * (dark as f64)) / ((n * n) as f64) - 50.0).abs()) / 5.0).floor() as i64 * 10;
    score + ratio_penalty
}

fn qr_matrix(bits: &[u8], version: usize, level: usize, micro: bool) -> Vec<Vec<bool>> {
    let n = if micro { 9 + version * 2 } else { 17 + version * 4 };
    let mut base = vec![vec![false; n]; n];
    let mut fixed = vec![vec![false; n]; n];
    let mut set = |x: isize, y: isize, val: bool| {
        if x >= 0 && y >= 0 && (x as usize) < n && (y as usize) < n {
            base[y as usize][x as usize] = val;
            fixed[y as usize][x as usize] = true;
        }
    };
    let mut finder = |cx: isize, cy: isize| {
        for y in -4..=4isize {
            for x in -4..=4isize {
                let d = x.abs().max(y.abs());
                set(cx + x, cy + y, d != 2 && d != 4);
            }
        }
    };
    finder(3, 3);
    if micro {
        for i in 8..n {
            set(i as isize, 0, i % 2 == 0);
            set(0, i as isize, i % 2 == 0);
        }
        for i in 1..=8 {
            set(8, i as isize, false);
            set(i as isize, 8, false);
        }
    } else {
        finder((n as isize) - 4, 3);
        finder(3, (n as isize) - 4);
        for i in 8..(n - 8) {
            set(6, i as isize, i % 2 == 0);
            set(i as isize, 6, i % 2 == 0);
        }
        if version > 1 {
            let count = (version / 7) + 2;
            let step = if version == 32 {
                26
            } else {
                ((n - 13) as f64 / ((count * 2 - 2) as f64)).ceil() as usize * 2
            };
            let mut positions = vec![6isize];
            for i in (0..=(count as isize - 2)).rev() {
                positions.push((n as isize) - 7 - i * (step as isize));
            }
            for yi in 0..count {
                for xi in 0..count {
                    if (xi == 0 && yi == 0)
                        || (xi == 0 && yi == count - 1)
                        || (xi == count - 1 && yi == 0)
                    {
                        continue;
                    }
                    for y in -2..=2isize {
                        for x in -2..=2isize {
                            set(
                                positions[xi] + x,
                                positions[yi] + y,
                                x.abs().max(y.abs()) != 1,
                            );
                        }
                    }
                }
            }
        }
        for i in 0..9 {
            if i != 6 {
                set(8, i as isize, false);
                set(i as isize, 8, false);
            }
        }
        for i in 0..8 {
            set((n - 1 - i) as isize, 8, false);
            set(8, (n - 1 - i) as isize, false);
        }
        set(8, (n - 8) as isize, true);
        if version >= 7 {
            let val = qr_bch(version, 0x1f25, 12);
            for i in 0..18 {
                let bit_val = ((val >> i) & 1) != 0;
                set((n - 11 + (i % 3)) as isize, (i / 3) as isize, bit_val);
                set((i / 3) as isize, (n - 11 + (i % 3)) as isize, bit_val);
            }
        }
    }
    let mut bit_idx = 0usize;
    let mut upward = true;
    let mut right = (n - 1) as isize;
    while right > 0 {
        if !micro && right == 6 {
            right -= 1;
        }
        for row in 0..n {
            let y = if upward { n - 1 - row } else { row };
            for x in [right as usize, (right - 1) as usize] {
                if !fixed[y][x] {
                    base[y][x] = bits.get(bit_idx).copied().unwrap_or(0) != 0;
                    bit_idx += 1;
                }
            }
        }
        upward = !upward;
        right -= 2;
    }
    let mut best = base.clone();
    let mut best_score = if micro { i64::MIN } else { i64::MAX };
    let mask_count = if micro { 4 } else { 8 };
    for mask in 0..mask_count {
        let actual_mask = if micro { [1, 4, 6, 7][mask] } else { mask };
        let mut grid: Vec<Vec<bool>> = (0..n)
            .map(|y| {
                (0..n)
                    .map(|x| {
                        if fixed[y][x] {
                            base[y][x]
                        } else {
                            base[y][x] != qr_mask_bit(actual_mask, x, y)
                        }
                    })
                    .collect()
            })
            .collect();
        if micro {
            let mtype = match version {
                1 => 0,
                2 => 1 + level,
                3 => 3 + level,
                _ => 5 + level,
            };
            let fmt = qr_bch(mtype * 4 + mask, 0x537, 10) ^ 0x4445;
            for i in 0..8 {
                grid[i + 1][8] = ((fmt >> i) & 1) != 0;
            }
            for i in 0..7 {
                grid[8][7 - i] = ((fmt >> (i + 8)) & 1) != 0;
            }
        } else {
            let fmt = qr_bch([1, 0, 3, 2][level] * 8 + mask, 0x537, 10) ^ 0x5412;
            for i in 0..15 {
                let val = ((fmt >> i) & 1) != 0;
                if i < 6 {
                    grid[i][8] = val;
                } else if i < 8 {
                    grid[i + 1][8] = val;
                } else {
                    grid[8][if i == 8 { 7 } else { 14 - i }] = val;
                }
                if i < 8 {
                    grid[8][n - 1 - i] = val;
                } else {
                    grid[n - 15 + i][8] = val;
                }
            }
        }
        let score = if micro {
            let mut a = 0i64;
            let mut b = 0i64;
            for i in 1..n {
                a += i64::from(grid[n - 1][i]);
                b += i64::from(grid[i][n - 1]);
            }
            a.min(b) * 16 + a.max(b)
        } else {
            qr_penalty(&grid)
        };
        if (micro && score > best_score) || (!micro && score < best_score) {
            best = grid;
            best_score = score;
        }
    }
    best
}

fn qr_encode_single(data: &[u8], opts: QrEncodeOpts) -> Result<Vec<Vec<bool>>, String> {
    if data.is_empty() || data.len() > 7089 {
        return Err("Input is empty or exceeds QR capacity".to_string());
    }
    let min_v = if opts.version == 0 { 1 } else { opts.version };
    let max_v = if opts.micro { 4 } else { 40 };
    if min_v < 1 || min_v > max_v || (opts.micro && opts.append.is_some()) {
        return Err("Invalid QR version or level".to_string());
    }
    let mut cached: Option<Vec<u8>> = None;
    let mut cached_group = isize::MIN;
    for version in min_v..=max_v {
        let (cap_bits, _, _) = qr_capacity(version, opts.level, opts.micro);
        if cap_bits == 0 {
            if opts.strict {
                break;
            }
            continue;
        }
        let grp = if opts.micro {
            version as isize
        } else if version < 10 {
            0
        } else if version < 27 {
            1
        } else {
            2
        };
        if grp != cached_group {
            cached = qr_segments(data, version, opts).ok();
            cached_group = grp;
        }
        if let Some(ref bits) = cached
            && bits.len() <= cap_bits
        {
            let cw = qr_codewords(bits.clone(), version, opts.level, opts.micro);
            return Ok(qr_matrix(&cw, version, opts.level, opts.micro));
        }
        if opts.strict {
            break;
        }
    }
    Err("Input does not fit the requested QR symbol".to_string())
}

fn qr_encode_symbols(data: &[u8], opts: QrEncodeOpts, structured: bool) -> Result<Vec<Vec<Vec<bool>>>, String> {
    if !structured {
        return Ok(vec![qr_encode_single(data, opts)?]);
    }
    let mut strict_opts = opts;
    strict_opts.strict = true;
    if let Ok(sym) = qr_encode_single(data, strict_opts) {
        return Ok(vec![sym]);
    }
    let mut parity = 0u8;
    for &b in data {
        parity ^= b;
    }
    let mut parts: Vec<&[u8]> = Vec::new();
    let mut offset = 0usize;
    while offset < data.len() {
        if parts.len() == 16 {
            return Err("Structured append exceeds 16 symbols".to_string());
        }
        let mut low = 0usize;
        let mut high = (data.len() - offset).min(7089);
        while low < high {
            let len = (low + high).div_ceil(2);
            let mut probe_opts = strict_opts;
            probe_opts.append = Some((0, 16, parity));
            if qr_encode_single(&data[offset..offset + len], probe_opts).is_ok() {
                low = len;
            } else {
                high = len - 1;
            }
        }
        if low == 0 {
            return Err("Input does not fit a structured symbol".to_string());
        }
        if opts.kanji && !opts.byte_mode && offset + low < data.len() {
            let mut cursor = offset;
            while cursor < offset + low {
                let b = data[cursor];
                cursor += if (0x81..=0x9f).contains(&b) || (0xe0..=0xeb).contains(&b) { 2 } else { 1 };
            }
            if cursor > offset + low {
                low -= 1;
            }
        }
        parts.push(&data[offset..offset + low]);
        offset += low;
    }
    let mut out = Vec::with_capacity(parts.len());
    for (idx, part) in parts.iter().enumerate() {
        let mut part_opts = strict_opts;
        part_opts.append = Some((idx, parts.len(), parity));
        out.push(qr_encode_single(part, part_opts)?);
    }
    Ok(out)
}

fn qr_fmt_ratio(v: u8) -> String {
    if v == 0 {
        "0".to_string()
    } else if v == 255 {
        "1".to_string()
    } else {
        format!("{}", (v as f64) / 255.0)
    }
}

fn qr_render(
    modules: &[Vec<bool>],
    rtype: &str,
    size: usize,
    margin: usize,
    fg: [u8; 4],
    bg: [u8; 4],
) -> Vec<u8> {
    let n = modules.len();
    let width = n + 2 * margin;
    let pixels = width * size;
    let dark = |x: usize, y: usize| -> bool {
        if x >= margin && y >= margin && x - margin < n && y - margin < n {
            modules[y - margin][x - margin]
        } else {
            false
        }
    };
    if rtype == "PNG" || rtype == "PNG32" {
        let im = ImageMeta {
            fmt: "PNG".to_string(),
            w: pixels as u32,
            h: pixels as u32,
            cs: "sRGB".to_string(),
            exif: BTreeMap::new(),
        };
        return write_image_bytes(&im);
    }
    let mut text = String::new();
    if rtype == "SVG" {
        let color = |c: [u8; 4]| format!("rgb({},{},{})", c[0], c[1], c[2]);
        text.push_str(&format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{pixels}\" height=\"{pixels}\" viewBox=\"0 0 {width} {width}\" shape-rendering=\"crispEdges\">\n<rect width=\"{width}\" height=\"{width}\" fill=\"{}\" fill-opacity=\"{}\"/>\n<path fill=\"{}\" fill-opacity=\"{}\" d=\"",
            color(bg),
            qr_fmt_ratio(bg[3]),
            color(fg),
            qr_fmt_ratio(fg[3])
        ));
        for y in 0..n {
            for x in 0..n {
                if modules[y][x] {
                    text.push_str(&format!("M{} {}h1v1h-1z", x + margin, y + margin));
                }
            }
        }
        text.push_str("\"/>\n</svg>\n");
    } else if rtype == "EPS" {
        let rgb = |c: [u8; 4]| format!("{} {} {}", qr_fmt_ratio(c[0]), qr_fmt_ratio(c[1]), qr_fmt_ratio(c[2]));
        text.push_str(&format!(
            "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 {pixels} {pixels}\n%%EndComments\n{} setrgbcolor\n0 0 {pixels} {pixels} rectfill\n{} setrgbcolor\n",
            rgb(bg),
            rgb(fg)
        ));
        for y in 0..n {
            for x in 0..n {
                if modules[y][x] {
                    text.push_str(&format!(
                        "{} {} {size} {size} rectfill\n",
                        (x + margin) * size,
                        (width - y - margin - 1) * size
                    ));
                }
            }
        }
        text.push_str("showpage\n%%EOF\n");
    } else if rtype == "ASCII" || rtype == "ASCIIi" {
        let inv = rtype == "ASCIIi";
        for y in 0..width {
            for x in 0..width {
                text.push_str(if dark(x, y) != inv { "##" } else { "  " });
            }
            text.push('\n');
        }
    } else if rtype == "ANSI" || rtype == "ANSI256" {
        let white = if rtype == "ANSI" { "\x1b[47m" } else { "\x1b[48;5;231m" };
        let black = if rtype == "ANSI" { "\x1b[40m" } else { "\x1b[48;5;16m" };
        for y in 0..width {
            text.push_str(white);
            let mut prev = false;
            for x in 0..width {
                let val = dark(x, y);
                if val != prev {
                    text.push_str(if val { black } else { white });
                }
                prev = val;
                text.push_str("  ");
            }
            if prev {
                text.push_str(white);
            }
            text.push_str("\x1b[0m\n");
        }
    } else {
        let inv = rtype == "UTF8i";
        let mut y = 0usize;
        while y < width {
            if rtype == "ANSIUTF8" {
                text.push_str("\x1b[40;37;1m");
            }
            for x in 0..width {
                let top = dark(x, y) != inv;
                let bottom = dark(x, y + 1) != inv;
                let idx = usize::from(top) + 2 * usize::from(bottom);
                text.push_str(["█", "▄", "▀", " "][idx]);
            }
            if rtype == "ANSIUTF8" {
                text.push_str("\x1b[0m");
            }
            text.push('\n');
            y += 2;
        }
    }
    text.into_bytes()
}

fn parse_ffmpeg_timestamp(spec: &str) -> Option<f64> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(ms) = trimmed.strip_suffix("ms") {
        return ms.parse::<f64>().ok().map(|v| v / 1000.0);
    }
    if let Some(us) = trimmed.strip_suffix("us") {
        return us.parse::<f64>().ok().map(|v| v / 1_000_000.0);
    }
    if let Some(s) = trimmed.strip_suffix('s')
        && !trimmed.contains(':')
    {
        return s.parse::<f64>().ok();
    }
    if trimmed.contains(':') {
        let parts: Vec<f64> = trimmed
            .split(':')
            .map(|x| x.parse::<f64>().unwrap_or(0.0))
            .collect();
        if parts.len() == 3 {
            return Some(parts[0] * 3600.0 + parts[1] * 60.0 + parts[2]);
        }
        if parts.len() == 2 {
            return Some(parts[0] * 60.0 + parts[1]);
        }
    }
    trimmed.parse::<f64>().ok()
}

fn format_ffmpeg_introspection(flag: &str, cmd: &str) -> Option<String> {
    match flag {
        "-version" | "--version" => Some(format!(
            "{cmd} version 7.1-safe-bash Copyright (c) 2000-2025 the FFmpeg developers\n  built with @poe-code/mp4-ast (registered ASTs: mp4, wav, gif, srt, webvtt, ffmetadata, hls, dash)\n  libavutil      59. 39.100 / 59. 39.100\n  libavcodec     61. 19.100 / 61. 19.100\n  libavformat    61.  7.100 / 61.  7.100\n  libavfilter    10.  4.100 / 10.  4.100\n"
        )),
        "-formats" | "-demuxers" | "-muxers" => Some(
            [
                "File formats:",
                " D. = Demuxing supported",
                " .E = Muxing supported",
                " --",
                " DE mov,mp4,m4a,3gp,3g2,mj2 QuickTime / MOV / MP4",
                " DE matroska,webm        Matroska / WebM",
                " DE wav                  WAV / WAVE (Waveform Audio)",
                " DE gif                  CompuServe Graphics Interchange Format (GIF)",
                " DE srt                  SubRip subtitle",
                " DE webvtt               WebVTT subtitle",
                " DE ffmetadata           FFmpeg metadata in text",
                " DE hls                  Apple HTTP Live Streaming",
                " DE dash                 Dynamic Adaptive Streaming over HTTP",
                "",
            ]
            .join("\n"),
        ),
        "-codecs" | "-decoders" | "-encoders" => Some(
            [
                "Codecs:",
                " D..... = Decoding supported",
                " .E.... = Encoding supported",
                " ..V... = Video codec",
                " ..A... = Audio codec",
                " ------",
                " DEV.LS h264               h264 video",
                " DEV.LS libx264            H.264 / AVC / MPEG-4 AVC",
                " DEV.LS gif                gif video",
                " DEV.LS png                png video",
                " DEV.LS mjpeg              mjpeg video",
                " DEA.L. aac                aac audio",
                " DEA.L. pcm_s16le          pcm_s16le audio",
                " DEA.L. pcm_f32le          pcm_f32le audio",
                " DEA.L. pcm_u8             pcm_u8 audio",
                " DEA.L. mp3                mp3 audio",
                " DEA.L. flac               flac audio",
                " DEA.L. opus               opus audio",
                " DEA.L. vorbis             vorbis audio",
                "",
            ]
            .join("\n"),
        ),
        "-protocols" => Some(
            [
                "Supported file protocols:",
                "Input:",
                "  file",
                "  pipe",
                "  concat",
                "Output:",
                "  file",
                "  pipe",
                "",
            ]
            .join("\n"),
        ),
        "-filters" => Some(
            [
                "Filters:",
                "  scale            V->V       Scale the input video size.",
                "  crop             V->V       Crop the input video.",
                "  pad              V->V       Pad the input video.",
                "  fps              V->V       Force constant framerate.",
                "  hflip            V->V       Horizontally flip the input video.",
                "  vflip            V->V       Vertically flip the input video.",
                "  transpose        V->V       Transpose rows with columns.",
                "  negate           V->V       Negate input video.",
                "  drawbox          V->V       Draw a colored box on the input video.",
                "  overlay          VV->V      Overlay a video source on top of the input.",
                "  hstack           N->V       Stack video inputs horizontally.",
                "  vstack           N->V       Stack video inputs vertically.",
                "  concat           N->N       Concatenate audio and video streams.",
                "  volume           A->A       Change input volume.",
                "",
            ]
            .join("\n"),
        ),
        "-h" | "-help" | "--help" => Some(format!(
            "{}\nusage: {cmd} [options] ...\n",
            if cmd == "ffprobe" {
                "Multimedia stream analyzer (safe-bash pure-AST engine)"
            } else {
                "Hyper fast Audio and Video encoder (safe-bash pure-AST engine)"
            }
        )),
        _ => None,
    }
}

fn parse_lavfi_input_doc(inp: &str) -> Option<MediaDoc> {
    if inp.starts_with("color=")
        || inp.starts_with("testsrc=")
        || inp.starts_with("smptebars=")
        || inp == "color"
        || inp == "testsrc"
        || inp == "smptebars"
    {
        let mut w = 64u32;
        let mut h = 48u32;
        let mut r = 10f64;
        let mut d = 1.0f64;
        let params = inp
            .split_once('=')
            .map(|(_, rest)| if rest.contains('=') { rest } else { inp })
            .unwrap_or(inp);
        for part in params.split(':') {
            if let Some((k, v)) = part.split_once('=') {
                match k {
                    "s" | "size" => {
                        if let Some((ws, hs)) = v.split_once('x') {
                            w = ws.parse().unwrap_or(64);
                            h = hs.parse().unwrap_or(48);
                        }
                    }
                    "r" | "rate" => r = v.parse().unwrap_or(10.0),
                    "d" | "duration" => d = v.parse().unwrap_or(1.0),
                    _ => {}
                }
            }
        }
        let mut doc = MediaDoc::default_video();
        doc.codec_type = "video".to_string();
        doc.codec_name = "h264".to_string();
        doc.format_name = "mp4".to_string();
        doc.width = w;
        doc.height = h;
        doc.fps = r.round() as u32;
        doc.duration = d;
        doc.nb_frames = (r * d).round().max(1.0) as u32;
        return Some(doc);
    }
    if inp.starts_with("sine=")
        || inp.starts_with("anoisesrc=")
        || inp.starts_with("anullsrc=")
        || inp == "sine"
        || inp == "anoisesrc"
        || inp == "anullsrc"
    {
        let mut sr = 16000u32;
        let mut d = 1.0f64;
        let mut ch = 1u32;
        let params = inp
            .split_once('=')
            .map(|(_, rest)| if rest.contains('=') { rest } else { inp })
            .unwrap_or(inp);
        for part in params.split(':') {
            if let Some((k, v)) = part.split_once('=') {
                if k == "sample_rate" || k == "r" {
                    sr = v.parse().unwrap_or(16000);
                } else if k == "duration" || k == "d" {
                    d = v.parse().unwrap_or(1.0);
                } else if k == "channel_layout" || k == "cl" {
                    ch = if v == "stereo" { 2 } else { 1 };
                }
            }
        }
        let mut doc = MediaDoc::default_video();
        doc.codec_type = "audio".to_string();
        doc.codec_name = "pcm_s16le".to_string();
        doc.format_name = "wav".to_string();
        doc.sample_rate = sr;
        doc.duration = d;
        doc.channels = ch;
        return Some(doc);
    }
    None
}

fn eval_dim_expr(expr: &str, iw: u32, ih: u32) -> Option<i32> {
    let s = expr.trim();
    if let Ok(v) = s.parse::<i32>() {
        return Some(v);
    }
    let base = if s.starts_with("iw") || s.starts_with("in_w") {
        Some((iw as f64, s.trim_start_matches("in_w").trim_start_matches("iw")))
    } else if s.starts_with("ih") || s.starts_with("in_h") {
        Some((ih as f64, s.trim_start_matches("in_h").trim_start_matches("ih")))
    } else {
        None
    };
    if let Some((val, rest)) = base {
        let rest = rest.trim();
        if rest.is_empty() {
            return Some(val.round() as i32);
        }
        if let Some(div_s) = rest.strip_prefix('/')
            && let Ok(div) = div_s.trim().parse::<f64>()
            && div > 0.0
        {
            return Some((val / div).round() as i32);
        }
        if let Some(mul_s) = rest.strip_prefix('*')
            && let Ok(mul) = mul_s.trim().parse::<f64>()
        {
            return Some((val * mul).round() as i32);
        }
    }
    None
}

fn apply_vf_chain_to_doc(doc: &mut MediaDoc, vf_chain: &str) {
    for f in vf_chain.split(',') {
        let f = f.trim();
        if f.is_empty() {
            continue;
        }
        let f = if let Some(idx) = f.rfind(']') {
            f[idx + 1..].trim()
        } else {
            f
        };
        let f = if let Some(idx) = f.find('[') {
            f[..idx].trim()
        } else {
            f
        };
        if let Some(rest) = f.strip_prefix("scale=") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                let w_raw = parts[0].strip_prefix("w=").unwrap_or(parts[0]);
                let h_raw = parts[1].strip_prefix("h=").unwrap_or(parts[1]);
                let w_eval = eval_dim_expr(w_raw, doc.width, doc.height).unwrap_or(doc.width as i32);
                let h_eval = eval_dim_expr(h_raw, doc.width, doc.height).unwrap_or(doc.height as i32);
                let (new_w, new_h) = if w_eval < 0 && h_eval > 0 {
                    let mut nw = ((doc.width as f64) * (h_eval as f64) / (doc.height.max(1) as f64)).round() as u32;
                    if w_eval == -2 && nw % 2 == 1 {
                        nw += 1;
                    }
                    (nw.max(1), h_eval as u32)
                } else if h_eval < 0 && w_eval > 0 {
                    let mut nh = ((doc.height as f64) * (w_eval as f64) / (doc.width.max(1) as f64)).round() as u32;
                    if h_eval == -2 && nh % 2 == 1 {
                        nh += 1;
                    }
                    (w_eval as u32, nh.max(1))
                } else {
                    (w_eval.max(1) as u32, h_eval.max(1) as u32)
                };
                doc.width = new_w;
                doc.height = new_h;
            }
        } else if let Some(rest) = f.strip_prefix("crop=") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                let w_raw = parts[0].strip_prefix("w=").unwrap_or(parts[0]);
                let h_raw = parts[1].strip_prefix("h=").unwrap_or(parts[1]);
                if let Some(w) = eval_dim_expr(w_raw, doc.width, doc.height)
                    && w > 0
                {
                    doc.width = w as u32;
                }
                if let Some(h) = eval_dim_expr(h_raw, doc.width, doc.height)
                    && h > 0
                {
                    doc.height = h as u32;
                }
            }
        } else if let Some(rest) = f.strip_prefix("pad=") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                let w_raw = parts[0].strip_prefix("w=").unwrap_or(parts[0]);
                let h_raw = parts[1].strip_prefix("h=").unwrap_or(parts[1]);
                if let Some(w) = eval_dim_expr(w_raw, doc.width, doc.height)
                    && w > 0
                {
                    doc.width = w as u32;
                }
                if let Some(h) = eval_dim_expr(h_raw, doc.width, doc.height)
                    && h > 0
                {
                    doc.height = h as u32;
                }
            }
        } else if let Some(rest) = f.strip_prefix("transpose") {
            let arg = rest.strip_prefix('=').unwrap_or("1");
            if arg == "1" || arg == "2" || arg == "clock" || arg == "cclock" || arg.is_empty() {
                std::mem::swap(&mut doc.width, &mut doc.height);
            }
        } else if let Some(rest) = f.strip_prefix("fps=") {
            let val_s = rest.strip_prefix("fps=").unwrap_or(rest);
            if let Ok(fr) = val_s.parse::<f64>()
                && fr > 0.0
            {
                doc.fps = fr.round() as u32;
                doc.nb_frames = (fr * doc.duration).round().max(1.0) as u32;
            }
        } else if let Some(rest) = f.strip_prefix("tile=")
            && let Some((cs, rs)) = rest.split_once('x')
        {
            let cols: u32 = cs.parse().unwrap_or(1);
            let rows: u32 = rs.parse().unwrap_or(1);
            doc.width *= cols;
            doc.height *= rows;
        }
    }
}

fn cmd_media_doc(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    match cmd {
        "ffmpeg" => {
            for arg in args {
                if let Some(intro) = format_ffmpeg_introspection(arg, "ffmpeg") {
                    return ok_out(&intro);
                }
            }
            let mut inputs: Vec<String> = Vec::new();
            let mut fmt_flag = String::new();
            let mut vf_flags: Vec<String> = Vec::new();
            let mut fc_flag = String::new();
            let mut ar_opt: Option<u32> = None;
            let mut ac_opt: Option<u32> = None;
            let mut framerate_opt: Option<u32> = None;
            let mut ss_opt: Option<f64> = None;
            let mut to_opt: Option<f64> = None;
            let mut t_opt: Option<f64> = None;
            let mut vframes_opt: Option<u32> = None;
            let mut size_opt: Option<(u32, u32)> = None;
            let mut strip_audio = false;
            let mut strip_video = false;
            let mut explicit_no_overwrite = false;
            let mut meta_title: Option<String> = None;
            let mut meta_tags: BTreeMap<String, String> = BTreeMap::new();
            let mut out_arg: Option<String> = None;
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-y" => {
                        explicit_no_overwrite = false;
                        i += 1;
                    }
                    "-n" => {
                        explicit_no_overwrite = true;
                        i += 1;
                    }
                    "-an" => {
                        strip_audio = true;
                        i += 1;
                    }
                    "-vn" => {
                        strip_video = true;
                        i += 1;
                    }
                    "-i" if i + 1 < args.len() => {
                        inputs.push(args[i + 1].clone());
                        i += 2;
                    }
                    "-f" if i + 1 < args.len() => {
                        fmt_flag = args[i + 1].clone();
                        i += 2;
                    }
                    "-vf" | "-filter:v" if i + 1 < args.len() => {
                        vf_flags.push(args[i + 1].clone());
                        i += 2;
                    }
                    "-filter_complex" if i + 1 < args.len() => {
                        fc_flag = args[i + 1].clone();
                        i += 2;
                    }
                    "-ar" if i + 1 < args.len() => {
                        ar_opt = args[i + 1].parse().ok();
                        i += 2;
                    }
                    "-ac" if i + 1 < args.len() => {
                        ac_opt = args[i + 1].parse().ok();
                        i += 2;
                    }
                    "-framerate" | "-r" if i + 1 < args.len() => {
                        framerate_opt = args[i + 1].parse::<f64>().ok().map(|v| v.round() as u32);
                        i += 2;
                    }
                    "-ss" if i + 1 < args.len() => {
                        ss_opt = parse_ffmpeg_timestamp(&args[i + 1]);
                        i += 2;
                    }
                    "-to" if i + 1 < args.len() => {
                        to_opt = parse_ffmpeg_timestamp(&args[i + 1]);
                        i += 2;
                    }
                    "-t" if i + 1 < args.len() => {
                        t_opt = parse_ffmpeg_timestamp(&args[i + 1]);
                        i += 2;
                    }
                    "-frames:v" | "-vframes" if i + 1 < args.len() => {
                        vframes_opt = args[i + 1].parse().ok();
                        i += 2;
                    }
                    "-s" if i + 1 < args.len() => {
                        if let Some((ws, hs)) = args[i + 1].split_once('x')
                            && let (Ok(w), Ok(h)) = (ws.parse::<u32>(), hs.parse::<u32>())
                        {
                            size_opt = Some((w, h));
                        }
                        i += 2;
                    }
                    "-metadata" if i + 1 < args.len() => {
                        if let Some((k, v)) = args[i + 1].split_once('=') {
                            if k == "title" {
                                meta_title = Some(v.to_string());
                            }
                            meta_tags.insert(k.to_string(), v.to_string());
                        }
                        i += 2;
                    }
                    "-af" | "-filter:a" | "-c" | "-codec" | "-c:a" | "-acodec" | "-c:v"
                    | "-vcodec" | "-c:s" | "-scodec" | "-safe" | "-hls_time" | "-b:a" | "-b:v"
                    | "-pix_fmt" | "-v" | "-loglevel" | "-map" | "-movflags" | "-preset"
                    | "-crf" | "-threads" | "-start_number" | "-stream_loop"
                        if i + 1 < args.len() =>
                    {
                        i += 2;
                    }
                    a if !a.starts_with('-') => {
                        out_arg = Some(a.to_string());
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            let out_rel = match out_arg {
                Some(o) => o,
                None => return ok_out(""),
            };
            let out_lower = out_rel.to_ascii_lowercase();
            if out_lower.ends_with(".ass")
                || out_lower.ends_with(".aiff")
                || out_lower.ends_with(".au")
                || out_lower.ends_with(".caf")
            {
                return err_out("ffmpeg: format AST not registered\n", 1);
            }
            let out_full = resolve_posix_path(cwd, &out_rel);
            if explicit_no_overwrite && fs.read_file(&out_full).is_ok() {
                return err_out(&format!("File '{out_rel}' already exists. Exiting.\n"), 1);
            }
            let mut doc = MediaDoc::default_video();
            let mut parsed_input_docs: Vec<MediaDoc> = Vec::new();
            for inp in &inputs {
                if let Some(lavfi_doc) = parse_lavfi_input_doc(inp) {
                    if parsed_input_docs.is_empty() {
                        doc = lavfi_doc.clone();
                    } else if doc.codec_type == "video" && lavfi_doc.codec_type == "audio" {
                        doc.has_audio = true;
                        doc.sample_rate = lavfi_doc.sample_rate;
                        doc.channels = lavfi_doc.channels;
                    } else {
                        doc = lavfi_doc.clone();
                    }
                    parsed_input_docs.push(lavfi_doc);
                } else if let Some(rest) = inp.strip_prefix("concat:") {
                    let mut total_frames = 0u32;
                    let mut total_dur = 0.0f64;
                    for p in rest.split('|') {
                        let f = resolve_posix_path(cwd, p);
                        if let Ok(b) = fs.read_file(&f) {
                            let sub = MediaDoc::parse(&b, &f);
                            doc.width = sub.width;
                            doc.height = sub.height;
                            doc.fps = sub.fps;
                            total_frames += sub.nb_frames;
                            total_dur += sub.duration;
                        }
                    }
                    doc.nb_frames = total_frames.max(1);
                    doc.duration = if total_dur > 0.0 {
                        total_dur
                    } else {
                        (doc.nb_frames as f64) / (doc.fps.max(1) as f64)
                    };
                    parsed_input_docs.push(doc.clone());
                } else if inp.contains('%') {
                    let mut count = 0u32;
                    let mut idx = 1usize;
                    while idx <= 100 {
                        let candidate = resolve_posix_path(cwd, &format_printf_num(inp, idx));
                        if let Ok(b) = fs.read_file(&candidate) {
                            if idx == 1 {
                                let im = read_image_meta(&b, &candidate);
                                doc.width = im.w;
                                doc.height = im.h;
                            }
                            count += 1;
                            idx += 1;
                        } else {
                            break;
                        }
                    }
                    doc.nb_frames = count.max(1);
                    if let Some(fr) = framerate_opt {
                        doc.fps = fr;
                    }
                    doc.duration = (doc.nb_frames as f64) / (doc.fps.max(1) as f64);
                    parsed_input_docs.push(doc.clone());
                } else {
                    let full_in = resolve_posix_path(cwd, inp);
                    if let Ok(b) = fs.read_file(&full_in) {
                        let text = String::from_utf8_lossy(&b);
                        if fmt_flag == "concat" || text.starts_with("ffconcat") {
                            let mut total_frames = 0u32;
                            let mut total_dur = 0.0f64;
                            for line in text.lines() {
                                let t = line.trim();
                                if let Some(r) = t.strip_prefix("file ") {
                                    let p = r.trim().trim_matches('\'').trim_matches('"');
                                    let pf = resolve_posix_path(cwd, p);
                                    if let Ok(pb) = fs.read_file(&pf) {
                                        let sub = MediaDoc::parse(&pb, &pf);
                                        doc.width = sub.width;
                                        doc.height = sub.height;
                                        doc.fps = sub.fps;
                                        total_frames += sub.nb_frames;
                                        total_dur += sub.duration;
                                    }
                                }
                            }
                            doc.nb_frames = total_frames.max(1);
                            doc.duration = if total_dur > 0.0 {
                                total_dur
                            } else {
                                (doc.nb_frames as f64) / (doc.fps.max(1) as f64)
                            };
                            parsed_input_docs.push(doc.clone());
                        } else if full_in.ends_with(".srt") {
                            doc.subtitles = text.to_string();
                        } else if full_in.ends_with(".ffmeta") || text.starts_with(";FFMETADATA1") {
                            let mut cid = 0usize;
                            let mut in_chap = false;
                            for line in text.lines() {
                                if line.trim() == "[CHAPTER]" {
                                    in_chap = true;
                                } else if in_chap
                                    && let Some(t) = line.trim().strip_prefix("title=")
                                {
                                    doc.chapters.push((cid, t.to_string()));
                                    cid += 1;
                                } else if !in_chap
                                    && let Some(t) = line.trim().strip_prefix("title=")
                                {
                                    doc.title = t.to_string();
                                }
                            }
                        } else if parsed_input_docs.is_empty() {
                            let parsed = MediaDoc::parse(&b, &full_in);
                            doc = parsed.clone();
                            parsed_input_docs.push(parsed);
                        } else {
                            let sub = MediaDoc::parse(&b, &full_in);
                            if doc.codec_type == "video" && sub.codec_type == "audio" {
                                doc.has_audio = true;
                                doc.sample_rate = sub.sample_rate;
                                doc.channels = sub.channels;
                            } else if doc.codec_type == "audio" && sub.codec_type == "video" {
                                let sr = doc.sample_rate;
                                let ch = doc.channels;
                                doc = sub.clone();
                                doc.has_audio = true;
                                doc.sample_rate = sr;
                                doc.channels = ch;
                            }
                            parsed_input_docs.push(sub);
                        }
                    } else if inp != "-" && inp != "pipe:0" {
                        return err_out(&format!("{inp}: No such file or directory\n"), 1);
                    }
                }
            }
            if !fc_flag.is_empty() {
                if parsed_input_docs.len() >= 2 {
                    let d0 = &parsed_input_docs[0];
                    let d1 = &parsed_input_docs[1];
                    if fc_flag.contains("vstack") {
                        doc.width = d0.width.max(d1.width);
                        doc.height = parsed_input_docs.iter().map(|d| d.height).sum();
                    } else if fc_flag.contains("hstack") {
                        doc.width = parsed_input_docs.iter().map(|d| d.width).sum();
                        doc.height = d0.height.max(d1.height);
                    } else if fc_flag.contains("concat") {
                        doc.width = d0.width;
                        doc.height = d0.height;
                        doc.fps = d0.fps;
                        doc.nb_frames = parsed_input_docs.iter().map(|d| d.nb_frames).sum();
                        doc.duration = parsed_input_docs.iter().map(|d| d.duration).sum();
                    }
                }
                for stage in fc_flag.split(';') {
                    apply_vf_chain_to_doc(&mut doc, stage);
                }
            }
            for vf_chain in &vf_flags {
                apply_vf_chain_to_doc(&mut doc, vf_chain);
            }
            if let Some((sw, sh)) = size_opt {
                doc.width = sw;
                doc.height = sh;
            }
            if let Some(sr) = ar_opt {
                doc.sample_rate = sr;
            }
            if let Some(ch) = ac_opt {
                doc.channels = ch;
            }
            if let Some(fr) = framerate_opt {
                doc.fps = fr;
                doc.nb_frames = ((doc.fps as f64) * doc.duration).round().max(1.0) as u32;
            }
            if let Some(dur) = t_opt {
                let _ = ss_opt;
                doc.duration = dur;
                doc.nb_frames = ((doc.fps as f64) * dur).round().max(1.0) as u32;
            } else if let Some(to_val) = to_opt {
                let start = ss_opt.unwrap_or(0.0);
                let dur = (to_val - start).max(0.05);
                doc.duration = dur;
                doc.nb_frames = ((doc.fps as f64) * dur).round().max(1.0) as u32;
            } else if let Some(ss_val) = ss_opt
                && ss_val > 0.0
                && ss_val < doc.duration
            {
                doc.duration = (doc.duration - ss_val).max(0.05);
                doc.nb_frames = ((doc.fps as f64) * doc.duration).round().max(1.0) as u32;
            }
            if let Some(vf_cnt) = vframes_opt {
                doc.nb_frames = vf_cnt.max(1);
                doc.duration = (doc.nb_frames as f64) / (doc.fps.max(1) as f64);
            }
            if strip_audio {
                doc.has_audio = false;
            }
            if strip_video {
                doc.codec_type = "audio".to_string();
            }
            if let Some(t) = meta_title {
                doc.title = t.clone();
                doc.tags.insert("title".to_string(), t);
            }
            for (k, v) in meta_tags {
                doc.tags.insert(k, v);
            }
            if out_lower.ends_with(".ffmeta") || fmt_flag == "ffmetadata" {
                let mut ffmeta = String::from(";FFMETADATA1\n");
                if !doc.title.is_empty() && !doc.tags.contains_key("title") {
                    ffmeta.push_str(&format!("title={}\n", doc.title));
                }
                for (k, v) in &doc.tags {
                    ffmeta.push_str(&format!("{k}={v}\n"));
                }
                for (cid, ctitle) in &doc.chapters {
                    ffmeta.push_str(&format!(
                        "[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle={ctitle}\n",
                        cid * 1000,
                        (cid + 1) * 1000
                    ));
                }
                let _ = fs.write_file(&out_full, ffmeta.as_bytes());
                return ok_out("");
            }
            if out_lower.ends_with(".mpd") || fmt_flag == "dash" {
                let mpd = format!(
                    "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" mediaPresentationDuration=\"PT{:.1}S\">\n  <Period>\n    <AdaptationSet mimeType=\"video/mp4\" width=\"{}\" height=\"{}\"/>\n  </Period>\n</MPD>\n",
                    doc.duration, doc.width, doc.height
                );
                let _ = fs.write_file(&out_full, mpd.as_bytes());
                return ok_out("");
            }
            if out_lower.ends_with(".vtt") {
                let vtt = format!("WEBVTT\n\n{}", doc.subtitles.replace(',', "."));
                let _ = fs.write_file(&out_full, vtt.as_bytes());
                return ok_out("");
            }
            if out_lower.ends_with(".srt") {
                let _ = fs.write_file(&out_full, doc.subtitles.as_bytes());
                return ok_out("");
            }
            if out_lower.ends_with(".png") {
                let im = ImageMeta {
                    fmt: "PNG".to_string(),
                    w: doc.width,
                    h: doc.height,
                    cs: "sRGB".to_string(),
                    exif: BTreeMap::new(),
                };
                let bytes = write_image_bytes(&im);
                if out_rel.contains('%') {
                    for idx in 1..=(doc.nb_frames as usize) {
                        let p = resolve_posix_path(cwd, &format_printf_num(&out_rel, idx));
                        let _ = fs.write_file(&p, &bytes);
                    }
                } else {
                    let _ = fs.write_file(&out_full, &bytes);
                }
                return ok_out("");
            }
            if out_lower.ends_with(".wav") {
                doc.codec_type = "audio".to_string();
                doc.codec_name = "pcm_s16le".to_string();
                doc.format_name = "wav".to_string();
            } else if out_lower.ends_with(".gif") {
                doc.codec_name = "gif".to_string();
                doc.format_name = "gif".to_string();
            } else {
                doc.codec_name = "h264".to_string();
                doc.format_name = "mp4".to_string();
            }
            let is_m3u8 = fmt_flag == "hls" || out_lower.ends_with(".m3u8");
            let _ = fs.write_file(&out_full, &doc.serialize(is_m3u8));
            ok_out("")
        }
        "ffprobe" => {
            for arg in args {
                if let Some(intro) = format_ffmpeg_introspection(arg, "ffprobe") {
                    return ok_out(&intro);
                }
            }
            let mut of_fmt = "json".to_string();
            let mut in_arg: Option<String> = None;
            let mut show_entries = String::new();
            let mut select_streams: Option<String> = None;
            let mut count_frames = false;
            let mut count_packets = false;
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-print_format" | "-of" if i + 1 < args.len() => {
                        of_fmt = args[i + 1].clone();
                        i += 2;
                    }
                    "-show_entries" if i + 1 < args.len() => {
                        show_entries = args[i + 1].clone();
                        i += 2;
                    }
                    "-select_streams" if i + 1 < args.len() => {
                        select_streams = Some(args[i + 1].to_ascii_lowercase());
                        i += 2;
                    }
                    "-i" if i + 1 < args.len() => {
                        in_arg = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-v" | "-loglevel" | "-f" if i + 1 < args.len() => {
                        i += 2;
                    }
                    "-count_frames" => {
                        count_frames = true;
                        i += 1;
                    }
                    "-count_packets" => {
                        count_packets = true;
                        i += 1;
                    }
                    a if !a.starts_with('-') => {
                        in_arg = Some(a.to_string());
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            let (raw_bytes, path_str) = match in_arg.as_deref() {
                Some("pipe:0") | Some("-") | None => {
                    (crate::vfs::stream_string_to_bytes(stdin), "pipe:0".to_string())
                }
                Some(p) => {
                    let full = resolve_posix_path(cwd, p);
                    match fs.read_file(&full) {
                        Ok(b) => (b, full),
                        Err(_) => return err_out(&format!("{p}: No such file or directory\n"), 1),
                    }
                }
            };
            let doc = MediaDoc::parse(&raw_bytes, &path_str);
            let dur_val = if doc.duration > 0.0 {
                doc.duration
            } else {
                (doc.nb_frames.max(1) as f64) / (doc.fps.max(1) as f64)
            };
            let want_video = match select_streams.as_deref() {
                Some("a") | Some("a:0") | Some("1") => false,
                _ => doc.codec_type == "video",
            };
            let want_audio = match select_streams.as_deref() {
                Some("v") | Some("v:0") => false,
                Some("0") => doc.codec_type == "audio",
                _ => doc.codec_type == "audio" || doc.has_audio,
            };
            let video_field = |f: &str| -> Option<String> {
                match f.trim() {
                    "index" => Some("0".to_string()),
                    "codec_name" => Some(doc.codec_name.clone()),
                    "codec_type" => Some("video".to_string()),
                    "width" => Some(doc.width.to_string()),
                    "height" => Some(doc.height.to_string()),
                    "nb_frames" | "nb_read_frames" | "nb_read_packets" => {
                        Some(doc.nb_frames.to_string())
                    }
                    "r_frame_rate" | "avg_frame_rate" => Some(format!("{}/1", doc.fps)),
                    "duration" => Some(format!("{dur_val:.6}")),
                    _ => None,
                }
            };
            let audio_field = |f: &str| -> Option<String> {
                let a_codec = if doc.codec_type == "audio" {
                    doc.codec_name.clone()
                } else {
                    "aac".to_string()
                };
                let a_idx = if doc.codec_type == "video" { "1" } else { "0" };
                match f.trim() {
                    "index" => Some(a_idx.to_string()),
                    "codec_name" => Some(a_codec),
                    "codec_type" => Some("audio".to_string()),
                    "sample_rate" => Some(doc.sample_rate.to_string()),
                    "channels" => Some(doc.channels.to_string()),
                    "duration" => Some(format!("{dur_val:.6}")),
                    "nb_frames" | "nb_read_frames" | "nb_read_packets" => {
                        Some(doc.nb_frames.to_string())
                    }
                    _ => None,
                }
            };
            let format_field = |f: &str| -> Option<String> {
                match f.trim() {
                    "filename" => Some(in_arg.clone().unwrap_or_else(|| path_str.clone())),
                    "nb_streams" => Some(
                        if doc.codec_type == "video" && doc.has_audio {
                            "2".to_string()
                        } else {
                            "1".to_string()
                        },
                    ),
                    "format_name" => Some(doc.format_name.clone()),
                    "duration" => Some(format!("{dur_val:.6}")),
                    "size" => Some(raw_bytes.len().to_string()),
                    "title" | "tag:title" => Some(doc.title.clone()),
                    _ => None,
                }
            };
            if of_fmt.starts_with("default") && !show_entries.is_empty() {
                let nokey = of_fmt.contains("nokey=1") || of_fmt.contains("nk=1");
                let nowrappers = of_fmt.contains("noprint_wrappers=1") || of_fmt.contains("nw=1");
                let mut lines: Vec<String> = Vec::new();
                for sec in show_entries.split(':') {
                    if let Some((sec_name, fields)) = sec.split_once('=') {
                        let sec_lower = sec_name.trim().to_ascii_lowercase();
                        if sec_lower == "stream" {
                            if want_video {
                                if !nowrappers {
                                    lines.push("[STREAM]".to_string());
                                }
                                for f in fields.split(',') {
                                    if let Some(v) = video_field(f) {
                                        lines.push(if nokey { v } else { format!("{}={v}", f.trim()) });
                                    }
                                }
                                if !nowrappers {
                                    lines.push("[/STREAM]".to_string());
                                }
                            }
                            if want_audio {
                                if !nowrappers {
                                    lines.push("[STREAM]".to_string());
                                }
                                for f in fields.split(',') {
                                    if let Some(v) = audio_field(f) {
                                        lines.push(if nokey { v } else { format!("{}={v}", f.trim()) });
                                    }
                                }
                                if !nowrappers {
                                    lines.push("[/STREAM]".to_string());
                                }
                            }
                        } else if sec_lower == "format" || sec_lower == "format_tags" {
                            if !nowrappers {
                                lines.push("[FORMAT]".to_string());
                            }
                            for f in fields.split(',') {
                                if let Some(v) = format_field(f) {
                                    lines.push(if nokey { v } else { format!("{}={v}", f.trim()) });
                                }
                            }
                            if !nowrappers {
                                lines.push("[/FORMAT]".to_string());
                            }
                        }
                    }
                }
                if lines.is_empty() {
                    lines.push(doc.nb_frames.to_string());
                }
                return ok_out(&format!("{}\n", lines.join("\n")));
            }
            if of_fmt.starts_with("default=noprint_wrappers=1:nokey=1") {
                return ok_out(&format!("{}\n", doc.nb_frames));
            }
            if of_fmt == "flat" && !show_entries.is_empty() {
                let mut lines: Vec<String> = Vec::new();
                let fmt_flat_val = |k: &str, v: &str| -> String {
                    if matches!(k, "width" | "height" | "channels" | "index") {
                        v.to_string()
                    } else {
                        format!("\"{v}\"")
                    }
                };
                for sec in show_entries.split(':') {
                    if let Some((sec_name, fields)) = sec.split_once('=') {
                        let sec_lower = sec_name.trim().to_ascii_lowercase();
                        if sec_lower == "stream" {
                            if want_video {
                                for f in fields.split(',') {
                                    let ft = f.trim();
                                    if let Some(v) = video_field(ft) {
                                        lines.push(format!("streams.stream.0.{ft}={}", fmt_flat_val(ft, &v)));
                                    }
                                }
                            }
                            if want_audio {
                                let a_idx = if doc.codec_type == "video" { 1 } else { 0 };
                                for f in fields.split(',') {
                                    let ft = f.trim();
                                    if let Some(v) = audio_field(ft) {
                                        lines.push(format!("streams.stream.{a_idx}.{ft}={}", fmt_flat_val(ft, &v)));
                                    }
                                }
                            }
                        } else if sec_lower == "format" || sec_lower == "format_tags" {
                            for f in fields.split(',') {
                                let ft = f.trim();
                                if let Some(v) = format_field(ft) {
                                    lines.push(format!("format.{ft}={}", fmt_flat_val(ft, &v)));
                                }
                            }
                        }
                    }
                }
                return ok_out(&format!("{}\n", lines.join("\n")));
            }
            if of_fmt == "flat" {
                return ok_out(&format!(
                    "streams.stream.0.codec_type=\"{}\"\nstreams.stream.0.codec_name=\"{}\"\nstreams.stream.0.width={}\nstreams.stream.0.height={}\nstreams.stream.0.nb_frames=\"{}\"\nstreams.stream.0.sample_rate=\"{}\"\nstreams.stream.0.channels={}\nformat.format_name=\"{}\"\nformat.duration=\"{dur_val:.6}\"\nformat.tags.title=\"{}\"\n",
                    doc.codec_type,
                    doc.codec_name,
                    doc.width,
                    doc.height,
                    doc.nb_frames,
                    doc.sample_rate,
                    doc.channels,
                    doc.format_name,
                    doc.title
                ));
            }
            if of_fmt.starts_with("compact") {
                let no_key = of_fmt.contains("nk=1") || of_fmt.contains("nokey=1");
                let no_sec = of_fmt.contains("p=0") || of_fmt.contains("print_section=0");
                let mut out = String::new();
                let fields: Vec<&str> = if let Some(s) = show_entries.strip_prefix("stream=") {
                    s.split(':').next().unwrap_or(s).split(',').collect()
                } else {
                    vec!["codec_type", "codec_name", "width", "height"]
                };
                if want_video {
                    let mut parts = Vec::new();
                    if !no_sec {
                        parts.push("stream".to_string());
                    }
                    for f in &fields {
                        if let Some(v) = video_field(f) {
                            parts.push(if no_key { v } else { format!("{}={v}", f.trim()) });
                        }
                    }
                    out.push_str(&parts.join("|"));
                    out.push('\n');
                }
                if want_audio {
                    let mut parts = Vec::new();
                    if !no_sec {
                        parts.push("stream".to_string());
                    }
                    for f in &fields {
                        if let Some(v) = audio_field(f) {
                            parts.push(if no_key { v } else { format!("{}={v}", f.trim()) });
                        }
                    }
                    out.push_str(&parts.join("|"));
                    out.push('\n');
                }
                return ok_out(&out);
            }
            if of_fmt == "csv=p=0" || of_fmt == "csv" {
                let print_sec = of_fmt == "csv";
                if !show_entries.is_empty() {
                    let mut out = String::new();
                    for sec in show_entries.split(':') {
                        if let Some((sec_name, fields_spec)) = sec.split_once('=') {
                            let sec_lower = sec_name.trim().to_ascii_lowercase();
                            if sec_lower == "stream" {
                                if want_video {
                                    let mut vals = Vec::new();
                                    if print_sec {
                                        vals.push("stream".to_string());
                                    }
                                    for f in fields_spec.split(',') {
                                        if let Some(v) = video_field(f) {
                                            vals.push(v);
                                        }
                                    }
                                    if !vals.is_empty() {
                                        out.push_str(&format!("{}\n", vals.join(",")));
                                    }
                                }
                                if want_audio {
                                    let mut vals = Vec::new();
                                    if print_sec {
                                        vals.push("stream".to_string());
                                    }
                                    for f in fields_spec.split(',') {
                                        if let Some(v) = audio_field(f) {
                                            vals.push(v);
                                        }
                                    }
                                    if !vals.is_empty() {
                                        out.push_str(&format!("{}\n", vals.join(",")));
                                    }
                                }
                            } else if sec_lower == "format" || sec_lower == "format_tags" {
                                let mut vals = Vec::new();
                                if print_sec {
                                    vals.push("format".to_string());
                                }
                                for f in fields_spec.split(',') {
                                    if let Some(v) = format_field(f) {
                                        vals.push(v);
                                    }
                                }
                                if !vals.is_empty() {
                                    out.push_str(&format!("{}\n", vals.join(",")));
                                }
                            }
                        }
                    }
                    return ok_out(&out);
                }
                if of_fmt == "csv" {
                    return ok_out(&format!(
                        "stream,0,{},{},{},{},{},{}\n",
                        doc.codec_name,
                        doc.codec_type,
                        doc.width,
                        doc.height,
                        doc.sample_rate,
                        doc.channels
                    ));
                }
            }
            if of_fmt == "default" {
                return ok_out(&format!(
                    "[STREAM]\ncodec_name={}\ncodec_type={}\nwidth={}\nheight={}\nsample_rate={}\nchannels={}\n[/STREAM]\n[FORMAT]\nformat_name={}\n[/FORMAT]\n",
                    doc.codec_name,
                    doc.codec_type,
                    doc.width,
                    doc.height,
                    doc.sample_rate,
                    doc.channels,
                    doc.format_name
                ));
            }
            let chaps_json: Vec<String> = doc
                .chapters
                .iter()
                .map(|(id, t)| format!("{{\"id\":{id},\"tags\":{{\"title\":\"{t}\"}}}}"))
                .collect();
            let read_frames_extra = if count_frames {
                format!(",\"nb_read_frames\":\"{}\"", doc.nb_frames)
            } else {
                String::new()
            };
            let read_packets_extra = if count_packets {
                format!(",\"nb_read_packets\":\"{}\"", doc.nb_frames)
            } else {
                String::new()
            };
            let mut stream_objs = Vec::new();
            if want_video {
                stream_objs.push(format!(
                    "{{\"index\":0,\"codec_type\":\"video\",\"codec_name\":\"{}\",\"width\":{},\"height\":{},\"r_frame_rate\":\"{}/1\",\"nb_frames\":\"{}\",\"duration\":\"{dur_val:.6}\"{read_frames_extra}{read_packets_extra}}}",
                    doc.codec_name, doc.width, doc.height, doc.fps, doc.nb_frames
                ));
            }
            if want_audio {
                let a_codec = if doc.codec_type == "audio" {
                    doc.codec_name.as_str()
                } else {
                    "aac"
                };
                let a_idx = if doc.codec_type == "video" { 1 } else { 0 };
                stream_objs.push(format!(
                    "{{\"index\":{a_idx},\"codec_type\":\"audio\",\"codec_name\":\"{a_codec}\",\"sample_rate\":\"{}\",\"channels\":{},\"duration\":\"{dur_val:.6}\"{read_frames_extra}{read_packets_extra}}}",
                    doc.sample_rate, doc.channels
                ));
            }
            let stream_json = stream_objs.join(",");
            ok_out(&format!(
                "{{\"streams\":[{stream_json}],\"format\":{{\"format_name\":\"{}\",\"duration\":\"{dur_val:.6}\",\"tags\":{{\"title\":\"{}\"}}}},\"chapters\":[{}]}}\n",
                doc.format_name,
                doc.title,
                chaps_json.join(",")
            ))
        }
        "soffice" | "libreoffice" => {
            let mut outdir = cwd.to_string();
            let mut convert_to: Option<String> = None;
            let mut cat_mode = false;
            let mut files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                let arg = args[i].as_str();
                if arg == "--" {
                    for f in &args[i + 1..] {
                        files.push(f.clone());
                    }
                    break;
                }
                if arg == "--help" || arg == "-h" || arg == "-help" || arg == "-?" {
                    return ok_out(
                        "LibreOffice 24.8 (@poe-code/pdf-ast)\nUsage: soffice --headless --convert-to <format> [--outdir <dir>] <files...>\n",
                    );
                }
                if arg == "--version" || arg == "-version" {
                    return ok_out("LibreOffice 24.8.0.0 (@poe-code/pdf-ast)\n");
                }
                if arg == "--cat" || arg == "-cat" {
                    cat_mode = true;
                    i += 1;
                    continue;
                }
                let opt = arg
                    .strip_prefix("--")
                    .or_else(|| arg.strip_prefix('-'))
                    .unwrap_or("");
                let (opt_name, eq_val) = match opt.split_once('=') {
                    Some((n, v)) => (n, Some(v)),
                    None => (opt, None),
                };
                if matches!(
                    opt_name,
                    "convert-to" | "outdir" | "infilter" | "pidfile" | "language"
                ) {
                    let val = if let Some(v) = eq_val {
                        if v.is_empty() {
                            return err_out(&format!("Error: {arg} requires a value\n"), 1);
                        }
                        i += 1;
                        v.to_string()
                    } else {
                        let next = args.get(i + 1).map(|s| s.as_str()).unwrap_or("");
                        if next.is_empty() || next.starts_with('-') {
                            return err_out(&format!("Error: {arg} requires a value\n"), 1);
                        }
                        i += 2;
                        next.to_string()
                    };
                    if opt_name == "convert-to" {
                        convert_to = Some(val);
                    } else if opt_name == "outdir" {
                        outdir = resolve_posix_path(cwd, &val);
                    }
                } else if arg.starts_with('-') {
                    i += 1;
                } else {
                    files.push(arg.to_string());
                    i += 1;
                }
            }
            if cat_mode && convert_to.is_none() && !files.is_empty() {
                let mut out = String::new();
                for f in &files {
                    let full = resolve_posix_path(cwd, f);
                    let bytes = match fs.read_file(&full) {
                        Ok(b) => b,
                        Err(_) => {
                            return err_out(
                                &format!("Error: source file '{f}' could not be loaded\n"),
                                1,
                            )
                        }
                    };
                    let (paras, _) = read_office_source(&full, &bytes, fs);
                    for p in paras {
                        out.push_str(&p);
                        out.push('\n');
                    }
                }
                return ok_out(&out);
            }
            let conv_spec = match convert_to {
                Some(s) if !files.is_empty() => s,
                _ => {
                    return err_out(
                        "Error: --convert-to and at least one input file are required\n",
                        1,
                    )
                }
            };
            let _ = fs.mkdir_all(&outdir);
            let first_colon = conv_spec.find(':');
            let second_colon = first_colon.and_then(|fc| conv_spec[fc + 1..].find(':').map(|sc| fc + 1 + sc));
            let target_ext = match first_colon {
                Some(fc) => conv_spec[..fc].to_ascii_lowercase(),
                None => conv_spec.to_ascii_lowercase(),
            };
            let filter_name_raw = match (first_colon, second_colon) {
                (Some(fc), Some(sc)) => Some(&conv_spec[fc + 1..sc]),
                (Some(fc), None) => Some(&conv_spec[fc + 1..]),
                _ => None,
            };
            let filter_opts = second_colon.map(|sc| &conv_spec[sc + 1..]);
            let mut stdout_msg = String::new();
            for f in &files {
                let full = resolve_posix_path(cwd, f);
                let bytes = match fs.read_file(&full) {
                    Ok(b) => b,
                    Err(_) => {
                        return err_out(
                            &format!("Error: source file '{f}' could not be loaded\n"),
                            1,
                        )
                    }
                };
                let fname = f.rsplit('/').next().unwrap_or(f);
                let stem = fname
                    .rsplit_once('.')
                    .map(|(s, _)| s)
                    .unwrap_or(fname);
                let lower_in = fname.to_ascii_lowercase();
                let dest = format!("{}/{stem}.{target_ext}", outdir.trim_end_matches('/'));
                let default_filter = if target_ext == "pdf" {
                    if lower_in.ends_with(".xlsx") || lower_in.ends_with(".csv") || lower_in.ends_with(".ods") {
                        "calc_pdf_Export".to_string()
                    } else if lower_in.ends_with(".pptx") || lower_in.ends_with(".odp") {
                        "impress_pdf_Export".to_string()
                    } else {
                        "writer_pdf_Export".to_string()
                    }
                } else if target_ext == "csv" {
                    "Text - txt - csv (StarCalc)".to_string()
                } else {
                    format!("{target_ext}_Export")
                };
                let filter_name = match filter_name_raw {
                    Some(s) if !s.is_empty() => s.to_string(),
                    _ => default_filter,
                };
                let (paras, rows_opt) = read_office_source(&full, &bytes, fs);
                match target_ext.as_str() {
                    "pdf" => {
                        let mut pdf = if full.to_ascii_lowercase().ends_with(".pdf") {
                            PdfDoc::parse(&bytes)
                        } else {
                            let mut d = PdfDoc::new();
                            let body = paras.join("\n");
                            d.pages.push(PdfPage {
                                rot: 0,
                                text: body.clone(),
                                html: format!("<p>{}</p>", html_escape_str(&body)),
                                images: Vec::new(),
                                urls: Vec::new(),
                            });
                            d
                        };
                        pdf.version = "1.7".to_string();
                        if conv_spec.contains("\"value\":16") || conv_spec.contains("\"value\": 16")
                        {
                            pdf.version = "1.6".to_string();
                        } else if conv_spec.contains("\"value\":15") {
                            pdf.version = "1.5".to_string();
                        } else if conv_spec.contains("\"value\":14") {
                            pdf.version = "1.4".to_string();
                        }
                        if let Some(pr_idx) = conv_spec.find("\"PageRange\"") {
                            let after = &conv_spec[pr_idx..];
                            if let Some(v_idx) = after.find("\"value\":\"") {
                                let r = &after[v_idx + 9..];
                                if let Some(end_q) = r.find('"') {
                                    let range_str = &r[..end_q];
                                    let sel = parse_qpdf_page_spec(range_str, pdf.pages.len());
                                    let mut new_pages = Vec::new();
                                    for pno in sel {
                                        if let Some(pg) = pdf.pages.get(pno - 1) {
                                            new_pages.push(pg.clone());
                                        }
                                    }
                                    if !new_pages.is_empty() {
                                        pdf.pages = new_pages;
                                    }
                                }
                            }
                        }
                        let _ = fs.write_file(&dest, &pdf.serialize());
                    }
                    "docx" | "odt" => {
                        let mut doc_xml = String::from(
                            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>",
                        );
                        for p in &paras {
                            doc_xml.push_str(&format!(
                                "<w:p><w:r><w:t>{}</w:t></w:r></w:p>",
                                html_escape_str(p)
                            ));
                        }
                        doc_xml.push_str("</w:body></w:document>\n");
                        let ct_xml = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"></Types>\n".to_vec();
                        let entries = vec![
                            TarEntry {
                                name: "[Content_Types].xml".to_string(),
                                typeflag: b'0',
                                mode: 0o644,
                                mtime: 1700000000,
                                uid: 0,
                                gid: 0,
                                linkname: String::new(),
                                content: ct_xml,
                            },
                            TarEntry {
                                name: "word/document.xml".to_string(),
                                typeflag: b'0',
                                mode: 0o644,
                                mtime: 1700000000,
                                uid: 0,
                                gid: 0,
                                linkname: String::new(),
                                content: doc_xml.into_bytes(),
                            },
                        ];
                        let _ = fs.write_file(&dest, &serialize_ustar_archive(&entries));
                    }
                    "xlsx" | "ods" => {
                        let rows = rows_opt.unwrap_or_else(|| {
                            paras
                                .iter()
                                .map(|l| l.split(',').map(|c| c.to_string()).collect())
                                .collect()
                        });
                        let mut sheet_xml = String::from(
                            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<worksheet><sheetData>",
                        );
                        for (r_idx, row) in rows.iter().enumerate() {
                            sheet_xml.push_str(&format!("<row r=\"{}\">", r_idx + 1));
                            for (c_idx, cell) in row.iter().enumerate() {
                                let col_char = (b'A' + (c_idx as u8)) as char;
                                sheet_xml.push_str(&format!(
                                    "<c r=\"{col_char}{}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
                                    r_idx + 1,
                                    html_escape_str(cell)
                                ));
                            }
                            sheet_xml.push_str("</row>");
                        }
                        sheet_xml.push_str("</sheetData></worksheet>\n");
                        let entries = vec![
                            TarEntry {
                                name: "[Content_Types].xml".to_string(),
                                typeflag: b'0',
                                mode: 0o644,
                                mtime: 1700000000,
                                uid: 0,
                                gid: 0,
                                linkname: String::new(),
                                content: b"<Types/>".to_vec(),
                            },
                            TarEntry {
                                name: "xl/workbook.xml".to_string(),
                                typeflag: b'0',
                                mode: 0o644,
                                mtime: 1700000000,
                                uid: 0,
                                gid: 0,
                                linkname: String::new(),
                                content: b"<workbook/>".to_vec(),
                            },
                            TarEntry {
                                name: "xl/worksheets/sheet1.xml".to_string(),
                                typeflag: b'0',
                                mode: 0o644,
                                mtime: 1700000000,
                                uid: 0,
                                gid: 0,
                                linkname: String::new(),
                                content: sheet_xml.into_bytes(),
                            },
                        ];
                        let _ = fs.write_file(&dest, &serialize_ustar_archive(&entries));
                    }
                    "csv" => {
                        let mut delim = ',';
                        let mut quote = '"';
                        let mut quote_all = false;
                        if let Some(fopts) = filter_opts {
                            let fparts: Vec<&str> = fopts.split(',').collect();
                            if let Some(first_num) = fparts.first()
                                && let Ok(code) = first_num.parse::<u8>()
                                && code > 0
                            {
                                delim = code as char;
                            }
                            if let Some(second_num) = fparts.get(1)
                                && let Ok(code) = second_num.parse::<u8>()
                                && code > 0
                            {
                                quote = code as char;
                            }
                            quote_all = fparts.get(6) == Some(&"true") || fopts.ends_with(",true");
                        }
                        let rows = rows_opt.unwrap_or_else(|| {
                            paras
                                .iter()
                                .map(|l| l.split(',').map(|c| c.to_string()).collect())
                                .collect()
                        });
                        let mut csv_out = String::new();
                        let q_str = quote.to_string();
                        let qq_str = format!("{quote}{quote}");
                        for r in rows {
                            let formatted_cells: Vec<String> = r
                                .into_iter()
                                .map(|c| {
                                    let must_quote = quote_all
                                        || c.contains(delim)
                                        || c.contains(quote)
                                        || c.contains('\n')
                                        || c.contains('\r');
                                    if must_quote {
                                        let escaped = c.replace(&q_str, &qq_str);
                                        format!("{quote}{escaped}{quote}")
                                    } else {
                                        c
                                    }
                                })
                                .collect();
                            let d_str = delim.to_string();
                            csv_out.push_str(&formatted_cells.join(&d_str));
                            csv_out.push('\n');
                        }
                        let _ = fs.write_file(&dest, csv_out.as_bytes());
                    }
                    "html" => {
                        let mut html_out = String::from("<!DOCTYPE html>\n<html><body>");
                        if let Some(rows) = rows_opt {
                            html_out.push_str("<table>");
                            for r in rows {
                                html_out.push_str("<tr>");
                                for c in r {
                                    html_out.push_str(&format!("<td>{}</td>", html_escape_str(&c)));
                                }
                                html_out.push_str("</tr>");
                            }
                            html_out.push_str("</table>");
                        } else {
                            for (idx, p) in paras.iter().enumerate() {
                                if idx == 0 {
                                    html_out.push_str(&format!("\n<h1>{}</h1>\n", html_escape_str(p)));
                                } else {
                                    html_out.push_str(&format!("<p>{}</p>\n", html_escape_str(p)));
                                }
                            }
                        }
                        html_out.push_str("</body></html>\n");
                        let _ = fs.write_file(&dest, html_out.as_bytes());
                    }
                    "txt" => {
                        let txt_out = format!("{}\n", paras.join("\n\n"));
                        let _ = fs.write_file(&dest, txt_out.as_bytes());
                    }
                    "png" => {
                        let im = ImageMeta {
                            fmt: "PNG".to_string(),
                            w: 612,
                            h: 792,
                            cs: "sRGB".to_string(),
                            exif: BTreeMap::new(),
                        };
                        let _ = fs.write_file(&dest, &write_image_bytes(&im));
                    }
                    _ => {}
                }
                stdout_msg.push_str(&format!("convert {f} -> {dest} using filter : {filter_name}\n"));
            }
            ok_out(&stdout_msg)
        }
        "wkhtmltopdf" => {
            if args.iter().any(|a| a == "-V" || a == "--version") {
                return ok_out("wkhtmltopdf 0.12.6 (safe-bash html-to-pdf)\n");
            }
            if args.iter().any(|a| a == "-h" || a == "--help") {
                return ok_out("Usage: wkhtmltopdf [GLOBAL OPTION]... [OBJECT]... <input file> [PAGE OPTION]... <output file>\n");
            }
            if args.iter().any(|a| a == "--read-args-from-stdin") {
                for line in stdin.lines() {
                    let t = line.trim();
                    if t.is_empty() {
                        continue;
                    }
                    let sub_args: Vec<String> =
                        t.split_whitespace().map(|s| s.to_string()).collect();
                    let _ = cmd_media_doc("wkhtmltopdf", &sub_args, "", cwd, fs);
                }
                return ok_out("");
            }
            let mut title_opt: Option<String> = None;
            let mut page_size = "A4".to_string();
            let mut orientation = "Portrait".to_string();
            let mut outline = true;
            let mut copies: usize = 1;
            let mut collate = true;
            let mut page_offset: i64 = 0;
            let mut hdr_left = String::new();
            let mut hdr_center = String::new();
            let mut hdr_right = String::new();
            let mut ftr_left = String::new();
            let mut ftr_center = String::new();
            let mut ftr_right = String::new();
            let mut replacements: Vec<(String, String)> = Vec::new();
            let mut pos_args: Vec<(String, bool, bool)> = Vec::new();
            let mut next_is_cover = false;
            let mut next_is_cover_obj = false;
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "--title" if i + 1 < args.len() => {
                        title_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-s" | "--page-size" if i + 1 < args.len() => {
                        page_size = args[i + 1].clone();
                        i += 2;
                    }
                    "-O" | "--orientation" if i + 1 < args.len() => {
                        orientation = args[i + 1].clone();
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
                    "--copies" if i + 1 < args.len() => {
                        copies = args[i + 1].parse().unwrap_or(1).max(1);
                        i += 2;
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
                    "-T" | "-B" | "-L" | "-R" | "--margin-top" | "--margin-bottom"
                    | "--margin-left" | "--margin-right" | "--encoding" | "--dpi" | "--zoom"
                    | "--page-width" | "--page-height" | "--outline-depth"
                    | "--user-style-sheet" | "--xsl-style-sheet"
                    | "--header-html" | "--footer-html" | "--header-spacing"
                    | "--footer-spacing" | "--header-font-name" | "--footer-font-name"
                    | "--header-font-size" | "--footer-font-size"
                    | "--minimum-font-size" | "--javascript-delay"
                    | "--window-status" | "--viewport-size" | "--cookie-jar"
                        if i + 1 < args.len() =>
                    {
                        i += 2;
                    }
                    "toc" => {
                        return err_out("wkhtmltopdf: UNSUPPORTED_CAPABILITY: TOC requires a qualified outline/XSLT engine\n", 1);
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
                        pos_args.push((a.to_string(), next_is_cover, next_is_cover_obj));
                        next_is_cover = false;
                        next_is_cover_obj = false;
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            if pos_args.len() < 2 {
                return err_out("wkhtmltopdf: You need to specify at least one input file, and exactly one output file\n", 1);
            }
            let (mut pw, mut ph) = match page_size.to_ascii_lowercase().as_str() {
                "letter" => (612.0, 792.0),
                "legal" => (612.0, 1008.0),
                "a3" => (841.89, 1190.55),
                "a5" => (419.53, 595.28),
                "b5" => (498.90, 708.66),
                _ => (595.28, 841.89),
            };
            if orientation.eq_ignore_ascii_case("landscape") {
                std::mem::swap(&mut pw, &mut ph);
            }
            let mut doc = PdfDoc::new();
            doc.page_w = pw;
            doc.page_h = ph;
            let mut all_headings: Vec<(String, String, usize)> = Vec::new();
            let mut page_meta: Vec<(String, bool, bool)> = Vec::new();
            for (src, is_cover, is_cover_obj) in &pos_args[..pos_args.len() - 1] {
                if src.ends_with(".txt") {
                    return err_out("wkhtmltopdf: unsupported .txt input\n", 1);
                }
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
                    return err_out(&format!("wkhtmltopdf: cannot read {src}\n"), 1);
                };
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
                    if !*is_cover_obj {
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
                    page_meta.push((src.clone(), *is_cover, *is_cover_obj));
                }
            }
            if let Some(t) = title_opt {
                doc.title = t;
            }
            if doc.title.is_empty() {
                doc.title = "Document".to_string();
            }
            let counted_total = page_meta.iter().filter(|(_, is_cov, _)| !*is_cov).count() as i64;
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
                let (ref wp, is_cov, is_cov_obj) = page_meta[idx];
                let cur_pno = logical_page;
                if !is_cov {
                    logical_page += 1;
                }
                if !is_cov_obj {
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
                    doc.bookmarks.push((ht.clone(), hl.clone(), pno.to_string()));
                }
            }
            if copies > 1 && !doc.pages.is_empty() {
                let orig = doc.pages.clone();
                doc.pages.clear();
                if collate {
                    for _ in 0..copies {
                        doc.pages.extend(orig.clone());
                    }
                } else {
                    for pg in &orig {
                        for _ in 0..copies {
                            doc.pages.push(pg.clone());
                        }
                    }
                }
            }
            if !doc.info.iter().any(|(k, _)| k.eq_ignore_ascii_case("Creator")) {
                doc.info.push(("Creator".to_string(), "wkhtmltopdf (pdf-ast-static)".to_string()));
            }
            if !doc.info.iter().any(|(k, _)| k.eq_ignore_ascii_case("Producer")) {
                doc.info.push(("Producer".to_string(), "@poe-code/pdf-ast".to_string()));
            }
            let out_arg = &pos_args.last().unwrap().0;
            let serialized = doc.serialize();
            if out_arg == "-" {
                return ok_out(&crate::vfs::bytes_to_stream_string(&serialized));
            }
            let dst = resolve_posix_path(cwd, out_arg);
            let _ = fs.write_file(&dst, &serialized);
            ok_out("")
        }
        "pdfunite" => {
            if args.iter().any(|a| a == "-v" || a == "--version") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "pdfunite version 24.02.0\n".to_string(),
                    exit_code: 0,
                };
            }
            let mut pos: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                let a = &args[i];
                if a == "-v" || a == "--version" {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "pdfunite version 24.08.0\n".to_string(),
                        exit_code: 0,
                    };
                }
                if matches!(a.as_str(), "-h" | "-help" | "--help" | "-?") {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n".to_string(),
                        exit_code: 0,
                    };
                }
                if a == "--" {
                    pos.extend(args[i + 1..].iter().cloned());
                    break;
                }
                if a.starts_with('-') {
                    return err_out(&format!("pdfunite: unknown option {a}\n"), 99);
                }
                pos.push(a.clone());
                i += 1;
            }
            if pos.len() < 3 {
                return err_out("Syntax Warning: pdfunite requires at least two input files and an output file.\n", 99);
            }
            let mut out_doc = PdfDoc::new();
            for (idx, src) in pos[..pos.len() - 1].iter().enumerate() {
                let full = resolve_posix_path(cwd, src);
                let Ok(b) = fs.read_file(&full) else {
                    return err_out(&format!("I/O Error: Couldn't open file '{src}'\n"), 255);
                };
                if !b.starts_with(b"%PDF-") {
                    return err_out(&format!("Syntax Error: '{src}' is not a valid PDF\n"), 255);
                }
                let sub = PdfDoc::parse(&b);
                if sub.encrypted.is_some() {
                    return err_out(&format!("Command Line Error: Could not merge encrypted files ('{src}')\n"), 255);
                }
                let page_offset = out_doc.pages.len();
                if idx == 0 {
                    out_doc.version = sub.version.clone();
                    out_doc.title = sub.title.clone();
                    out_doc.author = sub.author.clone();
                    out_doc.page_w = sub.page_w;
                    out_doc.page_h = sub.page_h;
                    out_doc.info = sub.info.clone();
                    out_doc.exif = sub.exif.clone();
                }
                for (pno, media) in &sub.page_media {
                    out_doc.page_media.insert(page_offset + pno, *media);
                }
                for (bt, bl, bp) in &sub.bookmarks {
                    let shifted = bp.parse::<usize>().unwrap_or(1) + page_offset;
                    out_doc.bookmarks.push((bt.clone(), bl.clone(), shifted.to_string()));
                }
                for (ni, st, pf, sy) in &sub.page_labels {
                    let shifted = ni.parse::<usize>().unwrap_or(1) + page_offset;
                    out_doc.page_labels.push((shifted.to_string(), st.clone(), pf.clone(), sy.clone()));
                }
                for att in &sub.attachments {
                    if !out_doc.attachments.iter().any(|x| x.0 == att.0) {
                        out_doc.attachments.push(att.clone());
                    }
                }
                out_doc.pages.extend(sub.pages);
            }
            let dst = resolve_posix_path(cwd, pos.last().unwrap());
            let _ = fs.write_file(&dst, &out_doc.serialize());
            ok_out("")
        }
        "pdfseparate" => {
            if args.iter().any(|a| a == "-v" || a == "--version") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "pdfseparate version 24.02.0\n".to_string(),
                    exit_code: 0,
                };
            }
            let mut first_p = 1usize;
            let mut last_p: Option<usize> = None;
            let mut pos: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-v" | "--version" => {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "pdfseparate version 24.08.0\n".to_string(),
                            exit_code: 0,
                        };
                    }
                    "-h" | "-help" | "--help" | "-?" => {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n".to_string(),
                            exit_code: 0,
                        };
                    }
                    "--" => {
                        pos.extend(args[i + 1..].iter().cloned());
                        break;
                    }
                    "-f" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out("pdfseparate: invalid -f argument\n", 99);
                        };
                        first_p = v.max(1);
                        i += 2;
                    }
                    "-l" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out("pdfseparate: invalid -l argument\n", 99);
                        };
                        if v > 0 {
                            last_p = Some(v);
                        } else {
                            last_p = None;
                        }
                        i += 2;
                    }
                    a if !a.starts_with('-') => {
                        pos.push(a.to_string());
                        i += 1;
                    }
                    a => {
                        return err_out(&format!("pdfseparate: unknown option {a}\n"), 99);
                    }
                }
            }
            if pos.len() != 2 {
                return err_out("Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n", 99);
            }
            let src = resolve_posix_path(cwd, &pos[0]);
            let pat = &pos[1];
            let Ok(b) = fs.read_file(&src) else {
                return err_out(&format!("I/O Error: Couldn't open file '{}'\n", pos[0]), 99);
            };
            if !b.starts_with(b"%PDF-") {
                return err_out(&format!("Syntax Error: Could not extract page(s) from damaged file ('{}')\n", pos[0]), 99);
            }
            let doc = PdfDoc::parse(&b);
            let total = doc.pages.len().max(1);
            let end_p = last_p.unwrap_or(total);
            if first_p > end_p || end_p > total {
                return err_out("Wrong page range given: the first page can not be after the last page.\n", 99);
            }
            let count = end_p - first_p + 1;
            let has_spec = has_pdfseparate_spec(pat);
            if count > 1 && !has_spec {
                return err_out(&format!("Error: '{pat}' must contain '%d' if more than one page should be extracted\n"), 99);
            }
            for pno in first_p..=end_p {
                if let Some(pg) = doc.pages.get(pno - 1) {
                    let mut single = PdfDoc::new();
                    single.version = doc.version.clone();
                    single.title = doc.title.clone();
                    single.author = doc.author.clone();
                    single.page_w = doc.page_w;
                    single.page_h = doc.page_h;
                    if let Some(m) = doc.page_media.get(&pno) {
                        single.page_media.insert(1, *m);
                    }
                    single.pages.push(pg.clone());
                    let formatted = if has_spec {
                        format_printf_num(pat, pno)
                    } else {
                        pat.replace("%%", "%")
                    };
                    let out_p = resolve_posix_path(cwd, &formatted);
                    let _ = fs.write_file(&out_p, &single.serialize());
                }
            }
            ok_out("")
        }
        "qpdf" => {
            if args.iter().any(|a| a == "--version") {
                return ok_out("qpdf version 11.9.0 (safe-bash pdf-ast)\n");
            }
            if args.iter().any(|a| a == "--help" || a == "-h" || a.starts_with("--help=")) {
                return ok_out("Usage: qpdf [ options ] infilename [ outfilename ]\n");
            }
            let mut password: Option<String> = None;
            let mut empty_input = false;
            let mut replace_input = false;
            let mut check_mode = false;
            let mut show_npages = false;
            let mut show_enc = false;
            let mut is_enc = false;
            let mut req_pw = false;
            let mut show_lin = false;
            let mut show_xref = false;
            let mut show_pages = false;
            let mut with_images = false;
            let mut show_object: Option<String> = None;
            let mut raw_stream_data = false;
            let mut filtered_stream_data = false;
            let mut json_version: Option<u32> = None;
            let mut json_keys: Vec<String> = Vec::new();
            let mut json_objects: Vec<String> = Vec::new();
            let mut json_stream_data = "none".to_string();
            let mut json_input = false;
            let mut update_from_json: Option<String> = None;
            let mut list_att = false;
            let mut show_att: Option<String> = None;
            let mut remove_atts: Vec<String> = Vec::new();
            let mut add_atts: Vec<(String, String, String, bool)> = Vec::new();
            let mut copy_atts: Vec<(String, String)> = Vec::new();
            let mut split_pages_group: Option<usize> = None;
            let mut encrypt_pw: Option<String> = None;
            let mut decrypt_mode = false;
            let mut linearize = false;
            let mut qdf_mode = false;
            let mut min_version: Option<String> = None;
            let mut force_version: Option<String> = None;
            let mut rotations: Vec<(bool, i32, String)> = Vec::new();
            let mut flatten_rotation = false;
            let mut overlay_specs: Vec<(bool, String, String, String, String)> = Vec::new();
            let mut page_specs: Vec<(String, String)> = Vec::new();
            let mut collate_group: Option<usize> = None;
            let mut set_page_labels: Vec<String> = Vec::new();
            let mut remove_page_labels = false;
            let mut remove_info = false;
            let mut remove_metadata = false;
            let mut pos_files: Vec<String> = Vec::new();

            let mut i = 0usize;
            while i < args.len() {
                let a = args[i].as_str();
                if a == "--empty" {
                    empty_input = true;
                    i += 1;
                    continue;
                }
                if a == "--replace-input" {
                    replace_input = true;
                    i += 1;
                    continue;
                }
                if let Some(pw) = a.strip_prefix("--password=") {
                    password = Some(pw.to_string());
                    i += 1;
                    continue;
                }
                if a == "--check" {
                    check_mode = true;
                    i += 1;
                    continue;
                }
                if a == "--show-npages" || a == "--npages" {
                    show_npages = true;
                    i += 1;
                    continue;
                }
                if a == "--show-encryption" {
                    show_enc = true;
                    i += 1;
                    continue;
                }
                if a == "--is-encrypted" {
                    is_enc = true;
                    i += 1;
                    continue;
                }
                if a == "--requires-password" {
                    req_pw = true;
                    i += 1;
                    continue;
                }
                if a == "--show-linearization" || a == "--check-linearization" {
                    show_lin = true;
                    i += 1;
                    continue;
                }
                if a == "--show-xref" {
                    show_xref = true;
                    i += 1;
                    continue;
                }
                if a == "--show-pages" {
                    show_pages = true;
                    i += 1;
                    continue;
                }
                if a == "--with-images" {
                    with_images = true;
                    i += 1;
                    continue;
                }
                if let Some(obj) = a.strip_prefix("--show-object=") {
                    show_object = Some(obj.to_string());
                    i += 1;
                    continue;
                }
                if a == "--raw-stream-data" {
                    raw_stream_data = true;
                    i += 1;
                    continue;
                }
                if a == "--filtered-stream-data" {
                    filtered_stream_data = true;
                    i += 1;
                    continue;
                }
                if a == "--json" || a == "--json=latest" || a == "--json=2" {
                    json_version = Some(2);
                    i += 1;
                    continue;
                }
                if a == "--json=1" {
                    json_version = Some(1);
                    i += 1;
                    continue;
                }
                if let Some(k) = a.strip_prefix("--json-key=") {
                    json_keys.push(k.to_string());
                    i += 1;
                    continue;
                }
                if let Some(o) = a.strip_prefix("--json-object=") {
                    json_objects.push(o.to_string());
                    i += 1;
                    continue;
                }
                if let Some(m) = a.strip_prefix("--json-stream-data=") {
                    json_stream_data = m.to_string();
                    i += 1;
                    continue;
                }
                if a == "--json-input" {
                    json_input = true;
                    i += 1;
                    continue;
                }
                if let Some(uf) = a.strip_prefix("--update-from-json=") {
                    update_from_json = Some(uf.to_string());
                    i += 1;
                    continue;
                }
                if a == "--list-attachments" {
                    list_att = true;
                    i += 1;
                    continue;
                }
                if let Some(key) = a.strip_prefix("--show-attachment=") {
                    show_att = Some(key.to_string());
                    i += 1;
                    continue;
                }
                if let Some(key) = a.strip_prefix("--remove-attachment=") {
                    remove_atts.push(key.to_string());
                    i += 1;
                    continue;
                }
                if a == "--add-attachment" && i + 1 < args.len() {
                    let att_file = args[i + 1].clone();
                    let mut key = att_file.rsplit('/').next().unwrap_or(&att_file).to_string();
                    let mut fname = key.clone();
                    let mut replace = false;
                    i += 2;
                    while i < args.len() && args[i] != "--" {
                        if let Some(k) = args[i].strip_prefix("--key=") {
                            key = k.to_string();
                        } else if let Some(f) = args[i].strip_prefix("--filename=") {
                            fname = f.to_string();
                        } else if args[i] == "--replace" {
                            replace = true;
                        }
                        i += 1;
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    add_atts.push((att_file, key, fname, replace));
                    continue;
                }
                if a == "--copy-attachments-from" && i + 1 < args.len() {
                    let src_pdf = args[i + 1].clone();
                    let mut pfx = String::new();
                    i += 2;
                    while i < args.len() && args[i] != "--" {
                        if let Some(p) = args[i].strip_prefix("--prefix=") {
                            pfx = p.to_string();
                        }
                        i += 1;
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    copy_atts.push((src_pdf, pfx));
                    continue;
                }
                if a == "--split-pages" {
                    let mut grp = 1usize;
                    if i + 1 < args.len() && args[i + 1].chars().all(|c| c.is_ascii_digit()) {
                        grp = args[i + 1].parse::<usize>().unwrap_or(1).max(1);
                        i += 2;
                    } else {
                        i += 1;
                    }
                    split_pages_group = Some(grp);
                    continue;
                }
                if let Some(sp) = a.strip_prefix("--split-pages=") {
                    split_pages_group = Some(sp.parse::<usize>().unwrap_or(1).max(1));
                    i += 1;
                    continue;
                }
                if a == "--encrypt" {
                    let upw = args.get(i + 1).cloned().unwrap_or_default();
                    let opw = args.get(i + 2).cloned().unwrap_or_default();
                    encrypt_pw = Some(if !upw.is_empty() { upw } else { opw });
                    i += 1;
                    while i < args.len() && args[i] != "--" {
                        i += 1;
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    continue;
                }
                if a == "--decrypt" {
                    decrypt_mode = true;
                    i += 1;
                    continue;
                }
                if a == "--linearize" {
                    linearize = true;
                    i += 1;
                    continue;
                }
                if a == "--no-linearize" {
                    linearize = false;
                    i += 1;
                    continue;
                }
                if a == "--qdf" {
                    qdf_mode = true;
                    i += 1;
                    continue;
                }
                if let Some(mv) = a.strip_prefix("--min-version=") {
                    min_version = Some(mv.to_string());
                    i += 1;
                    continue;
                }
                if let Some(fv) = a.strip_prefix("--force-version=") {
                    force_version = Some(fv.to_string());
                    i += 1;
                    continue;
                }
                if let Some(rot_spec) = a.strip_prefix("--rotate=") {
                    let (deg_s, rng_s) = rot_spec.split_once(':').unwrap_or((rot_spec, "1-z"));
                    let rel = deg_s.starts_with('+') || deg_s.starts_with('-');
                    let deg: i32 = deg_s.trim_start_matches('+').parse().unwrap_or(0);
                    rotations.push((rel, deg, rng_s.to_string()));
                    i += 1;
                    continue;
                }
                if a == "--flatten-rotation" {
                    flatten_rotation = true;
                    i += 1;
                    continue;
                }
                if (a == "--overlay" || a == "--underlay") && i + 1 < args.len() {
                    let is_over = a == "--overlay";
                    let ov_file = args[i + 1].clone();
                    let mut to_rng = "1-z".to_string();
                    let mut from_rng = "1-z".to_string();
                    let mut rep_rng = String::new();
                    i += 2;
                    while i < args.len() && args[i] != "--" {
                        if let Some(t) = args[i].strip_prefix("--to=") {
                            to_rng = t.to_string();
                        } else if let Some(f) = args[i].strip_prefix("--from=") {
                            from_rng = f.to_string();
                        } else if let Some(r) = args[i].strip_prefix("--repeat=") {
                            rep_rng = r.to_string();
                        }
                        i += 1;
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    overlay_specs.push((is_over, ov_file, to_rng, from_rng, rep_rng));
                    continue;
                }
                if a == "--collate" {
                    collate_group = Some(1);
                    i += 1;
                    continue;
                }
                if let Some(cg) = a.strip_prefix("--collate=") {
                    collate_group = Some(cg.parse::<usize>().unwrap_or(1).max(1));
                    i += 1;
                    continue;
                }
                if a == "--pages" {
                    i += 1;
                    while i < args.len() && args[i] != "--" {
                        if args[i].starts_with("--password=") {
                            i += 1;
                            continue;
                        }
                        let src_f = args[i].clone();
                        let mut rng = "1-z".to_string();
                        let mut j = i + 1;
                        if j < args.len() && args[j].starts_with("--password=") {
                            j += 1;
                        }
                        let next_is_range = j < args.len()
                            && args[j] != "--"
                            && args[j] != "."
                            && !args[j].starts_with('-')
                            && !args[j].to_ascii_lowercase().ends_with(".pdf")
                            && args[j]
                                .chars()
                                .next()
                                .map(|c| c.is_ascii_digit() || matches!(c, 'z' | 'r' | 'x'))
                                .unwrap_or(false);
                        if next_is_range {
                            rng = args[j].clone();
                            i = j + 1;
                        } else {
                            i = j;
                        }
                        page_specs.push((src_f, rng));
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    continue;
                }
                if a == "--set-page-labels" {
                    i += 1;
                    while i < args.len() && args[i] != "--" {
                        set_page_labels.push(args[i].clone());
                        i += 1;
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    continue;
                }
                if a == "--remove-page-labels" {
                    remove_page_labels = true;
                    i += 1;
                    continue;
                }
                if a == "--remove-info" {
                    remove_info = true;
                    i += 1;
                    continue;
                }
                if a == "--remove-metadata" {
                    remove_metadata = true;
                    i += 1;
                    continue;
                }
                if !a.starts_with('-') || a == "-" {
                    pos_files.push(a.to_string());
                }
                i += 1;
            }

            let parse_qpdf_json_doc = |s: &str| -> PdfDoc {
                let mut d = PdfDoc::new();
                let mut rem = s;
                while let Some(pos) = rem.find("\"data\":") {
                    rem = &rem[pos + 7..];
                    if let Some(q1) = rem.find('"') {
                        let after_q1 = &rem[q1 + 1..];
                        let mut val = String::new();
                        let mut chars = after_q1.chars();
                        let mut consumed = 0usize;
                        while let Some(ch) = chars.next() {
                            consumed += ch.len_utf8();
                            if ch == '\\' {
                                if let Some(esc) = chars.next() {
                                    consumed += esc.len_utf8();
                                    match esc {
                                        'n' => val.push('\n'),
                                        'r' => val.push('\r'),
                                        't' => val.push('\t'),
                                        other => val.push(other),
                                    }
                                }
                            } else if ch == '"' {
                                break;
                            } else {
                                val.push(ch);
                            }
                        }
                        let decoded_txt = if let Ok(dec_bytes) = base64_decode(&val)
                            && !dec_bytes.is_empty()
                            && dec_bytes.iter().all(|b| b.is_ascii_graphic() || b.is_ascii_whitespace())
                        {
                            String::from_utf8_lossy(&dec_bytes).to_string()
                        } else {
                            val
                        };
                        d.pages.push(PdfPage {
                            rot: 0,
                            text: decoded_txt,
                            html: String::new(),
                            images: Vec::new(),
                            urls: Vec::new(),
                        });
                        rem = &after_q1[consumed..];
                    } else {
                        break;
                    }
                }
                if d.pages.is_empty() {
                    d.pages.push(PdfPage::default());
                }
                d
            };
            let load_input = |path_arg: &str| -> Result<PdfDoc, BuiltinOutcome> {
                if path_arg == "-" {
                    let b = crate::vfs::stream_string_to_bytes(stdin);
                    if json_input {
                        return Ok(parse_qpdf_json_doc(&String::from_utf8_lossy(&b)));
                    }
                    return Ok(PdfDoc::parse(&b));
                }
                let full = resolve_posix_path(cwd, path_arg);
                let Ok(b) = fs.read_file(&full) else {
                    return Err(err_out(&format!("qpdf: {path_arg}: No such file or directory\n"), 2));
                };
                if json_input {
                    return Ok(parse_qpdf_json_doc(&String::from_utf8_lossy(&b)));
                }
                if !b.starts_with(b"%PDF-") {
                    return Err(err_out(&format!("qpdf: {path_arg}: not a PDF file\n"), 2));
                }
                Ok(PdfDoc::parse(&b))
            };

            let primary_arg = if empty_input {
                None
            } else {
                pos_files.first().cloned()
            };

            if is_enc {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                return if doc.encrypted.is_some() {
                    ok_out("")
                } else {
                    err_out("", 2)
                };
            }
            if req_pw {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                let Some(ref enc_pw) = doc.encrypted else {
                    return err_out("", 2);
                };
                let supplied = password.as_deref().unwrap_or("");
                if !enc_pw.is_empty() && supplied != enc_pw {
                    return ok_out("");
                }
                return err_out("", 3);
            }
            if show_enc {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                if let Some(ref enc_pw) = doc.encrypted {
                    let supplied = password.as_deref().unwrap_or("");
                    if !enc_pw.is_empty() && supplied != enc_pw {
                        return err_out(&format!("qpdf: {f}: invalid password\n"), 2);
                    }
                    return ok_out("R = 6\nV = 5\nLength = 256\nprint: allowed\nmodify: allowed\nextract for accessibility: allowed\n");
                }
                return ok_out("File is not encrypted\n");
            }
            if show_lin {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                if doc.linearized {
                    return ok_out(&format!("{f}: linearized\nno linearization errors\n"));
                }
                return ok_out(&format!("{f}: not linearized\n"));
            }
            if show_npages {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                return ok_out(&format!("{}\n", doc.pages.len()));
            }
            if check_mode {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                if let Some(ref enc_pw) = doc.encrypted {
                    let supplied = password.as_deref().unwrap_or("");
                    if !enc_pw.is_empty() && supplied != enc_pw {
                        return err_out(&format!("qpdf: {f}: invalid password\n"), 2);
                    }
                }
                let lines = vec![
                    format!("checking {f}"),
                    format!("PDF Version: {}", doc.version),
                    if doc.encrypted.is_some() {
                        "File is encrypted".to_string()
                    } else {
                        "File is not encrypted".to_string()
                    },
                    if doc.linearized {
                        "File is linearized".to_string()
                    } else {
                        "File is not linearized".to_string()
                    },
                    "No syntax or stream encoding errors found; the file may still contain".to_string(),
                    "errors that qpdf cannot detect".to_string(),
                ];
                return ok_out(&format!("{}\n", lines.join("\n")));
            }
            if show_xref {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                let mut lines = vec![
                    "1/0: uncompressed; offset = 15".to_string(),
                    "2/0: uncompressed; offset = 64".to_string(),
                ];
                for p in 0..doc.pages.len() {
                    let obj_id = 3 + p * 2;
                    lines.push(format!("{obj_id}/0: uncompressed; offset = {}", 120 + p * 120));
                    lines.push(format!("{}/0: uncompressed; offset = {}", obj_id + 1, 180 + p * 120));
                }
                return ok_out(&format!("{}\n", lines.join("\n")));
            }
            if show_pages {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                let mut lines = Vec::new();
                for (p, pg) in doc.pages.iter().enumerate() {
                    let content_obj = 4 + p * 4;
                    let page_obj = 5 + p * 4;
                    lines.push(format!("page {}: {page_obj} 0 R", p + 1));
                    if with_images {
                        lines.push("  images:".to_string());
                        for (im_idx, (w, h, _)) in pg.images.iter().enumerate() {
                            let im_obj = 8 + p * 4 + im_idx;
                            lines.push(format!("    /Im{}: {im_obj} 0 R ({w} x {h})", im_idx + 1));
                        }
                    }
                    lines.push("  content:".to_string());
                    lines.push(format!("    {content_obj} 0 R"));
                }
                return ok_out(&format!("{}\n", lines.join("\n")));
            }
            if let Some(ref obj_spec) = show_object {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                let obj_num: usize = obj_spec
                    .split([',', ' '])
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                if obj_num == 1 {
                    return ok_out("<< /Type /Catalog /Pages 2 0 R >>\n");
                }
                if obj_num == 2 {
                    let kids: Vec<String> = (0..doc.pages.len())
                        .map(|p| format!("{} 0 R", 5 + p * 4))
                        .collect();
                    return ok_out(&format!("<< /Type /Pages /Count {} /Kids [ {} ] >>\n", doc.pages.len(), kids.join(" ")));
                }
                if obj_num == 3 {
                    return ok_out(&format!("<< /Producer (@poe-code/pdf-ast) /Title ({}) /Creator (wkhtmltopdf (pdf-ast-static)) >>\n", doc.title));
                }
                if obj_num >= 4 {
                    let rem = obj_num - 4;
                    let page_idx = rem / 4;
                    let slot = rem % 4;
                    if let Some(pg) = doc.pages.get(page_idx) {
                        if slot == 0 {
                            let stream_str = format!("BT /F1 12 Tf 72 720 Td ({}) Tj ET\n", pg.text);
                            if raw_stream_data || filtered_stream_data {
                                return ok_out(&stream_str);
                            }
                            return ok_out(&format!("<< /Filter /FlateDecode /Length {} >>\n", stream_str.len()));
                        } else if slot == 1 {
                            let (pw, ph) = doc
                                .page_media
                                .get(&(page_idx + 1))
                                .map(|(w, h, _)| (*w, *h))
                                .unwrap_or((doc.page_w, doc.page_h));
                            return ok_out(&format!(
                                "<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 {pw} {ph} ] /Rotate {} /Contents {} 0 R >>\n",
                                pg.rot,
                                obj_num - 1
                            ));
                        }
                    }
                }
                return ok_out("null\n");
            }
            if list_att {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                let mut out = String::new();
                for (k, fname, _, _) in &doc.attachments {
                    out.push_str(&format!("{k} -> {fname}\n"));
                }
                return ok_out(&out);
            }
            if let Some(ref key) = show_att {
                let Some(f) = primary_arg.as_deref() else {
                    return err_out("qpdf: input file required\n", 2);
                };
                let doc = match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                for (k, fname, _, data) in &doc.attachments {
                    if k == key || fname == key {
                        return ok_out(&crate::vfs::bytes_to_stream_string(data));
                    }
                }
                return err_out(&format!("qpdf: attachment {key} not found\n"), 2);
            }
            if let Some(jv) = json_version {
                let doc = if let Some(f) = primary_arg.as_deref() {
                    match load_input(f) {
                        Ok(d) => d,
                        Err(e) => return e,
                    }
                } else {
                    PdfDoc::new()
                };
                let out_file = if !empty_input && pos_files.len() >= 2 {
                    Some(pos_files[1].clone())
                } else if empty_input && !pos_files.is_empty() {
                    Some(pos_files[0].clone())
                } else {
                    None
                };
                let stream_prefix = out_file
                    .as_ref()
                    .map(|of| format!("{of}-"))
                    .unwrap_or_else(|| "qpdf-stream-".to_string());
                let esc_json = |s: &str| -> String {
                    let mut out = String::new();
                    for ch in s.chars() {
                        match ch {
                            '"' => out.push_str("\\\""),
                            '\\' => out.push_str("\\\\"),
                            '\n' => out.push_str("\\n"),
                            '\r' => out.push_str("\\r"),
                            '\t' => out.push_str("\\t"),
                            c => out.push(c),
                        }
                    }
                    out
                };
                let include_obj = |id: usize| -> bool {
                    if json_objects.is_empty() {
                        return true;
                    }
                    json_objects.iter().any(|s| {
                        let clean = s.strip_prefix("obj:").unwrap_or(s);
                        let num = clean.split([',', ' ', '/']).next().and_then(|x| x.parse::<usize>().ok());
                        num == Some(id) || s == "trailer"
                    })
                };
                let keep_objs = json_keys.is_empty() || json_keys.iter().any(|k| k == "objects" || k == "qpdf");
                let mut obj_entries: Vec<String> = Vec::new();
                if keep_objs {
                    if include_obj(1) {
                        obj_entries.push("      \"obj:1 0 R\": {\n        \"value\": {\n          \"/Type\": \"/Catalog\",\n          \"/Pages\": \"2 0 R\"\n        }\n      }".to_string());
                    }
                    if include_obj(2) {
                        let kids: Vec<String> = (0..doc.pages.len()).map(|p| format!("\"{} 0 R\"", 5 + p * 4)).collect();
                        obj_entries.push(format!(
                            "      \"obj:2 0 R\": {{\n        \"value\": {{\n          \"/Type\": \"/Pages\",\n          \"/Count\": {},\n          \"/Kids\": [ {} ]\n        }}\n      }}",
                            doc.pages.len(),
                            kids.join(", ")
                        ));
                    }
                    if include_obj(3) {
                        obj_entries.push(format!(
                            "      \"obj:3 0 R\": {{\n        \"value\": {{\n          \"/Producer\": \"u:@poe-code/pdf-ast\",\n          \"/Title\": \"u:{}\"\n        }}\n      }}",
                            esc_json(&doc.title)
                        ));
                    }
                    for (p, pg) in doc.pages.iter().enumerate() {
                        let content_obj = 4 + p * 4;
                        let page_obj = 5 + p * 4;
                        let (pw, ph) = doc
                            .page_media
                            .get(&(p + 1))
                            .map(|(w, h, _)| (*w, *h))
                            .unwrap_or((doc.page_w, doc.page_h));
                        if include_obj(content_obj) {
                            let raw_str = pg.text.clone();
                            let mut stream_fields = vec![format!("          \"dict\": {{ \"/Filter\": \"/FlateDecode\", \"/Length\": {} }}", raw_str.len())];
                            if json_stream_data == "inline" {
                                let b64 = base64_encode(raw_str.as_bytes());
                                stream_fields.push(format!("          \"data\": \"{b64}\""));
                            } else if json_stream_data == "file" {
                                let sf_rel = format!("{stream_prefix}{content_obj}");
                                let sf_full = resolve_posix_path(cwd, &sf_rel);
                                let _ = fs.write_file(&sf_full, raw_str.as_bytes());
                                stream_fields.push(format!("          \"datafile\": \"{}\"", esc_json(&sf_rel)));
                            }
                            obj_entries.push(format!(
                                "      \"obj:{content_obj} 0 R\": {{\n        \"stream\": {{\n{}\n        }}\n      }}",
                                stream_fields.join(",\n")
                            ));
                        }
                        if include_obj(page_obj) {
                            obj_entries.push(format!(
                                "      \"obj:{page_obj} 0 R\": {{\n        \"value\": {{\n          \"/Type\": \"/Page\",\n          \"/Parent\": \"2 0 R\",\n          \"/MediaBox\": [ 0, 0, {pw}, {ph} ],\n          \"/Rotate\": {},\n          \"/Contents\": \"{content_obj} 0 R\"\n        }}\n      }}",
                                pg.rot
                            ));
                        }
                    }
                    obj_entries.push(format!(
                        "      \"trailer\": {{\n        \"value\": {{\n          \"/Root\": \"1 0 R\",\n          \"/Info\": \"3 0 R\",\n          \"/Size\": {}\n        }}\n      }}",
                        4 + doc.pages.len() * 4
                    ));
                }
                let objs_block = if obj_entries.is_empty() {
                    "    {}".to_string()
                } else {
                    format!("    {{\n{}\n    }}", obj_entries.join(",\n"))
                };
                let max_obj = 3 + doc.pages.len() * 4;
                let rendered = format!(
                    "{{\n  \"version\": {jv},\n  \"qpdf\": [\n    {{\n      \"jsonversion\": {jv},\n      \"pdfversion\": \"{}\",\n      \"maxobjectid\": {max_obj}\n    }},\n{objs_block}\n  ]\n}}\n",
                    doc.version
                );
                if let Some(of) = out_file
                    && of != "-"
                {
                    let dst = resolve_posix_path(cwd, &of);
                    let _ = fs.write_file(&dst, rendered.as_bytes());
                    return ok_out("");
                }
                return ok_out(&rendered);
            }

            if let Some(group_sz) = split_pages_group {
                if pos_files.len() < 2 {
                    return err_out("qpdf: --split-pages requires input and output pattern\n", 2);
                }
                let doc = match load_input(&pos_files[0]) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                let pat = &pos_files[1];
                let total = doc.pages.len();
                let mut start = 1usize;
                while start <= total {
                    let end = (start + group_sz - 1).min(total);
                    let mut sub = PdfDoc::new();
                    sub.version = doc.version.clone();
                    sub.title = doc.title.clone();
                    sub.author = doc.author.clone();
                    sub.page_w = doc.page_w;
                    sub.page_h = doc.page_h;
                    sub.pages = doc.pages[(start - 1)..end].to_vec();
                    let fname = format_qpdf_split_name(pat, total, group_sz, start, end);
                    let out_p = resolve_posix_path(cwd, &fname);
                    let _ = fs.write_file(&out_p, &sub.serialize());
                    start = end + 1;
                }
                return ok_out("");
            }

            let out_arg = if replace_input {
                pos_files.first().cloned()
            } else if empty_input {
                pos_files.first().cloned()
            } else if pos_files.len() >= 2 {
                pos_files.last().cloned()
            } else {
                None
            };
            let Some(dst_arg) = out_arg else {
                return ok_out("");
            };
            let mut doc = if empty_input {
                PdfDoc::new()
            } else if let Some(f) = primary_arg.as_deref() {
                match load_input(f) {
                    Ok(d) => d,
                    Err(e) => return e,
                }
            } else {
                PdfDoc::new()
            };

            if let Some(ref enc_pw) = doc.encrypted {
                let supplied = password.as_deref().unwrap_or("");
                if !enc_pw.is_empty() && supplied != enc_pw {
                    let f = primary_arg.as_deref().unwrap_or("input");
                    return err_out(&format!("qpdf: {f}: invalid password\n"), 2);
                }
            }

            if let Some(ref ujson) = update_from_json {
                let ufull = resolve_posix_path(cwd, ujson);
                if let Ok(ub) = fs.read_file(&ufull) {
                    let us = String::from_utf8_lossy(&ub);
                    let mut rem = us.as_ref();
                    while let Some(pos) = rem.find("\"obj:") {
                        rem = &rem[pos + 5..];
                        let num = rem
                            .split(|c: char| !c.is_ascii_digit())
                            .next()
                            .and_then(|s| s.parse::<usize>().ok())
                            .unwrap_or(0);
                        let next_obj = rem.find("\"obj:").unwrap_or(rem.len());
                        let chunk = &rem[..next_obj];
                        if num >= 3 {
                            let page_idx = if num >= 5 && (num - 5) % 4 == 0 {
                                (num - 5) / 4
                            } else {
                                (num - 3) / 2
                            };
                            if let Some(rpos) = chunk.find("\"/Rotate\":") {
                                let after_r = chunk[rpos + 10..].trim_start();
                                let rot_s: String = after_r
                                    .chars()
                                    .take_while(|c| c.is_ascii_digit() || *c == '-' || *c == '+')
                                    .collect();
                                if let Ok(rot) = rot_s.parse::<i32>()
                                    && let Some(pg) = doc.pages.get_mut(page_idx)
                                {
                                    pg.rot = rot.rem_euclid(360);
                                }
                            }
                        }
                        rem = &rem[next_obj..];
                    }
                }
            }

            if !page_specs.is_empty() {
                let mut groups: Vec<Vec<PdfPage>> = Vec::new();
                for (sf, rng) in &page_specs {
                    let sdoc = if sf == "." {
                        doc.clone()
                    } else {
                        match load_input(sf) {
                            Ok(d) => d,
                            Err(e) => return e,
                        }
                    };
                    if doc.title.is_empty() && !sdoc.title.is_empty() {
                        doc.title = sdoc.title.clone();
                    }
                    let mut group_pages = Vec::new();
                    for pno in parse_qpdf_page_spec(rng, sdoc.pages.len()) {
                        if let Some(pg) = sdoc.pages.get(pno - 1) {
                            group_pages.push(pg.clone());
                        }
                    }
                    groups.push(group_pages);
                }
                let mut new_pages = Vec::new();
                if let Some(cg) = collate_group {
                    let mut offsets = vec![0usize; groups.len()];
                    loop {
                        let mut any = false;
                        for (gi, g) in groups.iter().enumerate() {
                            let start = offsets[gi];
                            if start < g.len() {
                                any = true;
                                let end = (start + cg).min(g.len());
                                new_pages.extend_from_slice(&g[start..end]);
                                offsets[gi] = end;
                            }
                        }
                        if !any {
                            break;
                        }
                    }
                } else {
                    for g in groups {
                        new_pages.extend(g);
                    }
                }
                doc.pages = new_pages;
            }

            for (rel, deg, rng) in &rotations {
                for pno in parse_qpdf_page_spec(rng, doc.pages.len()) {
                    if let Some(pg) = doc.pages.get_mut(pno - 1) {
                        if *rel {
                            pg.rot = (pg.rot + deg).rem_euclid(360);
                        } else {
                            pg.rot = deg.rem_euclid(360);
                        }
                    }
                }
            }

            if flatten_rotation {
                for (idx, pg) in doc.pages.iter_mut().enumerate() {
                    if pg.rot == 90 || pg.rot == 270 {
                        let pno = idx + 1;
                        let (w, h, crop) = doc
                            .page_media
                            .get(&pno)
                            .copied()
                            .unwrap_or((doc.page_w, doc.page_h, None));
                        doc.page_media.insert(pno, (h, w, crop));
                    }
                    pg.rot = 0;
                }
            }

            for (is_over, ov_file, to_rng, from_rng, rep_rng) in &overlay_specs {
                let odoc = if ov_file == "." {
                    doc.clone()
                } else {
                    match load_input(ov_file) {
                        Ok(d) => d,
                        Err(e) => return e,
                    }
                };
                let to_pages = parse_qpdf_page_spec(to_rng, doc.pages.len());
                let from_pages = parse_qpdf_page_spec(from_rng, odoc.pages.len());
                let rep_pages = if rep_rng.is_empty() {
                    Vec::new()
                } else {
                    parse_qpdf_page_spec(rep_rng, from_pages.len())
                };
                if !from_pages.is_empty() {
                    for (idx, dst_pno) in to_pages.into_iter().enumerate() {
                        let src_pno = if idx < from_pages.len() {
                            from_pages[idx]
                        } else if !rep_pages.is_empty() {
                            let r_idx = (idx - from_pages.len()) % rep_pages.len();
                            from_pages[rep_pages[r_idx] - 1]
                        } else {
                            *from_pages.last().unwrap()
                        };
                        if let Some(src_pg) = odoc.pages.get(src_pno - 1)
                            && let Some(dst_pg) = doc.pages.get_mut(dst_pno - 1)
                        {
                            if *is_over {
                                dst_pg.text = format!("{}\n{}", dst_pg.text, src_pg.text);
                            } else {
                                dst_pg.text = format!("{}\n{}", src_pg.text, dst_pg.text);
                            }
                        }
                    }
                }
            }

            for key in &remove_atts {
                doc.attachments.retain(|(k, fname, _, _)| k != key && fname != key);
            }
            for (att_p, key, fname, replace) in add_atts {
                let afull = resolve_posix_path(cwd, &att_p);
                let Ok(ab) = fs.read_file(&afull) else {
                    return err_out(&format!("qpdf: {att_p}: No such file or directory\n"), 2);
                };
                if let Some(pos) = doc.attachments.iter().position(|(k, _, _, _)| k == &key) {
                    if !replace {
                        return err_out(&format!("qpdf: attachment key {key} already exists (use --replace)\n"), 2);
                    }
                    doc.attachments.remove(pos);
                }
                doc.attachments.push((key, fname, String::new(), ab));
            }
            for (src_pdf, pfx) in copy_atts {
                let sdoc = match load_input(&src_pdf) {
                    Ok(d) => d,
                    Err(e) => return e,
                };
                for (k, fname, mime, data) in sdoc.attachments {
                    let nk = format!("{pfx}{k}");
                    doc.attachments.retain(|(ek, _, _, _)| ek != &nk);
                    doc.attachments.push((nk, fname, mime, data));
                }
            }

            if remove_page_labels {
                doc.page_labels.clear();
            }
            if !set_page_labels.is_empty() {
                doc.page_labels.clear();
                for spec in &set_page_labels {
                    if let Some((pno_s, rest)) = spec.split_once(':') {
                        let pno = pno_s.parse::<usize>().unwrap_or(1).to_string();
                        let mut style_code = "D";
                        let mut start_num = "1".to_string();
                        let mut prefix = String::new();
                        let parts: Vec<&str> = rest.split('/').collect();
                        if let Some(first) = parts.first()
                            && matches!(*first, "D" | "r" | "R" | "a" | "A" | "n" | "none")
                        {
                            style_code = first;
                        }
                        for (t_idx, token) in parts.iter().enumerate().skip(1) {
                            if let Some(st) = token.strip_prefix("st=") {
                                start_num = st.to_string();
                            } else if let Some(pr) = token.strip_prefix("pr=") {
                                prefix = pr.to_string();
                            } else if t_idx == 1 && token.chars().all(|c| c.is_ascii_digit()) && !token.is_empty() {
                                start_num = token.to_string();
                            } else if !token.is_empty() {
                                prefix = token.to_string();
                            }
                        }
                        let pdftk_style = match style_code {
                            "D" => "DecimalArabicNumerals",
                            "R" => "UppercaseRomanNumerals",
                            "r" => "LowercaseRomanNumerals",
                            "A" => "UppercaseLetters",
                            "a" => "LowercaseLetters",
                            _ => "NoNumber",
                        };
                        doc.page_labels.push((pno, start_num, prefix, pdftk_style.to_string()));
                    }
                }
            }

            if remove_info {
                doc.title.clear();
                doc.author.clear();
                doc.info.clear();
            }
            if remove_metadata {
                doc.exif.clear();
            }
            if let Some(fv) = force_version {
                doc.version = fv;
            } else if let Some(mv) = min_version
                && doc.version < mv
            {
                doc.version = mv;
            }
            if let Some(pw) = encrypt_pw {
                doc.encrypted = Some(pw);
            }
            if decrypt_mode {
                doc.encrypted = None;
            }
            if linearize {
                doc.linearized = true;
            }
            let _ = qdf_mode;
            let serialized = doc.serialize();
            if dst_arg == "-" {
                ok_out(&crate::vfs::bytes_to_stream_string(&serialized))
            } else {
                let dst = resolve_posix_path(cwd, &dst_arg);
                let _ = fs.write_file(&dst, &serialized);
                ok_out("")
            }
        }
        "pdftk" => {
            if args.iter().any(|a| a == "--version" || a == "-version") {
                return ok_out("pdftk port to safe-bash 3.3.3 a Handy Tool for Manipulating PDF Documents\n");
            }
            if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h" || a == "-help") {
                return ok_out("SYNOPSIS\n       pdftk <input PDF files | - | PROMPT>\n            [ input_pw <input PDF owner/user passwords | PROMPT> ]\n            [ <operation> <operation arguments> ]\n            [ output <output filename | - | PROMPT> ]\n");
            }
            let ops = [
                "cat",
                "shuffle",
                "burst",
                "dump_data",
                "dump_data_utf8",
                "dump_data_fields",
                "dump_data_fields_utf8",
                "dump_data_annots",
                "update_info",
                "update_info_utf8",
                "attach_files",
                "unpack_files",
                "background",
                "multibackground",
                "stamp",
                "multistamp",
                "fill_form",
                "generate_fdf",
            ];
            let mut handles: BTreeMap<String, PdfDoc> = BTreeMap::new();
            let mut input_docs: Vec<PdfDoc> = Vec::new();
            let mut op = String::new();
            let mut op_idx = args.len();
            let mut i = 0usize;
            while i < args.len() {
                let a = args[i].as_str();
                if ops.contains(&a) {
                    op = a.to_string();
                    op_idx = i;
                    break;
                }
                if a == "output" {
                    op = "passthrough".to_string();
                    op_idx = i;
                    break;
                }
                if a == "input_pw" {
                    i += 1;
                    while i < args.len() && !ops.contains(&args[i].as_str()) && args[i] != "output" {
                        i += 1;
                    }
                    continue;
                }
                if let Some((h, path)) = a.split_once('=')
                    && !h.is_empty()
                    && h.chars().all(|c| c.is_ascii_uppercase())
                {
                    let d = if path == "-" {
                        PdfDoc::parse(&crate::vfs::stream_string_to_bytes(stdin))
                    } else {
                        let full = resolve_posix_path(cwd, path);
                        let Ok(b) = fs.read_file(&full) else {
                            return err_out(&format!("Error: Unable to find file.\nError: Failed to open PDF file: \n   {path}\n"), 1);
                        };
                        PdfDoc::parse(&b)
                    };
                    handles.insert(h.to_string(), d.clone());
                    input_docs.push(d);
                } else if !a.starts_with('-') || a == "-" {
                    let d = if a == "-" {
                        PdfDoc::parse(&crate::vfs::stream_string_to_bytes(stdin))
                    } else {
                        let full = resolve_posix_path(cwd, a);
                        let Ok(b) = fs.read_file(&full) else {
                            return err_out(&format!("Error: Unable to find file.\nError: Failed to open PDF file: \n   {a}\n"), 1);
                        };
                        PdfDoc::parse(&b)
                    };
                    let auto_handle = ((b'A' + (input_docs.len() as u8)) as char).to_string();
                    handles.entry(auto_handle).or_insert_with(|| d.clone());
                    input_docs.push(d);
                }
                i += 1;
            }
            if op.is_empty() {
                op = "cat".to_string();
            }

            let format_dump = |doc: &PdfDoc, utf8: bool| -> String {
                let mut out = String::new();
                if !doc.title.is_empty() {
                    out.push_str(&format!(
                        "InfoBegin\nInfoKey: Title\nInfoValue: {}\n",
                        encode_pdftk_text(&doc.title, utf8)
                    ));
                }
                if !doc.author.is_empty() {
                    out.push_str(&format!(
                        "InfoBegin\nInfoKey: Author\nInfoValue: {}\n",
                        encode_pdftk_text(&doc.author, utf8)
                    ));
                }
                for (k, v) in &doc.info {
                    out.push_str(&format!(
                        "InfoBegin\nInfoKey: {k}\nInfoValue: {}\n",
                        encode_pdftk_text(v, utf8)
                    ));
                }
                out.push_str(&format!("PdfID0: {}\n", doc.pdf_id0));
                out.push_str(&format!("PdfID1: {}\n", doc.pdf_id1));
                out.push_str(&format!("NumberOfPages: {}\n", doc.pages.len()));
                for (t, l, p) in &doc.bookmarks {
                    out.push_str(&format!(
                        "BookmarkBegin\nBookmarkTitle: {}\nBookmarkLevel: {l}\nBookmarkPageNumber: {p}\n",
                        encode_pdftk_text(t, utf8)
                    ));
                }
                for (idx, pg) in doc.pages.iter().enumerate() {
                    let pno = idx + 1;
                    let (pw, ph, crop_opt) = doc
                        .page_media
                        .get(&pno)
                        .copied()
                        .unwrap_or((doc.page_w, doc.page_h, None));
                    out.push_str(&format!(
                        "PageMediaBegin\nPageMediaNumber: {pno}\nPageMediaRotation: {}\nPageMediaRect: 0 0 {} {}\nPageMediaDimensions: {} {}\n",
                        pg.rot,
                        pw as i64,
                        ph as i64,
                        pw as i64,
                        ph as i64
                    ));
                    if let Some([cx0, cy0, cx1, cy1]) = crop_opt {
                        out.push_str(&format!(
                            "PageMediaCropBox: {} {} {} {}\nPageMediaCropRect: {} {} {} {}\n",
                            cx0 as i64, cy0 as i64, cx1 as i64, cy1 as i64,
                            cx0 as i64, cy0 as i64, cx1 as i64, cy1 as i64
                        ));
                    }
                }
                for (ni, st, pf, sy) in &doc.page_labels {
                    out.push_str(&format!("PageLabelBegin\nPageLabelNewIndex: {ni}\nPageLabelStart: {st}\n"));
                    if !pf.is_empty() {
                        out.push_str(&format!("PageLabelPrefix: {}\n", encode_pdftk_text(pf, utf8)));
                    }
                    out.push_str(&format!("PageLabelNumStyle: {sy}\n"));
                }
                out
            };

            let write_pdftk_output = |doc: &mut PdfDoc, tail: &[String]| -> BuiltinOutcome {
                let mut out_target: Option<String> = None;
                let mut idx = 0usize;
                while idx < tail.len() {
                    match tail[idx].as_str() {
                        "output" if idx + 1 < tail.len() => {
                            out_target = Some(tail[idx + 1].clone());
                            idx += 2;
                        }
                        "owner_pw" | "user_pw" if idx + 1 < tail.len() => {
                            doc.encrypted = Some(tail[idx + 1].clone());
                            idx += 2;
                        }
                        _ => {
                            idx += 1;
                        }
                    }
                }
                let Some(of) = out_target else {
                    return err_out("Error: Output filename required.\n", 1);
                };
                let serialized = doc.serialize();
                if of == "-" {
                    ok_out(&crate::vfs::bytes_to_stream_string(&serialized))
                } else {
                    let dst = resolve_posix_path(cwd, &of);
                    let _ = fs.write_file(&dst, &serialized);
                    ok_out("")
                }
            };

            let primary = input_docs.first().cloned().unwrap_or_else(PdfDoc::new);
            match op.as_str() {
                "passthrough" => {
                    let mut doc = primary;
                    write_pdftk_output(&mut doc, &args[op_idx..])
                }
                "dump_data" | "dump_data_utf8" => {
                    let utf8 = op == "dump_data_utf8";
                    let dump_txt = format_dump(&primary, utf8);
                    let rest = &args[op_idx + 1..];
                    if let Some(pos) = rest.iter().position(|x| x == "output")
                        && pos + 1 < rest.len()
                        && rest[pos + 1] != "-"
                    {
                        let dst = resolve_posix_path(cwd, &rest[pos + 1]);
                        let _ = fs.write_file(&dst, dump_txt.as_bytes());
                        return ok_out("");
                    }
                    ok_out(&dump_txt)
                }
                "dump_data_fields" | "dump_data_fields_utf8" | "dump_data_annots" => ok_out(""),
                "update_info" | "update_info_utf8" => {
                    let rest = &args[op_idx + 1..];
                    if rest.is_empty() {
                        return err_out("Error: update_info requires a data file.\n", 1);
                    }
                    let info_src = &rest[0];
                    let txt = if info_src == "-" {
                        stdin.to_string()
                    } else {
                        let info_full = resolve_posix_path(cwd, info_src);
                        let Ok(ib) = fs.read_file(&info_full) else {
                            return err_out(&format!("Error: Unable to open data file {info_src}\n"), 1);
                        };
                        String::from_utf8_lossy(&ib).to_string()
                    };
                    let mut doc = primary;
                    let has_info_blocks = txt.lines().any(|l| l.trim() == "InfoBegin");
                    let has_bm_blocks = txt.lines().any(|l| l.trim() == "BookmarkBegin");
                    let has_pl_blocks = txt.lines().any(|l| l.trim() == "PageLabelBegin");
                    if has_info_blocks {
                        doc.info.clear();
                    }
                    if has_bm_blocks {
                        doc.bookmarks.clear();
                    }
                    if has_pl_blocks {
                        doc.page_labels.clear();
                    }
                    let mut cur_kind = "";
                    let mut k = String::new();
                    let mut v = String::new();
                    let mut bt = String::new();
                    let mut bl = String::new();
                    let mut bp = String::new();
                    let mut pni = String::new();
                    let mut pst = String::new();
                    let mut ppf = String::new();
                    let mut psy = String::new();
                    let mut pm_num: usize = 0;
                    let mut pm_rot: Option<i32> = None;
                    let mut pm_dim: Option<(f64, f64)> = None;
                    let mut pm_crop: Option<[f64; 4]> = None;

                    let flush = |kind: &str,
                                 doc: &mut PdfDoc,
                                 k: &mut String,
                                 v: &mut String,
                                 bt: &mut String,
                                 bl: &mut String,
                                 bp: &mut String,
                                 pni: &mut String,
                                 pst: &mut String,
                                 ppf: &mut String,
                                 psy: &mut String,
                                 pm_num: &mut usize,
                                 pm_rot: &mut Option<i32>,
                                 pm_dim: &mut Option<(f64, f64)>,
                                 pm_crop: &mut Option<[f64; 4]>| {
                        match kind {
                            "info" if !k.is_empty() => {
                                let dec_v = decode_pdftk_entities(v);
                                if k == "Title" {
                                    doc.title = dec_v;
                                } else if k == "Author" {
                                    doc.author = dec_v;
                                } else {
                                    doc.info.push((k.clone(), dec_v));
                                }
                                k.clear();
                                v.clear();
                            }
                            "bm" if !bt.is_empty() => {
                                doc.bookmarks.push((
                                    decode_pdftk_entities(bt),
                                    bl.clone(),
                                    bp.clone(),
                                ));
                                bt.clear();
                                bl.clear();
                                bp.clear();
                            }
                            "pl" if !pni.is_empty() => {
                                doc.page_labels.push((
                                    pni.clone(),
                                    if pst.is_empty() { "1".to_string() } else { pst.clone() },
                                    decode_pdftk_entities(ppf),
                                    if psy.is_empty() { "DecimalArabicNumerals".to_string() } else { psy.clone() },
                                ));
                                pni.clear();
                                pst.clear();
                                ppf.clear();
                                psy.clear();
                            }
                            "pm" if *pm_num >= 1 => {
                                if let Some(rot) = *pm_rot
                                    && let Some(pg) = doc.pages.get_mut(*pm_num - 1)
                                {
                                    pg.rot = rot.rem_euclid(360);
                                }
                                let (mut w, mut h, mut crop) = doc
                                    .page_media
                                    .get(pm_num)
                                    .copied()
                                    .unwrap_or((doc.page_w, doc.page_h, None));
                                if let Some((dw, dh)) = *pm_dim {
                                    w = dw;
                                    h = dh;
                                    if *pm_num == 1 {
                                        doc.page_w = dw;
                                        doc.page_h = dh;
                                    }
                                }
                                if pm_crop.is_some() {
                                    crop = *pm_crop;
                                }
                                doc.page_media.insert(*pm_num, (w, h, crop));
                                *pm_num = 0;
                                *pm_rot = None;
                                *pm_dim = None;
                                *pm_crop = None;
                            }
                            _ => {}
                        }
                    };
                    for line in txt.lines() {
                        let l = line.trim();
                        if matches!(l, "InfoBegin" | "BookmarkBegin" | "PageLabelBegin" | "PageMediaBegin") {
                            flush(
                                cur_kind, &mut doc, &mut k, &mut v, &mut bt, &mut bl, &mut bp,
                                &mut pni, &mut pst, &mut ppf, &mut psy, &mut pm_num, &mut pm_rot,
                                &mut pm_dim, &mut pm_crop,
                            );
                            cur_kind = match l {
                                "InfoBegin" => "info",
                                "BookmarkBegin" => "bm",
                                "PageLabelBegin" => "pl",
                                _ => "pm",
                            };
                        } else if let Some(r) = l.strip_prefix("PdfID0:") {
                            doc.pdf_id0 = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("PdfID1:") {
                            doc.pdf_id1 = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("InfoKey:") {
                            k = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("InfoValue:") {
                            v = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("BookmarkTitle:") {
                            bt = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("BookmarkLevel:") {
                            bl = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("BookmarkPageNumber:") {
                            bp = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("PageLabelNewIndex:") {
                            pni = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("PageLabelStart:") {
                            pst = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("PageLabelPrefix:") {
                            ppf = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("PageLabelNumStyle:") {
                            psy = r.trim().to_string();
                        } else if let Some(r) = l.strip_prefix("PageMediaNumber:") {
                            pm_num = r.trim().parse().unwrap_or(0);
                        } else if let Some(r) = l.strip_prefix("PageMediaRotation:") {
                            pm_rot = r.trim().parse().ok();
                        } else if let Some(r) = l.strip_prefix("PageMediaDimensions:") {
                            let nums: Vec<f64> = r.split_whitespace().filter_map(|x| x.parse().ok()).collect();
                            if nums.len() >= 2 {
                                pm_dim = Some((nums[0], nums[1]));
                            }
                        } else if let Some(r) = l.strip_prefix("PageMediaRect:") {
                            let nums: Vec<f64> = r.split_whitespace().filter_map(|x| x.parse().ok()).collect();
                            if nums.len() >= 4 && pm_dim.is_none() {
                                pm_dim = Some((nums[2] - nums[0], nums[3] - nums[1]));
                            }
                        } else if let Some(r) = l.strip_prefix("PageMediaCropRect:") {
                            let nums: Vec<f64> = r.split_whitespace().filter_map(|x| x.parse().ok()).collect();
                            if nums.len() >= 4 {
                                pm_crop = Some([nums[0], nums[1], nums[2], nums[3]]);
                            }
                        }
                    }
                    flush(
                        cur_kind, &mut doc, &mut k, &mut v, &mut bt, &mut bl, &mut bp,
                        &mut pni, &mut pst, &mut ppf, &mut psy, &mut pm_num, &mut pm_rot,
                        &mut pm_dim, &mut pm_crop,
                    );
                    write_pdftk_output(&mut doc, &rest[1..])
                }
                "burst" => {
                    let rest = &args[op_idx + 1..];
                    let pat = if let Some(pos) = rest.iter().position(|x| x == "output")
                        && pos + 1 < rest.len()
                    {
                        rest[pos + 1].clone()
                    } else {
                        "pg_%04d.pdf".to_string()
                    };
                    let pat_full = resolve_posix_path(cwd, &pat);
                    let burst_dir = pat_full
                        .rsplit_once('/')
                        .map(|(d, _)| if d.is_empty() { "/" } else { d })
                        .unwrap_or(cwd);
                    let _ = fs.mkdir_all(burst_dir);
                    for (idx, pg) in primary.pages.iter().enumerate() {
                        let mut single = PdfDoc::new();
                        single.version = primary.version.clone();
                        single.title = primary.title.clone();
                        single.author = primary.author.clone();
                        single.page_w = primary.page_w;
                        single.page_h = primary.page_h;
                        single.pages.push(pg.clone());
                        let out_p = resolve_posix_path(cwd, &format_printf_num(&pat, idx + 1));
                        let _ = fs.write_file(&out_p, &single.serialize());
                    }
                    let doc_data_p = format!("{}/doc_data.txt", burst_dir.trim_end_matches('/'));
                    let _ = fs.write_file(&doc_data_p, format_dump(&primary, false).as_bytes());
                    ok_out("")
                }
                "attach_files" => {
                    let rest = &args[op_idx + 1..];
                    let mut doc = primary;
                    let mut idx = 0usize;
                    let mut out_pos = rest.len();
                    while idx < rest.len() {
                        if rest[idx] == "to_page" && idx + 1 < rest.len() {
                            idx += 2;
                            continue;
                        }
                        if rest[idx] == "output" {
                            out_pos = idx;
                            break;
                        }
                        let afull = resolve_posix_path(cwd, &rest[idx]);
                        let Ok(ab) = fs.read_file(&afull) else {
                            return err_out(&format!("Error: Unable to find attachment file {}\n", rest[idx]), 1);
                        };
                        let fname = rest[idx]
                            .rsplit('/')
                            .next()
                            .unwrap_or(&rest[idx])
                            .to_string();
                        doc.attachments.push((fname.clone(), fname, String::new(), ab));
                        idx += 1;
                    }
                    write_pdftk_output(&mut doc, &rest[out_pos..])
                }
                "unpack_files" => {
                    let rest = &args[op_idx + 1..];
                    let out_dir = if let Some(pos) = rest.iter().position(|x| x == "output")
                        && pos + 1 < rest.len()
                    {
                        resolve_posix_path(cwd, &rest[pos + 1])
                    } else {
                        cwd.to_string()
                    };
                    let _ = fs.mkdir_all(&out_dir);
                    for (_, fname, _, data) in &primary.attachments {
                        let p = format!("{}/{fname}", out_dir.trim_end_matches('/'));
                        let _ = fs.write_file(&p, data);
                    }
                    ok_out("")
                }
                "stamp" | "multistamp" | "background" | "multibackground" => {
                    let is_multi = op == "multistamp" || op == "multibackground";
                    let is_stamp = op == "stamp" || op == "multistamp";
                    let rest = &args[op_idx + 1..];
                    let mut doc = primary;
                    if !rest.is_empty() {
                        let sdoc = if rest[0] == "-" {
                            PdfDoc::parse(&crate::vfs::stream_string_to_bytes(stdin))
                        } else {
                            let sfull = resolve_posix_path(cwd, &rest[0]);
                            let Ok(sb) = fs.read_file(&sfull) else {
                                return err_out(&format!("Error: Unable to open stamp/background file {}\n", rest[0]), 1);
                            };
                            PdfDoc::parse(&sb)
                        };
                        if !sdoc.pages.is_empty() {
                            for (p_idx, pg) in doc.pages.iter_mut().enumerate() {
                                let spg = if is_multi {
                                    sdoc.pages.get(p_idx).unwrap_or_else(|| sdoc.pages.last().unwrap())
                                } else {
                                    &sdoc.pages[0]
                                };
                                if is_stamp {
                                    pg.text = format!("{}\n{}", pg.text, spg.text);
                                } else {
                                    pg.text = format!("{}\n{}", spg.text, pg.text);
                                }
                            }
                        }
                    }
                    let out_pos = rest.iter().position(|x| x == "output").unwrap_or(rest.len());
                    write_pdftk_output(&mut doc, &rest[out_pos..])
                }
                "cat" | "shuffle" => {
                    let rest = &args[op_idx + 1..];
                    let out_pos = rest.iter().position(|x| x == "output").unwrap_or(rest.len());
                    let specs = &rest[..out_pos];
                    let mut handle_keys: Vec<String> = handles.keys().cloned().collect();
                    handle_keys.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));

                    let eval_spec = |sp: &str| -> Vec<(String, usize, PdfPage)> {
                        if let Some(d) = handles.get(sp) {
                            return d
                                .pages
                                .iter()
                                .enumerate()
                                .map(|(idx, p)| (sp.to_string(), idx + 1, p.clone()))
                                .collect();
                        }
                        let mut s = sp;
                        let mut doc_key = "A".to_string();
                        let mut doc_ref = &primary;
                        for hk in &handle_keys {
                            if let Some(after) = s.strip_prefix(hk.as_str())
                                && after
                                    .chars()
                                    .next()
                                    .map(|c| c.is_ascii_digit() || after.starts_with("end") || after.starts_with("even") || after.starts_with("odd"))
                                    .unwrap_or(true)
                            {
                                doc_key = hk.clone();
                                doc_ref = handles.get(hk).unwrap_or(&primary);
                                s = after;
                                break;
                            }
                        }
                        let mut rot_mode: Option<(bool, i32)> = None;
                        let mut filter_odd_even: Option<bool> = None;
                        loop {
                            let mut matched = false;
                            for (suf, is_rel, deg) in [
                                ("north", false, 0),
                                ("east", false, 90),
                                ("south", false, 180),
                                ("west", false, 270),
                                ("right", true, 90),
                                ("left", true, -90),
                                ("down", true, 180),
                            ] {
                                if let Some(stripped) = s.strip_suffix(suf) {
                                    s = stripped;
                                    rot_mode = Some((is_rel, deg));
                                    matched = true;
                                    break;
                                }
                            }
                            if matched {
                                continue;
                            }
                            if let Some(stripped) = s.strip_suffix("even") {
                                s = stripped;
                                filter_odd_even = Some(true);
                                continue;
                            }
                            if let Some(stripped) = s.strip_suffix("odd") {
                                s = stripped;
                                filter_odd_even = Some(false);
                                continue;
                            }
                            for (suf, is_rel, deg) in [
                                ("N", false, 0),
                                ("E", false, 90),
                                ("S", false, 180),
                                ("W", false, 270),
                                ("R", true, 90),
                                ("L", true, -90),
                                ("D", true, 180),
                            ] {
                                if let Some(stripped) = s.strip_suffix(suf)
                                    && !stripped.is_empty()
                                {
                                    s = stripped;
                                    rot_mode = Some((is_rel, deg));
                                    matched = true;
                                    break;
                                }
                            }
                            if !matched {
                                break;
                            }
                        }
                        let mut pnos = if s.is_empty() {
                            (1..=doc_ref.pages.len()).collect()
                        } else {
                            parse_qpdf_page_spec(s, doc_ref.pages.len())
                        };
                        if let Some( want_even ) = filter_odd_even {
                            pnos.retain(|p| (*p % 2 == 0) == want_even);
                        }
                        let mut res = Vec::new();
                        for pno in pnos {
                            if let Some(pg) = doc_ref.pages.get(pno - 1) {
                                let mut c = pg.clone();
                                if let Some((is_rel, deg)) = rot_mode {
                                    c.rot = if is_rel {
                                        (c.rot + deg).rem_euclid(360)
                                    } else {
                                        deg.rem_euclid(360)
                                    };
                                }
                                res.push((doc_key.clone(), pno, c));
                            }
                        }
                        res
                    };

                    let mut out_doc = PdfDoc::new();
                    out_doc.version = primary.version.clone();
                    out_doc.title = primary.title.clone();
                    out_doc.author = primary.author.clone();
                    out_doc.page_w = primary.page_w;
                    out_doc.page_h = primary.page_h;
                    out_doc.info = primary.info.clone();
                    let mut chosen: Vec<(String, usize, PdfPage)> = Vec::new();
                    if specs.is_empty() {
                        for (idx, d) in input_docs.iter().enumerate() {
                            if out_doc.title.is_empty() {
                                out_doc.title = d.title.clone();
                            }
                            let hk = ((b'A' + (idx as u8)) as char).to_string();
                            for (p_idx, pg) in d.pages.iter().enumerate() {
                                chosen.push((hk.clone(), p_idx + 1, pg.clone()));
                            }
                        }
                    } else if op == "shuffle" {
                        let lists: Vec<Vec<(String, usize, PdfPage)>> =
                            specs.iter().map(|s| eval_spec(s)).collect();
                        let max_len = lists.iter().map(|l| l.len()).max().unwrap_or(0);
                        for idx in 0..max_len {
                            for l in &lists {
                                if let Some(item) = l.get(idx) {
                                    chosen.push(item.clone());
                                }
                            }
                        }
                    } else {
                        for s in specs {
                            chosen.extend(eval_spec(s));
                        }
                    }
                    for (new_idx0, (hk, old_pno, pg)) in chosen.iter().enumerate() {
                        let new_pno = new_idx0 + 1;
                        if let Some(src_doc) = handles.get(hk) {
                            if let Some(m) = src_doc.page_media.get(old_pno) {
                                out_doc.page_media.insert(new_pno, *m);
                            }
                            for (bt, bl, bp) in &src_doc.bookmarks {
                                if bp.parse::<usize>().ok() == Some(*old_pno) {
                                    out_doc.bookmarks.push((bt.clone(), bl.clone(), new_pno.to_string()));
                                }
                            }
                        }
                        out_doc.pages.push(pg.clone());
                    }
                    write_pdftk_output(&mut out_doc, &rest[out_pos..])
                }
                _ => ok_out(""),
            }
        }
        "pdfdetach" => {
            if args.iter().any(|a| a == "-v" || a == "--version") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "pdfdetach version 24.02.0\n".to_string(),
                    exit_code: 0,
                };
            }
            if args.iter().any(|a| a == "-h" || a == "--help" || a == "-?") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "Usage: pdfdetach [options] <PDF-file>\n".to_string(),
                    exit_code: 0,
                };
            }
            let mut list_mode = false;
            let mut save_all = false;
            let mut save_idx: Option<usize> = None;
            let mut save_file: Option<String> = None;
            let mut out_target: Option<String> = None;
            let mut pw_opt: Option<String> = None;
            let mut pdf_file: Option<String> = None;
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-list" => list_mode = true,
                    "-saveall" => save_all = true,
                    "-save" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out("pdfdetach: invalid -save argument\n", 99);
                        };
                        save_idx = Some(v);
                        i += 1;
                    }
                    "-savefile" => {
                        let Some(v) = args.get(i + 1) else {
                            return err_out("pdfdetach: missing -savefile argument\n", 99);
                        };
                        save_file = Some(v.clone());
                        i += 1;
                    }
                    "-o" => {
                        let Some(v) = args.get(i + 1) else {
                            return err_out("pdfdetach: missing -o argument\n", 99);
                        };
                        out_target = Some(v.clone());
                        i += 1;
                    }
                    "-upw" | "-opw" => {
                        if let Some(v) = args.get(i + 1) {
                            pw_opt = Some(v.clone());
                            i += 1;
                        }
                    }
                    "-enc" => {
                        let Some(enc) = args.get(i + 1) else {
                            return err_out("pdfdetach: missing -enc argument\n", 99);
                        };
                        if !matches!(enc.as_str(), "UTF-8" | "Latin1" | "ASCII7" | "UCS-2" | "Symbol" | "ZapfDingbats") {
                            return err_out(&format!("Command Line Error: Unknown encoding '{enc}'\n"), 99);
                        }
                        i += 1;
                    }
                    a if !a.starts_with('-') => pdf_file = Some(a.to_string()),
                    a => return err_out(&format!("pdfdetach: unknown option {a}\n"), 99),
                }
                i += 1;
            }
            if !list_mode && !save_all && save_idx.is_none() && save_file.is_none() {
                return err_out("pdfdetach: must specify -list, -save, -savefile, or -saveall\n", 99);
            }
            let Some(f) = pdf_file else {
                return err_out("Usage: pdfdetach [options] <PDF-file>\n", 99);
            };
            let full = resolve_posix_path(cwd, &f);
            let Ok(b) = fs.read_file(&full) else {
                return err_out(&format!("I/O Error: Couldn't open file '{f}'\n"), 1);
            };
            if !b.starts_with(b"%PDF-") {
                return err_out(&format!("Syntax Error: '{f}' is not a valid PDF\n"), 2);
            }
            let doc = PdfDoc::parse(&b);
            if let Some(ref enc_pw) = doc.encrypted {
                let supplied = pw_opt.as_deref().unwrap_or("");
                if !enc_pw.is_empty() && supplied != enc_pw {
                    return err_out("Command Line Error: Incorrect password\n", 1);
                }
            }
            if list_mode {
                let mut out = format!("{} embedded files\n", doc.attachments.len());
                for (idx, (_, fname, _, _)) in doc.attachments.iter().enumerate() {
                    out.push_str(&format!("{}: {fname}\n", idx + 1));
                }
                return ok_out(&out);
            }
            if save_all {
                let base_dir = out_target
                    .as_deref()
                    .map(|d| resolve_posix_path(cwd, d))
                    .unwrap_or_else(|| cwd.to_string());
                let _ = fs.mkdir_all(&base_dir);
                for (_, fname, _, payload) in &doc.attachments {
                    let safe_name = fname.rsplit('/').next().unwrap_or(fname);
                    let dst = resolve_posix_path(&base_dir, safe_name);
                    let _ = fs.write_file(&dst, payload);
                }
                return ok_out("");
            }
            if let Some(ref target_name) = save_file {
                let Some((_, fname, _, payload)) = doc
                    .attachments
                    .iter()
                    .find(|(k, fnm, _, _)| fnm == target_name || k == target_name)
                else {
                    return err_out(&format!("Error: Embedded file '{target_name}' not found\n"), 2);
                };
                let dst = out_target
                    .as_deref()
                    .map(|p| resolve_posix_path(cwd, p))
                    .unwrap_or_else(|| resolve_posix_path(cwd, fname.rsplit('/').next().unwrap_or(fname)));
                let _ = fs.write_file(&dst, payload);
                return ok_out("");
            }
            if let Some(idx1) = save_idx {
                if idx1 == 0 || idx1 > doc.attachments.len() {
                    return err_out(&format!("Error: Invalid attachment index {idx1}\n"), 2);
                }
                let (_, fname, _, payload) = &doc.attachments[idx1 - 1];
                let dst = out_target
                    .as_deref()
                    .map(|p| resolve_posix_path(cwd, p))
                    .unwrap_or_else(|| resolve_posix_path(cwd, fname.rsplit('/').next().unwrap_or(fname)));
                let _ = fs.write_file(&dst, payload);
                return ok_out("");
            }
            ok_out("")
        }
        "pdfinfo" => {
            if args.iter().any(|a| a == "-v" || a == "--version") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "pdfinfo version 24.02.0\n".to_string(),
                    exit_code: 0,
                };
            }
            if args.iter().any(|a| a == "-h" || a == "--help" || a == "-?") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "Usage: pdfinfo [options] <PDF-file>\n".to_string(),
                    exit_code: 0,
                };
            }
            if args.iter().any(|a| a == "-listenc") {
                return ok_out("Available encodings are:\nASCII7\nLatin1\nSymbol\nUCS-2\nUTF-8\nZapfDingbats\n");
            }
            let mut show_box = false;
            let mut show_url = false;
            let mut show_meta = false;
            let mut show_js = false;
            let mut show_struct = false;
            let mut show_struct_text = false;
            let mut show_dests = false;
            let mut show_custom = false;
            let mut date_mode = "normal";
            let mut first_p: Option<usize> = None;
            let mut last_p: Option<usize> = None;
            let mut pw_opt: Option<String> = None;
            let mut files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-box" => show_box = true,
                    "-url" => show_url = true,
                    "-meta" => show_meta = true,
                    "-js" => show_js = true,
                    "-struct" => show_struct = true,
                    "-struct-text" => {
                        show_struct = true;
                        show_struct_text = true;
                    }
                    "-dests" => show_dests = true,
                    "-custom" => show_custom = true,
                    "-isodates" => date_mode = "iso",
                    "-rawdates" => date_mode = "raw",
                    "-f" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out("pdfinfo: invalid -f argument\n", 99);
                        };
                        if v == 0 {
                            return err_out("pdfinfo: invalid -f argument\n", 99);
                        }
                        first_p = Some(v);
                        i += 1;
                    }
                    "-l" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out("pdfinfo: invalid -l argument\n", 99);
                        };
                        if v == 0 {
                            return err_out("pdfinfo: invalid -l argument\n", 99);
                        }
                        last_p = Some(v);
                        i += 1;
                    }
                    "-upw" | "-opw" => {
                        if let Some(v) = args.get(i + 1) {
                            pw_opt = Some(v.clone());
                            i += 1;
                        }
                    }
                    "-enc" => {
                        let Some(enc) = args.get(i + 1) else {
                            return err_out("pdfinfo: missing -enc argument\n", 99);
                        };
                        if !matches!(enc.as_str(), "UTF-8" | "Latin1" | "ASCII7" | "UCS-2" | "Symbol" | "ZapfDingbats") {
                            return err_out(&format!("Command Line Error: Unknown encoding '{enc}'\n"), 99);
                        }
                        i += 1;
                    }
                    a if a == "-" || !a.starts_with('-') => files.push(a.to_string()),
                    a => return err_out(&format!("pdfinfo: unknown option {a}\n"), 99),
                }
                i += 1;
            }
            if files.len() != 1 {
                return err_out("Usage: pdfinfo [options] <PDF-file>\n", 99);
            }
            let b = if files[0] == "-" {
                crate::vfs::stream_string_to_bytes(stdin)
            } else {
                let full = resolve_posix_path(cwd, &files[0]);
                let Ok(bytes) = fs.read_file(&full) else {
                    return err_out(&format!("I/O Error: Couldn't open file '{}'\n", files[0]), 1);
                };
                bytes
            };
            if !b.starts_with(b"%PDF-") {
                return err_out(&format!("Syntax Error: '{}' is not a valid PDF\n", files[0]), 2);
            }
            let doc = PdfDoc::parse(&b);
            if let Some(ref enc_pw) = doc.encrypted {
                let supplied = pw_opt.as_deref().unwrap_or("");
                if !enc_pw.is_empty() && supplied != enc_pw {
                    return err_out("Command Line Error: Incorrect password\n", 3);
                }
            }
            if show_url {
                let mut u_out = String::from("Page  Type          URL\n");
                for (p_idx, pg) in doc.pages.iter().enumerate() {
                    for u in &pg.urls {
                        u_out.push_str(&format!("{:4}  {:<13} {u}\n", p_idx + 1, "Annotation"));
                    }
                }
                return ok_out(&u_out);
            }
            let get_info_val = |key: &str| -> Option<String> {
                doc.exif
                    .get(key)
                    .cloned()
                    .or_else(|| {
                        doc.info
                            .iter()
                            .find(|(k, _)| k.eq_ignore_ascii_case(key))
                            .map(|(_, v)| v.clone())
                    })
            };
            let mut out = String::new();
            if !doc.title.is_empty() {
                out.push_str(&format!("{:<17}{}\n", "Title:", doc.title));
            }
            if let Some(v) = get_info_val("Subject")
                && !v.is_empty()
            {
                out.push_str(&format!("{:<17}{v}\n", "Subject:"));
            }
            if let Some(v) = get_info_val("Keywords")
                && !v.is_empty()
            {
                out.push_str(&format!("{:<17}{v}\n", "Keywords:"));
            }
            if !doc.author.is_empty() {
                out.push_str(&format!("{:<17}{}\n", "Author:", doc.author));
            }
            if let Some(v) = get_info_val("Creator")
                && !v.is_empty()
            {
                out.push_str(&format!("{:<17}{v}\n", "Creator:"));
            }
            if let Some(v) = get_info_val("Producer")
                && !v.is_empty()
            {
                out.push_str(&format!("{:<17}{v}\n", "Producer:"));
            }
            if let Some(v) = get_info_val("CreationDate")
                && !v.is_empty()
            {
                out.push_str(&format!("{:<17}{}\n", "CreationDate:", format_pdf_date(&v, date_mode)));
            }
            if let Some(v) = get_info_val("ModDate")
                && !v.is_empty()
            {
                out.push_str(&format!("{:<17}{}\n", "ModDate:", format_pdf_date(&v, date_mode)));
            }
            if show_custom {
                let std_keys = ["title", "author", "subject", "keywords", "creator", "producer", "creationdate", "moddate", "trapped"];
                let mut custom_map: BTreeMap<String, String> = BTreeMap::new();
                for (k, v) in &doc.info {
                    if !std_keys.contains(&k.to_ascii_lowercase().as_str()) {
                        custom_map.insert(k.clone(), v.clone());
                    }
                }
                for (k, v) in &doc.exif {
                    if !std_keys.contains(&k.to_ascii_lowercase().as_str()) {
                        custom_map.insert(k.clone(), v.clone());
                    }
                }
                out.push_str(&format!("{:<17}{}\n", "Custom Metadata:", if custom_map.is_empty() { "no" } else { "yes" }));
                for (k, v) in &custom_map {
                    out.push_str(&format!("{:<17}{v}\n", format!("{k}:")));
                }
            } else {
                out.push_str(&format!("{:<17}no\n", "Custom Metadata:"));
            }
            out.push_str(&format!("{:<17}no\n", "Metadata Stream:"));
            out.push_str(&format!("{:<17}no\n", "Tagged:"));
            out.push_str(&format!("{:<17}no\n", "UserProperties:"));
            out.push_str(&format!("{:<17}no\n", "Suspects:"));
            out.push_str(&format!("{:<17}none\n", "Form:"));
            out.push_str(&format!("{:<17}no\n", "JavaScript:"));
            let total_pages = doc.pages.len().max(1);
            out.push_str(&format!("{:<17}{total_pages}\n", "Pages:"));
            out.push_str(&format!(
                "{:<17}{}\n",
                "Encrypted:",
                if doc.encrypted.is_some() {
                    "yes (print:yes copy:yes change:yes addNotes:yes algorithm:AES-256)"
                } else {
                    "no"
                }
            ));
            let fmt_pt = |n: f64| -> String {
                let r = (n * 100.0).round() / 100.0;
                if (r - r.round()).abs() < 1e-9 {
                    format!("{}", r.round() as i64)
                } else {
                    format!("{r}")
                }
            };
            let multi_page = first_p.is_some() || last_p.is_some();
            let start_p = first_p.unwrap_or(1).max(1);
            let end_p = last_p.unwrap_or(if multi_page { start_p } else { 1 }).min(total_pages);
            for pno in start_p..=end_p {
                let (pw, ph, crop_opt) = doc
                    .page_media
                    .get(&pno)
                    .copied()
                    .unwrap_or((doc.page_w, doc.page_h, None));
                let (eff_w, eff_h) = if let Some([cx0, cy0, cx1, cy1]) = crop_opt {
                    ((cx1 - cx0).abs(), (cy1 - cy0).abs())
                } else {
                    (pw, ph)
                };
                let paper = paper_size_label(eff_w, eff_h);
                let rot = doc.pages.get(pno - 1).map(|p| p.rot).unwrap_or(0);
                if multi_page {
                    out.push_str(&format!(
                        "{:<17}{} x {} pts{paper}\n",
                        format!("Page {pno:4} size:"),
                        fmt_pt(eff_w),
                        fmt_pt(eff_h)
                    ));
                    out.push_str(&format!("{:<17}{rot}\n", format!("Page {pno:4} rot:")));
                } else {
                    out.push_str(&format!(
                        "{:<17}{} x {} pts{paper}\n",
                        "Page size:",
                        fmt_pt(eff_w),
                        fmt_pt(eff_h)
                    ));
                    out.push_str(&format!("{:<17}{rot}\n", "Page rot:"));
                }
                if show_box {
                    let mb = format!("{:8.2} {:8.2} {:8.2} {:8.2}", 0.0, 0.0, pw, ph);
                    let cb = if let Some([cx0, cy0, cx1, cy1]) = crop_opt {
                        format!("{cx0:8.2} {cy0:8.2} {cx1:8.2} {cy1:8.2}")
                    } else {
                        mb.clone()
                    };
                    let pfx = if multi_page {
                        format!("Page {pno:4} ")
                    } else {
                        String::new()
                    };
                    out.push_str(&format!("{:<17}{mb}\n", format!("{pfx}MediaBox:")));
                    out.push_str(&format!("{:<17}{cb}\n", format!("{pfx}CropBox:")));
                    out.push_str(&format!("{:<17}{cb}\n", format!("{pfx}BleedBox:")));
                    out.push_str(&format!("{:<17}{cb}\n", format!("{pfx}TrimBox:")));
                    out.push_str(&format!("{:<17}{cb}\n", format!("{pfx}ArtBox:")));
                }
            }
            out.push_str(&format!("{:<17}{} bytes\n", "File size:", b.len()));
            out.push_str(&format!("{:<17}{}\n", "Optimized:", if doc.linearized { "yes" } else { "no" }));
            out.push_str(&format!("{:<17}{}\n", "PDF version:", doc.version));
            let _ = (show_meta, show_js, show_struct, show_struct_text, show_dests);
            if show_url {
                out.push_str("\nPage  Type          URL\n");
                for (p_idx, pg) in doc.pages.iter().enumerate() {
                    for u in &pg.urls {
                        out.push_str(&format!("{:<5} {:<13} {u}\n", p_idx + 1, "Annotation"));
                    }
                }
            }
            ok_out(&out)
        }
        "pdffonts" => {
            if args.iter().any(|a| a == "-v" || a == "--version") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "pdffonts version 24.02.0\n".to_string(),
                    exit_code: 0,
                };
            }
            if args.iter().any(|a| a == "-h" || a == "--help" || a == "-?") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "Usage: pdffonts [options] <PDF-file>\n".to_string(),
                    exit_code: 0,
                };
            }
            let mut show_subst = false;
            let mut show_loc = false;
            let mut show_loc_ps = false;
            let mut pw_opt: Option<String> = None;
            let mut files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-subst" => show_subst = true,
                    "-loc" => show_loc = true,
                    "-locPS" => show_loc_ps = true,
                    "-f" | "-l" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out("pdffonts: invalid page number\n", 99);
                        };
                        if v == 0 {
                            return err_out("pdffonts: invalid page number\n", 99);
                        }
                        i += 1;
                    }
                    "-upw" | "-opw" => {
                        if let Some(v) = args.get(i + 1) {
                            pw_opt = Some(v.clone());
                            i += 1;
                        }
                    }
                    a if a == "-" || !a.starts_with('-') => files.push(a.to_string()),
                    a => return err_out(&format!("pdffonts: unknown option {a}\n"), 99),
                }
                i += 1;
            }
            if files.len() != 1 {
                return err_out("Usage: pdffonts [options] <PDF-file>\n", 99);
            }
            let b = if files[0] == "-" {
                crate::vfs::stream_string_to_bytes(stdin)
            } else {
                let full = resolve_posix_path(cwd, &files[0]);
                let Ok(bytes) = fs.read_file(&full) else {
                    return err_out(&format!("I/O Error: Couldn't open file '{}'\n", files[0]), 1);
                };
                bytes
            };
            if !b.starts_with(b"%PDF-") {
                return err_out(&format!("Syntax Error: '{}' is not a valid PDF\n", files[0]), 2);
            }
            let doc = PdfDoc::parse(&b);
            if let Some(ref enc_pw) = doc.encrypted {
                let supplied = pw_opt.as_deref().unwrap_or("");
                if !enc_pw.is_empty() && supplied != enc_pw {
                    return err_out("Command Line Error: Incorrect password\n", 3);
                }
            }
            let has_text = doc.pages.iter().any(|p| !p.text.trim().is_empty());
            if show_subst {
                let mut out = String::from(
                    "name                                 object ID substitute font                      substitute font file\n------------------------------------ --------- ------------------------------------ ------------------------------------\n",
                );
                if has_text {
                    out.push_str("Helvetica                                 6  0 Nimbus Sans                          /usr/share/fonts/type1/urw-base35/NimbusSans.t1\n");
                }
                return ok_out(&out);
            }
            if show_loc || show_loc_ps {
                let mut out = String::from(
                    "name                                 type              encoding         emb sub uni object ID location\n------------------------------------ ----------------- ---------------- --- --- --- --------- --------\n",
                );
                if has_text {
                    let loc = if show_loc_ps {
                        "Substitute (Helvetica)"
                    } else {
                        "/usr/share/fonts/type1/urw-base35/NimbusSans.t1"
                    };
                    out.push_str(&format!(
                        "Helvetica                            Type 1            WinAnsi          no  no  no       6  0 {loc}\n"
                    ));
                }
                return ok_out(&out);
            }
            let mut out = String::from(
                "name                                 type              encoding         emb sub uni object ID\n------------------------------------ ----------------- ---------------- --- --- --- ---------\n",
            );
            if has_text {
                out.push_str("Helvetica                            Type 1            WinAnsi          no  no  no       4  0\n");
            }
            ok_out(&out)
        }
        "pdftotext" => {
            let mut first_p = 1usize;
            let mut last_p = 0usize;
            let mut last_p_explicit = false;
            let mut bbox_mode = false;
            let mut bbox_layout = false;
            let mut tsv_mode = false;
            let mut htmlmeta = false;
            let mut urls_mode = false;
            let mut eol_mode = "unix";
            let mut invalid_eol_warn = false;
            let mut invalid_colspacing = false;
            let mut quiet = false;
            let mut listenc = false;
            let mut version = false;
            let mut help = false;
            let mut pos: Vec<String> = Vec::new();
            let mut after_dd = false;
            let mut i = 0usize;
            while i < args.len() {
                let a = args[i].as_str();
                if after_dd {
                    pos.push(a.to_string());
                    i += 1;
                    continue;
                }
                if a == "--" {
                    after_dd = true;
                    i += 1;
                    continue;
                }
                match a {
                    "-f" => {
                        if i + 1 >= args.len() {
                            return err_out("Invalid -f page number\n", 99);
                        }
                        if let Ok(v) = args[i + 1].parse::<usize>() {
                            first_p = v.max(1);
                        } else {
                            return err_out("Invalid -f page number\n", 99);
                        }
                        i += 2;
                    }
                    "-l" => {
                        if i + 1 >= args.len() {
                            return err_out("Invalid -l page number\n", 99);
                        }
                        if let Ok(v) = args[i + 1].parse::<usize>() {
                            last_p = v;
                            last_p_explicit = true;
                        } else {
                            return err_out("Invalid -l page number\n", 99);
                        }
                        i += 2;
                    }
                    "-r" => {
                        if i + 1 >= args.len() || args[i + 1].parse::<f64>().map(|v| v <= 0.0).unwrap_or(true) {
                            return err_out("Invalid -r resolution\n", 99);
                        }
                        i += 2;
                    }
                    "-x" | "-y" | "-W" | "-H" => {
                        if i + 1 >= args.len() || args[i + 1].parse::<f64>().is_err() {
                            return err_out(&format!("Command Line Error: Invalid numeric argument for {a}\n"), 99);
                        }
                        i += 2;
                    }
                    "-fixed" | "-linespacing" | "-upw" | "-opw" if i + 1 < args.len() => {
                        i += 2;
                    }
                    "-colspacing" => {
                        let v = args.get(i + 1).and_then(|s| s.parse::<f64>().ok());
                        if v.map(|x| x <= 0.0 || x > 10.0).unwrap_or(true) {
                            invalid_colspacing = true;
                        }
                        i += 2;
                    }
                    "-enc" => {
                        let enc = args.get(i + 1).map(|s| s.as_str()).unwrap_or("");
                        if !matches!(enc, "ASCII7" | "Latin1" | "UTF-8" | "UCS-2" | "Symbol" | "ZapfDingbats") {
                            return err_out(&format!("Command Line Error: Unknown encoding '{enc}'\n"), 99);
                        }
                        i += 2;
                    }
                    "-eol" => {
                        let v = args.get(i + 1).map(|s| s.as_str()).unwrap_or("");
                        match v {
                            "unix" => eol_mode = "unix",
                            "dos" => eol_mode = "dos",
                            "mac" => eol_mode = "mac",
                            _ => invalid_eol_warn = true,
                        }
                        i += 2;
                    }
                    "-remove-hyphens" => {
                        if let Some(nxt) = args.get(i + 1) && !nxt.starts_with('-') {
                            if !matches!(nxt.as_str(), "yes" | "no" | "auto") {
                                return err_out("Bad '-remove-hyphens' value on command line\n", 99);
                            }
                            i += 2;
                        } else {
                            i += 1;
                        }
                    }
                    "-bbox" => {
                        bbox_mode = true;
                        i += 1;
                    }
                    "-bbox-layout" => {
                        bbox_mode = true;
                        bbox_layout = true;
                        i += 1;
                    }
                    "-tsv" => {
                        tsv_mode = true;
                        i += 1;
                    }
                    "-htmlmeta" => {
                        htmlmeta = true;
                        i += 1;
                    }
                    "-urls" => {
                        urls_mode = true;
                        i += 1;
                    }
                    "-q" => {
                        quiet = true;
                        i += 1;
                    }
                    "-listenc" => {
                        listenc = true;
                        i += 1;
                    }
                    "-v" | "--version" => {
                        version = true;
                        i += 1;
                    }
                    "-h" | "-help" | "--help" | "-?" => {
                        help = true;
                        i += 1;
                    }
                    "-layout" | "-table" | "-lineprinter" | "-raw" | "-nopgbrk" | "-nodiag" | "-cropbox" | "-clip" => {
                        i += 1;
                    }
                    _ if a.starts_with('-') && a != "-" => {
                        return err_out(&format!("Command Line Error: Unknown option '{a}'\n"), 99);
                    }
                    _ => {
                        pos.push(a.to_string());
                        i += 1;
                    }
                }
            }
            let warn_prefix = if invalid_eol_warn { "Bad '-eol' value on command line\n" } else { "" };
            if invalid_colspacing {
                return err_out(&format!("{warn_prefix}Command Line Error: Invalid column spacing\n"), 99);
            }
            if urls_mode && (htmlmeta || bbox_mode || tsv_mode) {
                return err_out(&format!("{warn_prefix}Command Line Error: '-urls' is not supported with HTML or TSV output\n"), 99);
            }
            if pos.len() > 2 {
                return err_out(if quiet { warn_prefix.to_string() } else { format!("{warn_prefix}Usage: pdftotext [options] [PDF-file [text-file]]\n") }.as_str(), 99);
            }
            if listenc {
                return BuiltinOutcome {
                    stdout: "Available encodings are:\nASCII7\nLatin1\nUTF-8\nUCS-2\nSymbol\nZapfDingbats\n".to_string(),
                    stderr: warn_prefix.to_string(),
                    exit_code: 0,
                };
            }
            if version {
                return BuiltinOutcome {
                    stdout: "pdftotext version 26.09.90 (@poe-code/pdf-ast)\n".to_string(),
                    stderr: warn_prefix.to_string(),
                    exit_code: 0,
                };
            }
            if help {
                return BuiltinOutcome {
                    stdout: "Usage: pdftotext [options] [PDF-file [text-file]]\n  -f <int>          : first page to convert\n  -l <int>          : last page to convert\n  -r <fp>           : resolution, in DPI (default is 72)\n  -x <int>          : x-coordinate of the crop area top left corner\n  -y <int>          : y-coordinate of the crop area top left corner\n  -W <int>          : width of crop area in pixels\n  -H <int>          : height of crop area in pixels\n  -layout           : maintain original physical layout\n  -raw              : keep strings in content stream order\n  -bbox             : output bounding box for each word and page size to html\n  -bbox-layout      : like -bbox but with extra layout bounding box data\n  -tsv              : output bounding box for each word and page size to tsv\n  -htmlmeta         : generate a simple HTML file, including the meta information\n  -nopgbrk          : don't insert page breaks between pages\n  -eol <string>     : output end-of-line convention (unix, dos, or mac)\n  -upw <string>     : user password\n  -opw <string>     : owner password\n".to_string(),
                    stderr: warn_prefix.to_string(),
                    exit_code: 0,
                };
            }
            let in_arg = pos.first().map(|s| s.as_str()).unwrap_or("-");
            let raw_bytes = if in_arg == "-" {
                crate::vfs::stream_string_to_bytes(stdin)
            } else {
                let full = resolve_posix_path(cwd, in_arg);
                match fs.read_file(&full) {
                    Ok(b) => b,
                    Err(_) => {
                        let msg = if quiet {
                            String::new()
                        } else {
                            format!("{warn_prefix}I/O Error: Couldn't open file '{in_arg}': No such file or directory.\n")
                        };
                        return err_out(&msg, 1);
                    }
                }
            };
            if raw_bytes.is_empty() {
                let msg = if quiet {
                    String::new()
                } else {
                    format!("{warn_prefix}Syntax Error: Document stream is empty\n")
                };
                return err_out(&msg, 1);
            }
            let doc = PdfDoc::parse(&raw_bytes);
            let page_count = doc.pages.len().max(1);
            let end_p = if !last_p_explicit || last_p == 0 || last_p > page_count {
                page_count
            } else {
                last_p
            };
            if first_p > page_count || first_p > end_p {
                let msg = if quiet {
                    String::new()
                } else {
                    format!("{warn_prefix}Command Line Error: Wrong page range given: the first page ({first_p}) can not be after the last page ({end_p}).\n")
                };
                return err_out(&msg, 99);
            }
            let mut selected_pages: Vec<(usize, &PdfPage)> = Vec::new();
            for pno in first_p..=end_p {
                if let Some(pg) = doc.pages.get(pno - 1) {
                    selected_pages.push((pno, pg));
                }
            }
            let mut selected_texts = Vec::new();
            for (_pno, pg) in &selected_pages {
                let mut t = pg.text.clone();
                if urls_mode {
                    let mut extra = Vec::new();
                    for u in &pg.urls {
                        if !t.contains(u) && !extra.contains(u) {
                            extra.push(u.clone());
                        }
                    }
                    if !extra.is_empty() {
                        if !t.is_empty() && !t.ends_with('\n') {
                            t.push('\n');
                        }
                        t.push_str(&extra.join("\n"));
                    }
                }
                selected_texts.push(t);
            }
            let combined = selected_texts.join("\n");
            let mut rendered = if bbox_mode {
                let mut pages_xml = String::new();
                for (_pno, pg) in &selected_pages {
                    pages_xml.push_str(&format!("  <page width=\"{:.6}\" height=\"{:.6}\">\n", doc.page_w, doc.page_h));
                    if bbox_layout {
                        pages_xml.push_str("    <flow>\n      <block xMin=\"0.000000\" yMin=\"0.000000\" xMax=\"100.000000\" yMax=\"20.000000\">\n        <line xMin=\"0.000000\" yMin=\"0.000000\" xMax=\"100.000000\" yMax=\"20.000000\">\n");
                    }
                    for w in pg.text.split_whitespace() {
                        pages_xml.push_str(&format!(
                            "          <word xMin=\"0.000000\" yMin=\"0.000000\" xMax=\"50.000000\" yMax=\"12.000000\">{}</word>\n",
                            html_escape_str(w)
                        ));
                    }
                    if bbox_layout {
                        pages_xml.push_str("        </line>\n      </block>\n    </flow>\n");
                    }
                    pages_xml.push_str("  </page>\n");
                }
                let author_meta = if doc.author.is_empty() {
                    String::new()
                } else {
                    format!("<meta name=\"Author\" content=\"{}\"/>\n", html_escape_str(&doc.author))
                };
                format!(
                    "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\"><html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head>\n<title>{}</title>\n{author_meta}</head>\n<body>\n<doc>\n{pages_xml}</doc>\n</body>\n</html>\n",
                    html_escape_str(&doc.title)
                )
            } else if tsv_mode {
                let mut tsv = String::from(
                    "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n",
                );
                for (pno, pg) in &selected_pages {
                    tsv.push_str(&format!(
                        "1\t{pno}\t0\t0\t0\t0\t0.000000\t0.000000\t{:.6}\t{:.6}\t-1\t###PAGE###\n",
                        doc.page_w, doc.page_h
                    ));
                    let non_empty_lines: Vec<&str> = pg.text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
                    if !non_empty_lines.is_empty() {
                        tsv.push_str(&format!(
                            "3\t{pno}\t0\t0\t0\t0\t0.000000\t0.000000\t100.000000\t20.000000\t-1\t###FLOW###\n"
                        ));
                        for (lidx, line_str) in non_empty_lines.iter().enumerate() {
                            tsv.push_str(&format!(
                                "4\t{pno}\t0\t0\t{lidx}\t0\t0.000000\t0.000000\t100.000000\t20.000000\t-1\t###LINE###\n"
                            ));
                            for (widx, w) in line_str.split_whitespace().enumerate() {
                                tsv.push_str(&format!(
                                    "5\t{pno}\t0\t0\t{lidx}\t{widx}\t0.00\t0.00\t50.00\t12.00\t100\t{w}\n"
                                ));
                            }
                        }
                    }
                }
                if htmlmeta {
                    let author_meta = if doc.author.is_empty() {
                        String::new()
                    } else {
                        format!("<meta name=\"Author\" content=\"{}\"/>\n", html_escape_str(&doc.author))
                    };
                    format!(
                        "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\"><html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head>\n<title>{}</title>\n{author_meta}</head>\n<body>\n<pre>\n{}</pre>\n</body>\n</html>\n",
                        html_escape_str(&doc.title),
                        html_escape_str(&tsv)
                    )
                } else {
                    tsv
                }
            } else {
                let mut plain = format!("{combined}\n");
                if eol_mode == "dos" {
                    plain = plain.replace('\n', "\r\n");
                } else if eol_mode == "mac" {
                    plain = plain.replace('\n', "\r");
                }
                if htmlmeta {
                    let author_meta = if doc.author.is_empty() {
                        String::new()
                    } else {
                        format!("<meta name=\"Author\" content=\"{}\"/>\n", html_escape_str(&doc.author))
                    };
                    format!(
                        "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\"><html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head>\n<title>{}</title>\n{author_meta}</head>\n<body>\n<pre>\n{}</pre>\n</body>\n</html>\n",
                        html_escape_str(&doc.title),
                        html_escape_str(&plain)
                    )
                } else {
                    plain
                }
            };
            if (bbox_mode || tsv_mode) && eol_mode == "dos" {
                rendered = rendered.replace('\n', "\r\n");
            }
            let out_target = if pos.len() >= 2 {
                pos[1].clone()
            } else if in_arg != "-" {
                let ext = if bbox_mode || htmlmeta {
                    ".html"
                } else if tsv_mode {
                    ".tsv"
                } else {
                    ".txt"
                };
                let stem = if in_arg.to_ascii_lowercase().ends_with(".pdf") {
                    &in_arg[..in_arg.len() - 4]
                } else {
                    in_arg
                };
                format!("{stem}{ext}")
            } else {
                "-".to_string()
            };
            if out_target == "-" {
                BuiltinOutcome {
                    stdout: rendered,
                    stderr: warn_prefix.to_string(),
                    exit_code: 0,
                }
            } else {
                let dst = resolve_posix_path(cwd, &out_target);
                let _ = fs.write_file(&dst, rendered.as_bytes());
                BuiltinOutcome {
                    stdout: String::new(),
                    stderr: warn_prefix.to_string(),
                    exit_code: 0,
                }
            }
        }
        "pdftohtml" => {
            let mut xml_mode = false;
            let mut to_stdout = false;
            let mut ignore_images = false;
            let mut data_urls = false;
            let mut first_p = 1usize;
            let mut last_p = 0usize;
            let mut zoom = 1.0f64;
            let mut image_fmt = "png";
            let mut pos: Vec<String> = Vec::new();
            let mut after_dd = false;
            let mut i = 0usize;
            while i < args.len() {
                let a = args[i].as_str();
                if after_dd {
                    pos.push(a.to_string());
                    i += 1;
                    continue;
                }
                if a == "--" {
                    after_dd = true;
                    i += 1;
                    continue;
                }
                if a == "-v" || a == "--version" {
                    return ok_out("pdftohtml version 24.08.0\n");
                }
                if a == "-h" || a == "-help" || a == "--help" || a == "-?" {
                    return ok_out("Usage: pdftohtml [options] <PDF-file> [<html-file>|<xml-file>]\n  -xml / -stdout / -s / -i / -noframes / -c / -f <int> / -l <int>\n");
                }
                match a {
                    "-xml" => xml_mode = true,
                    "-stdout" => to_stdout = true,
                    "-i" => ignore_images = true,
                    "-dataurls" => data_urls = true,
                    "-f" => {
                        i += 1;
                        first_p = args.get(i).and_then(|s| s.parse::<usize>().ok()).unwrap_or(1).max(1);
                    }
                    "-l" => {
                        i += 1;
                        last_p = args.get(i).and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
                    }
                    "-zoom" => {
                        i += 1;
                        if let Some(z) = args.get(i).and_then(|s| s.parse::<f64>().ok()) && z.is_finite() && z > 0.0 {
                            zoom = z;
                        }
                    }
                    "-fmt" => {
                        i += 1;
                        let fv = args.get(i).map(|s| s.to_ascii_lowercase()).unwrap_or_default();
                        if fv == "png" {
                            image_fmt = "png";
                        } else if fv == "jpg" || fv == "jpeg" {
                            image_fmt = "jpg";
                        } else {
                            return err_out(&format!("Command Line Error: Invalid image format '{fv}'\n"), 99);
                        }
                    }
                    "-enc" => {
                        i += 1;
                        let enc = args.get(i).map(|s| s.as_str()).unwrap_or("");
                        if !matches!(enc, "ASCII7" | "Latin1" | "UTF-8" | "UCS-2" | "Symbol" | "ZapfDingbats") {
                            return err_out(&format!("Command Line Error: Unknown encoding '{enc}'\n"), 99);
                        }
                    }
                    "-upw" | "-opw" => {
                        i += 1;
                    }
                    "-s" | "-noframes" | "-c" | "-p" | "-q" | "-hidden" | "-nomerge" | "-nodrm" => {}
                    _ if !a.starts_with('-') || a == "-" => {
                        pos.push(a.to_string());
                    }
                    _ => {}
                }
                i += 1;
            }
            let input_path = if let Some(p0) = pos.first() {
                p0.as_str()
            } else if !stdin.is_empty() {
                "-"
            } else {
                return err_out("Usage: pdftohtml [options] <PDF-file> [<html-file>]\n", 99);
            };
            let explicit_out = pos.get(1).map(|s| s.as_str());
            let stdout_output = to_stdout || explicit_out == Some("-") || (input_path == "-" && explicit_out.is_none());
            let default_ext = if xml_mode { ".xml" } else { ".html" };
            let input_stem = if input_path.to_ascii_lowercase().ends_with(".pdf") {
                &input_path[..input_path.len() - 4]
            } else {
                input_path
            };
            let out_path = match explicit_out {
                Some(eo) => {
                    if eo.ends_with(".html") || eo.ends_with(".xml") {
                        eo.to_string()
                    } else {
                        format!("{eo}{default_ext}")
                    }
                }
                None => format!("{input_stem}{default_ext}"),
            };
            let image_dir = match out_path.rfind('/') {
                Some(idx) => &out_path[..=idx],
                None => "",
            };
            let raw_bytes = if input_path == "-" {
                let b = crate::vfs::stream_string_to_bytes(stdin);
                if b.is_empty() {
                    return err_out("I/O Error: Couldn't open file '-'\n", 1);
                }
                b
            } else {
                let full = resolve_posix_path(cwd, input_path);
                match fs.read_file(&full) {
                    Ok(b) => b,
                    Err(_) => return err_out(&format!("I/O Error: Couldn't open file '{input_path}'\n"), 1),
                }
            };
            let doc = PdfDoc::parse(&raw_bytes);
            let total_pages = doc.pages.len().max(1);
            let end_p = if last_p > 0 { total_pages.min(last_p) } else { total_pages };
            if first_p > total_pages || (last_p > 0 && first_p > end_p) {
                return err_out(
                    &format!("Command Line Error: Wrong page range given: the first page ({first_p}) can not be after the last page ({end_p}).\n"),
                    99,
                );
            }
            let pw = (doc.page_w * zoom).round() as i64;
            let ph = (doc.page_h * zoom).round() as i64;
            let default_font_size = (12.0 * zoom).round() as i64;
            let rendered = if xml_mode {
                let mut lines = vec![
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_string(),
                    "<!DOCTYPE pdf2xml SYSTEM \"pdf2xml.dtd\">".to_string(),
                    "<pdf2xml producer=\"@poe-code/pdf-ast\" version=\"24.08.0\">".to_string(),
                ];
                for pno in first_p..=end_p {
                    lines.push(format!(
                        "  <page number=\"{pno}\" position=\"absolute\" top=\"0\" left=\"0\" height=\"{ph}\" width=\"{pw}\">"
                    ));
                    lines.push(format!(
                        "    <fontspec id=\"0\" size=\"{default_font_size}\" family=\"Helvetica\" color=\"#000000\"/>"
                    ));
                    if let Some(pg) = doc.pages.get(pno - 1) {
                        if !ignore_images {
                            for (img_idx, (iw, ih, _)) in pg.images.iter().enumerate() {
                                let img_file = format!("page{pno}_{}.{image_fmt}", img_idx + 1);
                                let im = ImageMeta {
                                    fmt: if image_fmt == "jpg" { "JPEG".to_string() } else { "PNG".to_string() },
                                    w: *iw,
                                    h: *ih,
                                    cs: "sRGB".to_string(),
                                    exif: BTreeMap::new(),
                                };
                                let img_bytes = write_image_bytes(&im);
                                if !data_urls && !stdout_output {
                                    let full_img = resolve_posix_path(cwd, &format!("{image_dir}{img_file}"));
                                    let _ = fs.write_file(&full_img, &img_bytes);
                                }
                                let src_attr = if data_urls {
                                    let mime = if image_fmt == "jpg" { "image/jpeg" } else { "image/png" };
                                    format!("data:{mime};base64,{}", base64_encode(&img_bytes))
                                } else {
                                    img_file
                                };
                                lines.push(format!(
                                    "    <image top=\"0\" left=\"0\" width=\"{iw}\" height=\"{ih}\" src=\"{src_attr}\"/>"
                                ));
                            }
                        }
                        for (lidx, line_str) in pg.text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).enumerate() {
                            let top = 50 + (lidx as i64) * 20;
                            let escaped = html_escape_str(line_str);
                            let inner = if let Some(u) = pg.urls.first() && lidx == 0 {
                                format!("<a href=\"{}\">{escaped}</a>", html_escape_str(u))
                            } else {
                                escaped
                            };
                            lines.push(format!(
                                "    <text top=\"{top}\" left=\"50\" width=\"200\" height=\"20\" font=\"0\">{inner}</text>"
                            ));
                        }
                    }
                    lines.push("  </page>".to_string());
                }
                if !doc.bookmarks.is_empty() {
                    lines.push("  <outline>".to_string());
                    for (btitle, _blevel, bpage) in &doc.bookmarks {
                        lines.push(format!("    <item page=\"{bpage}\">{}</item>", html_escape_str(btitle)));
                    }
                    lines.push("  </outline>".to_string());
                }
                lines.push("</pdf2xml>".to_string());
                format!("{}\n", lines.join("\n"))
            } else {
                let title = if doc.title.is_empty() {
                    html_escape_str(input_path)
                } else {
                    html_escape_str(&doc.title)
                };
                let mut lines = vec![
                    "<!DOCTYPE html>".to_string(),
                    "<html>".to_string(),
                    format!("<head><meta charset=\"utf-8\"/><title>{title}</title></head>"),
                    "<body>".to_string(),
                ];
                for pno in first_p..=end_p {
                    lines.push(format!(
                        "<div class=\"page\" id=\"page{pno}\" style=\"position:relative;width:{pw}pt;height:{ph}pt;\">"
                    ));
                    if let Some(pg) = doc.pages.get(pno - 1) {
                        if !ignore_images {
                            for (img_idx, (iw, ih, _)) in pg.images.iter().enumerate() {
                                let img_file = format!("page{pno}_{}.{image_fmt}", img_idx + 1);
                                let im = ImageMeta {
                                    fmt: if image_fmt == "jpg" { "JPEG".to_string() } else { "PNG".to_string() },
                                    w: *iw,
                                    h: *ih,
                                    cs: "sRGB".to_string(),
                                    exif: BTreeMap::new(),
                                };
                                let img_bytes = write_image_bytes(&im);
                                if !data_urls && !stdout_output {
                                    let full_img = resolve_posix_path(cwd, &format!("{image_dir}{img_file}"));
                                    let _ = fs.write_file(&full_img, &img_bytes);
                                }
                                let src_attr = if data_urls {
                                    let mime = if image_fmt == "jpg" { "image/jpeg" } else { "image/png" };
                                    format!("data:{mime};base64,{}", base64_encode(&img_bytes))
                                } else {
                                    img_file
                                };
                                lines.push(format!(
                                    "  <img src=\"{src_attr}\" width=\"{iw}\" height=\"{ih}\"/>"
                                ));
                            }
                        }
                        for (lidx, line_str) in pg.text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).enumerate() {
                            let top = 50 + (lidx as i64) * 20;
                            let escaped = html_escape_str(line_str);
                            let inner = if let Some(u) = pg.urls.first() && lidx == 0 {
                                format!("<a href=\"{}\">{escaped}</a>", html_escape_str(u))
                            } else {
                                escaped
                            };
                            lines.push(format!(
                                "  <p style=\"position:absolute;top:{top}pt;left:50pt;margin:0;\">{inner}</p>"
                            ));
                        }
                    }
                    lines.push("</div>".to_string());
                }
                if !doc.bookmarks.is_empty() {
                    lines.push("<hr/>".to_string());
                    lines.push("<a name=\"outline\"></a><h1>Document Outline</h1>".to_string());
                    lines.push("<ul>".to_string());
                    for (btitle, _blevel, bpage) in &doc.bookmarks {
                        lines.push(format!("<li><a href=\"#page{bpage}\">{}</a></li>", html_escape_str(btitle)));
                    }
                    lines.push("</ul>".to_string());
                }
                lines.push("</body>".to_string());
                lines.push("</html>".to_string());
                format!("{}\n", lines.join("\n"))
            };
            if stdout_output {
                ok_out(&rendered)
            } else {
                let dst = resolve_posix_path(cwd, &out_path);
                let _ = fs.write_file(&dst, rendered.as_bytes());
                ok_out("")
            }
        }
        "pdftoppm" | "pdftocairo" => {
            if args.iter().any(|a| a == "-v" || a == "--version") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{cmd} version 24.02.0\n"),
                    exit_code: 0,
                };
            }
            if args.iter().any(|a| a == "-h" || a == "--help" || a == "-?") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("Usage: {cmd} [options] [PDF-file [PPM-file-prefix]]\n"),
                    exit_code: 0,
                };
            }
            let mut ext = "ppm";
            let mut fmt = "PPM";
            let mut singlefile = false;
            let mut first_p = 1usize;
            let mut last_p: Option<usize> = None;
            let mut odd_only = false;
            let mut even_only = false;
            let mut sep = "-".to_string();
            let mut force_num = false;
            let mut set_pageno: Option<usize> = None;
            let mut progress = false;
            let mut dpi_x = 150.0f64;
            let mut dpi_y = 150.0f64;
            let mut scale_to: Option<i64> = None;
            let mut scale_to_x: Option<i64> = None;
            let mut scale_to_y: Option<i64> = None;
            let mut crop_w: Option<f64> = None;
            let mut crop_h: Option<f64> = None;
            let mut pw_opt: Option<String> = None;
            let mut pos: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-png" => {
                        ext = "png";
                        fmt = "PNG";
                    }
                    "-jpeg" | "-jpg" => {
                        ext = "jpg";
                        fmt = "JPEG";
                    }
                    "-tiff" => {
                        ext = "tif";
                        fmt = "TIFF";
                    }
                    "-gray" => {
                        ext = "pgm";
                        fmt = "PGM";
                    }
                    "-mono" => {
                        ext = "pbm";
                        fmt = "PBM";
                    }
                    "-svg" => {
                        ext = "svg";
                        fmt = "SVG";
                    }
                    "-eps" => {
                        ext = "eps";
                        fmt = "EPS";
                    }
                    "-ps" => {
                        ext = "ps";
                        fmt = "PS";
                    }
                    "-pdf" => {
                        ext = "pdf";
                        fmt = "PDF";
                    }
                    "-singlefile" => singlefile = true,
                    "-odd" | "-o" => odd_only = true,
                    "-even" | "-e" => even_only = true,
                    "-forcenum" => force_num = true,
                    "-progress" => progress = true,
                    "-f" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out(&format!("{cmd}: invalid -f argument\n"), 99);
                        };
                        if v == 0 {
                            return err_out(&format!("{cmd}: invalid -f argument\n"), 99);
                        }
                        first_p = v;
                        i += 1;
                    }
                    "-l" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out(&format!("{cmd}: invalid -l argument\n"), 99);
                        };
                        if v == 0 {
                            return err_out(&format!("{cmd}: invalid -l argument\n"), 99);
                        }
                        last_p = Some(v);
                        i += 1;
                    }
                    "-r" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()) else {
                            return err_out(&format!("{cmd}: invalid -r argument\n"), 99);
                        };
                        if v <= 0.0 {
                            return err_out(&format!("{cmd}: invalid -r argument\n"), 99);
                        }
                        dpi_x = v;
                        dpi_y = v;
                        i += 1;
                    }
                    "-rx" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()) {
                            dpi_x = v;
                            i += 1;
                        }
                    }
                    "-ry" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()) {
                            dpi_y = v;
                            i += 1;
                        }
                    }
                    "-scale-to" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<i64>().ok()) {
                            scale_to = Some(v);
                            i += 1;
                        }
                    }
                    "-scale-to-x" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<i64>().ok()) {
                            scale_to_x = Some(v);
                            i += 1;
                        }
                    }
                    "-scale-to-y" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<i64>().ok()) {
                            scale_to_y = Some(v);
                            i += 1;
                        }
                    }
                    "-W" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()) {
                            crop_w = Some(v);
                            i += 1;
                        }
                    }
                    "-H" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()) {
                            crop_h = Some(v);
                            i += 1;
                        }
                    }
                    "-sz" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()) {
                            crop_w = Some(v);
                            crop_h = Some(v);
                            i += 1;
                        }
                    }
                    "-x" | "-y" | "-jpegopt" | "-tiffcompression" | "-paper" | "-paperw" | "-paperh" => {
                        i += 1;
                    }
                    "-sep" => {
                        let Some(s) = args.get(i + 1) else {
                            return err_out(&format!("{cmd}: -sep requires a single character\n"), 99);
                        };
                        if s.len() != 1 {
                            return err_out(&format!("{cmd}: -sep requires a single character\n"), 99);
                        }
                        sep = s.clone();
                        i += 1;
                    }
                    "-setpageno" => {
                        if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) {
                            set_pageno = Some(v);
                            i += 1;
                        }
                    }
                    "-upw" | "-opw" => {
                        if let Some(v) = args.get(i + 1) {
                            pw_opt = Some(v.clone());
                            i += 1;
                        }
                    }
                    "-cropbox" | "-aa" | "-aaVector" | "-thinlinemode" | "-transp" | "-level2" | "-level3" | "-origpagesizes" | "-nocrop" | "-expand" | "-noshrink" | "-nocenter" | "-duplex" | "-q" => {}
                    a if a == "-" || !a.starts_with('-') => pos.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let src_arg = pos.first().map(|s| s.as_str()).unwrap_or("-");
            let prefix_arg = pos.get(1).map(|s| s.as_str());
            let b = if src_arg == "-" {
                crate::vfs::stream_string_to_bytes(stdin)
            } else {
                let full = resolve_posix_path(cwd, src_arg);
                let Ok(bytes) = fs.read_file(&full) else {
                    return err_out(&format!("I/O Error: Couldn't open file '{src_arg}'\n"), 1);
                };
                bytes
            };
            if !b.starts_with(b"%PDF-") {
                return err_out(&format!("Syntax Error: '{src_arg}' is not a valid PDF\n"), 2);
            }
            let doc = PdfDoc::parse(&b);
            if let Some(ref enc_pw) = doc.encrypted {
                let supplied = pw_opt.as_deref().unwrap_or("");
                if !enc_pw.is_empty() && supplied != enc_pw {
                    return err_out("Command Line Error: Incorrect password\n", 3);
                }
            }
            let total = doc.pages.len().max(1);
            let end_p = last_p.unwrap_or(total).min(total);
            if first_p > end_p {
                return err_out("Wrong page range given: the first page can not be after the last page.\n", 99);
            }
            if matches!(fmt, "SVG" | "EPS" | "PS" | "PDF") {
                let pfx = prefix_arg.unwrap_or("out");
                let dst_rel = if pfx.ends_with(&format!(".{ext}")) {
                    pfx.to_string()
                } else {
                    format!("{pfx}.{ext}")
                };
                if fmt == "SVG" {
                    let txt = doc.pages.get(first_p - 1).map(|p| p.text.clone()).unwrap_or_default();
                    let svg = format!(
                        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\"><text x=\"20\" y=\"40\">{}</text></svg>\n",
                        doc.page_w as i64,
                        doc.page_h as i64,
                        doc.page_w as i64,
                        doc.page_h as i64,
                        html_escape_str(&txt)
                    );
                    if pfx == "-" {
                        return ok_out(&svg);
                    }
                    let dst = resolve_posix_path(cwd, &dst_rel);
                    let _ = fs.write_file(&dst, svg.as_bytes());
                    return ok_out("");
                }
                if fmt == "EPS" || fmt == "PS" {
                    let eps = format!(
                        "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 {} {}\n%%EndComments\n",
                        doc.page_w as i64, doc.page_h as i64
                    );
                    if pfx == "-" {
                        return ok_out(&eps);
                    }
                    let dst = resolve_posix_path(cwd, &dst_rel);
                    let _ = fs.write_file(&dst, eps.as_bytes());
                    return ok_out("");
                }
                if fmt == "PDF" {
                    let mut sub = doc.clone();
                    sub.pages = doc.pages[(first_p - 1)..end_p].to_vec();
                    let ser = sub.serialize();
                    if pfx == "-" {
                        return ok_out(&crate::vfs::bytes_to_stream_string(&ser));
                    }
                    let dst = resolve_posix_path(cwd, &dst_rel);
                    let _ = fs.write_file(&dst, &ser);
                    return ok_out("");
                }
            }

            let compute_dims = |pno: usize| -> (u32, u32) {
                let (mut pw, mut ph, _) = doc
                    .page_media
                    .get(&pno)
                    .copied()
                    .unwrap_or((doc.page_w, doc.page_h, None));
                let rot = doc.pages.get(pno - 1).map(|p| p.rot).unwrap_or(0);
                if rot == 90 || rot == 270 {
                    std::mem::swap(&mut pw, &mut ph);
                }
                let mut w = ((pw * dpi_x) / 72.0).round().max(1.0);
                let mut h = ((ph * dpi_y) / 72.0).round().max(1.0);
                let sx = scale_to_x.or(scale_to);
                let sy = scale_to_y.or(scale_to);
                if let (Some(tx), Some(ty)) = (sx, sy) {
                    if tx > 0 && ty > 0 {
                        let ratio = ((tx as f64) / w).min((ty as f64) / h);
                        w = (w * ratio).round().max(1.0);
                        h = (h * ratio).round().max(1.0);
                    } else if tx > 0 && ty < 0 {
                        let ratio = (tx as f64) / w;
                        w = tx as f64;
                        h = (h * ratio).round().max(1.0);
                    } else if ty > 0 && tx < 0 {
                        let ratio = (ty as f64) / h;
                        h = ty as f64;
                        w = (w * ratio).round().max(1.0);
                    }
                } else if let Some(tx) = sx
                    && tx > 0
                {
                    let ratio = (tx as f64) / w;
                    w = tx as f64;
                    h = (h * ratio).round().max(1.0);
                } else if let Some(ty) = sy
                    && ty > 0
                {
                    let ratio = (ty as f64) / h;
                    h = ty as f64;
                    w = (w * ratio).round().max(1.0);
                }
                if let Some(cw) = crop_w
                    && cw > 0.0
                {
                    w = cw.round().min(w).max(1.0);
                }
                if let Some(ch) = crop_h
                    && ch > 0.0
                {
                    h = ch.round().min(h).max(1.0);
                }
                (w as u32, h as u32)
            };

            let mut selected_pages: Vec<usize> = Vec::new();
            for pno in first_p..=end_p {
                if odd_only && pno % 2 == 0 {
                    continue;
                }
                if even_only && pno % 2 == 1 {
                    continue;
                }
                selected_pages.push(pno);
                if singlefile {
                    break;
                }
            }
            if prefix_arg.is_none() || prefix_arg == Some("-") {
                let pno = selected_pages.first().copied().unwrap_or(1);
                let (w, h) = compute_dims(pno);
                let im = ImageMeta {
                    fmt: fmt.to_string(),
                    w,
                    h,
                    cs: if fmt == "PGM" || fmt == "PBM" { "Gray".to_string() } else { "sRGB".to_string() },
                    exif: BTreeMap::new(),
                };
                let bytes = write_image_bytes(&im);
                return ok_out(&crate::vfs::bytes_to_stream_string(&bytes));
            }
            let pfx_rel = prefix_arg.unwrap();
            let pfx_full = resolve_posix_path(cwd, pfx_rel);
            let digits = total.to_string().len();
            let mut stderr_progress = String::new();
            for pno in &selected_pages {
                let (w, h) = compute_dims(*pno);
                let im = ImageMeta {
                    fmt: fmt.to_string(),
                    w,
                    h,
                    cs: if fmt == "PGM" || fmt == "PBM" { "Gray".to_string() } else { "sRGB".to_string() },
                    exif: BTreeMap::new(),
                };
                let bytes = write_image_bytes(&im);
                let (rel_dst, dst) = if singlefile && !force_num {
                    (format!("{pfx_rel}.{ext}"), format!("{pfx_full}.{ext}"))
                } else {
                    let out_num = set_pageno.map(|base| base + *pno - first_p).unwrap_or(*pno);
                    let width = digits.max(out_num.to_string().len());
                    let num_str = format!("{out_num:0width$}", width = width);
                    (
                        format!("{pfx_rel}{sep}{num_str}.{ext}"),
                        format!("{pfx_full}{sep}{num_str}.{ext}"),
                    )
                };
                let _ = fs.write_file(&dst, &bytes);
                if progress {
                    stderr_progress.push_str(&format!("{pno} {end_p} {rel_dst}\n"));
                }
            }
            BuiltinOutcome {
                stdout: String::new(),
                stderr: stderr_progress,
                exit_code: 0,
            }
        }
        "pdfimages" => {
            if args.iter().any(|a| a == "-v" || a == "--version") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "pdfimages version 24.02.0\n".to_string(),
                    exit_code: 0,
                };
            }
            if args.iter().any(|a| a == "-h" || a == "--help" || a == "-?") {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "Usage: pdfimages [options] <PDF-file> [<image-root>]\n".to_string(),
                    exit_code: 0,
                };
            }
            let mut list_mode = false;
            let mut page_nums = false;
            let mut print_names = false;
            let mut png_mode = false;
            let mut tiff_mode = false;
            let mut jpeg_mode = false;
            let mut all_mode = false;
            let mut first_p: Option<usize> = None;
            let mut last_p: Option<usize> = None;
            let mut pw_opt: Option<String> = None;
            let mut pos: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-list" => list_mode = true,
                    "-p" => page_nums = true,
                    "-print-filenames" => print_names = true,
                    "-png" => png_mode = true,
                    "-tiff" => tiff_mode = true,
                    "-j" => jpeg_mode = true,
                    "-all" => all_mode = true,
                    "-jp2" | "-jbig2" | "-ccitt" | "-u" | "-q" => {}
                    "-f" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out("pdfimages: invalid -f argument\n", 99);
                        };
                        if v == 0 {
                            return err_out("pdfimages: invalid -f argument\n", 99);
                        }
                        first_p = Some(v);
                        i += 1;
                    }
                    "-l" => {
                        let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                            return err_out("pdfimages: invalid -l argument\n", 99);
                        };
                        if v == 0 {
                            return err_out("pdfimages: invalid -l argument\n", 99);
                        }
                        last_p = Some(v);
                        i += 1;
                    }
                    "-upw" | "-opw" => {
                        if let Some(v) = args.get(i + 1) {
                            pw_opt = Some(v.clone());
                            i += 1;
                        }
                    }
                    a if a == "-" || !a.starts_with('-') => pos.push(a.to_string()),
                    a => return err_out(&format!("pdfimages: unknown option {a}\n"), 99),
                }
                i += 1;
            }
            if let (Some(f), Some(l)) = (first_p, last_p)
                && f > l
            {
                return err_out("pdfimages: invalid page range\n", 99);
            }
            if pos.is_empty() || (!list_mode && pos.len() < 2) {
                return err_out("Usage: pdfimages [options] <PDF-file> <image-root>\n", 99);
            }
            let b = if pos[0] == "-" {
                crate::vfs::stream_string_to_bytes(stdin)
            } else {
                let full = resolve_posix_path(cwd, &pos[0]);
                let Ok(bytes) = fs.read_file(&full) else {
                    return err_out(&format!("I/O Error: Couldn't open file '{}'\n", pos[0]), 1);
                };
                bytes
            };
            if !b.starts_with(b"%PDF-") {
                return err_out(&format!("Syntax Error: '{}' is not a valid PDF\n", pos[0]), 2);
            }
            let doc = PdfDoc::parse(&b);
            if let Some(ref enc_pw) = doc.encrypted {
                let supplied = pw_opt.as_deref().unwrap_or("");
                if !enc_pw.is_empty() && supplied != enc_pw {
                    return err_out("Command Line Error: Incorrect password\n", 3);
                }
            }
            let total_pages = doc.pages.len().max(1);
            let start_p = first_p.unwrap_or(1);
            let end_p = last_p.unwrap_or(total_pages).min(total_pages);
            let mut all_imgs: Vec<(usize, u32, u32, String)> = Vec::new();
            for (pidx, pg) in doc.pages.iter().enumerate() {
                let pno = pidx + 1;
                if pno < start_p || pno > end_p {
                    continue;
                }
                for (w, h, im_fmt) in &pg.images {
                    all_imgs.push((pno, *w, *h, im_fmt.clone()));
                }
            }
            if list_mode {
                let mut out = String::from(
                    "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n--------------------------------------------------------------------------------------------\n",
                );
                for (idx, (pno, w, h, im_fmt)) in all_imgs.iter().enumerate() {
                    let enc = if im_fmt.eq_ignore_ascii_case("JPEG") || im_fmt.eq_ignore_ascii_case("JPG") {
                        "jpeg"
                    } else {
                        "image"
                    };
                    let obj_id = 5 + idx * 2;
                    out.push_str(&format!(
                        "{pno:4}  {idx:4} image  {w:5} {h:6} rgb     3   8  {enc:<5} no      {obj_id:4}  0    72    72 128B  10%\n"
                    ));
                }
                return ok_out(&out);
            }
            let prefix = &pos[1];
            let mut out = String::new();
            for (idx, (pno, w, h, im_fmt)) in all_imgs.iter().enumerate() {
                let is_jpg = im_fmt.eq_ignore_ascii_case("JPEG") || im_fmt.eq_ignore_ascii_case("JPG");
                let (ext, fmt) = if tiff_mode {
                    ("tif", "TIFF")
                } else if all_mode {
                    if is_jpg { ("jpg", "JPEG") } else { ("png", "PNG") }
                } else if jpeg_mode && is_jpg {
                    ("jpg", "JPEG")
                } else if png_mode {
                    ("png", "PNG")
                } else {
                    ("ppm", "PPM")
                };
                let rel_name = if page_nums {
                    format!("{prefix}-{pno:03}-{idx:03}.{ext}")
                } else {
                    format!("{prefix}-{idx:03}.{ext}")
                };
                let full_out = resolve_posix_path(cwd, &rel_name);
                let im = ImageMeta {
                    fmt: fmt.to_string(),
                    w: *w,
                    h: *h,
                    cs: "sRGB".to_string(),
                    exif: BTreeMap::new(),
                };
                let _ = fs.write_file(&full_out, &write_image_bytes(&im));
                if print_names {
                    out.push_str(&format!("{rel_name}\n"));
                }
            }
            ok_out(&out)
        }
        "magick" | "convert" | "mogrify" => {
            if (cmd == "magick" || cmd == "convert")
                && let Some(first) = args.first()
                && matches!(
                    first.as_str(),
                    "identify" | "mogrify" | "convert" | "composite" | "montage" | "compare"
                )
            {
                return cmd_media_doc(first, &args[1..], stdin, cwd, fs);
            }
            if let Some(list_out) = try_magick_list_option(args) {
                return list_out;
            }
            for a in args {
                if a == "--" {
                    break;
                }
                if a == "-version" || a == "--version" {
                    return ok_out("Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");
                }
                if a == "-help" || a == "--help" || a == "-h" {
                    return ok_out(&format!("Usage: {cmd} [options] input... output\n"));
                }
            }
            let is_mogrify = cmd == "mogrify";
            let mut size_opt: Option<(u32, u32)> = None;
            let mut resize_spec: Option<String> = None;
            let mut crop_opt: Option<(u32, u32)> = None;
            let mut border_opt: Option<(u32, u32)> = None;
            let mut extent_opt: Option<(u32, u32)> = None;
            let mut rot_deg = 0i32;
            let mut transpose_swaps = 0usize;
            let mut gray_cs = false;
            let mut negate_count = 0usize;
            let mut append_mode: Option<bool> = None;
            let mut mogrify_format: Option<String> = None;
            let mut mogrify_path: Option<String> = None;
            let mut pseudo_color: Option<(u8, u8, u8)> = None;
            let mut pos_files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-size" if i + 1 < args.len() => {
                        if let Some((ws, hs)) = args[i + 1].split_once('x') {
                            size_opt = Some((ws.parse().unwrap_or(32), hs.parse().unwrap_or(32)));
                        }
                        i += 2;
                    }
                    "-resize" | "-scale" | "-sample" | "-thumbnail" if i + 1 < args.len() => {
                        resize_spec = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-crop" if i + 1 < args.len() => {
                        let s = args[i + 1].split(['+', '-']).next().unwrap_or("");
                        if let Some((ws, hs)) = s.split_once('x') {
                            crop_opt = Some((ws.parse().unwrap_or(32), hs.parse().unwrap_or(32)));
                        }
                        i += 2;
                    }
                    "-border" if i + 1 < args.len() => {
                        let s = args[i + 1].split(['+', '-']).next().unwrap_or("");
                        if let Some((ws, hs)) = s.split_once('x') {
                            border_opt = Some((ws.parse().unwrap_or(0), hs.parse().unwrap_or(0)));
                        } else if let Ok(bw) = s.parse::<u32>() {
                            border_opt = Some((bw, bw));
                        }
                        i += 2;
                    }
                    "-extent" if i + 1 < args.len() => {
                        let s = args[i + 1].split(['+', '-']).next().unwrap_or("");
                        if let Some((ws, hs)) = s.split_once('x') {
                            extent_opt = Some((ws.parse().unwrap_or(32), hs.parse().unwrap_or(32)));
                        }
                        i += 2;
                    }
                    "-rotate" if i + 1 < args.len() => {
                        rot_deg += args[i + 1].parse::<i32>().unwrap_or(0);
                        i += 2;
                    }
                    "-transpose" | "-transverse" => {
                        transpose_swaps += 1;
                        i += 1;
                    }
                    "-negate" => {
                        negate_count += 1;
                        i += 1;
                    }
                    "-append" => {
                        append_mode = Some(true);
                        i += 1;
                    }
                    "+append" => {
                        append_mode = Some(false);
                        i += 1;
                    }
                    "-format" if is_mogrify && i + 1 < args.len() => {
                        mogrify_format = Some(args[i + 1].trim_start_matches('.').to_ascii_lowercase());
                        i += 2;
                    }
                    "-path" if is_mogrify && i + 1 < args.len() => {
                        mogrify_path = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-colorspace" | "-grayscale" if i + 1 < args.len() => {
                        if args[i + 1].to_ascii_lowercase().contains("gray")
                            || args[i + 1].to_ascii_lowercase().contains("luma")
                        {
                            gray_cs = true;
                        }
                        i += 2;
                    }
                    "-gravity" | "-channel" | "-blur" | "-sharpen" | "-threshold"
                    | "-quality" | "-depth" | "-background" | "-fill" | "-bordercolor"
                    | "-density" | "-pointsize" | "-font" | "-stroke" | "-strokewidth"
                    | "-draw" | "-annotate" | "-alpha" | "-define" | "-filter"
                        if i + 1 < args.len() =>
                    {
                        i += 2;
                    }
                    a if a.starts_with("xc:") || a.starts_with("canvas:") => {
                        let c_str = a.split_once(':').map(|(_, r)| r).unwrap_or("white");
                        pseudo_color = Some(normalize_magick_rgb(c_str));
                        i += 1;
                    }
                    a if a == "rose:" || a == "logo:" || a == "wizard:" || a == "granite:" => {
                        if size_opt.is_none() {
                            size_opt = Some((70, 46));
                        }
                        i += 1;
                    }
                    a if !a.starts_with('-')
                        && !a.starts_with('+')
                        && !a.starts_with("xc:")
                        && !a.starts_with("canvas:")
                        && !a.starts_with("gradient:")
                        && !a.starts_with("radial-gradient:")
                        && !a.starts_with("pattern:")
                        && !a.starts_with("plasma:") =>
                    {
                        pos_files.push(a.to_string());
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            let apply_ops = |meta: &mut ImageMeta| {
                if let Some(ref rspec) = resize_spec {
                    let (rw, rh) = apply_magick_resize_geom(meta.w, meta.h, rspec);
                    meta.w = rw;
                    meta.h = rh;
                }
                if rot_deg.rem_euclid(180) != 0 {
                    std::mem::swap(&mut meta.w, &mut meta.h);
                }
                if transpose_swaps % 2 == 1 {
                    std::mem::swap(&mut meta.w, &mut meta.h);
                }
                if let Some((cw, ch)) = crop_opt {
                    meta.w = cw;
                    meta.h = ch;
                }
                if let Some((bw, bh)) = border_opt {
                    meta.w += bw * 2;
                    meta.h += bh * 2;
                }
                if let Some((ew, eh)) = extent_opt {
                    meta.w = ew;
                    meta.h = eh;
                }
                if gray_cs {
                    meta.cs = "Gray".to_string();
                }
                if let Some((r, g, b)) = pseudo_color {
                    meta.exif
                        .insert("__color".to_string(), format!("#{r:02x}{g:02x}{b:02x}"));
                }
                if negate_count % 2 == 1 {
                    let cur = meta
                        .exif
                        .get("__color")
                        .cloned()
                        .unwrap_or_else(|| "#ffffff".to_string());
                    let (r, g, b) = normalize_magick_rgb(&cur);
                    meta.exif.insert(
                        "__color".to_string(),
                        format!("#{:02x}{:02x}{:02x}", 255 - r, 255 - g, 255 - b),
                    );
                }
            };
            if is_mogrify {
                for f in &pos_files {
                    let full = resolve_posix_path(cwd, f);
                    let Ok(bytes) = fs.read_file(&full) else {
                        return err_out(
                            &format!("mogrify: unable to open image '{f}': No such file or directory\n"),
                            1,
                        );
                    };
                    let mut meta = read_image_meta(&bytes, &full);
                    apply_ops(&mut meta);
                    let dst_full = if mogrify_format.is_some() || mogrify_path.is_some() {
                        let fname = full.rsplit('/').next().unwrap_or(&full);
                        let (stem, orig_ext) = match fname.rsplit_once('.') {
                            Some((s, e)) if !s.is_empty() => (s, Some(e)),
                            _ => (fname, None),
                        };
                        let ext = mogrify_format
                            .as_deref()
                            .or(orig_ext)
                            .unwrap_or("png");
                        let new_fname = if mogrify_format.is_some() || orig_ext.is_some() {
                            format!("{stem}.{ext}")
                        } else {
                            stem.to_string()
                        };
                        let target_dir = if let Some(ref mp) = mogrify_path {
                            resolve_posix_path(cwd, mp)
                        } else if let Some((parent, _)) = full.rsplit_once('/') {
                            if parent.is_empty() { "/".to_string() } else { parent.to_string() }
                        } else {
                            cwd.to_string()
                        };
                        resolve_posix_path(&target_dir, &new_fname)
                    } else {
                        full.clone()
                    };
                    if mogrify_format.is_some() {
                        meta.fmt = format_from_path(&dst_full).to_string();
                    }
                    let _ = fs.write_file(&dst_full, &write_image_bytes(&meta));
                }
                return ok_out("");
            }
            if let Some(out_rel) = pos_files.last() {
                let out_full = resolve_posix_path(cwd, out_rel);
                let mut meta = if let Some(vertical) = append_mode
                    && pos_files.len() >= 2
                {
                    let mut total_w = 0u32;
                    let mut total_h = 0u32;
                    let mut first_meta: Option<ImageMeta> = None;
                    for in_rel in &pos_files[..pos_files.len() - 1] {
                        let in_full = resolve_posix_path(cwd, in_rel);
                        let im = fs
                            .read_file(&in_full)
                            .map(|b| read_image_meta(&b, &in_full))
                            .unwrap_or_else(|_| read_image_meta(&[], &in_full));
                        if vertical {
                            total_w = total_w.max(im.w);
                            total_h += im.h;
                        } else {
                            total_w += im.w;
                            total_h = total_h.max(im.h);
                        }
                        if first_meta.is_none() {
                            first_meta = Some(im);
                        }
                    }
                    let mut base = first_meta.unwrap_or_else(|| read_image_meta(&[], &out_full));
                    base.w = total_w.max(1);
                    base.h = total_h.max(1);
                    base
                } else if pos_files.len() >= 2 {
                    let in_full = resolve_posix_path(cwd, &pos_files[0]);
                    fs.read_file(&in_full)
                        .map(|b| read_image_meta(&b, &in_full))
                        .unwrap_or_else(|_| read_image_meta(&[], &in_full))
                } else {
                    let (w, h) = size_opt.unwrap_or((32, 32));
                    ImageMeta {
                        fmt: format_from_path(&out_full).to_string(),
                        w,
                        h,
                        cs: "sRGB".to_string(),
                        exif: BTreeMap::new(),
                    }
                };
                apply_ops(&mut meta);
                if out_full.to_ascii_lowercase().ends_with(".pdf") {
                    let mut pdf = PdfDoc::new();
                    pdf.pages.push(PdfPage {
                        rot: 0,
                        text: String::new(),
                        html: String::new(),
                        images: vec![(meta.w, meta.h, meta.fmt.clone())],
                        urls: Vec::new(),
                    });
                    let _ = fs.write_file(&out_full, &pdf.serialize());
                } else {
                    meta.fmt = format_from_path(&out_full).to_string();
                    let _ = fs.write_file(&out_full, &write_image_bytes(&meta));
                }
            }
            ok_out("")
        }
        "composite" => {
            if let Some(list_out) = try_magick_list_option(args) {
                return list_out;
            }
            let mut operands: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-version" | "--version" => {
                        return ok_out("Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");
                    }
                    "-help" | "--help" | "-h" => {
                        return ok_out("Usage: composite [options] overlay base [mask] output\n");
                    }
                    "-gravity" | "-geometry" | "-compose" | "-background" | "-quality"
                    | "-define" | "-dissolve" | "-blend" | "-watermark"
                        if i + 1 < args.len() =>
                    {
                        i += 2;
                    }
                    a if a.starts_with('-') => {
                        i += 1;
                    }
                    a => {
                        operands.push(a.to_string());
                        i += 1;
                    }
                }
            }
            if operands.len() < 3 {
                return err_out("composite: missing an image filename\n", 1);
            }
            let overlay_rel = &operands[0];
            let base_rel = &operands[1];
            let out_rel = operands.last().unwrap();
            for src_rel in [overlay_rel, base_rel] {
                if !src_rel.contains(':') {
                    let src_full = resolve_posix_path(cwd, src_rel);
                    if fs.read_file(&src_full).is_err() {
                        return err_out(
                            &format!("composite: unable to open image '{src_rel}': No such file or directory\n"),
                            1,
                        );
                    }
                }
            }
            let base_full = resolve_posix_path(cwd, base_rel);
            let mut base_meta = fs
                .read_file(&base_full)
                .map(|b| read_image_meta(&b, &base_full))
                .unwrap_or_else(|_| read_image_meta(&[], &base_full));
            let out_full = resolve_posix_path(cwd, out_rel);
            base_meta.fmt = format_from_path(&out_full).to_string();
            base_meta
                .exif
                .insert("__COMPOSITE__".to_string(), format!("{overlay_rel}:{}", args.join(",")));
            let _ = fs.write_file(&out_full, &write_image_bytes(&base_meta));
            ok_out("")
        }
        "montage" => {
            if let Some(list_out) = try_magick_list_option(args) {
                return list_out;
            }
            let mut tile_cols: Option<usize> = None;
            let mut tile_rows: Option<usize> = None;
            let mut cell_w: Option<u32> = None;
            let mut cell_h: Option<u32> = None;
            let mut pad_x = 2u32;
            let mut pad_y = 2u32;
            let mut border_w = 0u32;
            let mut operands: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-version" | "--version" => {
                        return ok_out("Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");
                    }
                    "-help" | "--help" | "-h" => {
                        return ok_out("Usage: montage [options] file... output\n");
                    }
                    "-tile" if i + 1 < args.len() => {
                        let t = &args[i + 1];
                        if let Some((cs, rs)) = t.split_once('x') {
                            if !cs.is_empty() {
                                tile_cols = cs.parse().ok();
                            }
                            if !rs.is_empty() {
                                tile_rows = rs.parse().ok();
                            }
                        } else {
                            tile_cols = t.parse().ok();
                        }
                        i += 2;
                    }
                    "-geometry" | "-thumbnail" if i + 1 < args.len() => {
                        let g = &args[i + 1];
                        let mut parts = g.split('+');
                        let dim_part = parts.next().unwrap_or("");
                        if let Some(px_s) = parts.next() {
                            pad_x = px_s.parse().unwrap_or(2);
                            if let Some(py_s) = parts.next() {
                                pad_y = py_s.parse().unwrap_or(2);
                            }
                        }
                        let clean_dim = dim_part.trim_end_matches(['!', '^', '>', '<']);
                        if let Some((ws, hs)) = clean_dim.split_once('x') {
                            if !ws.is_empty() {
                                cell_w = ws.parse().ok();
                            }
                            if !hs.is_empty() {
                                cell_h = hs.parse().ok();
                            }
                        } else if !clean_dim.is_empty() {
                            cell_w = clean_dim.parse().ok();
                        }
                        i += 2;
                    }
                    "-border" | "-frame" if i + 1 < args.len() => {
                        let b = args[i + 1].split('x').next().unwrap_or("0");
                        border_w = b.parse().unwrap_or(0);
                        i += 2;
                    }
                    "-background" | "-bordercolor" | "-fill" | "-label" | "-title" | "-font"
                    | "-pointsize" | "-gravity" | "-quality" | "-mode"
                        if i + 1 < args.len() =>
                    {
                        i += 2;
                    }
                    a if a.starts_with('-') => {
                        i += 1;
                    }
                    a => {
                        operands.push(a.to_string());
                        i += 1;
                    }
                }
            }
            if operands.len() < 2 {
                return err_out("montage: missing an image filename\n", 1);
            }
            let in_paths = &operands[..operands.len() - 1];
            let out_rel = operands.last().unwrap();
            let mut thumb_dims: Vec<(u32, u32)> = Vec::new();
            for p in in_paths {
                let full = resolve_posix_path(cwd, p);
                let Ok(bytes) = fs.read_file(&full) else {
                    return err_out(
                        &format!("montage: unable to open image '{p}': No such file or directory\n"),
                        1,
                    );
                };
                let meta = read_image_meta(&bytes, &full);
                let (mut tw, mut th) = if cell_w.is_some() || cell_h.is_some() {
                    let gspec = format!(
                        "{}{}",
                        cell_w.map(|v| v.to_string()).unwrap_or_default(),
                        cell_h.map(|v| format!("x{v}")).unwrap_or_default()
                    );
                    apply_magick_resize_geom(meta.w, meta.h, &gspec)
                } else {
                    (meta.w, meta.h)
                };
                tw += border_w * 2;
                th += border_w * 2;
                thumb_dims.push((tw, th));
            }
            let n = thumb_dims.len();
            let cols = tile_cols.unwrap_or_else(|| {
                if let Some(tr) = tile_rows {
                    n.div_ceil(tr.max(1))
                } else {
                    (n as f64).sqrt().ceil() as usize
                }
            });
            let rows = tile_rows.unwrap_or_else(|| n.div_ceil(cols.max(1)));
            let max_thumb_w = thumb_dims
                .iter()
                .map(|(w, _)| *w)
                .fold(cell_w.unwrap_or(0), u32::max);
            let max_thumb_h = thumb_dims
                .iter()
                .map(|(_, h)| *h)
                .fold(cell_h.unwrap_or(0), u32::max);
            let slot_w = max_thumb_w + pad_x * 2;
            let slot_h = max_thumb_h + pad_y * 2;
            let canvas_w = ((cols as u32) * slot_w).max(1);
            let canvas_h = ((rows as u32) * slot_h).max(1);
            let out_full = resolve_posix_path(cwd, out_rel);
            let out_meta = ImageMeta {
                fmt: format_from_path(&out_full).to_string(),
                w: canvas_w,
                h: canvas_h,
                cs: "sRGB".to_string(),
                exif: BTreeMap::new(),
            };
            let _ = fs.write_file(&out_full, &write_image_bytes(&out_meta));
            ok_out("")
        }
        "compare" => {
            if let Some(list_out) = try_magick_list_option(args) {
                return list_out;
            }
            let mut metric = "rmse".to_string();
            let mut fuzz_pct = 0.0f64;
            let mut operands: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-version" | "--version" => {
                        return ok_out("Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");
                    }
                    "-help" | "--help" | "-h" => {
                        return ok_out("Usage: compare [-metric METRIC] image1 image2 output\n");
                    }
                    "-metric" if i + 1 < args.len() => {
                        metric = args[i + 1].to_ascii_lowercase();
                        i += 2;
                    }
                    "-fuzz" if i + 1 < args.len() => {
                        let f = args[i + 1].trim_end_matches('%');
                        fuzz_pct = f.parse::<f64>().unwrap_or(0.0);
                        i += 2;
                    }
                    "-highlight-color" | "-lowlight-color" | "-compose"
                    | "-dissimilarity-threshold" | "-quality" | "-density"
                        if i + 1 < args.len() =>
                    {
                        i += 2;
                    }
                    a if a.starts_with('-') && a != "-" => {
                        i += 1;
                    }
                    a => {
                        operands.push(a.to_string());
                        i += 1;
                    }
                }
            }
            if operands.len() < 3 {
                return err_out("compare: missing an image filename\n", 2);
            }
            let load_cmp_img = |spec: &str| -> Result<(ImageMeta, Vec<u8>), String> {
                let lower = spec.to_ascii_lowercase();
                if lower.starts_with("xc:") || lower.starts_with("canvas:") {
                    let c_str = spec.split_once(':').map(|(_, r)| r).unwrap_or("white");
                    let (r, g, b) = normalize_magick_rgb(c_str);
                    let mut ex = BTreeMap::new();
                    ex.insert("__color".to_string(), format!("#{r:02x}{g:02x}{b:02x}"));
                    let m = ImageMeta {
                        fmt: "PNG".to_string(),
                        w: 1,
                        h: 1,
                        cs: "sRGB".to_string(),
                        exif: ex,
                    };
                    let bytes = write_image_bytes(&m);
                    return Ok((m, bytes));
                }
                let full = resolve_posix_path(cwd, spec);
                match fs.read_file(&full) {
                    Ok(bytes) => {
                        if bytes.is_empty() {
                            return Err(format!("compare: improper image header '{spec}'\n"));
                        }
                        Ok((read_image_meta(&bytes, &full), bytes))
                    }
                    Err(_) => Err(format!(
                        "compare: unable to open image '{spec}': No such file or directory\n"
                    )),
                }
            };
            let (meta_a, bytes_a) = match load_cmp_img(&operands[0]) {
                Ok(v) => v,
                Err(e) => return err_out(&e, 2),
            };
            let (meta_b, bytes_b) = match load_cmp_img(&operands[1]) {
                Ok(v) => v,
                Err(e) => return err_out(&e, 2),
            };
            let out_spec = &operands[2];
            let width = meta_a.w.max(meta_b.w);
            let height = meta_a.h.max(meta_b.h);
            let color_a = meta_a.exif.get("__color").map(|s| s.as_str()).unwrap_or("");
            let color_b = meta_b.exif.get("__color").map(|s| s.as_str()).unwrap_or("");
            let (ra, ga, ba) = normalize_magick_rgb(if color_a.is_empty() { "#ffffff" } else { color_a });
            let (rb, gb, bb) = normalize_magick_rgb(if color_b.is_empty() { "#ffffff" } else { color_b });
            let max_ch_diff = (ra as i32 - rb as i32)
                .abs()
                .max((ga as i32 - gb as i32).abs())
                .max((ba as i32 - bb as i32).abs()) as f64;
            let fuzz_abs = (fuzz_pct / 100.0) * 255.0;
            let same_pixels = (bytes_a == bytes_b)
                || (meta_a.w == meta_b.w
                    && meta_a.h == meta_b.h
                    && (!color_a.is_empty() || !color_b.is_empty())
                    && max_ch_diff <= fuzz_abs);
            let total_pixels = (width as u64) * (height as u64);
            let (metric_str, exit_code) = if same_pixels {
                let s = match metric.as_str() {
                    "ae" => "0".to_string(),
                    "psnr" => "inf".to_string(),
                    "ncc" | "ssim" => "1".to_string(),
                    "dssim" => "0".to_string(),
                    _ => "0 (0)".to_string(),
                };
                (s, 0)
            } else {
                let dr = (ra as f64 - rb as f64).abs();
                let dg = (ga as f64 - gb as f64).abs();
                let db = (ba as f64 - bb as f64).abs();
                let mae_norm = if dr + dg + db > 0.0 {
                    (dr + dg + db) / (3.0 * 255.0)
                } else {
                    1.0
                };
                let mse_norm = if dr + dg + db > 0.0 {
                    (dr * dr + dg * dg + db * db) / (3.0 * 255.0 * 255.0)
                } else {
                    1.0
                };
                let rmse_norm = mse_norm.sqrt();
                let pae_norm = if max_ch_diff > 0.0 { max_ch_diff / 255.0 } else { 1.0 };
                let fmt_num = |n: f64| -> String {
                    if !n.is_finite() {
                        return "inf".to_string();
                    }
                    if n.abs() < 1e-9 {
                        return "0".to_string();
                    }
                    let s = format!("{n:.6}");
                    let s = s.trim_end_matches('0').trim_end_matches('.');
                    if s == "-0" || s.is_empty() { "0".to_string() } else { s.to_string() }
                };
                let s = match metric.as_str() {
                    "ae" => total_pixels.to_string(),
                    "mae" => format!("{} ({})", fmt_num(mae_norm * 65535.0), fmt_num(mae_norm)),
                    "mse" => format!("{} ({})", fmt_num(mse_norm * 65535.0), fmt_num(mse_norm)),
                    "pae" => format!("{} ({})", fmt_num(pae_norm * 65535.0), fmt_num(pae_norm)),
                    "psnr" => fmt_num(10.0 * (1.0 / mse_norm).log10()),
                    "ncc" | "ssim" => "0".to_string(),
                    "dssim" => "0.5".to_string(),
                    _ => format!("{} ({})", fmt_num(rmse_norm * 65535.0), fmt_num(rmse_norm)),
                };
                (s, 1)
            };
            if !out_spec.eq_ignore_ascii_case("null:") {
                let clean_out = out_spec
                    .split_once(':')
                    .map(|(_, r)| r)
                    .unwrap_or(out_spec.as_str());
                let diff_meta = ImageMeta {
                    fmt: format_from_path(clean_out).to_string(),
                    w: width,
                    h: height,
                    cs: "sRGB".to_string(),
                    exif: BTreeMap::new(),
                };
                let encoded = write_image_bytes(&diff_meta);
                if clean_out == "-" {
                    return BuiltinOutcome {
                        stdout: crate::vfs::bytes_to_stream_string(&encoded),
                        stderr: format!("{metric_str}\n"),
                        exit_code,
                    };
                }
                let out_full = resolve_posix_path(cwd, clean_out);
                let _ = fs.write_file(&out_full, &encoded);
            }
            BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{metric_str}\n"),
                exit_code,
            }
        }
        "identify" => {
            if let Some(list_out) = try_magick_list_option(args) {
                return list_out;
            }
            let mut fmt_opt: Option<String> = None;
            let mut verbose = false;
            let mut files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                let a = args[i].as_str();
                if a == "-version" || a == "--version" {
                    return ok_out("Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");
                }
                if a == "-help" || a == "--help" || a == "-h" {
                    return ok_out("Usage: identify [-ping] [-verbose] [-format FORMAT] file...\n");
                }
                if (a == "-format" || a == "--format") && i + 1 < args.len() {
                    fmt_opt = Some(args[i + 1].clone());
                    i += 2;
                    continue;
                }
                if a == "-verbose" || a == "--verbose" {
                    verbose = true;
                    i += 1;
                    continue;
                }
                if a == "-ping" || a == "--ping" {
                    i += 1;
                    continue;
                }
                if !a.starts_with('-') || a == "-" {
                    files.push(args[i].clone());
                }
                i += 1;
            }
            if files.is_empty() {
                return err_out("identify: missing an image filename\n", 1);
            }
            let mut out = String::new();
            let mut err_buf = String::new();
            let mut exit_code = 0;
            for f in &files {
                let full = resolve_posix_path(cwd, f);
                let Ok(bytes) = fs.read_file(&full) else {
                    err_buf.push_str(&format!(
                        "identify: unable to open image '{f}': No such file or directory\n"
                    ));
                    exit_code = 1;
                    continue;
                };
                let meta = read_image_meta(&bytes, &full);
                if let Some(ref fmt_str) = fmt_opt {
                    let fname = f.rsplit('/').next().unwrap_or(f);
                    let (stem, ext) = match fname.rsplit_once('.') {
                        Some((s, e)) => (s, e),
                        None => (fname, ""),
                    };
                    let compression = match meta.fmt.as_str() {
                        "PNG" => "Zip",
                        "JPEG" => "JPEG",
                        "GIF" => "LZW",
                        _ => "None",
                    };
                    let rendered = fmt_str
                        .replace("%%", "\x00PCT\x00")
                        .replace("%m", &meta.fmt)
                        .replace("%w", &meta.w.to_string())
                        .replace("%h", &meta.h.to_string())
                        .replace("%z", "8")
                        .replace("%q", "8")
                        .replace("%r", &format!("DirectClass {}", meta.cs))
                        .replace("%t", stem)
                        .replace("%e", ext)
                        .replace("%i", f)
                        .replace("%g", &format!("{}x{}+0+0", meta.w, meta.h))
                        .replace("%P", &format!("{}x{}", meta.w, meta.h))
                        .replace("%C", compression)
                        .replace("%Q", "92")
                        .replace("%n", "1")
                        .replace("%s", "0")
                        .replace("%[width]", &meta.w.to_string())
                        .replace("%[height]", &meta.h.to_string())
                        .replace("%[depth]", "8")
                        .replace("%[size]", &format!("{}B", bytes.len()))
                        .replace("%[compression]", compression)
                        .replace("%[quality]", "92")
                        .replace("%[fx:w]", &meta.w.to_string())
                        .replace("%[fx:h]", &meta.h.to_string())
                        .replace("%[fx:w*h]", &(meta.w * meta.h).to_string())
                        .replace("%[colorspace]", &meta.cs)
                        .replace("%b", &format!("{}B", bytes.len()))
                        .replace("%B", &bytes.len().to_string())
                        .replace("%f", fname)
                        .replace("\\n", "\n")
                        .replace("\\t", "\t")
                        .replace("\x00PCT\x00", "%");
                    out.push_str(&rendered);
                } else if verbose {
                    out.push_str(&format!(
                        "Image: {f}\n  Format: {}\n  Geometry: {}x{}+0+0\n  Resolution: 72x72\n  Colorspace: {}\n  Depth: 8-bit\n  Filesize: {}B\n",
                        meta.fmt,
                        meta.w,
                        meta.h,
                        meta.cs,
                        bytes.len()
                    ));
                } else {
                    out.push_str(&format!(
                        "{f} {} {}x{} {}x{}+0+0 8-bit {}\n",
                        meta.fmt, meta.w, meta.h, meta.w, meta.h, meta.cs
                    ));
                }
            }
            BuiltinOutcome {
                stdout: out,
                stderr: err_buf,
                exit_code,
            }
        }
        "sips" => {
            if args.is_empty() {
                return err_out(
                    "sips: no arguments specified. Try 'sips --help' for help.\n",
                    1,
                );
            }
            let mut get_props: Vec<String> = Vec::new();
            let mut one_line = false;
            let mut has_mod = false;
            let mut verify_mode = false;
            let mut out_path: Option<String> = None;
            let mut files: Vec<String> = Vec::new();
            let mut ops: Vec<(&str, String, String)> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-h" | "--help" => {
                        return ok_out(
                            "sips - scriptable image processing system\nUsage: sips [options] file ...\n",
                        );
                    }
                    "-v" | "--version" => {
                        return ok_out("sips 10.4.4\n");
                    }
                    "-H" | "--helpProperties" => {
                        return ok_out(
                            "pixelWidth\npixelHeight\ntypeIdentifier\nformat\nformatOptions\ndpiWidth\ndpiHeight\nsamplesPerPixel\nbitsPerSample\nhasAlpha\nspace\nall\nallxml\n",
                        );
                    }
                    "--formats" => {
                        return ok_out(
                            "Supported Formats:\n-------------------------------------------\ncom.adobe.pdf                pdf   Writable\ncom.compuserve.gif           gif   Writable\ncom.microsoft.bmp            bmp   Writable\norg.webmproject.webp         webp  Writable\npublic.avif                  avif  Writable\npublic.heic                  heic  Writable\npublic.heif                  heif  Writable\npublic.jpeg                  jpeg  Writable\npublic.png                   png   Writable\npublic.tiff                  tiff  Writable\n",
                        );
                    }
                    "--verify" => {
                        verify_mode = true;
                        i += 1;
                    }
                    "-1" | "--oneLine" => {
                        one_line = true;
                        i += 1;
                    }
                    "-g" | "--getProperty" if i + 1 < args.len() => {
                        get_props.push(args[i + 1].clone());
                        i += 2;
                    }
                    "-d" | "--deleteProperty" if i + 1 < args.len() => {
                        has_mod = true;
                        ops.push(("d", args[i + 1].clone(), String::new()));
                        i += 2;
                    }
                    "-z" | "--resampleHeightWidth" if i + 2 < args.len() => {
                        has_mod = true;
                        ops.push(("z", args[i + 1].clone(), args[i + 2].clone()));
                        i += 3;
                    }
                    "-Z" | "--resampleHeightWidthMax" if i + 1 < args.len() => {
                        has_mod = true;
                        ops.push(("Z", args[i + 1].clone(), String::new()));
                        i += 2;
                    }
                    "--resampleWidth" if i + 1 < args.len() => {
                        has_mod = true;
                        ops.push(("rw", args[i + 1].clone(), String::new()));
                        i += 2;
                    }
                    "--resampleHeight" if i + 1 < args.len() => {
                        has_mod = true;
                        ops.push(("rh", args[i + 1].clone(), String::new()));
                        i += 2;
                    }
                    "-r" | "--rotate" if i + 1 < args.len() => {
                        has_mod = true;
                        ops.push(("r", args[i + 1].clone(), String::new()));
                        i += 2;
                    }
                    "-f" | "--flip" if i + 1 < args.len() => {
                        has_mod = true;
                        i += 2;
                    }
                    "-c" | "--cropToHeightWidth" if i + 2 < args.len() => {
                        has_mod = true;
                        ops.push(("c", args[i + 1].clone(), args[i + 2].clone()));
                        i += 3;
                    }
                    "--cropOffset" if i + 2 < args.len() => {
                        i += 3;
                    }
                    "-p" | "--padToHeightWidth" if i + 2 < args.len() => {
                        has_mod = true;
                        ops.push(("p", args[i + 1].clone(), args[i + 2].clone()));
                        i += 3;
                    }
                    "--padColor" if i + 1 < args.len() => {
                        i += 2;
                    }
                    "-s" | "--setProperty" if i + 2 < args.len() => {
                        has_mod = true;
                        ops.push(("s", args[i + 1].clone(), args[i + 2].clone()));
                        i += 3;
                    }
                    "--out" | "-o" if i + 1 < args.len() => {
                        out_path = Some(args[i + 1].clone());
                        i += 2;
                    }
                    a if !a.starts_with('-') => {
                        files.push(a.to_string());
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            if !get_props.is_empty() && has_mod {
                return err_out(
                    "Error 6: cannot get properties and modify file in the same invocation\n",
                    6,
                );
            }
            if files.is_empty() {
                return err_out("sips: no input files specified\n", 1);
            }
            let type_id_for_fmt = |fmt_lower: &str| -> String {
                match fmt_lower {
                    "webp" => "org.webmproject.webp".to_string(),
                    "gif" => "com.compuserve.gif".to_string(),
                    "bmp" => "com.microsoft.bmp".to_string(),
                    "pdf" => "com.adobe.pdf".to_string(),
                    "ppm" | "pgm" | "pbm" => "public.pbm".to_string(),
                    other => format!("public.{other}"),
                }
            };
            if !get_props.is_empty() {
                let mut out = String::new();
                let mut err_out_str = String::new();
                for f in &files {
                    let full = resolve_posix_path(cwd, f);
                    if !fs.exists(&full) {
                        err_out_str.push_str(&format!("Error: {f}: file does not exist\n"));
                        continue;
                    }
                    let bytes = fs.read_file(&full).unwrap_or_default();
                    let meta = read_image_meta(&bytes, &full);
                    let fmt_lower = meta.fmt.to_ascii_lowercase();
                    if get_props.iter().any(|p| p == "allxml") {
                        out.push_str(&format!(
                            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict><key>pixelWidth</key><integer>{}</integer><key>pixelHeight</key><integer>{}</integer><key>format</key><string>{fmt_lower}</string></dict></plist>\n",
                            meta.w, meta.h
                        ));
                        continue;
                    }
                    let mut expanded_props = Vec::new();
                    for p in &get_props {
                        if p == "all" {
                            expanded_props.push("pixelWidth".to_string());
                            expanded_props.push("pixelHeight".to_string());
                            expanded_props.push("typeIdentifier".to_string());
                            expanded_props.push("format".to_string());
                            expanded_props.push("formatOptions".to_string());
                            expanded_props.push("dpiWidth".to_string());
                            expanded_props.push("dpiHeight".to_string());
                            expanded_props.push("samplesPerPixel".to_string());
                            expanded_props.push("bitsPerSample".to_string());
                            expanded_props.push("hasAlpha".to_string());
                            expanded_props.push("space".to_string());
                            for k in meta.exif.keys() {
                                if !k.starts_with("__") {
                                    expanded_props.push(k.clone());
                                }
                            }
                        } else {
                            expanded_props.push(p.clone());
                        }
                    }
                    let mut kvs = Vec::new();
                    for p in &expanded_props {
                        let val = match p.as_str() {
                            "path" => f.to_string(),
                            "pixelWidth" => meta.w.to_string(),
                            "pixelHeight" => meta.h.to_string(),
                            "format" => fmt_lower.clone(),
                            "typeIdentifier" => type_id_for_fmt(&fmt_lower),
                            "formatOptions" => "default".to_string(),
                            "dpiWidth" => meta
                                .exif
                                .get("dpiWidth")
                                .cloned()
                                .unwrap_or_else(|| "72.000".to_string()),
                            "dpiHeight" => meta
                                .exif
                                .get("dpiHeight")
                                .cloned()
                                .unwrap_or_else(|| "72.000".to_string()),
                            "samplesPerPixel" => "3".to_string(),
                            "bitsPerSample" => "8".to_string(),
                            "hasAlpha" => "no".to_string(),
                            "space" => "RGB".to_string(),
                            other => meta
                                .exif
                                .get(other)
                                .cloned()
                                .unwrap_or_else(|| "<nil>".to_string()),
                        };
                        kvs.push((p.clone(), val));
                    }
                    if one_line {
                        out.push_str(f);
                        out.push('|');
                        for (k, v) in kvs {
                            out.push_str(&format!("{k}: {v}|"));
                        }
                        out.push('\n');
                    } else {
                        out.push_str(&format!("{f}:\n"));
                        for (k, v) in kvs {
                            out.push_str(&format!("  {k}: {v}\n"));
                        }
                    }
                }
                return BuiltinOutcome {
                    stdout: out,
                    stderr: err_out_str.clone(),
                    exit_code: if err_out_str.is_empty() { 0 } else { 1 },
                };
            }
            let mut err_out_str = String::new();
            let mut verify_out = String::new();
            for f in &files {
                let in_full = resolve_posix_path(cwd, f);
                if !fs.exists(&in_full) {
                    err_out_str.push_str(&format!("Error: {f}: file does not exist\n"));
                    continue;
                }
                if verify_mode && !has_mod && out_path.is_none() {
                    verify_out.push_str(&format!("{f}\n"));
                    continue;
                }
                let mut meta = fs
                    .read_file(&in_full)
                    .map(|b| read_image_meta(&b, &in_full))
                    .unwrap_or_else(|_| read_image_meta(&[], &in_full));
                for (op, a1, a2) in &ops {
                    match *op {
                        "z" | "c" | "p" => {
                            meta.h = a1.parse().unwrap_or(meta.h);
                            meta.w = a2.parse().unwrap_or(meta.w);
                        }
                        "Z" => {
                            let max_d: f64 = a1.parse().unwrap_or(meta.w as f64);
                            let w = meta.w.max(1) as f64;
                            let h = meta.h.max(1) as f64;
                            if w >= h {
                                meta.w = max_d.round() as u32;
                                meta.h = (h * max_d / w).round().max(1.0) as u32;
                            } else {
                                meta.h = max_d.round() as u32;
                                meta.w = (w * max_d / h).round().max(1.0) as u32;
                            }
                        }
                        "rw" => {
                            let nw: f64 = a1.parse().unwrap_or(meta.w as f64);
                            let w = meta.w.max(1) as f64;
                            let h = meta.h.max(1) as f64;
                            meta.h = (h * nw / w).round().max(1.0) as u32;
                            meta.w = nw.round() as u32;
                        }
                        "rh" => {
                            let nh: f64 = a1.parse().unwrap_or(meta.h as f64);
                            let w = meta.w.max(1) as f64;
                            let h = meta.h.max(1) as f64;
                            meta.w = (w * nh / h).round().max(1.0) as u32;
                            meta.h = nh.round() as u32;
                        }
                        "r" => {
                            let deg: i32 = a1.parse().unwrap_or(0);
                            if deg.rem_euclid(180) != 0 {
                                std::mem::swap(&mut meta.w, &mut meta.h);
                            }
                        }
                        "s" => {
                            if a1 == "format" {
                                let norm_fmt = match a2.trim().to_ascii_lowercase().as_str() {
                                    "png" | "public.png" => Some("PNG"),
                                    "jpeg" | "jpg" | "public.jpeg" => Some("JPEG"),
                                    "webp" | "org.webmproject.webp" => Some("WEBP"),
                                    "gif" | "com.compuserve.gif" => Some("GIF"),
                                    "bmp" | "com.microsoft.bmp" => Some("BMP"),
                                    "tiff" | "tif" | "public.tiff" => Some("TIFF"),
                                    "ppm" => Some("PPM"),
                                    "pgm" => Some("PGM"),
                                    "pbm" | "public.pbm" => Some("PBM"),
                                    "pdf" | "com.adobe.pdf" => Some("PDF"),
                                    "heic" | "public.heic" => Some("HEIC"),
                                    "heif" | "public.heif" => Some("HEIF"),
                                    "avif" | "public.avif" => Some("AVIF"),
                                    _ => None,
                                };
                                if let Some(nf) = norm_fmt {
                                    meta.fmt = nf.to_string();
                                } else {
                                    return err_out(&format!("Error:Unsupported format: {a2}\n"), 1);
                                }
                            } else if a1 == "dpiWidth" || a1 == "dpiHeight" {
                                if let Ok(num) = a2.parse::<f64>()
                                    && num > 0.0
                                {
                                    meta.exif.insert(a1.clone(), format!("{num:.3}"));
                                }
                            } else if a1 != "formatOptions" {
                                meta.exif.insert(a1.clone(), a2.clone());
                            }
                        }
                        "d" => {
                            meta.exif.remove(a1);
                        }
                        _ => {}
                    }
                }
                let dst_full = if let Some(ref opath) = out_path {
                    let ofull = resolve_posix_path(cwd, opath);
                    if opath.ends_with('/') || fs.is_dir(&ofull) {
                        let fname = f.rsplit('/').next().unwrap_or(f);
                        let stem = fname.rsplit_once('.').map(|(s, _)| s).unwrap_or(fname);
                        let ext = if meta.fmt == "JPEG" {
                            "jpg".to_string()
                        } else {
                            meta.fmt.to_ascii_lowercase()
                        };
                        format!("{}/{stem}.{ext}", ofull.trim_end_matches('/'))
                    } else {
                        if meta.fmt == "PNG" && format_from_path(&ofull) != "PNG" {
                            meta.fmt = format_from_path(&ofull).to_string();
                        }
                        ofull
                    }
                } else {
                    in_full
                };
                let _ = fs.write_file(&dst_full, &write_image_bytes(&meta));
            }
            BuiltinOutcome {
                stdout: verify_out,
                stderr: err_out_str.clone(),
                exit_code: if err_out_str.is_empty() { 0 } else { 1 },
            }
        }
        "exiftool" => {
            if args.len() == 1 && (args[0] == "-ver" || args[0] == "--version") {
                return ok_out("13.59\n");
            }
            let mut expanded_args: Vec<String> = Vec::new();
            let mut ai = 0usize;
            while ai < args.len() {
                if args[ai] == "-@" && ai + 1 < args.len() {
                    let af_full = resolve_posix_path(cwd, &args[ai + 1]);
                    if let Ok(af_bytes) = fs.read_file(&af_full) {
                        for line in String::from_utf8_lossy(&af_bytes).lines() {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() && !trimmed.starts_with('#') {
                                expanded_args.push(trimmed.to_string());
                            }
                        }
                    }
                    ai += 2;
                } else {
                    expanded_args.push(args[ai].clone());
                    ai += 1;
                }
            }
            let json_mode = expanded_args
                .iter()
                .any(|a| a == "-j" || a == "-json" || a == "--json");
            let s3_mode = expanded_args.iter().any(|a| a == "-s3");
            let s2_mode = expanded_args.iter().any(|a| a == "-s2");
            let group_mode = expanded_args
                .iter()
                .any(|a| a == "-G" || a == "-G0" || a == "-G1");
            let tab_mode = expanded_args.iter().any(|a| a == "-T");
            let csv_mode = expanded_args.iter().any(|a| a == "-csv");
            let xml_mode = expanded_args.iter().any(|a| a == "-X");
            let overwrite_orig = expanded_args.iter().any(|a| a == "-overwrite_original");
            let mut print_fmt: Option<String> = None;
            let mut updates: Vec<(String, String)> = Vec::new();
            let mut requested_tags: Vec<String> = Vec::new();
            let mut files: Vec<String> = Vec::new();
            let mut out_path: Option<String> = None;
            let mut tags_from_file: Option<String> = None;
            let mut i = 0usize;
            while i < expanded_args.len() {
                let a = &expanded_args[i];
                if a == "-o" && i + 1 < expanded_args.len() {
                    out_path = Some(expanded_args[i + 1].clone());
                    i += 2;
                    continue;
                }
                if a == "-p" && i + 1 < expanded_args.len() {
                    print_fmt = Some(expanded_args[i + 1].clone());
                    i += 2;
                    continue;
                }
                if (a == "-tagsFromFile" || a == "-TagsFromFile") && i + 1 < expanded_args.len() {
                    tags_from_file = Some(expanded_args[i + 1].clone());
                    i += 2;
                    continue;
                }
                if let Some(rest) = a.strip_prefix('-') {
                    if let Some((k, v)) = rest.split_once('=') {
                        let clean_k = k.trim_end_matches('+').trim_end_matches('-');
                        updates.push((clean_k.to_string(), v.to_string()));
                    } else if !matches!(
                        rest,
                        "j" | "json"
                            | "-json"
                            | "s"
                            | "s1"
                            | "s2"
                            | "s3"
                            | "G"
                            | "G0"
                            | "G1"
                            | "T"
                            | "csv"
                            | "X"
                            | "overwrite_original"
                            | "q"
                            | "n"
                            | "a"
                            | "u"
                    ) {
                        requested_tags.push(rest.to_string());
                    }
                } else {
                    files.push(a.clone());
                }
                i += 1;
            }
            if let Some(src_tag_file) = tags_from_file {
                let src_full = resolve_posix_path(cwd, &src_tag_file);
                if let Ok(src_bytes) = fs.read_file(&src_full) {
                    let mut src_tags: BTreeMap<String, String> = BTreeMap::new();
                    if src_full.to_ascii_lowercase().ends_with(".pdf")
                        || src_bytes.starts_with(b"%PDF-")
                    {
                        let pdf = PdfDoc::parse(&src_bytes);
                        if !pdf.title.is_empty() {
                            src_tags.insert("Title".to_string(), pdf.title);
                        }
                        if !pdf.author.is_empty() {
                            src_tags.insert("Author".to_string(), pdf.author);
                        }
                        for (k, v) in pdf.info {
                            src_tags.insert(k, v);
                        }
                        for (k, v) in pdf.exif {
                            src_tags.insert(k, v);
                        }
                    } else {
                        let src_meta = read_image_meta(&src_bytes, &src_full);
                        for (k, v) in src_meta.exif {
                            if !k.starts_with("__") {
                                src_tags.insert(k, v);
                            }
                        }
                    }
                    for (k, v) in src_tags {
                        if (requested_tags.is_empty()
                            || requested_tags.iter().any(|rt| rt.eq_ignore_ascii_case(&k)))
                            && !v.is_empty()
                        {
                            updates.push((k, v));
                        }
                    }
                }
            }
            if !updates.is_empty() {
                let mut updated = 0usize;
                let mut err_out = String::new();
                for f in &files {
                    let full = resolve_posix_path(cwd, f);
                    if !fs.exists(&full) {
                        err_out.push_str(&format!("Error: File not found - {f}\n"));
                        continue;
                    }
                    let mut data = fs.read_file(&full).unwrap_or_default();
                    let is_pdf = full.to_ascii_lowercase().ends_with(".pdf")
                        || data.starts_with(b"%PDF-");
                    if is_pdf && updates.iter().any(|(k, _)| k.eq_ignore_ascii_case("all")) {
                        err_out.push_str(&format!(
                            "Error: PDF parser/writer not yet supported; metadata deletion retains historical revisions and never guarantees redaction - {f}\n"
                        ));
                        continue;
                    }
                    if !overwrite_orig && out_path.is_none() {
                        let orig_path = format!("{full}_original");
                        if !fs.exists(&orig_path) {
                            let _ = fs.write_file(&orig_path, &data);
                        }
                    }
                    for (k, v) in &updates {
                        data.extend_from_slice(format!("\n__EXIF__:{k}={v}").as_bytes());
                    }
                    let dst = out_path
                        .as_ref()
                        .map(|p| resolve_posix_path(cwd, p))
                        .unwrap_or(full);
                    let _ = fs.write_file(&dst, &data);
                    updated += 1;
                }
                let stdout_str = if updated > 0 {
                    format!("    {updated} image files updated\n")
                } else {
                    String::new()
                };
                return BuiltinOutcome {
                    stdout: stdout_str,
                    stderr: err_out.clone(),
                    exit_code: if err_out.is_empty() { 0 } else { 1 },
                };
            }
            let read_all_tags = |f: &str| -> BTreeMap<String, String> {
                let full = resolve_posix_path(cwd, f);
                let data = fs.read_file(&full).unwrap_or_default();
                let mut map = BTreeMap::new();
                map.insert("SourceFile".to_string(), f.to_string());
                let file_name = f.rsplit('/').next().unwrap_or(f).to_string();
                let dir_name = match f.rfind('/') {
                    Some(0) => "/".to_string(),
                    Some(idx) => f[..idx].to_string(),
                    None => ".".to_string(),
                };
                map.insert("FileName".to_string(), file_name);
                map.insert("Directory".to_string(), dir_name);
                map.insert("FileSize".to_string(), format!("{} bytes", data.len()));
                if full.to_ascii_lowercase().ends_with(".pdf") || data.starts_with(b"%PDF-") {
                    let pdf = PdfDoc::parse(&data);
                    map.insert("FileType".to_string(), "PDF".to_string());
                    map.insert("FileTypeExtension".to_string(), "pdf".to_string());
                    map.insert("MIMEType".to_string(), "application/pdf".to_string());
                    map.insert("PDFVersion".to_string(), pdf.version);
                    map.insert("PageCount".to_string(), pdf.pages.len().to_string());
                    if !pdf.title.is_empty() {
                        map.insert("Title".to_string(), pdf.title);
                    }
                    if !pdf.author.is_empty() {
                        map.insert("Author".to_string(), pdf.author);
                    }
                    for (k, v) in pdf.info {
                        map.insert(k, v);
                    }
                    for (k, v) in pdf.exif {
                        map.insert(k, v);
                    }
                } else {
                    let im = read_image_meta(&data, &full);
                    map.insert(
                        "MIMEType".to_string(),
                        format!("image/{}", im.fmt.to_ascii_lowercase()),
                    );
                    let ext = if im.fmt == "JPEG" {
                        "jpg".to_string()
                    } else {
                        im.fmt.to_ascii_lowercase()
                    };
                    map.insert("FileTypeExtension".to_string(), ext);
                    map.insert("FileType".to_string(), im.fmt);
                    map.insert("ImageWidth".to_string(), im.w.to_string());
                    map.insert("ImageHeight".to_string(), im.h.to_string());
                    map.insert("ImageSize".to_string(), format!("{}x{}", im.w, im.h));
                    map.insert("BitDepth".to_string(), "8".to_string());
                    map.insert("ColorType".to_string(), "RGB".to_string());
                    for (k, v) in im.exif {
                        if !k.starts_with("__") {
                            map.insert(k, v);
                        }
                    }
                }
                map
            };
            if let Some(ref tpl) = print_fmt {
                let mut out = String::new();
                for f in &files {
                    let map = read_all_tags(f);
                    let mut line = tpl.clone();
                    for (k, v) in &map {
                        line = line
                            .replace(&format!("${{{k}}}"), v)
                            .replace(&format!("${k}"), v);
                    }
                    out.push_str(&line);
                    out.push('\n');
                }
                return ok_out(&out);
            }
            if json_mode {
                let mut items = Vec::new();
                for f in &files {
                    let map = read_all_tags(f);
                    let mut fields = Vec::new();
                    for (k, v) in &map {
                        if k == "ImageWidth" || k == "ImageHeight" || k == "PageCount" {
                            fields.push(format!("\"{k}\": {v}"));
                        } else {
                            fields.push(format!("\"{k}\": \"{}\"", v.replace('"', "\\\"")));
                        }
                    }
                    items.push(format!("  {{\n    {}\n  }}", fields.join(",\n    ")));
                }
                return ok_out(&format!("[\n{}\n]\n", items.join(",\n")));
            }
            if csv_mode {
                let mut hdr = vec!["SourceFile".to_string()];
                for t in &requested_tags {
                    hdr.push(t.clone());
                }
                let mut out = format!("{}\n", hdr.join(","));
                for f in &files {
                    let map = read_all_tags(f);
                    let mut row = vec![f.clone()];
                    for t in &requested_tags {
                        row.push(map.get(t).cloned().unwrap_or_else(|| "-".to_string()));
                    }
                    out.push_str(&format!("{}\n", row.join(",")));
                }
                return ok_out(&out);
            }
            if xml_mode {
                let mut out = String::from("<?xml version='1.0' encoding='UTF-8'?>\n<rdf:RDF>\n");
                for f in &files {
                    let map = read_all_tags(f);
                    for (k, v) in &map {
                        out.push_str(&format!("  <PNG:{k}>{}</PNG:{k}>\n", html_escape_str(v)));
                    }
                }
                out.push_str("</rdf:RDF>\n");
                return ok_out(&out);
            }
            if tab_mode {
                let mut lines = Vec::new();
                for f in &files {
                    let map = read_all_tags(f);
                    let mut vals = Vec::new();
                    for rt in &requested_tags {
                        vals.push(map.get(rt).cloned().unwrap_or_else(|| "-".to_string()));
                    }
                    lines.push(vals.join("\t"));
                }
                return ok_out(&format!("{}\n", lines.join("\n")));
            }
            if s3_mode {
                let mut lines = Vec::new();
                for f in &files {
                    let map = read_all_tags(f);
                    for rt in &requested_tags {
                        if let Some(v) = map.get(rt) {
                            lines.push(v.clone());
                        }
                    }
                }
                if lines.is_empty() {
                    return ok_out("");
                }
                return ok_out(&format!("{}\n", lines.join("\n")));
            }
            let mut out = String::new();
            for f in &files {
                let map = read_all_tags(f);
                let file_grp = map.get("FileType").cloned().unwrap_or_else(|| "File".to_string());
                let keys: Vec<String> = if requested_tags.is_empty() {
                    map.keys().cloned().collect()
                } else {
                    requested_tags.clone()
                };
                for k in &keys {
                    if let Some(v) = map.get(k) {
                        if s2_mode {
                            out.push_str(&format!("{k}: {v}\n"));
                        } else if group_mode {
                            let grp_hdr = format!("[{file_grp}]");
                            out.push_str(&format!("{grp_hdr:<16}{k:<32}: {v}\n"));
                        } else {
                            out.push_str(&format!("{k:<32}: {v}\n"));
                        }
                    }
                }
            }
            ok_out(&out)
        }
        "diffpdf" | "pdfdiff" => {
            let mut mode = "text";
            let mut files: Vec<String> = Vec::new();
            let mut positional = false;
            for arg in args {
                if !positional && arg == "--" {
                    positional = true;
                    continue;
                }
                if !positional && (arg == "--text" || arg == "--layout") {
                    mode = if arg == "--text" { "text" } else { "layout" };
                    continue;
                }
                if !positional && arg == "--help" {
                    return ok_out("Usage: diffpdf [--text|--layout] OLD.pdf NEW.pdf\nExit 0: equal, 1: different, 2: invalid invocation.\n");
                }
                if !positional && arg.starts_with('-') {
                    return err_out(&format!("diffpdf: unsupported option {arg}\n"), 2);
                }
                files.push(arg.clone());
            }
            if files.len() != 2 {
                return err_out("diffpdf: expected two PDF files\n", 2);
            }
            let mut docs: Vec<PdfDoc> = Vec::new();
            for f in &files {
                let full = resolve_posix_path(cwd, f);
                let Ok(bytes) = fs.read_file(&full) else {
                    return err_out(&format!("diffpdf: {f}: cannot read file\n"), 2);
                };
                if !bytes.starts_with(b"%PDF-") {
                    return err_out(&format!("diffpdf: {f}: Invalid PDF header\n"), 2);
                }
                docs.push(PdfDoc::parse(&bytes));
            }
            let a = &docs[0];
            let b = &docs[1];
            let max_p = a.pages.len().max(b.pages.len());
            let mut changed = false;
            let mut out = String::new();
            let page_sig = |doc: &PdfDoc, idx: usize| -> Option<String> {
                let pg = doc.pages.get(idx)?;
                let lines: Vec<&str> = pg
                    .text
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .collect();
                if mode == "text" {
                    Some(format!("{lines:?}"))
                } else {
                    let (pw, ph) = doc
                        .page_media
                        .get(&(idx + 1))
                        .map(|(w, h, _)| (*w, *h))
                        .unwrap_or((doc.page_w, doc.page_h));
                    Some(format!(
                        "{:.2}:{:.2}:{}:{lines:?}:{:?}",
                        pw, ph, pg.rot, pg.images
                    ))
                }
            };
            for idx in 0..max_p {
                if page_sig(a, idx) != page_sig(b, idx) {
                    changed = true;
                    out.push_str(&format!("Page {} differs ({mode})\n", idx + 1));
                }
            }
            BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: if changed { 1 } else { 0 },
            }
        }
        "svgo" => {
            let mut input_opt: Option<String> = None;
            let mut literal_opt: Option<String> = None;
            let mut outfile_opt: Option<String> = None;
            let mut precision = 3usize;
            let mut indent = 2usize;
            let mut pretty = false;
            let mut multipass = false;
            let mut end = false;
            let mut i = 0usize;
            while i < args.len() {
                let arg = args[i].as_str();
                if !end && arg == "--" {
                    end = true;
                    i += 1;
                    continue;
                }
                if !end && (arg == "--help" || arg == "-h") {
                    return ok_out("Usage: svgo [INPUT|-] [-i INPUT] [-s STRING] [-o OUTPUT|-]\n            [--multipass] [-p PRECISION] [--pretty] [--indent N] [-q|--quiet]\nFile input is optimized in place unless -o is supplied. Stdin and strings default to stdout.\n");
                }
                if !end && matches!(arg, "--multipass" | "--pretty" | "-q" | "--quiet") {
                    if arg == "--multipass" {
                        multipass = true;
                    }
                    if arg == "--pretty" {
                        pretty = true;
                    }
                    i += 1;
                    continue;
                }
                if !end && arg != "-" && arg.starts_with('-') {
                    if !matches!(
                        arg,
                        "-i" | "--input" | "-s" | "--string" | "-o" | "--output" | "-p" | "--precision" | "--indent"
                    ) {
                        return err_out(&format!("svgo: unknown option: {arg}\n"), 1);
                    }
                    if i + 1 >= args.len() {
                        return err_out(&format!("svgo: missing value for {arg}\n"), 1);
                    }
                    i += 1;
                    let val = &args[i];
                    if arg == "-i" || arg == "--input" {
                        if input_opt.is_some() {
                            return err_out("svgo: multiple inputs\n", 1);
                        }
                        input_opt = Some(val.clone());
                    } else if arg == "-s" || arg == "--string" {
                        if literal_opt.is_some() {
                            return err_out("svgo: multiple strings\n", 1);
                        }
                        literal_opt = Some(val.clone());
                    } else if arg == "-o" || arg == "--output" {
                        outfile_opt = Some(val.clone());
                    } else {
                        let max_v = if arg == "--indent" { 16usize } else { 15usize };
                        let Ok(n) = val.trim().parse::<usize>() else {
                            return err_out(&format!("svgo: invalid {arg}\n"), 1);
                        };
                        if n > max_v {
                            return err_out(&format!("svgo: invalid {arg}\n"), 1);
                        }
                        if arg == "--indent" {
                            indent = n;
                        } else {
                            precision = n;
                        }
                    }
                } else {
                    if input_opt.is_some() {
                        return err_out("svgo: multiple inputs\n", 1);
                    }
                    input_opt = Some(arg.to_string());
                }
                i += 1;
            }
            if input_opt.is_some() && literal_opt.is_some() {
                return err_out("svgo: choose input or string\n", 1);
            }
            let source = if let Some(ref lit) = literal_opt {
                lit.clone()
            } else if let Some(ref inp) = input_opt && inp != "-" {
                let full = resolve_posix_path(cwd, inp);
                let Ok(b) = fs.read_file(&full) else {
                    return err_out(&format!("svgo: {inp}: No such file or directory\n"), 1);
                };
                String::from_utf8_lossy(&b).to_string()
            } else {
                stdin.to_string()
            };
            let mut result = source;
            let passes = if multipass { 10 } else { 1 };
            for _ in 0..passes {
                match optimize_svg_str(&result, precision, false, indent) {
                    Ok(next) => {
                        if next == result {
                            break;
                        }
                        result = next;
                    }
                    Err(e) => return err_out(&format!("svgo: {e}\n"), 1),
                }
            }
            if pretty {
                match optimize_svg_str(&result, precision, true, indent) {
                    Ok(next) => result = next,
                    Err(e) => return err_out(&format!("svgo: {e}\n"), 1),
                }
            }
            let target = outfile_opt.unwrap_or_else(|| {
                if literal_opt.is_some() {
                    "-".to_string()
                } else {
                    input_opt.unwrap_or_else(|| "-".to_string())
                }
            });
            if target == "-" {
                ok_out(&result)
            } else {
                let full = resolve_posix_path(cwd, &target);
                let _ = fs.write_file(&full, result.as_bytes());
                ok_out("")
            }
        }
        "rsvg-convert" => {
            let mut format = "png".to_string();
            let mut output_opt: Option<String> = None;
            let mut input_opt: Option<String> = None;
            let mut positional = false;
            let mut i = 0usize;
            while i < args.len() {
                let arg = args[i].as_str();
                if !positional && arg == "--" {
                    positional = true;
                    i += 1;
                    continue;
                }
                if !positional && arg == "--help" {
                    return ok_out("Usage: rsvg-convert [-f pdf|png] [-o OUTPUT] [INPUT]\n");
                }
                if !positional && (arg == "-f" || arg == "--format") {
                    i += 1;
                    format = args.get(i).cloned().unwrap_or_default();
                    i += 1;
                    continue;
                }
                if !positional && (arg == "-o" || arg == "--output") {
                    i += 1;
                    let Some(o) = args.get(i) else {
                        return err_out("rsvg-convert: missing output path\n", 1);
                    };
                    output_opt = Some(o.clone());
                    i += 1;
                    continue;
                }
                if !positional && arg.starts_with('-') && arg != "-" {
                    return err_out(&format!("rsvg-convert: unsupported option {arg}\n"), 1);
                }
                if input_opt.is_some() {
                    return err_out("rsvg-convert: expected at most one input\n", 1);
                }
                input_opt = Some(arg.to_string());
                i += 1;
            }
            if format != "pdf" && format != "png" {
                return err_out(&format!("rsvg-convert: unsupported format {format}\n"), 1);
            }
            let src = if let Some(ref inp) = input_opt && inp != "-" {
                let full = resolve_posix_path(cwd, inp);
                let Ok(b) = fs.read_file(&full) else {
                    return err_out(&format!("rsvg-convert: {inp}: No such file or directory\n"), 1);
                };
                String::from_utf8_lossy(&b).to_string()
            } else {
                stdin.to_string()
            };
            let (width, height, texts) = match validate_and_extract_svg_render(&src) {
                Ok(r) => r,
                Err(e) => return err_out(&format!("rsvg-convert: {e}\n"), 1),
            };
            let rendered = if format == "png" {
                let im = ImageMeta {
                    fmt: "PNG".to_string(),
                    w: width.ceil() as u32,
                    h: height.ceil() as u32,
                    cs: "sRGB".to_string(),
                    exif: BTreeMap::new(),
                };
                write_image_bytes(&im)
            } else {
                let mut doc = PdfDoc::new();
                doc.version = "1.7".to_string();
                doc.page_w = width * 0.75;
                doc.page_h = height * 0.75;
                doc.pages.push(PdfPage {
                    rot: 0,
                    text: texts.join("\n"),
                    html: String::new(),
                    images: Vec::new(),
                    urls: Vec::new(),
                });
                doc.serialize()
            };
            if let Some(ref out_p) = output_opt && out_p != "-" {
                let full = resolve_posix_path(cwd, out_p);
                let _ = fs.write_file(&full, &rendered);
                ok_out("")
            } else {
                ok_out(&crate::vfs::bytes_to_stream_string(&rendered))
            }
        }
        "soxi" => {
            if args.iter().any(|a| a == "--help" || a == "-h") {
                return ok_out("Usage: soxi [-t|-r|-c|-s|-d|-D|-b|-B|-a] FILE...\n");
            }
            run_audio_info("soxi", args, stdin, cwd, fs)
        }
        "sox" => {
            if args.iter().any(|a| a == "--help" || a == "-h") {
                return ok_out("Usage: sox [FORMAT] INPUT... [FORMAT] OUTPUT [trim|pad|norm|gain -n|rate|channels|remix|fade|reverse|stat|stats|synth ...]\n       sox --i [-t|-r|-c|-s|-d|-D|-b|-B|-a] FILE\nFORMAT: -r RATE -c CHANNELS -b BITS -e ENCODING; -n is the null device. PCM processing reads and writes WAV.\n");
            }
            if args.first().map(|s| s.as_str()) == Some("--i") {
                return run_audio_info("sox", &args[1..], stdin, cwd, fs);
            }
            #[derive(Default, Clone)]
            struct SoxFmt {
                rate: Option<u32>,
                channels: Option<usize>,
                bits: Option<u32>,
                encoding: Option<String>,
                ftype: Option<String>,
            }
            impl SoxFmt {
                fn is_empty(&self) -> bool {
                    self.rate.is_none()
                        && self.channels.is_none()
                        && self.bits.is_none()
                        && self.encoding.is_none()
                        && self.ftype.is_none()
                }
            }
            let is_effect = |s: &str| {
                matches!(
                    s,
                    "trim"
                        | "pad"
                        | "norm"
                        | "gain"
                        | "rate"
                        | "channels"
                        | "remix"
                        | "fade"
                        | "reverse"
                        | "stat"
                        | "stats"
                        | "synth"
                )
            };
            let mut files: Vec<(String, SoxFmt)> = Vec::new();
            let mut pending = SoxFmt::default();
            let mut index = 0usize;
            while index < args.len() {
                let arg = args[index].as_str();
                if is_effect(arg) {
                    break;
                }
                if matches!(arg, "-r" | "-c" | "-b" | "-e" | "-t") {
                    index += 1;
                    let Some(val) = args.get(index) else {
                        return err_out(&format!("sox: Missing {arg}\n"), 1);
                    };
                    if arg == "-e" {
                        pending.encoding = Some(val.clone());
                    } else if arg == "-t" {
                        if val != "wav" {
                            return err_out("sox: Only WAV PCM format is supported\n", 1);
                        }
                        pending.ftype = Some("wav".to_string());
                    } else {
                        let Ok(num) = sox_numeric(Some(val), arg) else {
                            return err_out(&format!("sox: Invalid {arg}: {val}\n"), 1);
                        };
                        if num.fract() != 0.0 || num < 1.0 {
                            return err_out(&format!("sox: Invalid {arg}\n"), 1);
                        }
                        let n = num as u32;
                        if arg == "-r" {
                            pending.rate = Some(n);
                        } else if arg == "-c" {
                            if n > 64 {
                                return err_out("sox: Channel limit exceeded\n", 1);
                            }
                            pending.channels = Some(n as usize);
                        } else {
                            pending.bits = Some(n);
                        }
                    }
                } else {
                    if arg.starts_with('-') && arg != "-" && arg != "-n" {
                        return err_out(&format!("sox: Unknown option {arg}\n"), 1);
                    }
                    files.push((arg.to_string(), pending));
                    pending = SoxFmt::default();
                }
                index += 1;
            }
            if !pending.is_empty() {
                return err_out("sox: Format options require a file\n", 1);
            }
            if files.len() < 2 || files.len() > 65 {
                return err_out("sox: Expected input and output files\n", 1);
            }
            let output = files.pop().unwrap();
            let mut buffers: Vec<PcmAudio> = Vec::new();
            for (inp_name, inp_opts) in &files {
                if inp_name == "-n" {
                    if files.len() != 1 {
                        return err_out("sox: Null input must stand alone\n", 1);
                    }
                    continue;
                }
                let data = if inp_name == "-" {
                    crate::vfs::stream_string_to_bytes(stdin)
                } else {
                    let full = resolve_posix_path(cwd, inp_name);
                    let Ok(b) = fs.read_file(&full) else {
                        return err_out(&format!("sox: {inp_name}: No such file or directory\n"), 1);
                    };
                    b
                };
                let (mut pcm, info) = match decode_wav_pcm(&data) {
                    Ok(v) => v,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
                if let Some(ref enc) = inp_opts.encoding {
                    let actual = if info.codec == "pcm_float" {
                        "floating-point"
                    } else if info.bits_per_sample == 8 {
                        "unsigned-integer"
                    } else {
                        "signed-integer"
                    };
                    if enc != actual {
                        return err_out("sox: Input encoding override disagrees with WAV header\n", 1);
                    }
                }
                if let Some(r) = inp_opts.rate {
                    pcm.sample_rate = r;
                }
                if let Some(ch) = inp_opts.channels && ch != pcm.channels.len() {
                    return err_out("sox: Input channel override disagrees with WAV header\n", 1);
                }
                if let Some(b) = inp_opts.bits && b != info.bits_per_sample {
                    return err_out("sox: Input precision override disagrees with WAV header\n", 1);
                }
                buffers.push(pcm);
            }
            let null_opts = if files.first().map(|f| f.0.as_str()) == Some("-n") {
                files[0].1.clone()
            } else {
                SoxFmt::default()
            };
            let out_opts = SoxFmt {
                rate: output.1.rate.or(null_opts.rate),
                channels: output.1.channels.or(null_opts.channels),
                bits: output.1.bits.or(null_opts.bits),
                encoding: output.1.encoding.clone().or(null_opts.encoding),
                ftype: output.1.ftype.clone().or(null_opts.ftype),
            };
            let mut pcm = if buffers.is_empty() {
                PcmAudio {
                    sample_rate: out_opts.rate.unwrap_or(48000),
                    channels: vec![Vec::new(); out_opts.channels.unwrap_or(1)],
                }
            } else {
                let first_sr = buffers[0].sample_rate;
                let first_ch = buffers[0].channels.len();
                if buffers.iter().any(|b| b.sample_rate != first_sr || b.channels.len() != first_ch) {
                    return err_out("sox: Concatenation requires matching sample rates and channels\n", 1);
                }
                let mut chs = vec![Vec::new(); first_ch];
                for b in buffers {
                    for (ci, cvec) in b.channels.into_iter().enumerate() {
                        chs[ci].extend(cvec);
                    }
                }
                PcmAudio {
                    sample_rate: first_sr,
                    channels: chs,
                }
            };
            let eff_args = &args[index..];
            let mut ei = 0usize;
            let mut stderr = String::new();
            while ei < eff_args.len() {
                let eff = eff_args[ei].as_str();
                let is_opt = |idx: usize| idx < eff_args.len() && !is_effect(&eff_args[idx]);
                match eff {
                    "trim" => {
                        ei += 1;
                        let start = match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                            Ok(v) => v,
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                        let dur = if is_opt(ei + 1) {
                            ei += 1;
                            match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                                Ok(v) => Some(v),
                                Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                            }
                        } else {
                            None
                        };
                        let st_idx = js_math_round(start * (pcm.sample_rate as f64)) as usize;
                        let end_idx = dur.map(|d| st_idx + js_math_round(d * (pcm.sample_rate as f64)) as usize);
                        for ch in &mut pcm.channels {
                            let s = st_idx.min(ch.len());
                            let e = end_idx.unwrap_or(ch.len()).min(ch.len()).max(s);
                            *ch = ch[s..e].to_vec();
                        }
                    }
                    "pad" => {
                        ei += 1;
                        let lead = match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                            Ok(v) => v,
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                        let trail = if is_opt(ei + 1) {
                            ei += 1;
                            match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                                Ok(v) => v,
                                Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                            }
                        } else {
                            0.0
                        };
                        let lead_n = js_math_round(lead * (pcm.sample_rate as f64)) as usize;
                        let trail_n = js_math_round(trail * (pcm.sample_rate as f64)) as usize;
                        for ch in &mut pcm.channels {
                            let mut out = vec![0.0f64; lead_n + ch.len() + trail_n];
                            out[lead_n..lead_n + ch.len()].copy_from_slice(ch);
                            *ch = out;
                        }
                    }
                    "norm" | "gain" => {
                        if eff == "gain" {
                            ei += 1;
                            if eff_args.get(ei).map(|s| s.as_str()) != Some("-n") {
                                return err_out("sox: Only gain -n is supported\n", 1);
                            }
                        }
                        let target_db = if is_opt(ei + 1) {
                            ei += 1;
                            match sox_numeric(eff_args.get(ei).map(|s| s.as_str()), "gain") {
                                Ok(v) => v,
                                Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                            }
                        } else {
                            0.0
                        };
                        let (peak, _, _, _, _, _) = sox_stats(&pcm);
                        let gain = if peak > 0.0 {
                            10f64.powf(target_db / 20.0) / peak
                        } else {
                            1.0
                        };
                        for ch in &mut pcm.channels {
                            for v in ch.iter_mut() {
                                *v *= gain;
                            }
                        }
                    }
                    "rate" => {
                        ei += 1;
                        let r = match sox_numeric(eff_args.get(ei).map(|s| s.as_str()), "sample rate") {
                            Ok(v) if v.fract() == 0.0 && v > 0.0 => v as u32,
                            Ok(_) => return err_out("sox: Invalid sample rate\n", 1),
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                        pcm = sox_resample(&pcm, r);
                    }
                    "channels" => {
                        ei += 1;
                        let cnt = match sox_numeric(eff_args.get(ei).map(|s| s.as_str()), "channels") {
                            Ok(v) if v.fract() == 0.0 && v >= 1.0 && v <= 64.0 => v as usize,
                            Ok(_) => return err_out("sox: Audio sample limit exceeded\n", 1),
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                        pcm = match sox_remix(&pcm, cnt, None) {
                            Ok(p) => p,
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                    }
                    "remix" => {
                        let mut matrix: Vec<Vec<f64>> = Vec::new();
                        while is_opt(ei + 1) {
                            ei += 1;
                            let spec = &eff_args[ei];
                            let list: Vec<&str> = spec.split(',').collect();
                            let mut row = vec![0.0f64; pcm.channels.len()];
                            for item in &list {
                                let ch_num = match sox_numeric(Some(item), "channel") {
                                    Ok(v) => v,
                                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                                };
                                if ch_num == 0.0 && list.len() == 1 {
                                    continue;
                                }
                                if ch_num.fract() != 0.0 || ch_num < 1.0 || (ch_num as usize) > row.len() {
                                    return err_out("sox: Invalid remix channel\n", 1);
                                }
                                row[(ch_num as usize) - 1] = 1.0 / (list.len() as f64);
                            }
                            matrix.push(row);
                        }
                        if matrix.is_empty() {
                            return err_out("sox: Audio sample limit exceeded\n", 1);
                        }
                        let mlen = matrix.len();
                        pcm = match sox_remix(&pcm, mlen, Some(matrix)) {
                            Ok(p) => p,
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                    }
                    "reverse" => {
                        for ch in &mut pcm.channels {
                            ch.reverse();
                        }
                    }
                    "fade" => {
                        let mut shape = "l";
                        if let Some(nx) = eff_args.get(ei + 1).map(|s| s.as_str())
                            && matches!(nx, "q" | "h" | "t" | "l" | "p")
                        {
                            ei += 1;
                            shape = nx;
                        }
                        ei += 1;
                        let fade_in = match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                            Ok(v) => v,
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                        let cur_frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
                        let has_stop = is_opt(ei + 1);
                        let stop = if has_stop {
                            ei += 1;
                            match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                                Ok(v) => v,
                                Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                            }
                        } else {
                            (cur_frames as f64) / (pcm.sample_rate as f64)
                        };
                        let fade_out = if is_opt(ei + 1) {
                            ei += 1;
                            match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                                Ok(v) => v,
                                Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                            }
                        } else if has_stop {
                            fade_in
                        } else {
                            0.0
                        };
                        if stop > 0.0 {
                            let target_len = js_math_round(stop * (pcm.sample_rate as f64)) as usize;
                            for ch in &mut pcm.channels {
                                ch.resize(target_len, 0.0);
                            }
                        }
                        let lead = js_math_round(fade_in * (pcm.sample_rate as f64)) as usize;
                        let trail = js_math_round(fade_out * (pcm.sample_rate as f64)) as usize;
                        let length = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
                        let curve = |v: f64| -> f64 {
                            match shape {
                                "q" => (v * std::f64::consts::PI / 2.0).sin(),
                                "h" => (1.0 - (v * std::f64::consts::PI).cos()) / 2.0,
                                "p" => (1.0 + 9.0 * v).log10(),
                                "t" => 10f64.powf(5.0 * (v - 1.0)),
                                _ => v,
                            }
                        };
                        for ch in &mut pcm.channels {
                            for (idx, val) in ch.iter_mut().enumerate() {
                                let c_in = curve(if lead > 0 { ((idx as f64) / (lead as f64)).min(1.0) } else { 1.0 });
                                let c_out = curve(if trail > 0 { (((length - 1 - idx) as f64) / (trail as f64)).min(1.0) } else { 1.0 });
                                *val *= c_in * c_out;
                            }
                        }
                    }
                    "synth" => {
                        ei += 1;
                        let dur = match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                            Ok(v) => v,
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                        ei += 1;
                        let kind = eff_args.get(ei).map(|s| s.as_str()).unwrap_or("");
                        ei += 1;
                        let freq = match sox_numeric(eff_args.get(ei).map(|s| s.as_str()), "frequency") {
                            Ok(v) => v,
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                        if freq < 0.0 || freq > (pcm.sample_rate as f64) / 2.0 {
                            return err_out("sox: Frequency exceeds Nyquist limit\n", 1);
                        }
                        if !matches!(kind, "sine" | "square" | "triangle" | "sawtooth") {
                            return err_out("sox: Unsupported synth waveform\n", 1);
                        }
                        let length = js_math_round(dur * (pcm.sample_rate as f64)) as usize;
                        let wave: Vec<f64> = (0..length)
                            .map(|idx| {
                                let phase = (idx as f64) * freq / (pcm.sample_rate as f64);
                                match kind {
                                    "sine" => (2.0 * std::f64::consts::PI * phase).sin(),
                                    "square" => if phase % 1.0 < 0.5 { 1.0 } else { -1.0 },
                                    "triangle" => 1.0 - 4.0 * (js_math_round(phase) - phase).abs(),
                                    _ => 2.0 * (phase - (phase + 0.5).floor()),
                                }
                            })
                            .collect();
                        for ch in &mut pcm.channels {
                            *ch = wave.clone();
                        }
                    }
                    "stat" | "stats" => {
                        let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
                        let (peak, rms, peak_db, rms_db, dc, crest) = sox_stats(&pcm);
                        let len_s = (frames as f64) / (pcm.sample_rate as f64);
                        if eff == "stat" {
                            stderr.push_str(&format!(
                                "Samples read:      {}\nLength (seconds): {:.6}\nMaximum amplitude: {:.6}\nRMS amplitude:     {:.6}\nMean amplitude:    {:.6}\n",
                                frames * pcm.channels.len(),
                                len_s,
                                peak,
                                rms,
                                dc
                            ));
                        } else {
                            let fmt_db = |v: f64| if v == f64::NEG_INFINITY { "-Infinity".to_string() } else { format!("{v:.2}") };
                            stderr.push_str(&format!(
                                "DC offset   {:.6}\nPk lev dB   {}\nRMS lev dB  {}\nCrest factor {:.2}\nNum samples {}\nLength s    {:.6}\n",
                                dc,
                                fmt_db(peak_db),
                                fmt_db(rms_db),
                                crest,
                                frames,
                                len_s
                            ));
                        }
                    }
                    _ => return err_out(&format!("sox: Unsupported effect {eff}\n"), 1),
                }
                ei += 1;
            }
            if let Some(r) = out_opts.rate && r != pcm.sample_rate {
                pcm = sox_resample(&pcm, r);
            }
            if let Some(ch) = out_opts.channels && ch != pcm.channels.len() {
                pcm = match sox_remix(&pcm, ch, None) {
                    Ok(p) => p,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
            }
            let floating = out_opts.encoding.as_deref() == Some("floating-point");
            let bits = out_opts.bits.unwrap_or(if floating {
                32
            } else if out_opts.encoding.as_deref() == Some("unsigned-integer") {
                8
            } else {
                16
            });
            if let Some(ref enc) = out_opts.encoding {
                if !matches!(enc.as_str(), "signed-integer" | "unsigned-integer" | "floating-point") {
                    return err_out("sox: Unsupported encoding\n", 1);
                }
                if (enc == "unsigned-integer" && bits != 8) || (enc == "signed-integer" && bits == 8) {
                    return err_out("sox: WAV uses unsigned 8-bit and signed 16/24/32-bit PCM\n", 1);
                }
            }
            let wav_bytes = match encode_wav_pcm(&pcm, bits, floating) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("sox: {e}\n"), 1),
            };
            let mut stdout = String::new();
            if output.0 == "-" {
                stdout = crate::vfs::bytes_to_stream_string(&wav_bytes);
            } else if output.0 != "-n" {
                if out_opts.ftype.as_deref() != Some("wav") && !output.0.to_ascii_lowercase().ends_with(".wav") {
                    return err_out("sox: Output must be WAV (.wav)\n", 1);
                }
                let full = resolve_posix_path(cwd, &output.0);
                let _ = fs.write_file(&full, &wav_bytes);
            }
            BuiltinOutcome {
                stdout,
                stderr,
                exit_code: 0,
            }
        }
        "qrencode" => {
            const QR_HELP: &str = "Usage: qrencode [OPTION]... [STRING]\nGenerate QR codes from a string, stdin, or a virtual file.\n  -o, --output FILE       Virtual output file (- for stdout)\n  -r, --read-from FILE    Read virtual file (- for stdin)\n  -t, --type TYPE         PNG, PNG32, SVG, EPS, ASCII, ASCIIi,\n                         UTF8, UTF8i, ANSI, ANSI256, ANSIUTF8\n  -s, --size N            Module pixel size (default 3)\n  -m, --margin N          Quiet zone (default 4, Micro QR 2)\n  -l, --level L|M|Q|H     Error correction (default L)\n  -v, --symversion N      Minimum version (0 auto, QR 1..40, Micro 1..4)\n  -d, --dpi N            PNG resolution (default 72)\n  -8, --8bit             Encode raw bytes\n  -k, --kanji            Interpret Shift-JIS pairs as Kanji\n  -i, --ignorecase       Fold ASCII lowercase to uppercase\n  -S, --structured       Structured append (requires -v and -o)\n  -M, --micro            Generate Micro QR\n      --strict-version   Fail instead of increasing version\n      --foreground=RRGGBB[AA]  Foreground color\n      --background=RRGGBB[AA]  Background color\n  -h, --help             Show help\n";
            let parse_uint = |val: &str, min: usize, max: usize| -> Result<usize, String> {
                if val.is_empty() || !val.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(format!("Invalid number: {val}"));
                }
                let n = val.parse::<usize>().map_err(|_| format!("Number out of range: {val}"))?;
                if n < min || n > max {
                    return Err(format!("Number out of range: {val}"));
                }
                Ok(n)
            };
            let parse_color = |val: &str| -> Result<[u8; 4], String> {
                if (val.len() != 6 && val.len() != 8) || !val.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("Colors must be RRGGBB or RRGGBBAA".to_string());
                }
                let r = u8::from_str_radix(&val[0..2], 16).unwrap();
                let g = u8::from_str_radix(&val[2..4], 16).unwrap();
                let b = u8::from_str_radix(&val[4..6], 16).unwrap();
                let a = if val.len() == 8 { u8::from_str_radix(&val[6..8], 16).unwrap() } else { 255 };
                Ok([r, g, b, a])
            };
            let mut output_opt: Option<String> = None;
            let mut input_opt: Option<String> = None;
            let mut operand_opt: Option<String> = None;
            let mut rtype = "PNG".to_string();
            let mut size = 3usize;
            let mut margin_opt: Option<usize> = None;
            let mut level = 0usize; // L=0, M=1, Q=2, H=3
            let mut version = 0usize;
            let mut byte_mode = false;
            let mut kanji = false;
            let mut ignorecase = false;
            let mut structured = false;
            let mut micro = false;
            let mut strict = false;
            let mut fg = [0u8, 0, 0, 255];
            let mut bg = [255u8, 255, 255, 255];
            let mut help = false;
            let mut end = false;
            let mut i = 0usize;
            while i < args.len() {
                let arg = args[i].as_str();
                if !end && arg == "--" {
                    end = true;
                    i += 1;
                    continue;
                }
                if end || !arg.starts_with('-') || arg == "-" {
                    if operand_opt.is_some() {
                        return err_out("qrencode: Only one input string is accepted\n", 1);
                    }
                    operand_opt = Some(arg.to_string());
                    i += 1;
                    continue;
                }
                let is_long = arg.starts_with("--");
                let eq = arg.find('=');
                let raw_name = if is_long {
                    match eq {
                        Some(pos) => &arg[2..pos],
                        None => &arg[2..],
                    }
                } else {
                    &arg[1..2]
                };
                let key = match raw_name {
                    "output" => "o",
                    "read-from" => "r",
                    "type" => "t",
                    "size" => "s",
                    "margin" => "m",
                    "dpi" => "d",
                    "level" => "l",
                    "symversion" => "v",
                    "structured" => "S",
                    "kanji" => "k",
                    "casesensitive" => "c",
                    "ignorecase" => "i",
                    "8bit" => "8",
                    "micro" => "M",
                    "help" => "h",
                    other => other,
                };
                let mut attached: Option<String> = if is_long {
                    eq.map(|pos| arg[pos + 1..].to_string())
                } else if arg.len() > 2 {
                    Some(arg[2..].to_string())
                } else {
                    None
                };
                if !matches!(key, "o" | "r" | "t" | "s" | "m" | "d" | "l" | "v" | "foreground" | "background") {
                    if attached.is_some() {
                        return err_out(&format!("qrencode: Unexpected option value: {arg}\n"), 1);
                    }
                    match key {
                        "h" => help = true,
                        "8" => byte_mode = true,
                        "k" => kanji = true,
                        "i" => ignorecase = true,
                        "c" => ignorecase = false,
                        "S" => structured = true,
                        "M" => micro = true,
                        "strict-version" => strict = true,
                        _ => return err_out(&format!("qrencode: Unknown option: {arg}\n"), 1),
                    }
                    i += 1;
                    continue;
                }
                if attached.is_none() {
                    i += 1;
                    let Some(nx) = args.get(i) else {
                        return err_out(&format!("qrencode: Missing value for {arg}\n"), 1);
                    };
                    attached = Some(nx.clone());
                }
                let val = attached.unwrap();
                match key {
                    "o" => output_opt = Some(val),
                    "r" => input_opt = Some(val),
                    "t" => {
                        if !matches!(
                            val.as_str(),
                            "PNG" | "PNG32" | "SVG" | "EPS" | "ASCII" | "ASCIIi" | "UTF8" | "UTF8i" | "ANSI" | "ANSI256" | "ANSIUTF8"
                        ) {
                            return err_out("qrencode: Unsupported output type\n", 1);
                        }
                        rtype = val;
                    }
                    "s" => match parse_uint(&val, 1, 0x7fffffff) {
                        Ok(v) => size = v,
                        Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
                    },
                    "m" => match parse_uint(&val, 0, 0x7fffffff) {
                        Ok(v) => margin_opt = Some(v),
                        Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
                    },
                    "d" => if let Err(e) = parse_uint(&val, 1, 109093169) {
                        return err_out(&format!("qrencode: {e}\n"), 1);
                    },
                    "v" => if val == "auto" {
                        version = 0;
                    } else {
                        match parse_uint(&val, 0, 40) {
                            Ok(v) => version = v,
                            Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
                        }
                    },
                    "l" => match val.as_str() {
                        "L" => level = 0,
                        "M" => level = 1,
                        "Q" => level = 2,
                        "H" => level = 3,
                        _ => return err_out("qrencode: Invalid error correction level\n", 1),
                    },
                    "foreground" => match parse_color(&val) {
                        Ok(c) => fg = c,
                        Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
                    },
                    "background" => match parse_color(&val) {
                        Ok(c) => bg = c,
                        Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
                    },
                    _ => {}
                }
                i += 1;
            }
            if help {
                return ok_out(QR_HELP);
            }
            if micro && (version > 4 || level == 3 || structured) {
                return err_out("qrencode: Unsupported Micro QR version, level, or structured append\n", 1);
            }
            if structured && (version == 0 || output_opt.as_deref().unwrap_or("-") == "-") {
                return err_out("qrencode: Structured append requires a version and output filename\n", 1);
            }
            if input_opt.is_some() && operand_opt.is_some() {
                return err_out("qrencode: Choose a file or an input string\n", 1);
            }
            let input_limit = if structured { 113_424usize } else { 7089usize };
            let mut data = if let Some(op) = operand_opt {
                if op.len() > input_limit {
                    return err_out("qrencode: Input exceeds byte limit\n", 1);
                }
                crate::vfs::stream_string_to_bytes(&op)
            } else if let Some(ref inp) = input_opt && inp != "-" {
                let full = resolve_posix_path(cwd, inp);
                let Ok(b) = fs.read_file(&full) else {
                    return err_out(&format!("qrencode: {inp}: No such file or directory\n"), 1);
                };
                b
            } else {
                crate::vfs::stream_string_to_bytes(stdin)
            };
            if data.len() > input_limit {
                return err_out("qrencode: Input exceeds byte limit\n", 1);
            }
            if ignorecase && !byte_mode {
                let mut idx = 0usize;
                while idx < data.len() {
                    if kanji && qr_kanji_value(&data, idx) >= 0 {
                        idx += 2;
                        continue;
                    }
                    if data[idx].is_ascii_lowercase() {
                        data[idx] -= 32;
                    }
                    idx += 1;
                }
            }
            let opts = QrEncodeOpts {
                version,
                level,
                byte_mode,
                kanji,
                micro,
                strict,
                append: None,
            };
            let syms = match qr_encode_symbols(&data, opts, structured) {
                Ok(s) => s,
                Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
            };
            let margin = margin_opt.unwrap_or(if micro { 2 } else { 4 });
            let mut stdout_bytes = Vec::new();
            for (idx, sym) in syms.iter().enumerate() {
                let n = sym.len();
                let width = n + 2 * margin;
                let pixels = width.saturating_mul(size);
                let raster = rtype == "PNG" || rtype == "PNG32";
                let vector = rtype == "SVG" || rtype == "EPS";
                let estimate = if raster {
                    pixels.saturating_mul(pixels).saturating_mul(24).saturating_add(1_048_576)
                } else if vector {
                    n.saturating_mul(n).saturating_mul(240).saturating_add(4096)
                } else {
                    width.saturating_mul(width).saturating_mul(48).saturating_add(4096)
                };
                let max_mem = (64 * 1024 * 1024usize)
                    .saturating_sub(data.len().saturating_mul(64))
                    .saturating_sub(n.saturating_mul(n).saturating_mul(16));
                if pixels > 0x7fff_ffff || estimate > max_mem {
                    return err_out("qrencode: QR output exceeds memory budget\n", 1);
                }
                let rendered = qr_render(sym, &rtype, size, margin, fg, bg);
                if let Some(ref out_p) = output_opt && out_p != "-" {
                    let mut name = out_p.clone();
                    if structured {
                        let dot = name.rfind('.');
                        let slash = name.rfind('/');
                        let has_ext = match (dot, slash) {
                            (Some(d), Some(s)) => d > s,
                            (Some(_), None) => true,
                            _ => false,
                        };
                        let (stem, suffix) = if has_ext {
                            let d = dot.unwrap();
                            (name[..d].to_string(), name[d..].to_string())
                        } else {
                            (name.clone(), format!(".{}", rtype.to_ascii_lowercase()))
                        };
                        name = format!("{stem}-{:02}{suffix}", idx + 1);
                    }
                    let full = resolve_posix_path(cwd, &name);
                    let _ = fs.write_file(&full, &rendered);
                } else {
                    stdout_bytes.extend_from_slice(&rendered);
                }
            }
            ok_out(&crate::vfs::bytes_to_stream_string(&stdout_bytes))
        }
        _ => ok_out(""),
    }
}
