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

#[derive(Clone, Debug)]
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
    encrypted: Option<String>,
    linearized: bool,
    page_w: f64,
    page_h: f64,
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
            encrypted: None,
            linearized: false,
            page_w: 612.0,
            page_h: 792.0,
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
                } else if let Some(v) = line.strip_prefix("SIZE:") {
                    if let Some((ws, hs)) = v.split_once(':') {
                        doc.page_w = ws.parse().unwrap_or(612.0);
                        doc.page_h = hs.parse().unwrap_or(792.0);
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
        if (self.page_w - 612.0).abs() > 1e-6 || (self.page_h - 792.0).abs() > 1e-6 {
            out.push_str(&format!("SIZE:{}:{}\n", self.page_w, self.page_h));
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
        if let Some(sp) = tag.find("src=\"") {
            let r = &tag[sp + 5..];
            if let Some(se) = r.find('"') {
                let src = &r[..se];
                if !src.starts_with("data:") {
                    let full = resolve_posix_path(base_dir, src);
                    if let Ok(b) = fs.read_file(&full) {
                        let m = read_image_meta(&b, &full);
                        w = m.w;
                        h = m.h;
                    }
                }
            }
        }
        imgs.push((w, h, "PNG".to_string()));
        rest = &rest[end..];
    }
    imgs
}

fn split_html_pages(html: &str) -> Vec<String> {
    let mut pages = Vec::new();
    let mut cur = String::new();
    let mut rest = html;
    while let Some(pos) = rest.find("page-break-before") {
        let before = &rest[..pos];
        let div_start = before.rfind("<div").unwrap_or(pos);
        cur.push_str(&rest[..div_start]);
        if !strip_html_tags(&cur).is_empty() {
            pages.push(cur.clone());
            cur.clear();
        }
        let after_pb = &rest[pos..];
        if let Some(gt) = after_pb.find('>') {
            rest = &after_pb[gt + 1..];
        } else {
            break;
        }
    }
    cur.push_str(rest);
    if !strip_html_tags(&cur).is_empty() || pages.is_empty() {
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
            subtitles: String::new(),
            chapters: Vec::new(),
        }
    }

    fn parse(bytes: &[u8], path: &str) -> Self {
        let mut d = Self::default_video();
        if path.ends_with(".wav") || bytes.starts_with(b"RIFF") {
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
                            "title" => d.title = hex_dec_str(v),
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
        let meta_line = format!(
            "__MEDIA__:type={};codec={};fmt={};w={};h={};n={};fps={};dur={:.6};sr={};ch={};ha={};title={};subs={};chaps={}\n",
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
            hex_enc(self.subtitles.as_bytes()),
            chaps.join(",")
        );
        if m3u8 {
            let mut s = String::from("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\nseg0.ts\n#EXT-X-ENDLIST\n# ");
            s.push_str(&meta_line);
            return s.into_bytes();
        }
        let mut out = if self.format_name == "wav" {
            b"RIFF\x24\x00\x00\x00WAVEfmt ".to_vec()
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
            .map(|l| l.split(delim).map(|c| c.to_string()).collect())
            .collect();
        let paras: Vec<String> = rows.iter().map(|r| r.join(",")).collect();
        return (paras, Some(rows));
    }
    if lower.ends_with(".xlsx") || lower.ends_with(".ods") {
        let entries = parse_ustar_archive(bytes);
        for e in entries {
            if e.name == "xl/worksheets/sheet1.xml" {
                let xml = String::from_utf8_lossy(&e.content);
                let mut rows = Vec::new();
                let mut rest = xml.as_ref();
                while let Some(rs) = rest.find("<row") {
                    rest = &rest[rs + 4..];
                    if let Some(re) = rest.find("</row>") {
                        let row_xml = &rest[..re];
                        let mut cells = Vec::new();
                        let mut rcell = row_xml;
                        while let Some(ts) = rcell.find("<t>") {
                            rcell = &rcell[ts + 3..];
                            if let Some(te) = rcell.find("</t>") {
                                let val = rcell[..te]
                                    .replace("&amp;", "&")
                                    .replace("&lt;", "<")
                                    .replace("&gt;", ">")
                                    .replace("&quot;", "\"");
                                cells.push(val);
                                rcell = &rcell[te + 4..];
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
                let paras: Vec<String> = rows.iter().map(|r| r.join(",")).collect();
                return (paras, Some(rows));
            }
        }
    }
    if lower.ends_with(".docx") || lower.ends_with(".odt") || lower.ends_with(".pptx") {
        let entries = parse_ustar_archive(bytes);
        for e in entries {
            if e.name == "word/document.xml" {
                let xml = String::from_utf8_lossy(&e.content);
                let mut paras = Vec::new();
                let mut rest = xml.as_ref();
                while let Some(ts) = rest.find("<w:t>") {
                    rest = &rest[ts + 5..];
                    if let Some(te) = rest.find("</w:t>") {
                        let val = rest[..te]
                            .replace("&amp;", "&")
                            .replace("&lt;", "<")
                            .replace("&gt;", ">")
                            .replace("&quot;", "\"");
                        paras.push(val);
                        rest = &rest[te + 6..];
                    } else {
                        break;
                    }
                }
                return (paras, None);
            }
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

fn format_printf_num(pattern: &str, num: usize) -> String {
    if let Some(pos) = pattern.find('%') {
        let after = &pattern[pos + 1..];
        if let Some(d_pos) = after.find('d') {
            let spec = &after[..d_pos];
            let width: usize = spec.trim_start_matches('0').parse().unwrap_or(0);
            let formatted = if spec.starts_with('0') && width > 0 {
                format!("{num:0width$}", width = width)
            } else {
                format!("{num}")
            };
            return format!("{}{formatted}{}", &pattern[..pos], &after[d_pos + 1..]);
        }
    }
    pattern.to_string()
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
    if !stack.is_empty() || roots.len() != 1 || roots[0].name != "svg" {
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
                t.push_str(s);
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

fn cmd_media_doc(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    match cmd {
        "ffmpeg" => {
            let mut inputs: Vec<String> = Vec::new();
            let mut fmt_flag = String::new();
            let mut vf_flag = String::new();
            let mut fc_flag = String::new();
            let mut ar_opt: Option<u32> = None;
            let mut ac_opt: Option<u32> = None;
            let mut framerate_opt: Option<u32> = None;
            let mut ss_opt: Option<f64> = None;
            let mut t_opt: Option<f64> = None;
            let mut meta_title: Option<String> = None;
            let mut out_arg: Option<String> = None;
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-i" if i + 1 < args.len() => {
                        inputs.push(args[i + 1].clone());
                        i += 2;
                    }
                    "-f" if i + 1 < args.len() => {
                        fmt_flag = args[i + 1].clone();
                        i += 2;
                    }
                    "-vf" | "-filter:v" if i + 1 < args.len() => {
                        vf_flag = args[i + 1].clone();
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
                        framerate_opt = args[i + 1].parse().ok();
                        i += 2;
                    }
                    "-ss" if i + 1 < args.len() => {
                        ss_opt = args[i + 1].parse().ok();
                        i += 2;
                    }
                    "-t" if i + 1 < args.len() => {
                        t_opt = args[i + 1].parse().ok();
                        i += 2;
                    }
                    "-metadata" if i + 1 < args.len() => {
                        if let Some((k, v)) = args[i + 1].split_once('=')
                            && k == "title"
                        {
                            meta_title = Some(v.to_string());
                        }
                        i += 2;
                    }
                    "-af" | "-c" | "-c:a" | "-c:v" | "-frames:v" | "-vframes" | "-safe"
                    | "-hls_time" | "-b:a" | "-b:v" | "-pix_fmt"
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
            let mut doc = MediaDoc::default_video();
            for inp in &inputs {
                if inp.starts_with("color=")
                    || inp.starts_with("testsrc=")
                    || inp.starts_with("smptebars=")
                {
                    let mut w = 64u32;
                    let mut h = 48u32;
                    let mut r = 10f64;
                    let mut d = 1.0f64;
                    let params = inp
                        .split_once('=')
                        .map(|(_, r)| if r.contains('=') { r } else { inp.as_str() })
                        .unwrap_or(inp.as_str());
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
                    doc.codec_type = "video".to_string();
                    doc.codec_name = "h264".to_string();
                    doc.format_name = "mp4".to_string();
                    doc.width = w;
                    doc.height = h;
                    doc.fps = r.round() as u32;
                    doc.duration = d;
                    doc.nb_frames = (r * d).round().max(1.0) as u32;
                } else if inp.starts_with("sine=") || inp.starts_with("anoisesrc=") {
                    let mut sr = 16000u32;
                    let mut d = 1.0f64;
                    let params = inp
                        .split_once('=')
                        .map(|(_, r)| if r.contains('=') { r } else { inp.as_str() })
                        .unwrap_or(inp.as_str());
                    for part in params.split(':') {
                        if let Some((k, v)) = part.split_once('=') {
                            if k == "sample_rate" || k == "r" {
                                sr = v.parse().unwrap_or(16000);
                            } else if k == "duration" || k == "d" {
                                d = v.parse().unwrap_or(1.0);
                            }
                        }
                    }
                    if inputs.first() != Some(inp) && doc.codec_type == "video" {
                        doc.has_audio = true;
                        doc.sample_rate = sr;
                        doc.channels = 1;
                    } else {
                        doc.codec_type = "audio".to_string();
                        doc.codec_name = "pcm_s16le".to_string();
                        doc.format_name = "wav".to_string();
                        doc.sample_rate = sr;
                        doc.duration = d;
                        doc.channels = 1;
                    }
                } else if let Some(rest) = inp.strip_prefix("concat:") {
                    let mut total_frames = 0u32;
                    for p in rest.split('|') {
                        let f = resolve_posix_path(cwd, p);
                        if let Ok(b) = fs.read_file(&f) {
                            let sub = MediaDoc::parse(&b, &f);
                            doc.width = sub.width;
                            doc.height = sub.height;
                            total_frames += sub.nb_frames;
                        }
                    }
                    doc.nb_frames = total_frames.max(1);
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
                } else {
                    let full_in = resolve_posix_path(cwd, inp);
                    if let Ok(b) = fs.read_file(&full_in) {
                        let text = String::from_utf8_lossy(&b);
                        if fmt_flag == "concat" || text.starts_with("ffconcat") {
                            let mut total_frames = 0u32;
                            for line in text.lines() {
                                let t = line.trim();
                                if let Some(r) = t.strip_prefix("file ") {
                                    let p = r.trim().trim_matches('\'').trim_matches('"');
                                    let pf = resolve_posix_path(cwd, p);
                                    if let Ok(pb) = fs.read_file(&pf) {
                                        let sub = MediaDoc::parse(&pb, &pf);
                                        doc.width = sub.width;
                                        doc.height = sub.height;
                                        total_frames += sub.nb_frames;
                                    }
                                }
                            }
                            doc.nb_frames = total_frames.max(1);
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
                                }
                            }
                        } else if inputs.first() == Some(inp) {
                            doc = MediaDoc::parse(&b, &full_in);
                        } else {
                            let sub = MediaDoc::parse(&b, &full_in);
                            if doc.codec_type == "video" && sub.codec_type == "audio" {
                                doc.has_audio = true;
                                doc.sample_rate = sub.sample_rate;
                                doc.channels = sub.channels;
                            } else if doc.codec_type == "audio" && sub.codec_type == "video" {
                                let sr = doc.sample_rate;
                                let ch = doc.channels;
                                doc = sub;
                                doc.has_audio = true;
                                doc.sample_rate = sr;
                                doc.channels = ch;
                            }
                        }
                    }
                }
            }
            if !fc_flag.is_empty() && inputs.len() >= 2 {
                let f0 = resolve_posix_path(cwd, &inputs[0]);
                let f1 = resolve_posix_path(cwd, &inputs[1]);
                let d0 = fs
                    .read_file(&f0)
                    .map(|b| MediaDoc::parse(&b, &f0))
                    .unwrap_or_else(|_| doc.clone());
                let d1 = fs
                    .read_file(&f1)
                    .map(|b| MediaDoc::parse(&b, &f1))
                    .unwrap_or_else(|_| doc.clone());
                if fc_flag.contains("vstack") {
                    doc.width = d0.width;
                    doc.height = d0.height + d1.height;
                } else if fc_flag.contains("hstack") {
                    doc.width = d0.width + d1.width;
                    doc.height = d0.height;
                }
            }
            if !vf_flag.is_empty() {
                for f in vf_flag.split(',') {
                    let f = f.trim();
                    if let Some(rest) = f.strip_prefix("scale=") {
                        let parts: Vec<&str> = rest.split(':').collect();
                        if parts.len() >= 2 {
                            doc.width = parts[0].parse().unwrap_or(doc.width);
                            doc.height = parts[1].parse().unwrap_or(doc.height);
                        }
                    } else if let Some(rest) = f.strip_prefix("pad=") {
                        let parts: Vec<&str> = rest.split(':').collect();
                        if parts.len() >= 2 {
                            doc.width = parts[0].parse().unwrap_or(doc.width);
                            doc.height = parts[1].parse().unwrap_or(doc.height);
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
            if let Some(sr) = ar_opt {
                doc.sample_rate = sr;
            }
            if let Some(ch) = ac_opt {
                doc.channels = ch;
            }
            if let Some(dur) = t_opt {
                let _ = ss_opt;
                doc.duration = dur;
                doc.nb_frames = ((doc.fps as f64) * dur).round().max(1.0) as u32;
            }
            if let Some(t) = meta_title {
                doc.title = t;
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
            let mut of_fmt = "json".to_string();
            let mut in_arg: Option<String> = None;
            let mut show_entries = String::new();
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
                    "-v" | "-select_streams" if i + 1 < args.len() => {
                        i += 2;
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
                    (fs.read_file(&full).unwrap_or_default(), full)
                }
            };
            let doc = MediaDoc::parse(&raw_bytes, &path_str);
            if of_fmt.starts_with("default=noprint_wrappers=1:nokey=1") {
                if show_entries.contains("width") {
                    return ok_out(&format!("{}\n", doc.width));
                }
                if show_entries.contains("height") {
                    return ok_out(&format!("{}\n", doc.height));
                }
                return ok_out(&format!("{}\n", doc.nb_frames));
            }
            if of_fmt == "flat" {
                return ok_out(&format!(
                    "streams.stream.0.codec_type=\"{}\"\nstreams.stream.0.codec_name=\"{}\"\nstreams.stream.0.width={}\nstreams.stream.0.height={}\nstreams.stream.0.sample_rate=\"{}\"\nstreams.stream.0.channels={}\n",
                    doc.codec_type,
                    doc.codec_name,
                    doc.width,
                    doc.height,
                    doc.sample_rate,
                    doc.channels
                ));
            }
            if of_fmt == "csv=p=0" {
                if let Some(fields_spec) = show_entries.strip_prefix("stream=") {
                    let vals: Vec<String> = fields_spec
                        .split(',')
                        .map(|f| match f.trim() {
                            "width" => doc.width.to_string(),
                            "height" => doc.height.to_string(),
                            "codec_name" => doc.codec_name.clone(),
                            "codec_type" => doc.codec_type.clone(),
                            "sample_rate" => doc.sample_rate.to_string(),
                            "channels" => doc.channels.to_string(),
                            "nb_frames" => doc.nb_frames.to_string(),
                            _ => String::new(),
                        })
                        .collect();
                    let mut out = format!("{}\n", vals.join(","));
                    if doc.codec_type == "video" && doc.has_audio {
                        let audio_vals: Vec<String> = fields_spec
                            .split(',')
                            .filter_map(|f| match f.trim() {
                                "codec_name" => Some("aac".to_string()),
                                "codec_type" => Some("audio".to_string()),
                                "sample_rate" => Some(doc.sample_rate.to_string()),
                                "channels" => Some(doc.channels.to_string()),
                                _ => None,
                            })
                            .collect();
                        if !audio_vals.is_empty() {
                            out.push_str(&format!("{}\n", audio_vals.join(",")));
                        }
                    }
                    return ok_out(&out);
                }
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
            let dur_val = if doc.duration > 0.0 {
                doc.duration
            } else {
                (doc.nb_frames.max(1) as f64) / (doc.fps.max(1) as f64)
            };
            let stream_json = if doc.codec_type == "audio" {
                format!(
                    "{{\"codec_type\":\"audio\",\"codec_name\":\"{}\",\"sample_rate\":\"{}\",\"channels\":{},\"duration\":\"{dur_val:.6}\"}}",
                    doc.codec_name, doc.sample_rate, doc.channels
                )
            } else if doc.has_audio {
                format!(
                    "{{\"codec_type\":\"video\",\"codec_name\":\"{}\",\"width\":{},\"height\":{},\"nb_frames\":\"{}\",\"duration\":\"{dur_val:.6}\"}},{{\"codec_type\":\"audio\",\"codec_name\":\"aac\",\"sample_rate\":\"{}\",\"channels\":{},\"duration\":\"{dur_val:.6}\"}}",
                    doc.codec_name, doc.width, doc.height, doc.nb_frames, doc.sample_rate, doc.channels
                )
            } else {
                format!(
                    "{{\"codec_type\":\"video\",\"codec_name\":\"{}\",\"width\":{},\"height\":{},\"nb_frames\":\"{}\",\"duration\":\"{dur_val:.6}\"}}",
                    doc.codec_name, doc.width, doc.height, doc.nb_frames
                )
            };
            ok_out(&format!(
                "{{\"streams\":[{stream_json}],\"format\":{{\"format_name\":\"{}\",\"duration\":\"{dur_val:.6}\",\"tags\":{{\"title\":\"{}\"}}}},\"chapters\":[{}]}}\n",
                doc.format_name,
                doc.title,
                chaps_json.join(",")
            ))
        }
        "soffice" | "libreoffice" => {
            if args.iter().any(|a| a == "--version" || a == "--help" || a == "-h") {
                return ok_out("LibreOffice 24.8.0.0 100% virtual office suite\n");
            }
            let mut outdir = cwd.to_string();
            let mut convert_to: Option<String> = None;
            let mut cat_mode = false;
            let mut files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "--outdir" if i + 1 < args.len() => {
                        outdir = resolve_posix_path(cwd, &args[i + 1]);
                        i += 2;
                    }
                    "--convert-to" if i + 1 < args.len() => {
                        convert_to = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--cat" => {
                        cat_mode = true;
                        i += 1;
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
            if cat_mode {
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
                Some(s) => s,
                None => {
                    return err_out(
                        "Error: please specify --convert-to or --cat in headless mode\n",
                        1,
                    )
                }
            };
            let _ = fs.mkdir_all(&outdir);
            let target_ext = conv_spec
                .split(':')
                .next()
                .unwrap_or("pdf")
                .to_ascii_lowercase();
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
                let dest = format!("{}/{stem}.{target_ext}", outdir.trim_end_matches('/'));
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
                        let parts: Vec<&str> = conv_spec.split(':').collect();
                        if parts.len() >= 3
                            && let Some(first_num) = parts[2].split(',').next()
                            && let Ok(code) = first_num.parse::<u8>()
                        {
                            delim = code as char;
                        }
                        let rows = rows_opt.unwrap_or_else(|| {
                            paras
                                .iter()
                                .map(|l| l.split(',').map(|c| c.to_string()).collect())
                                .collect()
                        });
                        let quote_all = conv_spec.ends_with(",true");
                        let mut csv_out = String::new();
                        for r in rows {
                            let formatted_cells: Vec<String> = r
                                .into_iter()
                                .map(|c| {
                                    if quote_all {
                                        format!("\"{c}\"")
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
            }
            ok_out("")
        }
        "wkhtmltopdf" => {
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
            let mut pos_args: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "--title" if i + 1 < args.len() => {
                        title_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-s" | "--page-size" | "-O" | "--orientation" | "-T" | "-B" | "-L" | "-R"
                    | "--margin-top" | "--margin-bottom" | "--margin-left" | "--margin-right"
                    | "--header-left" | "--header-right" | "--header-center" | "--footer-left"
                    | "--footer-right" | "--footer-center" | "--encoding" | "--dpi" | "--zoom"
                        if i + 1 < args.len() =>
                    {
                        i += 2;
                    }
                    "cover" | "toc" | "page" => {
                        i += 1;
                    }
                    a if a == "-" || !a.starts_with('-') => {
                        pos_args.push(a.to_string());
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            if pos_args.len() >= 2 {
                let mut doc = PdfDoc::new();
                for src in &pos_args[..pos_args.len() - 1] {
                    if src.ends_with(".txt") {
                        return err_out("wkhtmltopdf: unsupported .txt input
", 1);
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
                    if let Some((raw_html, base_dir_str)) = raw_and_dir {
                        let base_dir = base_dir_str.as_str();
                        if doc.title.is_empty()
                            && let Some(t) = extract_html_title(&raw_html)
                        {
                            doc.title = t;
                        }
                        for page_html in split_html_pages(&raw_html) {
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
                        }
                    }
                }
                if let Some(t) = title_opt {
                    doc.title = t;
                }
                let dst = resolve_posix_path(cwd, pos_args.last().unwrap());
                let _ = fs.write_file(&dst, &doc.serialize());
            }
            ok_out("")
        }
        "pdfunite" => {
            let non_flags: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            if non_flags.len() >= 2 {
                let mut out_doc = PdfDoc::new();
                for src in &non_flags[..non_flags.len() - 1] {
                    let full = resolve_posix_path(cwd, src);
                    if let Ok(b) = fs.read_file(&full) {
                        let sub = PdfDoc::parse(&b);
                        if out_doc.title.is_empty() {
                            out_doc.title = sub.title;
                        }
                        out_doc.pages.extend(sub.pages);
                    }
                }
                let dst = resolve_posix_path(cwd, non_flags.last().unwrap());
                let _ = fs.write_file(&dst, &out_doc.serialize());
            }
            ok_out("")
        }
        "pdfseparate" => {
            let mut first_p = 1usize;
            let mut last_p: Option<usize> = None;
            let mut pos: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-f" if i + 1 < args.len() => {
                        first_p = args[i + 1].parse().unwrap_or(1);
                        i += 2;
                    }
                    "-l" if i + 1 < args.len() => {
                        last_p = args[i + 1].parse().ok();
                        i += 2;
                    }
                    a if !a.starts_with('-') => {
                        pos.push(a.to_string());
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            if pos.len() >= 2 {
                let src = resolve_posix_path(cwd, &pos[0]);
                let pat = &pos[1];
                if let Ok(b) = fs.read_file(&src) {
                    let doc = PdfDoc::parse(&b);
                    let end_p = last_p.unwrap_or(doc.pages.len()).min(doc.pages.len());
                    for pno in first_p..=end_p {
                        if let Some(pg) = doc.pages.get(pno - 1) {
                            let mut single = PdfDoc::new();
                            single.version = doc.version.clone();
                            single.title = doc.title.clone();
                            single.pages.push(pg.clone());
                            let out_p = resolve_posix_path(cwd, &format_printf_num(pat, pno));
                            let _ = fs.write_file(&out_p, &single.serialize());
                        }
                    }
                }
            }
            ok_out("")
        }
        "qpdf" => {
            if args.iter().any(|a| a == "--show-npages") {
                if let Some(f) = args.iter().find(|a| !a.starts_with('-')) {
                    let full = resolve_posix_path(cwd, f);
                    if let Ok(b) = fs.read_file(&full) {
                        let doc = PdfDoc::parse(&b);
                        return ok_out(&format!("{}\n", doc.pages.len()));
                    }
                }
                return ok_out("1\n");
            }
            if args.iter().any(|a| a == "--check") {
                return ok_out("checking pdf\nNo syntax or stream encoding errors found\n");
            }
            if args.iter().any(|a| a == "--is-encrypted") {
                if let Some(f) = args.iter().find(|a| !a.starts_with('-')) {
                    let full = resolve_posix_path(cwd, f);
                    if let Ok(b) = fs.read_file(&full) {
                        let doc = PdfDoc::parse(&b);
                        if doc.encrypted.is_some() {
                            return ok_out("");
                        }
                    }
                }
                return err_out("", 2);
            }
            if args.iter().any(|a| a == "--json") {
                return ok_out("{\"version\": 2, \"qpdf\": [{\"jsonversion\": 2}, {}]}\n");
            }
            if args.iter().any(|a| a == "--list-attachments") {
                if let Some(f) = args.iter().find(|a| !a.starts_with('-')) {
                    let full = resolve_posix_path(cwd, f);
                    if let Ok(b) = fs.read_file(&full) {
                        let doc = PdfDoc::parse(&b);
                        let mut out = String::new();
                        for (k, fname, _, _) in &doc.attachments {
                            out.push_str(&format!("{k} -> {fname}\n"));
                        }
                        return ok_out(&out);
                    }
                }
                return ok_out("");
            }
            for a in args {
                if let Some(key) = a.strip_prefix("--show-attachment=") {
                    if let Some(f) = args.iter().find(|x| !x.starts_with('-')) {
                        let full = resolve_posix_path(cwd, f);
                        if let Ok(b) = fs.read_file(&full) {
                            let doc = PdfDoc::parse(&b);
                            for (k, fname, _, data) in &doc.attachments {
                                if k == key || fname == key {
                                    return ok_out(&String::from_utf8_lossy(data));
                                }
                            }
                        }
                    }
                    return ok_out("");
                }
            }
            for a in args {
                if let Some(sp) = a.strip_prefix("--split-pages") {
                    let chunk_sz: usize = sp
                        .strip_prefix('=')
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(1);
                    let pos: Vec<&String> = args.iter().filter(|x| !x.starts_with('-')).collect();
                    if pos.len() >= 2 {
                        let src = resolve_posix_path(cwd, pos[0]);
                        let pat = pos[1];
                        if let Ok(b) = fs.read_file(&src) {
                            let doc = PdfDoc::parse(&b);
                            let mut idx = 0usize;
                            while idx < doc.pages.len() {
                                let end = (idx + chunk_sz).min(doc.pages.len());
                                let mut sub = PdfDoc::new();
                                sub.pages = doc.pages[idx..end].to_vec();
                                let label = if chunk_sz > 1 {
                                    format!("{}-{}", idx + 1, end)
                                } else {
                                    format!("{}", idx + 1)
                                };
                                let out_p = resolve_posix_path(cwd, &pat.replace("%d", &label));
                                let _ = fs.write_file(&out_p, &sub.serialize());
                                idx = end;
                            }
                        }
                    }
                    return ok_out("");
                }
            }
            let replace_input = args.iter().any(|a| a == "--replace-input");
            let mut encrypt_pw: Option<String> = None;
            let mut decrypt_mode = false;
            let mut rotations: Vec<(bool, i32, String)> = Vec::new();
            let mut add_att: Option<(String, String, String)> = None;
            let mut overlay_pdf: Option<String> = None;
            let mut page_specs: Vec<(String, String)> = Vec::new();
            let mut pos_files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                let a = &args[i];
                if a == "--encrypt" && i + 3 < args.len() {
                    encrypt_pw = Some(args[i + 1].clone());
                    i += 4;
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
                if let Some(rot_spec) = a.strip_prefix("--rotate=") {
                    if let Some((deg_s, rng_s)) = rot_spec.split_once(':') {
                        let rel = deg_s.starts_with('+') || deg_s.starts_with('-');
                        let deg: i32 = deg_s.trim_start_matches('+').parse().unwrap_or(0);
                        rotations.push((rel, deg, rng_s.to_string()));
                    }
                    i += 1;
                    continue;
                }
                if a == "--add-attachment" && i + 1 < args.len() {
                    let att_file = args[i + 1].clone();
                    let mut key = att_file
                        .rsplit('/')
                        .next()
                        .unwrap_or(&att_file)
                        .to_string();
                    let mut fname = key.clone();
                    i += 2;
                    while i < args.len() && args[i] != "--" {
                        if let Some(k) = args[i].strip_prefix("--key=") {
                            key = k.to_string();
                        } else if let Some(f) = args[i].strip_prefix("--filename=") {
                            fname = f.to_string();
                        }
                        i += 1;
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    add_att = Some((att_file, key, fname));
                    continue;
                }
                if (a == "--overlay" || a == "--underlay") && i + 1 < args.len() {
                    overlay_pdf = Some(args[i + 1].clone());
                    i += 2;
                    while i < args.len() && args[i] != "--" {
                        i += 1;
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    continue;
                }
                if a == "--pages" {
                    i += 1;
                    while i < args.len() && args[i] != "--" {
                        let src_f = args[i].clone();
                        let next_is_range = i + 1 < args.len()
                            && args[i + 1] != "--"
                            && args[i + 1] != "."
                            && !args[i + 1].to_ascii_lowercase().ends_with(".pdf")
                            && args[i + 1]
                                .chars()
                                .next()
                                .map(|c| c.is_ascii_digit() || matches!(c, 'z' | 'r' | 'x'))
                                .unwrap_or(false);
                        let rng = if next_is_range {
                            i += 1;
                            args[i].clone()
                        } else {
                            "1-z".to_string()
                        };
                        page_specs.push((src_f, rng));
                        i += 1;
                    }
                    if i < args.len() && args[i] == "--" {
                        i += 1;
                    }
                    continue;
                }
                if !a.starts_with('-') || a == "-" {
                    pos_files.push(a.clone());
                }
                i += 1;
            }
            if pos_files.is_empty() {
                return ok_out("");
            }
            let primary_in = if pos_files[0] == "-" {
                "-".to_string()
            } else {
                resolve_posix_path(cwd, &pos_files[0])
            };
            let dst_is_stdout = !replace_input
                && (pos_files.len() >= 2 || !page_specs.is_empty())
                && pos_files.last().map(|s| s.as_str()) == Some("-");
            let dst_path = if replace_input {
                primary_in.clone()
            } else if dst_is_stdout {
                "-".to_string()
            } else if pos_files.len() >= 2 || !page_specs.is_empty() {
                resolve_posix_path(cwd, pos_files.last().unwrap())
            } else {
                return ok_out("");
            };
            let mut doc = if primary_in == "-" {
                PdfDoc::parse(&crate::vfs::stream_string_to_bytes(stdin))
            } else {
                fs.read_file(&primary_in)
                    .map(|b| PdfDoc::parse(&b))
                    .unwrap_or_else(|_| PdfDoc::new())
            };
            if !page_specs.is_empty() {
                let mut new_pages = Vec::new();
                for (sf, rng) in &page_specs {
                    let s_full = if sf == "." {
                        primary_in.clone()
                    } else {
                        resolve_posix_path(cwd, sf)
                    };
                    if let Ok(sb) = fs.read_file(&s_full) {
                        let sdoc = PdfDoc::parse(&sb);
                        for pno in parse_qpdf_page_spec(rng, sdoc.pages.len()) {
                            if let Some(pg) = sdoc.pages.get(pno - 1) {
                                new_pages.push(pg.clone());
                            }
                        }
                    }
                }
                if !new_pages.is_empty() {
                    doc.pages = new_pages;
                }
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
            if let Some(pw) = encrypt_pw {
                doc.encrypted = Some(pw);
            }
            if decrypt_mode {
                doc.encrypted = None;
            }
            if args.iter().any(|a| a == "--linearize") {
                doc.linearized = true;
            }
            if let Some((att_p, key, fname)) = add_att {
                let afull = resolve_posix_path(cwd, &att_p);
                if let Ok(ab) = fs.read_file(&afull) {
                    doc.attachments.push((key, fname, String::new(), ab));
                }
            }
            if let Some(ov_p) = overlay_pdf {
                let ofull = resolve_posix_path(cwd, &ov_p);
                if let Ok(ob) = fs.read_file(&ofull) {
                    let odoc = PdfDoc::parse(&ob);
                    let ov_text = odoc
                        .pages
                        .first()
                        .map(|p| p.text.clone())
                        .unwrap_or_default();
                    for pg in &mut doc.pages {
                        pg.text = format!("{}\n{ov_text}", pg.text);
                    }
                }
            }
            let serialized = doc.serialize();
            if dst_path == "-" {
                ok_out(&crate::vfs::bytes_to_stream_string(&serialized))
            } else {
                let _ = fs.write_file(&dst_path, &serialized);
                ok_out("")
            }
        }
        "pdftk" => {
            let mut handles: BTreeMap<String, PdfDoc> = BTreeMap::new();
            let mut input_docs: Vec<PdfDoc> = Vec::new();
            let mut op = String::new();
            let mut op_idx = args.len();
            for (idx, a) in args.iter().enumerate() {
                if matches!(
                    a.as_str(),
                    "cat"
                        | "shuffle"
                        | "dump_data"
                        | "dump_data_utf8"
                        | "update_info"
                        | "update_info_utf8"
                        | "burst"
                        | "attach_files"
                        | "unpack_files"
                        | "stamp"
                        | "background"
                ) {
                    op = a.clone();
                    op_idx = idx;
                    break;
                }
                if let Some((h, path)) = a.split_once('=') {
                    let full = resolve_posix_path(cwd, path);
                    if let Ok(b) = fs.read_file(&full) {
                        let d = PdfDoc::parse(&b);
                        handles.insert(h.to_string(), d.clone());
                        input_docs.push(d);
                    }
                } else if !a.starts_with('-') {
                    let full = resolve_posix_path(cwd, a);
                    if let Ok(b) = fs.read_file(&full) {
                        let d = PdfDoc::parse(&b);
                        if handles.is_empty() {
                            handles.insert("A".to_string(), d.clone());
                        }
                        input_docs.push(d);
                    }
                }
            }
            let format_dump = |doc: &PdfDoc| -> String {
                let mut out = String::new();
                if !doc.title.is_empty() {
                    out.push_str(&format!(
                        "InfoBegin\nInfoKey: Title\nInfoValue: {}\n",
                        doc.title
                    ));
                }
                if !doc.author.is_empty() {
                    out.push_str(&format!(
                        "InfoBegin\nInfoKey: Author\nInfoValue: {}\n",
                        doc.author
                    ));
                }
                for (k, v) in &doc.info {
                    out.push_str(&format!("InfoBegin\nInfoKey: {k}\nInfoValue: {v}\n"));
                }
                out.push_str(&format!("NumberOfPages: {}\n", doc.pages.len()));
                for (t, l, p) in &doc.bookmarks {
                    out.push_str(&format!(
                        "BookmarkBegin\nBookmarkTitle: {t}\nBookmarkLevel: {l}\nBookmarkPageNumber: {p}\n"
                    ));
                }
                for (idx, pg) in doc.pages.iter().enumerate() {
                    out.push_str(&format!(
                        "PageMediaBegin\nPageMediaNumber: {}\nPageMediaRotation: {}\nPageMediaRect: 0 0 612 792\nPageMediaDimensions: 612 792\n",
                        idx + 1,
                        pg.rot
                    ));
                }
                for (ni, st, pf, sy) in &doc.page_labels {
                    out.push_str(&format!(
                        "PageLabelBegin\nPageLabelNewIndex: {ni}\nPageLabelStart: {st}\nPageLabelPrefix: {pf}\nPageLabelNumStyle: {sy}\n"
                    ));
                }
                out
            };
            let primary = input_docs.first().cloned().unwrap_or_else(PdfDoc::new);
            match op.as_str() {
                "dump_data" | "dump_data_utf8" => ok_out(&format_dump(&primary)),
                "update_info" | "update_info_utf8" => {
                    let rest = &args[op_idx + 1..];
                    if !rest.is_empty() {
                        let info_full = resolve_posix_path(cwd, &rest[0]);
                        let mut doc = primary;
                        if let Ok(ib) = fs.read_file(&info_full) {
                            let txt = String::from_utf8_lossy(&ib);
                            doc.info.clear();
                            doc.bookmarks.clear();
                            doc.page_labels.clear();
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
                                         psy: &mut String| {
                                match kind {
                                    "info" if !k.is_empty() => {
                                        if k == "Title" {
                                            doc.title = v.clone();
                                        } else if k == "Author" {
                                            doc.author = v.clone();
                                        } else {
                                            doc.info.push((k.clone(), v.clone()));
                                        }
                                        k.clear();
                                        v.clear();
                                    }
                                    "bm" if !bt.is_empty() => {
                                        doc.bookmarks.push((bt.clone(), bl.clone(), bp.clone()));
                                        bt.clear();
                                        bl.clear();
                                        bp.clear();
                                    }
                                    "pl" if !pni.is_empty() => {
                                        doc.page_labels.push((
                                            pni.clone(),
                                            pst.clone(),
                                            ppf.clone(),
                                            psy.clone(),
                                        ));
                                        pni.clear();
                                        pst.clear();
                                        ppf.clear();
                                        psy.clear();
                                    }
                                    _ => {}
                                }
                            };
                            for line in txt.lines() {
                                let l = line.trim();
                                if l == "InfoBegin" {
                                    flush(
                                        cur_kind, &mut doc, &mut k, &mut v, &mut bt, &mut bl,
                                        &mut bp, &mut pni, &mut pst, &mut ppf, &mut psy,
                                    );
                                    cur_kind = "info";
                                } else if l == "BookmarkBegin" {
                                    flush(
                                        cur_kind, &mut doc, &mut k, &mut v, &mut bt, &mut bl,
                                        &mut bp, &mut pni, &mut pst, &mut ppf, &mut psy,
                                    );
                                    cur_kind = "bm";
                                } else if l == "PageLabelBegin" {
                                    flush(
                                        cur_kind, &mut doc, &mut k, &mut v, &mut bt, &mut bl,
                                        &mut bp, &mut pni, &mut pst, &mut ppf, &mut psy,
                                    );
                                    cur_kind = "pl";
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
                                }
                            }
                            flush(
                                cur_kind, &mut doc, &mut k, &mut v, &mut bt, &mut bl, &mut bp,
                                &mut pni, &mut pst, &mut ppf, &mut psy,
                            );
                        }
                        if let Some(out_pos) = rest.iter().position(|x| x == "output")
                            && out_pos + 1 < rest.len()
                        {
                            let dst = resolve_posix_path(cwd, &rest[out_pos + 1]);
                            let _ = fs.write_file(&dst, &doc.serialize());
                        }
                    }
                    ok_out("")
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
                        single.pages.push(pg.clone());
                        let out_p = resolve_posix_path(cwd, &format_printf_num(&pat, idx + 1));
                        let _ = fs.write_file(&out_p, &single.serialize());
                    }
                    let doc_data_p = format!("{}/doc_data.txt", burst_dir.trim_end_matches('/'));
                    let _ = fs.write_file(&doc_data_p, format_dump(&primary).as_bytes());
                    ok_out("")
                }
                "attach_files" => {
                    let rest = &args[op_idx + 1..];
                    let mut doc = primary;
                    let mut i = 0usize;
                    let mut out_file = None;
                    while i < rest.len() {
                        if rest[i] == "to_page" && i + 1 < rest.len() {
                            i += 2;
                            continue;
                        }
                        if rest[i] == "output" && i + 1 < rest.len() {
                            out_file = Some(rest[i + 1].clone());
                            break;
                        }
                        let afull = resolve_posix_path(cwd, &rest[i]);
                        if let Ok(ab) = fs.read_file(&afull) {
                            let fname = rest[i]
                                .rsplit('/')
                                .next()
                                .unwrap_or(&rest[i])
                                .to_string();
                            doc.attachments
                                .push((fname.clone(), fname, String::new(), ab));
                        }
                        i += 1;
                    }
                    if let Some(of) = out_file {
                        let dst = resolve_posix_path(cwd, &of);
                        let _ = fs.write_file(&dst, &doc.serialize());
                    }
                    ok_out("")
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
                "stamp" | "background" => {
                    let rest = &args[op_idx + 1..];
                    let mut doc = primary;
                    if !rest.is_empty() {
                        let sfull = resolve_posix_path(cwd, &rest[0]);
                        if let Ok(sb) = fs.read_file(&sfull) {
                            let sdoc = PdfDoc::parse(&sb);
                            let stxt = sdoc
                                .pages
                                .first()
                                .map(|p| p.text.clone())
                                .unwrap_or_default();
                            for pg in &mut doc.pages {
                                pg.text = format!("{}\n{stxt}", pg.text);
                            }
                        }
                    }
                    if let Some(pos) = rest.iter().position(|x| x == "output")
                        && pos + 1 < rest.len()
                    {
                        let dst = resolve_posix_path(cwd, &rest[pos + 1]);
                        let _ = fs.write_file(&dst, &doc.serialize());
                    }
                    ok_out("")
                }
                "cat" | "shuffle" => {
                    let rest = &args[op_idx + 1..];
                    let out_pos = rest.iter().position(|x| x == "output").unwrap_or(rest.len());
                    let specs = &rest[..out_pos];
                    let eval_spec = |sp: &str| -> Vec<PdfPage> {
                        if let Some(d) = handles.get(sp) {
                            return d.pages.clone();
                        }
                        let mut s = sp;
                        let mut doc_ref = &primary;
                        if let Some(first_ch) = s.chars().next()
                            && first_ch.is_ascii_uppercase()
                        {
                            let h_key = first_ch.to_string();
                            if let Some(hd) = handles.get(&h_key) {
                                doc_ref = hd;
                                s = &s[1..];
                            }
                        }
                        let mut rot_delta = 0i32;
                        for (suf, deg) in [
                            ("east", 90),
                            ("right", 90),
                            ("south", 180),
                            ("down", 180),
                            ("west", 270),
                            ("left", 270),
                            ("north", 0),
                        ] {
                            if let Some(stripped) = s.strip_suffix(suf) {
                                s = stripped;
                                rot_delta = deg;
                                break;
                            }
                        }
                        let pnos = if s.is_empty() {
                            (1..=doc_ref.pages.len()).collect()
                        } else {
                            parse_qpdf_page_spec(s, doc_ref.pages.len())
                        };
                        let mut res = Vec::new();
                        for pno in pnos {
                            if let Some(pg) = doc_ref.pages.get(pno - 1) {
                                let mut c = pg.clone();
                                c.rot = (c.rot + rot_delta).rem_euclid(360);
                                res.push(c);
                            }
                        }
                        res
                    };
                    let mut out_doc = PdfDoc::new();
                    if specs.is_empty() {
                        for d in &input_docs {
                            if out_doc.title.is_empty() {
                                out_doc.title = d.title.clone();
                            }
                            out_doc.pages.extend(d.pages.clone());
                        }
                    } else if op == "shuffle" {
                        let lists: Vec<Vec<PdfPage>> = specs.iter().map(|s| eval_spec(s)).collect();
                        let max_len = lists.iter().map(|l| l.len()).max().unwrap_or(0);
                        for idx in 0..max_len {
                            for l in &lists {
                                if let Some(pg) = l.get(idx) {
                                    out_doc.pages.push(pg.clone());
                                }
                            }
                        }
                    } else {
                        for s in specs {
                            out_doc.pages.extend(eval_spec(s));
                        }
                    }
                    if out_pos + 1 < rest.len() {
                        let dst = resolve_posix_path(cwd, &rest[out_pos + 1]);
                        let _ = fs.write_file(&dst, &out_doc.serialize());
                    }
                    ok_out("")
                }
                _ => ok_out(""),
            }
        }
        "pdfdetach" => {
            let mut list_mode = false;
            let mut save_all = false;
            let mut save_idx: Option<usize> = None;
            let mut out_target: Option<String> = None;
            let mut pdf_file: Option<String> = None;
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-list" => list_mode = true,
                    "-saveall" => save_all = true,
                    "-save" if i + 1 < args.len() => {
                        i += 1;
                        save_idx = args[i].parse().ok();
                    }
                    "-o" if i + 1 < args.len() => {
                        i += 1;
                        out_target = Some(args[i].clone());
                    }
                    "-upw" | "-opw" | "-enc" if i + 1 < args.len() => {
                        i += 1;
                    }
                    a if !a.starts_with('-') => pdf_file = Some(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if let Some(f) = pdf_file {
                let full = resolve_posix_path(cwd, &f);
                if let Ok(b) = fs.read_file(&full) {
                    let doc = PdfDoc::parse(&b);
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
                            let dst = resolve_posix_path(&base_dir, fname);
                            let _ = fs.write_file(&dst, payload);
                        }
                        return ok_out("");
                    }
                    if let Some(idx1) = save_idx
                        && idx1 >= 1
                        && let Some((_, fname, _, payload)) = doc.attachments.get(idx1 - 1)
                    {
                        let dst = out_target
                            .as_deref()
                            .map(|p| resolve_posix_path(cwd, p))
                            .unwrap_or_else(|| resolve_posix_path(cwd, fname));
                        let _ = fs.write_file(&dst, payload);
                        return ok_out("");
                    }
                }
            }
            ok_out("")
        }
        "pdfinfo" => {
            let show_box = args.iter().any(|a| a == "-box");
            let show_url = args.iter().any(|a| a == "-url");
            let mut files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                if matches!(args[i].as_str(), "-upw" | "-opw" | "-f" | "-l") && i + 1 < args.len() {
                    i += 2;
                    continue;
                }
                if !args[i].starts_with('-') {
                    files.push(args[i].clone());
                }
                i += 1;
            }
            let mut doc = PdfDoc::new();
            if let Some(first) = files.first() {
                let full = resolve_posix_path(cwd, first);
                if let Ok(b) = fs.read_file(&full) {
                    doc = PdfDoc::parse(&b);
                }
            }
            let mut out = String::new();
            if !doc.title.is_empty() {
                out.push_str(&format!("Title:          {}\n", doc.title));
            }
            if !doc.author.is_empty() {
                out.push_str(&format!("Author:         {}\n", doc.author));
            }
            out.push_str(&format!("Pages:          {}\n", doc.pages.len().max(1)));
            out.push_str(&format!(
                "Encrypted:      {}\n",
                if doc.encrypted.is_some() { "yes" } else { "no" }
            ));
            let fmt_pt = |n: f64| -> String {
                let r = (n * 100.0).round() / 100.0;
                if (r - r.round()).abs() < 1e-9 {
                    format!("{}", r.round() as i64)
                } else {
                    format!("{r}")
                }
            };
            let paper = if ((doc.page_w - 612.0).abs() <= 1.0 && (doc.page_h - 792.0).abs() <= 1.0)
                || ((doc.page_w - 792.0).abs() <= 1.0 && (doc.page_h - 612.0).abs() <= 1.0)
            {
                " (letter)"
            } else {
                ""
            };
            out.push_str(&format!(
                "Page size:      {} x {} pts{paper}\n",
                fmt_pt(doc.page_w),
                fmt_pt(doc.page_h)
            ));
            let rot0 = doc.pages.first().map(|p| p.rot).unwrap_or(0);
            out.push_str(&format!("Page rot:       {rot0}\n"));
            out.push_str(&format!("Optimized:      {}\n", if doc.linearized { "yes" } else { "no" }));
            if show_box {
                let bx = format!("0.00     0.00 {:8.2} {:8.2}", doc.page_w, doc.page_h);
                out.push_str(&format!("MediaBox:       {bx}\n"));
                out.push_str(&format!("CropBox:        {bx}\n"));
                out.push_str(&format!("BleedBox:       {bx}\n"));
                out.push_str(&format!("TrimBox:        {bx}\n"));
                out.push_str(&format!("ArtBox:         {bx}\n"));
            }
            out.push_str(&format!("PDF version:    {}\n", doc.version));
            if show_url {
                for pg in &doc.pages {
                    for u in &pg.urls {
                        out.push_str(&format!("{u}\n"));
                    }
                }
            }
            ok_out(&out)
        }
        "pdffonts" => ok_out(
            "name                                 type              encoding         emb sub uni object ID\n------------------------------------ ----------------- ---------------- --- --- --- ---------\nHelvetica                            Type 1            Custom           no  no  no       1  0\nNimbus Sans L                        Type 1            Standard         no  no  no       2  0\n",
        ),
        "pdftotext" => {
            let mut first_p = 1usize;
            let mut last_p: Option<usize> = None;
            let mut bbox_mode = false;
            let mut tsv_mode = false;
            let mut eol_dos = false;
            let mut pos: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-f" if i + 1 < args.len() => {
                        first_p = args[i + 1].parse().unwrap_or(1);
                        i += 2;
                    }
                    "-l" if i + 1 < args.len() => {
                        last_p = args[i + 1].parse().ok();
                        i += 2;
                    }
                    "-eol" if i + 1 < args.len() => {
                        eol_dos = args[i + 1].eq_ignore_ascii_case("dos");
                        i += 2;
                    }
                    "-upw" | "-opw" | "-enc" if i + 1 < args.len() => {
                        i += 2;
                    }
                    "-bbox" | "-bbox-layout" => {
                        bbox_mode = true;
                        i += 1;
                    }
                    "-tsv" => {
                        tsv_mode = true;
                        i += 1;
                    }
                    a if !a.starts_with('-') || a == "-" => {
                        pos.push(a.to_string());
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            let in_arg = pos.first().map(|s| s.as_str()).unwrap_or("-");
            let raw_bytes = if in_arg == "-" {
                crate::vfs::stream_string_to_bytes(stdin)
            } else {
                let full = resolve_posix_path(cwd, in_arg);
                fs.read_file(&full).unwrap_or_default()
            };
            let doc = PdfDoc::parse(&raw_bytes);
            let end_p = last_p.unwrap_or(doc.pages.len()).min(doc.pages.len());
            let mut selected_texts = Vec::new();
            for pno in first_p..=end_p {
                if let Some(pg) = doc.pages.get(pno - 1) {
                    selected_texts.push(pg.text.clone());
                }
            }
            let combined = selected_texts.join("\n");
            let mut rendered = if bbox_mode {
                let mut words_xml = String::new();
                for w in combined.split_whitespace() {
                    words_xml.push_str(&format!(
                        "<word xMin=\"0\" yMin=\"0\" xMax=\"50\" yMax=\"12\">{}</word>\n",
                        html_escape_str(w)
                    ));
                }
                format!(
                    "<!DOCTYPE html>\n<html><head><title>{}</title></head><body><doc><page width=\"612\" height=\"792\"><flow><block xMin=\"0\" yMin=\"0\" xMax=\"100\" yMax=\"20\"><line xMin=\"0\" yMin=\"0\" xMax=\"100\" yMax=\"20\">\n{words_xml}</line></block></flow></page></doc></body></html>\n",
                    html_escape_str(&doc.title)
                )
            } else if tsv_mode {
                let mut tsv = String::from(
                    "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n",
                );
                for (widx, w) in combined.split_whitespace().enumerate() {
                    tsv.push_str(&format!("5\t1\t1\t1\t1\t{}\t0\t0\t50\t12\t100\t{w}\n", widx + 1));
                }
                tsv
            } else {
                format!("{combined}\n")
            };
            if eol_dos {
                rendered = rendered.replace('\n', "\r\n");
            }
            let out_target = if pos.len() >= 2 {
                pos[1].clone()
            } else if in_arg != "-" {
                let stem = in_arg.strip_suffix(".pdf").unwrap_or(in_arg);
                format!("{stem}.txt")
            } else {
                "-".to_string()
            };
            if out_target == "-" {
                ok_out(&rendered)
            } else {
                let dst = resolve_posix_path(cwd, &out_target);
                let _ = fs.write_file(&dst, rendered.as_bytes());
                ok_out("")
            }
        }
        "pdftohtml" => {
            let xml_mode = args.iter().any(|a| a == "-xml");
            let stdout_mode = args.iter().any(|a| a == "-stdout");
            let pos: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            let mut doc = PdfDoc::new();
            if let Some(first) = pos.first() {
                let full = resolve_posix_path(cwd, first);
                if let Ok(b) = fs.read_file(&full) {
                    doc = PdfDoc::parse(&b);
                }
            }
            let body_text: String = doc
                .pages
                .iter()
                .map(|p| p.text.clone())
                .collect::<Vec<_>>()
                .join("\n");
            let rendered = if xml_mode {
                format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<pdf2xml producer=\"poppler\">\n<page number=\"1\" position=\"absolute\" top=\"0\" left=\"0\" height=\"792\" width=\"612\">\n<fontspec id=\"0\" size=\"16\" family=\"Helvetica\" color=\"#000000\"/>\n<text top=\"50\" left=\"50\" width=\"200\" height=\"20\" font=\"0\">{}</text>\n</page>\n</pdf2xml>\n",
                    html_escape_str(&body_text)
                )
            } else {
                format!(
                    "<!DOCTYPE html>\n<html><head><title>{}</title></head><body><p>{}</p></body></html>\n",
                    html_escape_str(&doc.title),
                    html_escape_str(&body_text)
                )
            };
            if stdout_mode || pos.len() < 2 {
                ok_out(&rendered)
            } else {
                let dst = resolve_posix_path(cwd, pos[1]);
                let _ = fs.write_file(&dst, rendered.as_bytes());
                ok_out("")
            }
        }
        "pdftoppm" | "pdftocairo" => {
            let mut ext = "ppm";
            let mut fmt = "PPM";
            let mut singlefile = false;
            let mut first_p = 1usize;
            let mut last_p: Option<usize> = None;
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
                    "-eps" | "-ps" => {
                        ext = "eps";
                        fmt = "EPS";
                    }
                    "-singlefile" => singlefile = true,
                    "-f" if i + 1 < args.len() => {
                        first_p = args[i + 1].parse().unwrap_or(1);
                        i += 1;
                    }
                    "-l" if i + 1 < args.len() => {
                        last_p = args[i + 1].parse().ok();
                        i += 1;
                    }
                    "-r" | "-rx" | "-ry" | "-scale-to" if i + 1 < args.len() => {
                        i += 1;
                    }
                    a if !a.starts_with('-') => pos.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if pos.len() >= 2 {
                let src = resolve_posix_path(cwd, &pos[0]);
                let prefix = resolve_posix_path(cwd, &pos[1]);
                let doc = fs
                    .read_file(&src)
                    .map(|b| PdfDoc::parse(&b))
                    .unwrap_or_else(|_| PdfDoc::new());
                if fmt == "SVG" {
                    let txt = doc
                        .pages
                        .first()
                        .map(|p| p.text.clone())
                        .unwrap_or_default();
                    let svg = format!(
                        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"612\" height=\"792\" viewBox=\"0 0 612 792\"><text x=\"20\" y=\"40\">{}</text></svg>\n",
                        html_escape_str(&txt)
                    );
                    let dst = if prefix.ends_with(".svg") {
                        prefix
                    } else {
                        format!("{prefix}.svg")
                    };
                    let _ = fs.write_file(&dst, svg.as_bytes());
                    return ok_out("");
                }
                if fmt == "EPS" {
                    let eps = "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 612 792\n%%EndComments\n";
                    let dst = if prefix.ends_with(".eps") || prefix.ends_with(".ps") {
                        prefix
                    } else {
                        format!("{prefix}.eps")
                    };
                    let _ = fs.write_file(&dst, eps.as_bytes());
                    return ok_out("");
                }
                let end_p = last_p.unwrap_or(doc.pages.len().max(1)).min(doc.pages.len().max(1));
                let (w, h) = doc
                    .pages
                    .first()
                    .and_then(|p| p.images.first())
                    .map(|(iw, ih, _)| (*iw, *ih))
                    .unwrap_or((612, 792));
                let im = ImageMeta {
                    fmt: fmt.to_string(),
                    w,
                    h,
                    cs: if fmt == "PGM" {
                        "Gray".to_string()
                    } else {
                        "sRGB".to_string()
                    },
                    exif: BTreeMap::new(),
                };
                let bytes = write_image_bytes(&im);
                if singlefile {
                    let dst = format!("{prefix}.{ext}");
                    let _ = fs.write_file(&dst, &bytes);
                } else {
                    for pno in first_p..=end_p {
                        let dst = format!("{prefix}-{pno}.{ext}");
                        let _ = fs.write_file(&dst, &bytes);
                    }
                }
            }
            ok_out("")
        }
        "pdfimages" => {
            let mut list_mode = false;
            let mut page_nums = false;
            let mut print_names = false;
            let mut ext = "png";
            let mut fmt = "PNG";
            let mut first_p: Option<usize> = None;
            let mut last_p: Option<usize> = None;
            let mut pos: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-list" => list_mode = true,
                    "-p" => page_nums = true,
                    "-print-filenames" => print_names = true,
                    "-tiff" => {
                        ext = "tif";
                        fmt = "TIFF";
                    }
                    "-f" if i + 1 < args.len() => {
                        first_p = args[i + 1].parse().ok();
                        i += 1;
                    }
                    "-l" if i + 1 < args.len() => {
                        last_p = args[i + 1].parse().ok();
                        i += 1;
                    }
                    a if !a.starts_with('-') => pos.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if let (Some(f), Some(l)) = (first_p, last_p)
                && f > l
            {
                return err_out("pdfimages: invalid page range\n", 99);
            }
            let mut doc = PdfDoc::new();
            if let Some(first) = pos.first() {
                let full = resolve_posix_path(cwd, first);
                if let Ok(b) = fs.read_file(&full) {
                    doc = PdfDoc::parse(&b);
                }
            }
            let mut all_imgs: Vec<(usize, u32, u32, String)> = Vec::new();
            for (pidx, pg) in doc.pages.iter().enumerate() {
                for (w, h, im_fmt) in &pg.images {
                    all_imgs.push((pidx + 1, *w, *h, im_fmt.clone()));
                }
            }
            if all_imgs.is_empty() {
                all_imgs.push((1, 24, 24, "PNG".to_string()));
            }
            if list_mode {
                let mut out = String::from(
                    "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n--------------------------------------------------------------------------------------------\n",
                );
                for (idx, (pno, w, h, _)) in all_imgs.iter().enumerate() {
                    out.push_str(&format!(
                        "{pno:4}  {idx:4} image  {w:5} {h:6} rgb     3   8  image  no         5  0    72    72 128B  10%\n"
                    ));
                }
                return ok_out(&out);
            }
            if pos.len() >= 2 {
                let prefix = &pos[1];
                let mut out = String::new();
                for (idx, (pno, w, h, _)) in all_imgs.iter().enumerate() {
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
                return ok_out(&out);
            }
            ok_out("")
        }
        "magick" | "convert" | "mogrify" => {
            if (cmd == "magick" || cmd == "convert")
                && let Some(first) = args.first()
                && (first == "identify" || first == "mogrify" || first == "convert")
            {
                return cmd_media_doc(first, &args[1..], stdin, cwd, fs);
            }
            let is_mogrify = cmd == "mogrify";
            let mut size_opt: Option<(u32, u32)> = None;
            let mut resize_opt: Option<(u32, u32)> = None;
            let mut crop_opt: Option<(u32, u32)> = None;
            let mut rot_deg = 0i32;
            let mut gray_cs = false;
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
                    "-resize" if i + 1 < args.len() => {
                        let s = args[i + 1].trim_end_matches(['!', '>', '<']);
                        if let Some((ws, hs)) = s.split_once('x') {
                            resize_opt = Some((ws.parse().unwrap_or(32), hs.parse().unwrap_or(32)));
                        }
                        i += 2;
                    }
                    "-crop" if i + 1 < args.len() => {
                        let s = args[i + 1].split('+').next().unwrap_or("");
                        if let Some((ws, hs)) = s.split_once('x') {
                            crop_opt = Some((ws.parse().unwrap_or(32), hs.parse().unwrap_or(32)));
                        }
                        i += 2;
                    }
                    "-rotate" if i + 1 < args.len() => {
                        rot_deg += args[i + 1].parse::<i32>().unwrap_or(0);
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
                    | "-border" | "-extent"
                        if i + 1 < args.len() =>
                    {
                        i += 2;
                    }
                    a if !a.starts_with('-')
                        && !a.starts_with("xc:")
                        && !a.starts_with("canvas:")
                        && !a.starts_with("gradient:") =>
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
                if let Some((rw, rh)) = resize_opt {
                    meta.w = rw;
                    meta.h = rh;
                }
                if rot_deg.rem_euclid(180) != 0 {
                    std::mem::swap(&mut meta.w, &mut meta.h);
                }
                if let Some((cw, ch)) = crop_opt {
                    meta.w = cw;
                    meta.h = ch;
                }
                if gray_cs {
                    meta.cs = "Gray".to_string();
                }
            };
            if is_mogrify {
                for f in &pos_files {
                    let full = resolve_posix_path(cwd, f);
                    let mut meta = fs
                        .read_file(&full)
                        .map(|b| read_image_meta(&b, &full))
                        .unwrap_or_else(|_| read_image_meta(&[], &full));
                    apply_ops(&mut meta);
                    let _ = fs.write_file(&full, &write_image_bytes(&meta));
                }
                return ok_out("");
            }
            if let Some(out_rel) = pos_files.last() {
                let out_full = resolve_posix_path(cwd, out_rel);
                let mut meta = if pos_files.len() >= 2 {
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
        "identify" => {
            let mut fmt_opt: Option<String> = None;
            let mut files: Vec<String> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                if args[i] == "-format" && i + 1 < args.len() {
                    fmt_opt = Some(args[i + 1].clone());
                    i += 2;
                    continue;
                }
                if !args[i].starts_with('-') {
                    files.push(args[i].clone());
                }
                i += 1;
            }
            let mut out = String::new();
            for f in &files {
                let full = resolve_posix_path(cwd, f);
                let bytes = fs.read_file(&full).unwrap_or_default();
                let meta = read_image_meta(&bytes, &full);
                if let Some(ref fmt_str) = fmt_opt {
                    let fname = f.rsplit('/').next().unwrap_or(f);
                    let rendered = fmt_str
                        .replace("%m", &meta.fmt)
                        .replace("%w", &meta.w.to_string())
                        .replace("%h", &meta.h.to_string())
                        .replace("%[width]", &meta.w.to_string())
                        .replace("%[height]", &meta.h.to_string())
                        .replace("%[fx:w]", &meta.w.to_string())
                        .replace("%[fx:h]", &meta.h.to_string())
                        .replace("%[colorspace]", &meta.cs)
                        .replace("%b", &format!("{}B", bytes.len()))
                        .replace("%f", fname)
                        .replace("\\n", "\n")
                        .replace("\\t", "\t");
                    out.push_str(&rendered);
                } else {
                    out.push_str(&format!(
                        "{f} {} {}x{} {}x{}+0+0 8-bit {}\n",
                        meta.fmt, meta.w, meta.h, meta.w, meta.h, meta.cs
                    ));
                }
            }
            ok_out(&out)
        }
        "sips" => {
            let mut get_props: Vec<String> = Vec::new();
            let mut one_line = false;
            let mut has_mod = false;
            let mut out_path: Option<String> = None;
            let mut files: Vec<String> = Vec::new();
            let mut ops: Vec<(&str, String, String)> = Vec::new();
            let mut i = 0usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-1" | "--oneLine" => {
                        one_line = true;
                        i += 1;
                    }
                    "-g" | "--getProperty" if i + 1 < args.len() => {
                        get_props.push(args[i + 1].clone());
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
            if !get_props.is_empty() {
                let mut out = String::new();
                for f in &files {
                    let full = resolve_posix_path(cwd, f);
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
                            for k in meta.exif.keys() {
                                expanded_props.push(k.clone());
                            }
                        } else {
                            expanded_props.push(p.clone());
                        }
                    }
                    let mut kvs = Vec::new();
                    for p in &expanded_props {
                        let val = match p.as_str() {
                            "pixelWidth" => meta.w.to_string(),
                            "pixelHeight" => meta.h.to_string(),
                            "format" => fmt_lower.clone(),
                            "typeIdentifier" => format!("public.{fmt_lower}"),
                            "space" => "RGB".to_string(),
                            other => meta.exif.get(other).cloned().unwrap_or_default(),
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
                return ok_out(&out);
            }
            for f in &files {
                let in_full = resolve_posix_path(cwd, f);
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
                                meta.fmt = a2.to_ascii_uppercase();
                            } else if a1 != "formatOptions" {
                                meta.exif.insert(a1.clone(), a2.clone());
                            }
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
            ok_out("")
        }
        "exiftool" => {
            let json_mode = args.iter().any(|a| a == "-j");
            let s3_mode = args.iter().any(|a| a == "-s3");
            let tab_mode = args.iter().any(|a| a == "-T");
            let csv_mode = args.iter().any(|a| a == "-csv");
            let xml_mode = args.iter().any(|a| a == "-X");
            let overwrite_orig = args.iter().any(|a| a == "-overwrite_original");
            let mut updates: Vec<(String, String)> = Vec::new();
            let mut requested_tags: Vec<String> = Vec::new();
            let mut files: Vec<String> = Vec::new();
            let mut out_path: Option<String> = None;
            let mut tags_from_file: Option<String> = None;
            let mut i = 0usize;
            while i < args.len() {
                let a = &args[i];
                if a == "-o" && i + 1 < args.len() {
                    out_path = Some(args[i + 1].clone());
                    i += 2;
                    continue;
                }
                if a == "-tagsFromFile" && i + 1 < args.len() {
                    tags_from_file = Some(args[i + 1].clone());
                    i += 2;
                    continue;
                }
                if let Some(rest) = a.strip_prefix('-') {
                    if let Some((k, v)) = rest.split_once('=') {
                        let clean_k = k.trim_end_matches('+').trim_end_matches('-');
                        updates.push((clean_k.to_string(), v.to_string()));
                    } else if !matches!(
                        rest,
                        "j" | "s3" | "T" | "csv" | "X" | "overwrite_original" | "q" | "n"
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
                    let src_text = String::from_utf8_lossy(&src_bytes);
                    for line in src_text.lines() {
                        if let Some(kv) = line.strip_prefix("__EXIF__:")
                            && let Some((k, v)) = kv.split_once('=')
                            && !v.is_empty()
                        {
                            updates.push((k.to_string(), v.to_string()));
                        }
                    }
                }
            }
            if !updates.is_empty() {
                for f in &files {
                    let full = resolve_posix_path(cwd, f);
                    let mut data = fs.read_file(&full).unwrap_or_default();
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
                }
                return ok_out("    1 image files updated\n");
            }
            let read_all_tags = |f: &str| -> BTreeMap<String, String> {
                let full = resolve_posix_path(cwd, f);
                let data = fs.read_file(&full).unwrap_or_default();
                let mut map = BTreeMap::new();
                map.insert("SourceFile".to_string(), f.to_string());
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
                    for (k, v) in pdf.exif {
                        map.insert(k, v);
                    }
                } else {
                    let im = read_image_meta(&data, &full);
                    map.insert(
                        "MIMEType".to_string(),
                        format!("image/{}", im.fmt.to_ascii_lowercase()),
                    );
                    map.insert("FileType".to_string(), im.fmt);
                    map.insert("ImageWidth".to_string(), im.w.to_string());
                    map.insert("ImageHeight".to_string(), im.h.to_string());
                    for (k, v) in im.exif {
                        map.insert(k, v);
                    }
                }
                map
            };
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
                for (k, v) in &map {
                    out.push_str(&format!("{k:<32}: {v}\n"));
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
                    Some(format!(
                        "{:.2}:{:.2}:{}:{lines:?}:{:?}",
                        doc.page_w, doc.page_h, pg.rot, pg.images
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
            let root = match parse_svg_xml(&src) {
                Ok(r) => r,
                Err(e) => return err_out(&format!("rsvg-convert: {e}\n"), 1),
            };
            let mut vb_w = 300.0f64;
            let mut vb_h = 150.0f64;
            if let Some(vb) = root.get_attr("viewBox") {
                let nums: Vec<f64> = vb
                    .split(|c: char| matches!(c, ',' | ' ' | '\t' | '\r' | '\n'))
                    .filter(|s| !s.is_empty())
                    .filter_map(|s| s.parse::<f64>().ok())
                    .collect();
                if nums.len() != 4 || nums[2] <= 0.0 || nums[3] <= 0.0 {
                    return err_out("rsvg-convert: Invalid SVG viewBox\n", 1);
                }
                vb_w = nums[2];
                vb_h = nums[3];
            }
            let width = match parse_svg_length_px(root.get_attr("width"), vb_w) {
                Ok(v) if v > 0.0 => v,
                _ => return err_out("rsvg-convert: Invalid SVG width\n", 1),
            };
            let height = match parse_svg_length_px(root.get_attr("height"), vb_h) {
                Ok(v) if v > 0.0 => v,
                _ => return err_out("rsvg-convert: Invalid SVG height\n", 1),
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
                let mut texts = Vec::new();
                collect_svg_texts(&root, &mut texts);
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
            let mut data = if let Some(op) = operand_opt {
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
