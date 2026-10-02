// UI text in English and Brazilian Portuguese. The English text is the key; pt-BR.ts holds the translations.
// Placeholders: t('{n} rooms', { n: 3 }). Numbers follow the language (1,234.56 / 1.234,56).
import { PT } from './pt-BR';

export type Lang = 'pt-BR' | 'en';
export const LANGS: Lang[] = ['pt-BR', 'en'];

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const s = lang === 'pt-BR' ? PT[key] ?? key : key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** A number in the language's format. */
export const fmtNum = (lang: Lang, v: number, digits = 2) =>
  Number.isFinite(v) ? v.toLocaleString(lang === 'pt-BR' ? 'pt-BR' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
