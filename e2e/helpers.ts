import { expect, type Page } from '@playwright/test';

/**
 * P0: every test works on its own copy of Casa 123 (the server's projects folder is a copy made for the run),
 * in English, so tests never see each other's edits.
 * version: open that design version; for the BIM tab a version other than 3 is approved first (as the family would).
 */
export async function openCasa(page: Page, opt: { version?: 'v1' | 'v2' | 'v3'; tab?: 'design' | 'bim'; level?: string; view?: '2d' | '3d' | 'split' } = {}) {
  const { version = 'v3', tab = 'bim', level = 'SL', view = '2d' } = opt;
  const res = await page.request.post('/api/projects/casa-123/duplicate', { data: { name: `Casa 123 test ${Date.now()} ${Math.random().toString(36).slice(2, 7)}` } });
  expect(res.ok()).toBeTruthy();
  const p = await res.json();
  const put = await page.request.put(`/api/projects/${p.id}`, { data: { ...p, language: 'en', designVersionId: version } });
  expect(put.ok()).toBeTruthy();
  await page.addInitScript(([lv, vw]) => {
    if (!sessionStorage.getItem('e2e.init')) {
      sessionStorage.setItem('e2e.init', '1');
      localStorage.setItem('casabim.ui.1', JSON.stringify({ level: lv, view: vw }));
      localStorage.setItem('casabim.lang', 'en');
      localStorage.setItem('casabim.legacyImported', 'yes');
    }
  }, [level, view]);
  const needApproval = tab === 'bim' && version !== 'v3';
  await page.goto(`/#/p/${p.id}/${needApproval ? 'design' : tab}`);
  await expect(page.getByTestId('project-name')).toBeVisible();
  if (needApproval) {
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('tab-bim')).toHaveAttribute('aria-pressed', 'true');
  }
  return p.id as string;
}
