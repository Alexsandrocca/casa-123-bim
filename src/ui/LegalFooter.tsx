// The legal notice on every sheet and export, in both languages (P0 §7).
import { LEGAL } from '../model/legal';

export function LegalFooter() {
  return (
    <footer className="legal" data-testid="legal-footer">
      <span lang="pt-BR">{LEGAL['pt-BR']}</span>
      <span lang="en">{LEGAL.en}</span>
    </footer>
  );
}
