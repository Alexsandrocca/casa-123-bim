// Developer tool (spec 04b): prints the MEP physics report of Version 3. npx tsx scripts/mep-report.ts exposed|clash|rules|forb|slope|seg <network>
import { readFileSync } from 'node:fs';

import { parseProject } from '../src/model/schema';
import { mepReport } from '../src/model/mep/analysis';
const B = decodeURIComponent(new URL('../', import.meta.url).pathname);
const p = parseProject(JSON.parse(readFileSync(B+'model/casa-123-v3.json','utf8')));
const rep = mepReport(p);
const what = process.argv[2] ?? 'exposed';
const f = (v: number[]) => v.map(x=>x.toFixed(2)).join(',');
if (what==='exposed') {
  const by: Record<string, string[]> = {};
  for (const s of rep.segs.values()) if (s.exposed>0.03) (by[s.network] ??= []).push(`${s.id} [${f(s.a)}]→[${f(s.b)}] exp ${s.exposed.toFixed(2)} host ${s.host}`);
  for (const [k,v] of Object.entries(by)) { console.log('##', k, v.length); for (const x of v.slice(0, Number(process.argv[3]??4))) console.log('  ', x); }
}
if (what==='clash') {
  const by: Record<string, number> = {};
  for (const c of rep.clashes) { const k = c.kind+' '+c.text.replace(/[\w-]+-\d{3}/g,'#').replace(/\d+(\.\d+)?/g,'n'); by[k]=(by[k]??0)+1; }
  for (const [k,v] of Object.entries(by).sort((a,b)=>b[1]-a[1])) console.log(v, k);
  if (process.argv[3]) for (const c of rep.clashes.filter(c=>c.text.includes(process.argv[3]!))) console.log(c.text, f(c.at));
}
if (what==='rules') for (const s of rep.segs.values()) if (s.issues.some(i=>/wall|crawlspace ground/.test(i))) console.log(s.id, f(s.a), f(s.b), s.issues.join('; '));
if (what==='forb') for (const s of rep.segs.values()) if (s.forbidden.length) console.log(s.id, f(s.a), f(s.b), s.forbidden.map(x=>x.name).join('; '));
if (what==='slope') for (const s of rep.slopes) if (s.bad) console.log(s.id, s.bad, s.slope.toFixed(4));
if (what==='seg') { const n = process.argv[3]!; for (const e of p.elements) if (e.type==='PipeSegment' && e.props.network===n || e.type==='Conduit' && e.props.circuit===n) { const s = rep.segs.get(e.id)!; console.log(e.id, f(e.props.start), '→', f(e.props.end), 'dn', (e.props as any).dn, s.host, s.issues.join('; ')); } }
