"""Generate portable offset facts from the authenticated reference TZif directory."""
import argparse
import hashlib
import json
import pathlib
import struct


def future(text):
    at = 0

    def name():
        nonlocal at
        start = at
        if text[at] == '<':
            at = text.index('>', at) + 1
        else:
            while at < len(text) and text[at].isalpha():
                at += 1
        assert at > start

    def number():
        nonlocal at
        start = at
        while at < len(text) and text[at].isdigit():
            at += 1
        assert at > start
        return int(text[start:at])

    def seconds():
        nonlocal at
        sign = 1
        if text[at] in '+-':
            if text[at] == '-':
                sign = -1
            at += 1
        result = number() * 3600
        if at < len(text) and text[at] == ':':
            at += 1
            result += number() * 60
            if at < len(text) and text[at] == ':':
                at += 1
                result += number()
        return sign * result

    def rule():
        nonlocal at
        assert text[at:at + 2] == ',M'
        at += 2
        month = number()
        assert text[at] == '.'
        at += 1
        week = number()
        assert text[at] == '.'
        at += 1
        day = number()
        time = 7200
        if at < len(text) and text[at] == '/':
            at += 1
            time = seconds()
        assert 1 <= month <= 12 and 1 <= week <= 5 and 0 <= day <= 6
        return [month, week, day, time]

    name()
    standard = -seconds()
    if at == len(text):
        return standard
    name()
    daylight = standard + 3600 if text[at] == ',' else -seconds()
    start, end = rule(), rule()
    assert at == len(text), text
    return [standard, daylight, start, end]


def read(data):
    def header(at):
        assert data[at:at + 4] == b'TZif'
        return struct.unpack_from('>6I', data, at + 20)

    ut, std, leap, count, types, chars = header(0)
    at = 44 + count * 5 + types * 6 + chars + leap * 8 + std + ut
    assert data[4:5] in [b'2', b'3', b'4']
    ut, std, leap, count, types, chars = header(at)
    at += 44
    transitions = struct.unpack_from('>' + 'q' * count, data, at)
    at += count * 8
    indexes = data[at:at + count]
    at += count
    offsets = [struct.unpack_from('>i', data, at + i * 6)[0] for i in range(types)]
    at += types * 6 + chars + leap * 12 + std + ut
    tail = data[at:].decode('ascii')
    assert tail.startswith('\n') and tail.endswith('\n') and leap == 0
    return [offsets[0], [[time, offsets[index]] for time, index in zip(transitions, indexes)], future(tail[1:-1])]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zoneinfo', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    zones, profiles, identities = {}, [], {}
    seen = {}
    for path in sorted(args.zoneinfo.rglob('*')):
        relative = path.relative_to(args.zoneinfo)
        if relative.parts[0] in ['posix', 'right'] or str(relative) in ['localtime', 'posixrules'] or not path.is_file():
            continue
        data = path.read_bytes()
        if data[:4] != b'TZif':
            continue
        profile = read(data)
        identity = json.dumps(profile, separators=(',', ':'))
        if identity not in seen:
            seen[identity] = len(profiles)
            profiles.append(profile)
        zones[str(relative)] = seen[identity]
        identities[str(relative)] = hashlib.sha256(data).hexdigest()
    inventory_hash = hashlib.sha256(json.dumps(identities, sort_keys=True).encode()).hexdigest()
    if inventory_hash != 'c5d2b3e05c4a76362ebd3c5e8884680d0a696fe872277303acb268f5c4e99b3e':
        raise ValueError('Timezone input differs from the authenticated tzdb 2026c profile')
    output = '// Generated from pinned tzdb 2026c TZif; see timezones-NOTICE.md.\n'
    output += 'import type { TimezoneProfile } from "./timezones.js";\n'
    output += 'export const timezoneNames: Readonly<Record<string, number>> = ' + json.dumps(zones, separators=(',', ':')) + ';\n'
    output += 'export const timezoneProfiles: readonly TimezoneProfile[] = [\n'
    output += ',\n'.join(json.dumps(profile, separators=(',', ':')) for profile in profiles) + '\n];\n'
    args.output.write_text(output)
    print(json.dumps({'zones': len(zones), 'profiles': len(profiles), 'tzifIdentitiesSha256': inventory_hash, 'outputSha256': hashlib.sha256(output.encode()).hexdigest()}))


if __name__ == '__main__':
    main()
