// P1: the lot wizard — Casa 123 prefilled with its open items, a new lot from a sentence (AI mocked), the envelope,
// and a lot change that leaves the house outside (shown in red, never moved).
import { expect, test, type Page } from '@playwright/test';
import { openCasa } from './helpers';

const CASA_ANSWER = { shape: 'trapezoid', front: 14, rear: 15, left: 25, right: 25, secondStreet: null, terrain: 'down', fall: 2, lowerSide: null, streetFaces: 'E', address: null, city: 'Piracicaba', state: 'SP', notes: [] };

/** No map tiles from the internet in tests; the AI answer is mocked. */
async function offline(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await page.route('**/api/ai/lot', (r) => r.fulfill({
    json: { fields: CASA_ANSWER, usage: { date: new Date().toISOString(), purpose: 'lot description', model: 'claude-opus-5-5', tokensIn: 900, tokensOut: 120, usd: 0.006, brl: 0.0324 }, status: { connected: true, model: 'claude-opus-5-5', monthUsd: 0.006, monthBrl: 0.03, budgetUsd: 20, warn: false, blocked: false } },
  }));
}

const step = (page: Page, k: string) => page.getByTestId(`wstep-${k}`).click();
async function shot(page: Page, path: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path });
}

test('Casa 123 opens in the wizard prefilled; the summary lists the open items by whom to ask', async ({ page }) => {
  await offline(page);
  await openCasa(page, { tab: 'design' });
  await page.getByTestId('step-lot').click();
  await expect(page.getByTestId('lot-wizard')).toBeVisible();
  await expect(page.getByTestId('lot-figures')).toContainText('362.50 m²');
  await expect(page.getByTestId('w-city')).toHaveValue('Piracicaba');
  await step(page, 'shape');
  await expect(page.getByTestId('w-preset-trapezoid')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('w-front')).toHaveValue('14');
  await expect(page.getByTestId('w-rear')).toHaveValue('15');
  await expect(page.getByTestId('w-depth')).toHaveValue('25');
  await expect(page.getByTestId('lc-side-0')).toContainText('14.00 m · street');
  await expect(page.getByTestId('lc-house')).toHaveAttribute('data-outside', '0');
  await page.getByTestId('lang-pt-BR').click();
  await shot(page, 'docs/screens/P1-shape.png');
  await page.getByTestId('lang-en').click();

  await step(page, 'north');
  await expect(page.getByTestId('w-faces-E')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lc-sunpath-6')).toBeVisible();
  await expect(page.getByTestId('w-sun-table')).toContainText('h of sun');

  await step(page, 'rules');
  await expect(page.getByTestId('w-sb-front')).toHaveValue('4');
  await expect(page.getByTestId('w-sb-rear')).toHaveValue('6');
  await expect(page.getByTestId('w-sb-left')).toHaveValue('1.2');
  await expect(page.getByTestId('lc-envelope')).toBeVisible();
  await expect(page.getByTestId('w-env-area')).toHaveText('180.9 m²');
  await expect(page.getByTestId('w-max-footprint')).toHaveText('TO CONFIRM');
  // "I don't know" fills a typical value, marked TO CONFIRM, and the maximum footprint follows
  await page.getByTestId('w-to-dk').click();
  await expect(page.getByTestId('w-to')).toHaveValue('60');
  await expect(page.getByTestId('w-to-status')).toHaveValue('to-confirm');
  await expect(page.getByTestId('w-max-footprint')).toHaveText('217.5 m²');
  await page.getByTestId('lang-pt-BR').click();
  await shot(page, 'docs/screens/P1-rules-envelope.png');
  await page.getByTestId('lang-en').click();

  await step(page, 'services');
  await expect(page.getByTestId('w-sewer-depth')).toHaveValue('3');
  await expect(page.getByTestId('w-volt-127/220')).toHaveAttribute('aria-pressed', 'true');

  await step(page, 'summary');
  const list = page.getByTestId('confirm-list');
  await expect(list.locator('[data-who="prefeitura"]')).toContainText('zone');
  await expect(list.locator('[data-who="prefeitura"]')).toContainText('Height limit');
  await expect(list.locator('[data-who="prefeitura"]')).toContainText('carport');
  await expect(list.locator('[data-who="water"]')).toContainText('SEMAE');
  await expect(list.locator('[data-who="water"]')).toContainText('Depth of the public sewer');
  await expect(list.locator('[data-who="power"]')).toContainText('CPFL');
  await expect(list.locator('[data-who="surveyor"]')).toContainText('Topographic survey');
  await expect(list.locator('[data-who="soil"]')).toContainText('SPT');
  await page.getByTestId('lang-pt-BR').click();
  await shot(page, 'docs/screens/P1-summary.png');
});

test('a new lot in under 2 minutes: the Casa 123 sentence (AI mocked) fills the trapezoid, the slope and the street side', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => { localStorage.setItem('casabim.lang', 'en'); localStorage.setItem('casabim.legacyImported', 'yes'); });
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('lot-wizard')).toBeVisible();
  await page.getByTestId('w-name').fill('Lote do teste');
  await page.getByTestId('w-name').press('Tab');
  await page.getByTestId('ai-text').fill('14 de frente, 15 de fundo, 25 de laterais, cai uns 2 metros para o fundo, a rua fica a leste, Piracicaba');
  await page.getByTestId('ai-read').click();
  const preview = page.getByTestId('ai-preview');
  await expect(preview).toContainText('trapezoid');
  await expect(preview).toContainText('falls towards the rear');
  await expect(preview).toContainText('east');
  // never applied on its own: the lot is still the default rectangle until "Use these values"
  await expect(page.getByTestId('lot-figures')).toContainText('360.00 m²');
  await page.getByTestId('lang-pt-BR').click();
  await page.getByTestId('ai-use').scrollIntoViewIfNeeded();
  await shot(page, 'docs/screens/P1-ai.png');
  await page.getByTestId('lang-en').click();
  await page.getByTestId('ai-use').click();
  await expect(page.getByTestId('lot-figures')).toContainText('362.50 m²');
  await expect(page.getByTestId('w-city')).toHaveValue('Piracicaba');
  await step(page, 'shape');
  await expect(page.getByTestId('w-preset-trapezoid')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('w-front')).toHaveValue('14');
  await step(page, 'north');
  await expect(page.getByTestId('w-faces-E')).toHaveAttribute('aria-pressed', 'true');
  await step(page, 'terrain');
  await expect(page.getByTestId('w-terrain-down')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('w-fall')).toHaveValue('2');
  await step(page, 'rules');
  // Piracicaba's table: eaves 0.70 given by the code; the setbacks typical and TO CONFIRM
  await expect(page.getByTestId('w-eaves')).toHaveValue('0.7');
  await step(page, 'summary');
  await page.getByTestId('save-lot').click();
  await expect(page.getByTestId('lot-saved')).toContainText('Start stage');
  await expect(page.getByTestId('project-name')).toHaveText('Lote do teste');
  await expect(page.getByTestId('step-start')).toBeDisabled();
  // the starting house sits inside the buildable area
  await page.getByTestId('tab-design').click();
  await expect(page.getByTestId('envelope-banner')).toHaveCount(0);
  await expect(page.getByTestId('plan-envelope')).toBeVisible();
});

test('a corner lot: both streets get the front setback; the envelope follows', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => { localStorage.setItem('casabim.lang', 'en'); });
  await page.goto('/#/new');
  await step(page, 'shape');
  await page.getByTestId('w-preset-corner').click();
  await page.getByTestId('w-front').fill('15');
  await page.getByTestId('w-front').press('Enter');
  await page.getByTestId('w-depth').fill('25');
  await page.getByTestId('w-depth').press('Enter');
  await expect(page.getByTestId('w-street-0')).toBeChecked();
  await expect(page.getByTestId('w-street-1')).toBeChecked();
  await step(page, 'rules');
  for (const [k, v] of [['front', '4'], ['rear', '3'], ['left', '1.5']] as const) {
    await page.getByTestId(`w-sb-${k}`).fill(v);
    await page.getByTestId(`w-sb-${k}`).press('Enter');
  }
  // 15 − 1.5 − 4 = 9.5 m across, 25 − 4 − 3 = 18 m deep
  await expect(page.getByTestId('w-env-area')).toHaveText('171.0 m²');
});

test('changing the lot after a design: the house is shown red with a clear message, never moved', async ({ page }) => {
  await offline(page);
  await openCasa(page, { tab: 'design' });
  const before = await page.locator('text[data-room="Kitchen"]').textContent();
  await page.getByTestId('step-lot').click();
  await step(page, 'shape');
  await page.getByTestId('w-front').fill('10');
  await page.getByTestId('w-front').press('Enter');
  await expect(page.getByTestId('lc-house')).toHaveAttribute('data-outside', '1');
  await step(page, 'summary');
  await page.getByTestId('save-lot').click();
  await expect(page.getByTestId('lot-saved')).toContainText('nothing in the house was moved', { timeout: 30000 });
  await page.getByTestId('tab-design').click();
  await expect(page.getByTestId('envelope-banner')).toContainText('North side setback');
  await expect(page.locator('rect.floor')).toHaveAttribute('data-outside', '1');
  await expect(page.locator('text[data-room="Kitchen"]')).toHaveText(before!);
  // the BIM tab's checks fail the setback too, and undo brings the old lot back
  await page.getByTestId('tab-bim').click();
  await page.getByTestId('checks-toggle').click();
  await expect(page.locator('.checklist tr.fail', { hasText: 'North side setback' })).toBeVisible();
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('envelope-banner')).toHaveCount(0);
});
