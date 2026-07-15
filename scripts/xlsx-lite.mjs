import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// An .xlsx is a zip of XML. We unzip to a temp dir with the system `unzip`, then parse the
// sharedStrings table and each worksheet by hand — enough to pull cell text out, no dependency.
function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
}
function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

export function readWorkbook(path) {
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'))
  try {
    execFileSync('unzip', ['-o', '-q', path, '-d', dir])

    // sheet name -> sheetN.xml, via workbook.xml + its rels
    const wbXml = readFileSync(join(dir, 'xl/workbook.xml'), 'utf8')
    const relsXml = readFileSync(join(dir, 'xl/_rels/workbook.xml.rels'), 'utf8')
    const relTarget = {}
    for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget[m[1]] = m[2]
    const sheetFile = {}
    for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
      sheetFile[decode(m[1])] = relTarget[m[2]].replace(/^\/?xl\//, '').replace(/^worksheets\//, '')
    }

    // shared strings
    const shared = []
    try {
      const ss = readFileSync(join(dir, 'xl/sharedStrings.xml'), 'utf8')
      for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        const t = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
        shared.push(decode(t))
      }
    } catch { /* a workbook with no strings is legal */ }

    const out = {}
    for (const [name, file] of Object.entries(sheetFile)) {
      const xml = readFileSync(join(dir, 'xl/worksheets', file), 'utf8')
      const rows = []
      for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const arr = []
        for (const cm of rm[1].matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
          const col = colToNum(cm[1]); const attrs = cm[2]; const inner = cm[3]
          const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || 'n'
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
          let val = ''
          if (type === 's' && v) val = shared[Number(v[1])] ?? ''
          else if (type === 'inlineStr') { const im = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); val = im ? decode(im[1]) : '' }
          else if (v) val = v[1]
          arr[col] = val
        }
        for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = ''
        rows.push(arr)
      }
      out[name] = rows
    }
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
