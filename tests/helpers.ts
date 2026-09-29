import { readFileSync } from 'node:fs';
import { parseProject, type Project } from '../src/model/schema';

export const load = (f: 'casa-123.json' | 'casa-123-v1.json' | 'casa-123-v3.json'): Project =>
  parseProject(JSON.parse(readFileSync(new URL(`../model/${f}`, import.meta.url), 'utf8')));

export const ref = (f: string) => readFileSync(new URL(`../docs/reference/${f}`, import.meta.url), 'utf8');

export const space = (p: Project, level: string, name: string) => {
  const s = p.elements.find((e) => e.type === 'Space' && e.level === level && e.props.name === name);
  if (!s || s.type !== 'Space') throw new Error(`no ${name} on ${level}`);
  return s;
};
