// Developer tool (spec 04b): draws a routing layer as text around a point. npx tsx scripts/mep-layer.ts <carry> <x0> <y0> <x1> <y1> [crawl,ground,plenums=SL]
import { readFileSync } from 'node:fs';
import { parseProject } from '../src/model/schema';
import { mepContext } from '../src/model/mep/spaces';
import { buildLayer } from '../src/model/mep/layers';
const B = decodeURIComponent(new URL('../', import.meta.url).pathname);
const p = parseProject(JSON.parse(readFileSync(B + 'model/casa-123-v3.json', 'utf8')));
const [carry, x0, y0, x1, y1, opts = 'crawl,ground'] = process.argv.slice(2) as [string, string, string, string, string, string?];
const o = Object.fromEntries((opts ?? '').split(',').map((kv) => { const [k, v] = kv.split('='); return [k, v ? v.split('+') : true]; }));
const occ = process.env.OCC ? p.elements.flatMap((e) => (e.type === 'PipeSegment' && !e.props.network.startsWith(process.env.OCC!) ? [{ a: e.props.start, b: e.props.end, r: (e.props.dn >= 100 ? 0.11 : e.props.dn >= 75 ? 0.075 : e.props.dn >= 50 ? 0.05 : 0.03) / 2, carry: e.props.system, net: e.props.network }] : [])) : [];
const L = buildLayer(mepContext(p), { occ, key: 'debug', carry: carry as never, dn: Number(process.env.DN ?? 100), diagonal: true, crawl: !!o.crawl, ground: !!o.ground, underLL: !!o.underLL, plenums: o.plenums as string[] | undefined, screeds: o.screeds as string[] | undefined, roof: !!o.roof });
const step = 0.1;
for (let y = Number(y1); y >= Number(y0) - 1e-9; y -= step) {
  let row = y.toFixed(1).padStart(6) + ' ';
  for (let x = Number(x0); x <= Number(x1) + 1e-9; x += step) {
    const k = L.cellAt(x, y);
    if (k < 0) { row += ' '; continue; }
    if (!L.passable(k)) { const w = L.why[k]!; row += w >= 0 ? String.fromCharCode(65 + (w % 26)) : '.'; continue; }
    const h = L.hosts[L.host[k]!]!.kind;
    row += ({ crawlspace: 'c', underground: 'g', plenum: 'p', shaft: 's', screed: 'f', 'roof-zone': 'r' } as Record<string, string>)[h] ?? '?';
  }
  console.log(row);
}
L.reasons.forEach((r, i) => console.log(String.fromCharCode(65 + (i % 26)), r));
