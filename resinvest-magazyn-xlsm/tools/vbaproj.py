"""
Budowanie projektu VBA (xl/vbaProject.bin) bez Excela.

* MS-CFB  — zapis pliku złożonego (Compound File Binary, wersja 3, sektory 512 B, ministrumień 64 B),
* MS-OVBA — kompresja źródeł modułów, strumienie dir / PROJECT / PROJECTwm.

Zasada: moduły zapisujemy wyłącznie jako ŹRÓDŁO (MODULEOFFSET = 0, bez p-kodu) i podmieniamy
_VBA_PROJECT na nagłówek w wersji 0xFFFF — Excel przy otwarciu nie znajduje zgodnego p-kodu
i kompiluje projekt ze źródeł. Strumienie __SRP_* (pamięć podręczna wydajności) są pomijane.
Projektanci formularzy (magazyny frmDane, frmDodatkowe) są kopiowane bez zmian.
"""
import struct
import olefile
from oletools.olevba import decompress_stream

ENDOFCHAIN, FREESECT, FATSECT, NOSTREAM = 0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFD, 0xFFFFFFFF


# --------------------------------------------------------------------------- MS-OVBA kompresja
def _copy_token_help(decompressed_current, decompressed_chunk_start):
    difference = decompressed_current - decompressed_chunk_start
    bit_count = max((difference - 1).bit_length(), 4)
    length_mask = 0xFFFF >> bit_count
    offset_mask = (~length_mask) & 0xFFFF
    maximum_length = (0xFFFF >> bit_count) + 3
    return length_mask, offset_mask, bit_count, maximum_length


def _compress_chunk(data, start, end):
    """Kompresja jednego fragmentu (≤ 4096 B) wg MS-OVBA 2.4.1.3.7; dopasowania szukane przez indeks 3-bajtowy."""
    out = bytearray()
    cur = start
    index = {}

    def remember(p):
        if p + 3 <= end:
            index.setdefault(data[p:p + 3], []).append(p)

    while cur < end:
        flag_pos = len(out)
        out.append(0)
        flags = 0
        for bit in range(8):
            if cur >= end:
                break
            _, _, bit_count, max_len = _copy_token_help(cur, start)
            best_len, best_off = 0, 0
            for cand in reversed(index.get(data[cur:cur + 3], [])[-256:]):
                ln = 0
                while cur + ln < end and ln < max_len and data[cand + ln] == data[cur + ln]:
                    ln += 1
                if ln > best_len:
                    best_len, best_off = ln, cur - cand
                    if ln == max_len:
                        break
            if best_len >= 3:
                token = ((best_off - 1) << (16 - bit_count)) | (best_len - 3)
                out += struct.pack("<H", token)
                flags |= 1 << bit
                for p in range(cur, cur + best_len):
                    remember(p)
                cur += best_len
            else:
                out.append(data[cur])
                remember(cur)
                cur += 1
        out[flag_pos] = flags
    return out


def compress(data: bytes) -> bytes:
    """Kontener skompresowany MS-OVBA 2.4.1."""
    data = bytes(data)
    out = bytearray(b"\x01")
    pos = 0
    while pos < len(data):
        end = min(pos + 4096, len(data))
        chunk = _compress_chunk(data, pos, end)
        if len(chunk) >= 4096 and end - pos == 4096:
            out += struct.pack("<H", 0x3000 | 0x0FFF) + data[pos:end]   # fragment nieskompresowany (pełne 4096 B)
        else:
            assert len(chunk) <= 4096, "fragment nie mieści się po kompresji"
            out += struct.pack("<H", 0x8000 | 0x3000 | ((len(chunk) + 2 - 3) & 0x0FFF)) + chunk
        pos = end
    return bytes(out)


# --------------------------------------------------------------------------- MS-CFB zapis
class _Node:
    def __init__(self, name, kind, data=b"", clsid=b"\0" * 16):
        self.name, self.kind, self.data, self.clsid = name, kind, data, clsid
        self.children = []
        self.sid = None
        self.left = self.right = self.child = NOSTREAM
        self.start, self.size = ENDOFCHAIN, 0


def _cfb_key(name):
    return (len(name), name.upper())


def _build_tree(nodes):
    """Zrównoważone drzewo BST rodzeństwa (wszystkie węzły czarne) — zwraca sid korzenia."""
    if not nodes:
        return NOSTREAM
    mid = len(nodes) // 2
    root = nodes[mid]
    root.left = _build_tree(nodes[:mid])
    root.right = _build_tree(nodes[mid + 1:])
    return root.sid


def write_cfb(root_children, path, root_clsid=b"\0" * 16):
    """root_children: lista (nazwa, bytes) albo (nazwa, [dzieci], clsid)."""
    SEC, MINI, CUTOFF = 512, 64, 4096
    root = _Node("Root Entry", 5, clsid=root_clsid)
    order = [root]

    def add(parent, items):
        for it in items:
            if isinstance(it[1], (bytes, bytearray)):
                n = _Node(it[0], 2, bytes(it[1]))
            else:
                n = _Node(it[0], 1, clsid=it[2] if len(it) > 2 else b"\0" * 16)
                add(n, it[1])
            parent.children.append(n)
    add(root, root_children)

    def number(n):
        for c in sorted(n.children, key=lambda x: _cfb_key(x.name)):
            c.sid = len(order)
            order.append(c)
        for c in n.children:
            if c.kind == 1:
                number(c)
    root.sid = 0
    number(root)

    def link(n):
        kids = sorted(n.children, key=lambda x: _cfb_key(x.name))
        n.child = _build_tree(kids)
        for c in kids:
            if c.kind == 1:
                link(c)
    link(root)

    # ministrumień
    mini = bytearray()
    minifat = []
    big = []
    for n in order:
        if n.kind != 2:
            continue
        n.size = len(n.data)
        if n.size == 0:
            n.start = ENDOFCHAIN
        elif n.size < CUTOFF:
            first = len(mini) // MINI
            cnt = -(-n.size // MINI)
            mini += n.data + b"\0" * (cnt * MINI - n.size)
            for i in range(cnt):
                minifat.append(first + i + 1 if i < cnt - 1 else ENDOFCHAIN)
            n.start = first
        else:
            big.append(n)

    sectors = []  # lista bajtów sektorów
    fat = []

    def alloc(data):
        cnt = max(1, -(-len(data) // SEC))
        first = len(sectors)
        padded = data + b"\0" * (cnt * SEC - len(data))
        for i in range(cnt):
            sectors.append(padded[i * SEC:(i + 1) * SEC])
            fat.append(first + i + 1 if i < cnt - 1 else ENDOFCHAIN)
        return first

    for n in big:
        n.start = alloc(n.data)
    if mini:
        root.start = alloc(bytes(mini))
        root.size = len(mini)
    else:
        root.start, root.size = ENDOFCHAIN, 0
    minifat_start, minifat_cnt = ENDOFCHAIN, 0
    if minifat:
        mf = b"".join(struct.pack("<I", x) for x in minifat)
        mf += struct.pack("<I", FREESECT) * ((-len(minifat)) % (SEC // 4))
        minifat_start = alloc(mf)
        minifat_cnt = len(mf) // SEC

    # katalog
    dirdata = bytearray()
    for n in order:
        nm = n.name.encode("utf-16-le")
        assert len(nm) <= 62, n.name
        e = nm + b"\0\0"
        e += b"\0" * (64 - len(e))
        e += struct.pack("<HBB", len(nm) + 2, n.kind, 1)
        e += struct.pack("<III", n.left, n.right, n.child)
        e += n.clsid + struct.pack("<I", 0) + b"\0" * 16
        e += struct.pack("<IQ", n.start if n.kind != 1 else 0, n.size if n.kind != 1 else 0)
        dirdata += e
    while len(dirdata) % SEC:
        dirdata += (b"\0" * 64 + struct.pack("<HBB", 0, 0, 0) + struct.pack("<III", NOSTREAM, NOSTREAM, NOSTREAM) + b"\0" * 52)
    dir_start = alloc(bytes(dirdata))

    # FAT (iteracyjnie: sektory FAT same są w FAT)
    nfat = 1
    while True:
        total = len(sectors) + nfat
        if total <= nfat * (SEC // 4):
            break
        nfat += 1
    assert nfat <= 109, "plik za duży dla nagłówka bez DIFAT"
    fat_start = len(sectors)
    fat += [FATSECT] * nfat
    fat += [FREESECT] * (nfat * (SEC // 4) - len(fat))
    fatbytes = b"".join(struct.pack("<I", x) for x in fat)
    for i in range(nfat):
        sectors.append(fatbytes[i * SEC:(i + 1) * SEC])

    hdr = bytearray(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" + b"\0" * 16)
    hdr += struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + b"\0" * 6
    hdr += struct.pack("<IIIIIIII", 0, nfat, dir_start, 0, CUTOFF, minifat_start, minifat_cnt, ENDOFCHAIN)
    hdr += struct.pack("<I", 0)
    difat = [fat_start + i for i in range(nfat)] + [FREESECT] * (109 - nfat)
    hdr += b"".join(struct.pack("<I", x) for x in difat)
    assert len(hdr) == 512
    with open(path, "wb") as f:
        f.write(hdr)
        for s in sectors:
            f.write(s)


# --------------------------------------------------------------------------- projekt VBA
def _records(d):
    i, out = 0, []
    while i < len(d):
        rid, size = struct.unpack_from("<HI", d, i)
        if rid == 0x09:
            size = 6
        out.append((rid, bytes(d[i + 6:i + 6 + size])))
        i += 6 + size
    return out


def _rec(rid, data=b""):
    return struct.pack("<HI", rid, len(data)) + data


def read_project(path):
    """Odczyt: rekordy nagłówka dir, lista modułów (nazwa, typ, źródło), strumienie projektantów formularzy."""
    o = olefile.OleFileIO(path)
    d = decompress_stream(bytearray(o.openstream("VBA/dir").read()))
    recs = _records(d)
    k = next(i for i, r in enumerate(recs) if r[0] == 0x0F)
    header = recs[:k]
    codepage = struct.unpack("<H", next(r[1] for r in recs if r[0] == 0x03))[0]
    enc = "cp%d" % codepage
    modules, cur = [], None
    for rid, data in recs[k + 2:]:
        if rid == 0x19:
            cur = {"name": data.decode(enc), "type": None, "private": False}
        elif rid == 0x1A:
            cur["stream"] = data.decode(enc)
        elif rid == 0x31:
            cur["offset"] = struct.unpack("<I", data)[0]
        elif rid == 0x21:
            cur["type"] = "std"
        elif rid == 0x22:
            cur["type"] = "other"
        elif rid == 0x28:
            cur["private"] = True
        elif rid == 0x2B:
            raw = o.openstream("VBA/" + cur["stream"]).read()
            cur["source"] = decompress_stream(bytearray(raw[cur["offset"]:])).decode(enc)
            modules.append(cur)
            cur = None
    project_text = o.openstream("PROJECT").read().decode(enc)
    storages = {}
    for entry in o.listdir(streams=True, storages=False):
        if entry[0] in ("VBA", "PROJECT", "PROJECTwm"):
            continue
        storages.setdefault(entry[0], {})["/".join(entry[1:])] = o.openstream("/".join(entry)).read()
    clsids = {}
    for sid in range(len(o.direntries)):
        de = o.direntries[sid]
        if de is not None and de.entry_type == 1:
            clsids[de.name] = _clsid_bytes(de.clsid)
    root_clsid = _clsid_bytes(o.root.clsid)
    o.close()
    return {"header": header, "enc": enc, "modules": modules, "project": project_text, "storages": storages,
            "clsids": clsids, "root_clsid": root_clsid}


def _clsid_bytes(s):
    if not s:
        return b"\0" * 16
    import uuid
    return uuid.UUID(s).bytes_le


def build_project(orig, modules, out_path):
    """
    modules: lista słowników {name, kind: 'std'|'class'|'doc'|'form', source} w kolejności projektu.
    Źródło musi zawierać wiersze Attribute (jak w strumieniu modułu), końce wierszy CRLF.
    """
    enc = orig["enc"]
    dirb = bytearray()
    for rid, data in orig["header"]:
        if rid == 0x09:
            dirb += struct.pack("<HI", rid, 4) + data
        else:
            dirb += _rec(rid, data)
    dirb += _rec(0x0F, struct.pack("<H", len(modules)))
    dirb += _rec(0x13, struct.pack("<H", 0xFFFF))
    vba_streams = []
    for m in modules:
        nm = m["name"].encode(enc)
        nu = m["name"].encode("utf-16-le")
        dirb += _rec(0x19, nm) + _rec(0x47, nu) + _rec(0x1A, nm) + _rec(0x32, nu)
        dirb += _rec(0x1C) + _rec(0x48) + _rec(0x31, struct.pack("<I", 0)) + _rec(0x1E, struct.pack("<I", 0))
        dirb += _rec(0x2C, struct.pack("<H", 0xFFFF))
        dirb += _rec(0x21 if m["kind"] == "std" else 0x22)
        if m["kind"] == "form":
            dirb += _rec(0x28)
        dirb += _rec(0x2B)
        src = vba_codepage_safe(m["source"].replace("\r\n", "\n"), enc).replace("\n", "\r\n")
        vba_streams.append((m["name"], compress(src.encode(enc))))
    dirb += _rec(0x10)
    vba_streams.append(("dir", compress(bytes(dirb))))
    vba_streams.append(("_VBA_PROJECT", b"\xCC\x61\xFF\xFF\x00\x00\x00"))

    # PROJECT — linie modułów odtworzone, reszta (ID, Name, CMG/DPB/GC, Host Extender, Workspace) zachowana
    lines = orig["project"].replace("\r\n", "\n").split("\n")
    head = [l for l in lines if l.startswith("ID=")]
    mod_lines = []
    for m in modules:
        if m["kind"] == "std":
            mod_lines.append("Module=" + m["name"])
        elif m["kind"] == "class":
            mod_lines.append("Class=" + m["name"])
        elif m["kind"] == "doc":
            mod_lines.append("Document=%s/&H00000000" % m["name"])
        elif m["kind"] == "form":
            mod_lines += ["Package={AC9F2F90-E877-11CE-9F68-00AA00574A4F}", "BaseClass=" + m["name"]]
    rest, in_ws, ws = [], False, []
    for l in lines:
        if l.startswith(("ID=", "Document=", "Module=", "Class=", "BaseClass=", "Package=")):
            continue
        if l == "[Workspace]":
            in_ws = True
            continue
        if in_ws:
            continue
        rest.append(l)
    while rest and rest[-1] == "":
        rest.pop()
    ws = ["[Workspace]"] + ["%s=0, 0, 0, 0, C" % m["name"] for m in modules]
    project = "\r\n".join(head + mod_lines + rest + [""] + ws) + "\r\n"

    wm = b"".join(m["name"].encode(enc) + b"\0" + m["name"].encode("utf-16-le") + b"\0\0" for m in modules) + b"\0\0"

    tree = [("PROJECT", project.encode(enc)), ("PROJECTwm", wm), ("VBA", vba_streams, b"\0" * 16)]
    for stor, streams in orig["storages"].items():
        sub = {}
        for path, data in streams.items():
            parts = path.split("/")
            if len(parts) == 1:
                sub[parts[0]] = data
            else:
                sub.setdefault(parts[0], {})[parts[1]] = data
        items = []
        for k, v in sub.items():
            if isinstance(v, dict):
                items.append((k, list(v.items()), orig["clsids"].get(k, b"\0" * 16)))
            else:
                items.append((k, v))
        tree.append((stor, items, orig["clsids"].get(stor, b"\0" * 16)))
    write_cfb(tree, out_path, orig["root_clsid"])


def vba_codepage_safe(src, enc="cp1250"):
    """Znaki spoza strony kodowej projektu (np. ³, →) w literałach VBA zamieniane na ChrW(n); w komentarzach na ASCII."""
    def ok(ch):
        try:
            ch.encode(enc)
            return True
        except UnicodeEncodeError:
            return False
    out_lines = []
    for line in src.split("\n"):
        res, i, in_str, buf = [], 0, False, ""
        while i < len(line):
            ch = line[i]
            if not in_str and ch == "'":
                rest = line[i:]
                res.append(buf + "".join(c if ok(c) else "?" for c in rest))
                buf = ""
                i = len(line)
                break
            if ch == '"':
                if in_str and i + 1 < len(line) and line[i + 1] == '"':
                    buf += '""'
                    i += 2
                    continue
                in_str = not in_str
                buf += ch
            elif in_str and not ok(ch):
                buf += '" & ChrW(%d) & "' % ord(ch)
            else:
                buf += ch
            i += 1
        res.append(buf)
        out_lines.append("".join(res))
    return "\n".join(out_lines)
