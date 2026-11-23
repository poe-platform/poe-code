use super::super::{
    adts,
    media_probe::{self, Codec, Packet, ProbeOptions, StreamInfo},
};
use super::h264;
use std::collections::BTreeMap;
type Result<T> = std::result::Result<T, &'static str>;

pub(in super::super) fn framing(b: &[u8]) -> Result<(usize, usize)> {
    for (stride, skip) in [(188, 0), (192, 4)] {
        if b.len() >= stride
            && b[skip] == 0x47
            && (b.len() < 2 * stride || b[stride + skip] == 0x47)
        {
            return Ok((stride, skip));
        }
    }
    Err("Invalid MPEG-TS stream: missing 0x47 sync byte")
}
fn timestamp(b: &[u8]) -> i64 {
    (i64::from(b[0] & 14) << 29)
        | (i64::from(b[1]) << 22)
        | (i64::from(b[2] >> 1) << 15)
        | (i64::from(b[3]) << 7)
        | i64::from(b[4] >> 1)
}
struct Pes {
    stream_id: u8,
    emitted_at: usize,
    corrupt: bool,
    pts: i64,
    dts: i64,
    start: usize,
    end: usize,
}
#[derive(Default)]
struct Stream {
    last_cc: Option<u8>,
    corrupt: bool,
    current: Vec<u8>,
    data: Vec<u8>,
    packets: Vec<Pes>,
}
impl Stream {
    fn flush(&mut self, emitted_at: usize, budget: &mut usize) -> Result<bool> {
        let b = &self.current;
        let mut first = false;
        if b.starts_with(&[0, 0, 1])
            && b.len() >= 9
            && let Some(es) = b.get(9 + usize::from(b[8])..)
        {
            let flags = b[7] >> 6;
            let pts = if flags >= 2 && b.len() >= 14 {
                timestamp(&b[9..])
            } else {
                0
            };
            let dts = if flags == 3 && b.len() >= 19 {
                timestamp(&b[14..])
            } else {
                pts
            };
            first = self.packets.is_empty();
            *budget = budget
                .checked_sub(size_of::<Pes>())
                .ok_or("sample index exceeds memory budget")?;
            let start = self.data.len();
            self.data.extend_from_slice(es);
            self.packets.push(Pes {
                stream_id: b[3],
                emitted_at,
                corrupt: self.corrupt || {
                    let length = usize::from(u16::from_be_bytes([b[4], b[5]]));
                    length != 0 && length + 6 != b.len()
                },
                pts,
                dts,
                start,
                end: self.data.len(),
            });
        }
        self.current.clear();
        self.corrupt = false;
        Ok(first)
    }
}
fn streams(bytes: &[u8], budget: &mut usize) -> Result<Vec<(u8, Stream)>> {
    let (stride, skip) = framing(bytes)?;
    let mut streams: Vec<(u16, Stream)> = Vec::new();
    let mut pids = BTreeMap::new();
    let mut types = BTreeMap::new();
    let mut order = Vec::new();
    let mut declared = Vec::new();
    let mut pmt = 0x1000;
    for (slot_index, slot) in bytes.chunks_exact(stride).enumerate() {
        let b = &slot[skip..];
        if b[0] != 0x47 {
            continue;
        }
        let start = b[1] & 0x40 != 0;
        let pid = u16::from_be_bytes([b[1] & 31, b[2]]);
        let control = b[3] >> 4 & 3;
        if control == 0 || pid == 0x1fff {
            continue;
        }
        let at = if control & 2 != 0 {
            5 + usize::from(b[4])
        } else {
            4
        };
        let Some(payload) = b.get(at..) else {
            continue;
        };
        if pid == 0 || pid == pmt {
            if payload.is_empty() {
                continue;
            }
            let pointer = if start {
                usize::from(payload[0]) + 1
            } else {
                0
            };
            let Some(s) = payload.get(pointer..).filter(|s| s.len() >= 12) else {
                continue;
            };
            let end = (3 + usize::from(u16::from_be_bytes([s[1] & 15, s[2]])))
                .saturating_sub(4)
                .min(s.len());
            if pid == 0 && s[0] == 0 {
                for e in s[..end].get(8..).unwrap_or_default().chunks_exact(4) {
                    if e[..2] != [0, 0] {
                        pmt = u16::from_be_bytes([e[2] & 31, e[3]]);
                    }
                }
            } else if pid != 0 && s[0] == 2 && s.len() >= 16 {
                let mut pos = 12 + usize::from(u16::from_be_bytes([s[10] & 15, s[11]]));
                while pos + 5 <= end {
                    let e = &s[pos..];
                    let pid = u16::from_be_bytes([e[1] & 31, e[2]]);
                    if !declared.contains(&pid) {
                        declared.push(pid);
                    }
                    types.insert(pid, e[0]);
                    pos += 5 + usize::from(u16::from_be_bytes([e[3] & 15, e[4]]));
                }
            }
            continue;
        }
        if start
            && payload.starts_with(&[0, 0, 1])
            && let Some(&id) = payload.get(3)
        {
            match id {
                0xe0..=0xef => {
                    types.entry(pid).or_insert(0x1b);
                }
                0xc0..=0xdf => {
                    types.entry(pid).or_insert(0xf);
                }
                _ => (),
            }
        }
        let index = if let Some(&idx) = pids.get(&pid) {
            idx
        } else {
            *budget = budget
                .checked_sub(size_of::<Stream>())
                .ok_or("stream index exceeds memory budget")?;
            let idx = streams.len();
            streams.push((pid, Stream::default()));
            pids.insert(pid, idx);
            idx
        };
        let st = &mut streams[index].1;
        let cc = b[3] & 15;
        let discontinuity = control & 2 != 0 && b[4] != 0 && b[5] & 0x80 != 0;
        st.corrupt |= b[1] & 0x80 != 0
            || !discontinuity
                && st
                    .last_cc
                    .is_some_and(|last| (last + (control & 1)) & 15 != cc);
        st.last_cc = Some(cc);
        if control & 1 == 0 {
            continue;
        }
        if start && st.flush(slot_index * stride, budget)? {
            order.push(index);
        }
        st.current.extend_from_slice(payload);
        if st.current.len() >= 6 {
            let length = usize::from(u16::from_be_bytes([st.current[4], st.current[5]]));
            if length != 0 && st.current.len() >= length + 6 {
                st.current.truncate(length + 6);
                if st.flush(slot_index * stride, budget)? {
                    order.push(index);
                }
            }
        }
    }
    for (idx, (_, s)) in streams.iter_mut().enumerate() {
        if s.flush(bytes.len(), budget)? {
            order.push(idx);
        }
    }
    // Stream indexes follow the program map, regardless of PES buffering.
    order.sort_by_key(|&idx| {
        declared
            .iter()
            .position(|&pid| pid == streams[idx].0)
            .unwrap_or(declared.len() + idx)
    });
    Ok(order
        .into_iter()
        .map(|idx| {
            let (pid, s) = &mut streams[idx];
            (types.get(pid).copied().unwrap_or(0x1b), std::mem::take(s))
        })
        .collect())
}
// MP4 sample tables represent time as successive 32-bit durations. Keep the
// source clock when it cannot be reconstructed from those tables.
pub(super) struct Description {
    pub packets: Vec<Packet>,
    pub ticks: u64,
    pub avcc: Vec<u8>,
}
#[derive(Clone, Copy)]
pub(super) struct PacketInfo {
    pub stream_id: u8,
    pub emitted_at: usize,
    pub corrupt: bool,
}
pub(super) struct Track {
    pub info: StreamInfo,
    pub packets: Vec<Packet>,
    pub packet_info: Vec<PacketInfo>,
    pub data: Vec<u8>,
    pub config: Vec<u8>,
    pub object: u8,
    pub kind: &'static str,
    ordinal: usize,
}
#[derive(PartialEq, Clone, Copy)]
pub(super) enum Read {
    Summary,
    Packets,
    Payloads,
}
pub(super) fn parse(bytes: &[u8], limit: usize, mode: Read) -> Result<Vec<Track>> {
    let mut budget = limit;
    let mut payload_budget = limit;
    let mut tracks = Vec::new();
    let mut ordinals = [0, 0];
    for (ty, stream) in streams(bytes, &mut budget)? {
        let mut packets = Vec::new();
        let mut packet_info = Vec::new();
        let mut config = Vec::new();
        let mut object = 2;
        let mut data = Vec::new();
        let mut append = |part: &[u8]| -> Result<()> {
            if mode == Read::Payloads {
                payload_budget = payload_budget
                    .checked_sub(part.len())
                    .ok_or("input byte limit exceeded")?;
                data.extend_from_slice(part);
            }
            Ok(())
        };
        let (mut total, mut count, mut start, mut size, mut has_cts) = (0., 0, 0, 0, false);
        let mut push = |pts, dts, ticks: i64, bytes: usize, key, info| -> Result<()> {
            if count == 0 {
                start = pts;
            }
            has_cts |= pts != dts;
            if mode != Read::Summary {
                budget = budget
                    .checked_sub(size_of::<Packet>())
                    .ok_or("sample index exceeds memory budget")?;
                packets.push(Packet {
                    pts,
                    dts,
                    ticks: ticks as f64,
                    size: bytes as u64,
                    pos: size,
                    key,
                });
                if mode == Read::Packets {
                    budget = budget
                        .checked_sub(size_of::<PacketInfo>() + size_of::<(usize, usize)>())
                        .ok_or("sample index exceeds memory budget")?;
                    packet_info.push(info);
                }
            }
            total += ticks as f64;
            size += bytes as u64;
            count += 1;
            Ok(())
        };
        let (codec, scale, profile, kind, ki) = match ty {
            0x1b | 0x24 => {
                let mut seq = None;
                let mut sets = [&[][..]; 2];
                let mut last_ticks = 0;
                let base = |s: &Pes| if s.dts == 0 { s.pts } else { s.dts };
                let origin = base(&stream.packets[0]);
                for (i, s) in stream.packets.iter().enumerate() {
                    let payload = &stream.data[s.start..s.end];
                    let (mut n, mut key, mut sps) = (0, i == 0, None);
                    for nal in h264::nals(payload) {
                        match nal[0] & 31 {
                            7 => {
                                sets[0] = payload;
                                sps.get_or_insert(nal);
                            }
                            8 => sets[1] = payload,
                            9 => (),
                            t => {
                                append(&(nal.len() as u32).to_be_bytes())?;
                                append(nal)?;
                                n += 4 + nal.len();
                                key |= t == 5;
                            }
                        }
                    }
                    if n == 0 {
                        append(payload)?;
                    }
                    if let Some(sps) = sps {
                        seq = h264::Sequence::parse::<true>(sps);
                    }
                    let dts = (base(s) - origin).max(0);
                    let ticks = if let Some(next) = stream.packets.get(i + 1) {
                        (base(next) - origin - dts).max(1)
                    } else if i > 0 {
                        last_ticks
                    } else {
                        (90000. / seq.as_ref().and_then(|s| s.fps).unwrap_or(30.))
                            .round()
                            .max(1.) as i64
                    };
                    push(
                        (s.pts - origin).max(0),
                        dts,
                        ticks,
                        if n == 0 { payload.len() } else { n },
                        key,
                        PacketInfo {
                            stream_id: s.stream_id,
                            corrupt: stream.packets.get(i + 1).is_some_and(|next| next.corrupt),
                            // The video parser needs the next access unit before it
                            // releases this one. Its last unit drains after demux EOF.
                            emitted_at: stream
                                .packets
                                .get(i + 1)
                                .map_or(bytes.len() + 1, |next| next.emitted_at),
                        },
                    )?;
                    last_ticks = ticks;
                }
                let (w, h, p) = seq.map_or((320, 240, "Baseline".into()), |s| {
                    (s.width, s.height, s.profile)
                });
                if mode == Read::Payloads {
                    config = h264::collected_config(sets, i64::from(w), h, 30., &mut budget)?;
                }
                (
                    Codec::Video {
                        tag: if ty == 0x24 { b"hvc1" } else { b"avc1" },
                        width: Some(w.into()),
                        height: Some(h),
                    },
                    90000,
                    Some(p),
                    "video",
                    0,
                )
            }
            0xf | 3 | 4 => {
                let mut frames = adts::Frames::new(&stream.data);
                let mut dts = 0;
                let mut pes = stream.packets.iter().peekable();
                let mut current = &stream.packets[0];
                for f in frames.by_ref() {
                    let offset = f.as_ptr().addr() - stream.data.as_ptr().addr();
                    while pes.peek().is_some_and(|s| s.start <= offset) {
                        current = pes.next().unwrap();
                    }
                    append(f)?;
                    push(
                        dts,
                        dts,
                        1024,
                        f.len(),
                        true,
                        PacketInfo {
                            stream_id: current.stream_id,
                            corrupt: current.corrupt,
                            emitted_at: current.emitted_at,
                        },
                    )?;
                    dts += 1024;
                }
                if dts == 0 {
                    for s in &stream.packets {
                        append(&stream.data[s.start..s.end])?;
                        push(
                            dts,
                            dts,
                            1024,
                            s.end - s.start,
                            true,
                            PacketInfo {
                                stream_id: s.stream_id,
                                corrupt: s.corrupt,
                                emitted_at: s.emitted_at,
                            },
                        )?;
                        dts += 1024;
                    }
                }
                object = frames.object;
                (
                    Codec::Audio {
                        tag: if ty == 0xf { b"mp4a" } else { b".mp3" },
                        rate: frames.rate,
                        channels: frames.channels.into(),
                        bits: 16,
                        profile: true,
                    },
                    frames.rate,
                    None,
                    "audio",
                    1,
                )
            }
            _ => continue,
        };
        let ordinal = ordinals[ki];
        ordinals[ki] += 1;
        tracks.push(Track {
            kind,
            data,
            config,
            object,
            ordinal,
            packets,
            packet_info,
            info: StreamInfo {
                codec,
                scale,
                start,
                ticks: total,
                sample_ticks: total,
                id: tracks.len() as u64 + 1,
                language: "und".into(),
                profile,
                count,
                payload_bytes: size,
                has_cts,
            },
        });
    }
    Ok(tracks)
}
pub(in super::super) fn report(
    bytes: &[u8],
    name: &str,
    limit: usize,
    opts: ProbeOptions<'_>,
) -> Result<String> {
    let tracks = parse(
        bytes,
        limit,
        if opts.show.contains("packet") || opts.show.contains("frame") {
            Read::Packets
        } else {
            Read::Summary
        },
    )?;
    let (counts, select) = (opts.counts, opts.select);
    let count: usize = tracks.iter().map(|t| t.packets.len()).sum();
    if count > limit / size_of::<(usize, usize)>() {
        return Err("sample index exceeds memory budget");
    }
    let mut order: Vec<_> = tracks
        .iter()
        .enumerate()
        .flat_map(|(i, t)| (0..t.packets.len()).map(move |n| (i, n)))
        .collect();
    order.sort_unstable_by_key(|&(i, n)| (tracks[i].packet_info[n].emitted_at, i, n));
    let tracks = &tracks;
    media_probe::report(opts, |section| match section {
        "packet" | "frame" => Box::new(order.iter().filter_map(move |&(i, n)| {
            let t = &tracks[i];
            if !media_probe::selected(select, t.kind, i, t.ordinal) {
                return None;
            }
            let mut row = t
                .info
                .codec
                .record(i, t.info.scale, t.packets[n], section == "frame");
            if section == "packet" {
                t.packet_info[n].add_to(&mut row);
            }
            Some(row)
        })),
        "stream" => Box::new(
            tracks
                .iter()
                .enumerate()
                .filter(|(i, t)| media_probe::selected(select, t.kind, *i, t.ordinal))
                .map(|(i, t)| t.info.stream(i, counts)),
        ),
        "format" => Box::new(std::iter::once(media_probe::format_row(
            name,
            bytes.len(),
            ("mpegts", "MPEG-TS (MPEG-2 Transport Stream)"),
            tracks.len(),
            tracks
                .iter()
                .map(|t| t.info.ticks / f64::from(t.info.scale))
                .fold(0., f64::max),
            vec![],
        ))),
        _ => Box::new(std::iter::empty()),
    })
}

impl PacketInfo {
    pub fn add_to(self, row: &mut media_probe::Row) {
        use crate::commands::structured::JVal::{Array, Number, Object, Str};
        if self.corrupt {
            if let Some((_, Str(flags))) = row.iter_mut().find(|(key, _)| *key == "flags") {
                flags.pop();
                flags.push('C');
            }
        }
        row.push((
            "side_data_list",
            Array(vec![Object(vec![
                ("side_data_type".into(), Str("MPEGTS Stream ID".into())),
                ("id".into(), Number(f64::from(self.stream_id), None)),
            ])]),
        ));
    }
}
