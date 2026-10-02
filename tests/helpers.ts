import { readFileSync } from 'node:fs';
import { parseProject, type Project } from '../src/model/schema';

/** The committed Casa 123 versions (projects/casa-123), by their old file names. */
const FILES = { 'casa-123.json': 'v2.json', 'casa-123-v1.json': 'v1.json', 'casa-123-v3.json': 'v3.json' } as const;

export const load = (f: 'casa-123.json' | 'casa-123-v1.json' | 'casa-123-v3.json'): Project =>
  parseProject(JSON.parse(readFileSync(new URL(`../projects/casa-123/versions/${FILES[f]}`, import.meta.url), 'utf8')));

export const ref = (f: string) => readFileSync(new URL(`../docs/reference/${f}`, import.meta.url), 'utf8');

export const space = (p: Project, level: string, name: string) => {
  const s = p.elements.find((e) => e.type === 'Space' && e.level === level && e.props.name === name);
  if (!s || s.type !== 'Space') throw new Error(`no ${name} on ${level}`);
  return s;
};
