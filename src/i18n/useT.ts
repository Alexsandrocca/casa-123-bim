// The translator for components: re-renders when the language changes.
import { useCallback } from 'react';
import { useApp } from '../store';
import { fmtNum, translate } from './index';

export function useT() {
  const lang = useApp((s) => s.lang);
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const n = useCallback((v: number, digits = 2) => fmtNum(lang, v, digits), [lang]);
  return Object.assign(t, { n, lang });
}
