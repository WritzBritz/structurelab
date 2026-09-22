/**
 * Exporter text (FBX / Maya / MTL / sidecars) is UTF-8. Reading those bytes as
 * Latin-1 or Windows-1252 produces mojibake (`ëƒ¥ì´…png` for Korean names).
 * Decode as UTF-8, and fold NFC so macOS NFD matches Windows NFC.
 */

/** Unicode → Windows-1252 byte for the 0x80–0x9F C1 replacements. */
const FROM_CP1252 = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
])

const CJK =
  /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/

function bytesFromMojibake(value: string): Uint8Array | null {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0xff) {
      out[i] = code
      continue
    }
    const mapped = FROM_CP1252.get(code)
    if (mapped == null) return null
    out[i] = mapped
  }
  return out
}

function looksLikeMojibake(value: string): boolean {
  if (!value || CJK.test(value)) return false
  if (/[\u0080-\u009f]/.test(value) || /[ƒ]/.test(value)) return true
  // UTF-8 lead (C2–F4) decoded as Latin-1, followed by a continuation byte.
  return /[À-ÿ][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/.test(value)
}

function tryUtf8FromMojibake(value: string): string | null {
  const bytes = bytesFromMojibake(value)
  if (!bytes) return null
  try {
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes).normalize('NFC')
    if (repaired.includes('\uFFFD')) return null
    if (!CJK.test(value) && CJK.test(repaired)) return repaired
    if (/[\u0080-\u009f]/.test(value) && !/[\u0080-\u009f]/.test(repaired)) return repaired
    if (looksLikeMojibake(value) && !looksLikeMojibake(repaired)) return repaired
    return null
  } catch {
    return null
  }
}

/** If `value` is UTF-8 that was decoded as Latin-1/CP1252, recover the original. */
export function repairMojibake(value: string): string {
  if (!value) return value
  const nfc = value.normalize('NFC')
  if (!looksLikeMojibake(nfc)) return nfc
  const candidates = [nfc]
  if (/\s/.test(nfc)) candidates.push(nfc.replace(/\s+/g, ''))
  for (const candidate of candidates) {
    const repaired = tryUtf8FromMojibake(candidate)
    if (repaired) return repaired
  }
  return nfc
}

/** Length-prefixed FBX / IFF strings: UTF-8, then Latin-1 + mojibake repair. */
export function decodeExportBytes(bytes: Uint8Array): string {
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end -= 1
  const slice = end === bytes.length ? bytes : bytes.subarray(0, end)
  if (slice.length === 0) return ''
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(slice).normalize('NFC')
  } catch {
    const latin = new TextDecoder('latin1').decode(slice)
    return repairMojibake(latin)
  }
}

/** Whole text files (ASCII FBX, MTL, OBJ) with BOM + UTF-8 / mojibake fallback. */
export function decodeExportText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes).normalize('NFC')
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes).normalize('NFC')
  }
  let start = 0
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3
  }
  return decodeExportBytes(start === 0 ? bytes : bytes.subarray(start))
}

/** Lowercased NFC, with mojibake undone — use this for filename compares. */
export function foldExportName(value: string): string {
  return repairMojibake(value).normalize('NFC').toLowerCase()
}

const CP1252_BYTE: string[] = (() => {
  const chars = Array.from({ length: 256 }, (_, byte) => String.fromCharCode(byte))
  const extras: Array<[number, string]> = [
    [0x80, '\u20ac'],
    [0x82, '\u201a'],
    [0x83, '\u0192'],
    [0x84, '\u201e'],
    [0x85, '\u2026'],
    [0x86, '\u2020'],
    [0x87, '\u2021'],
    [0x88, '\u02c6'],
    [0x89, '\u2030'],
    [0x8a, '\u0160'],
    [0x8b, '\u2039'],
    [0x8c, '\u0152'],
    [0x8e, '\u017d'],
    [0x91, '\u2018'],
    [0x92, '\u2019'],
    [0x93, '\u201c'],
    [0x94, '\u201d'],
    [0x95, '\u2022'],
    [0x96, '\u2013'],
    [0x97, '\u2014'],
    [0x98, '\u02dc'],
    [0x99, '\u2122'],
    [0x9a, '\u0161'],
    [0x9b, '\u203a'],
    [0x9c, '\u0153'],
    [0x9e, '\u017e'],
    [0x9f, '\u0178'],
  ]
  for (const [byte, char] of extras) chars[byte] = char
  return chars
})()

function utf8AsLatin1(value: string): string {
  return new TextDecoder('latin1').decode(new TextEncoder().encode(value))
}

function utf8AsCp1252(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let out = ''
  for (const byte of bytes) out += CP1252_BYTE[byte] ?? String.fromCharCode(byte)
  return out
}

export function exportNameAliases(raw: string): string[] {
  const names = new Set<string>()
  const add = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    names.add(trimmed)
    names.add(trimmed.normalize('NFC'))
    names.add(trimmed.normalize('NFD'))
    const repaired = repairMojibake(trimmed)
    names.add(repaired)
    names.add(repaired.normalize('NFC'))
    names.add(repaired.normalize('NFD'))
    names.add(repaired.toLowerCase())
    names.add(foldExportName(trimmed))
    names.add(utf8AsLatin1(repaired))
    names.add(utf8AsCp1252(repaired))
  }
  add(raw)
  return [...names]
}

export function exportNamesMatch(a: string, b: string): boolean {
  return foldExportName(a) === foldExportName(b)
}

export function findEntryByExportName<T>(
  entries: Iterable<[string, T]>,
  name: string,
): [string, T] | undefined {
  const fold = foldExportName(name.replaceAll('\\', '/').split('/').pop() ?? name)
  for (const entry of entries) {
    if (foldExportName(entry[0]) === fold) return entry
  }
  return undefined
}
