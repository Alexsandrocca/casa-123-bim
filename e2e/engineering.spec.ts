import { expect, test, type Page } from '@playwright/test';
import { openCasa } from './helpers';

// Spec 08: architectural features and engineering estimates.
type Hook = { frames(): number };
const ready = (page: Page) => page.waitForFunction(() => ((window as unknown as { __casa3d?: Hook }).__casa3d?.frames() ?? 0) > 10, null, { timeout: 30000 });
const openEngineering = async (page: Page, tab: string) => {
  await page.getByTestId('engineering').click();
  await page.getByTestId(`eng-tab-${tab}`).click();
};

test('assemblies: exterior walls to light steel frame — thickness, U-value and thermal result follow; disclaimer shown', async ({ page }) => {
  await openCasa(page);
  await openEngineering(page, 'assemblies');
  await expect(page.getByTestId('disclaimer')).toContainText('ART/RRT');
  await page.getByTestId('asm-default-exterior').selectOption('ext-lsf');
  await expect(page.locator('.flash')).toContainText('Light steel frame', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.modal .box').screenshot({ path: 'docs/screens/08-assemblies.png' });
  await page.getByTestId('eng-tab-thermal').click();
  await expect(page.getByTestId('thermal-table')).toContainText('simulation needed');
  await page.getByRole('button', { name: 'Close' }).click();
  // an exterior wall now draws 0.13 m thick, and its estimates carry the badge
  await page.locator('[data-wall="SL-wall-04"]').click({ force: true });
  await expect(page.getByTestId('wall-thickness')).toHaveValue('0.13');
  await expect(page.getByTestId('estimates')).toContainText('U-value');
  await page.getByTestId('estimates').getByTestId('est-badge').first().click();
  await expect(page.locator('.estpop')).toContainText('Method');
});

test('structure: utilisation colours, load path and kN in 3D; a weaker soil makes bigger footings', async ({ page }) => {
  await openCasa(page);
  await openEngineering(page, 'structure');
  const before = await page.getByTestId('footing-table').locator('tbody tr').nth(6).locator('td').last().textContent();
  await page.getByTestId('eng-tab-assumptions').click();
  await page.getByTestId('as-soilPressure').fill('80');
  await page.getByTestId('as-soilPressure').press('Enter');
  await page.getByTestId('eng-tab-structure').click();
  const after = await page.getByTestId('footing-table').locator('tbody tr').nth(6).locator('td').last().textContent();
  expect(after).not.toBe(before);
  await page.getByTestId('show-structure-3d').click();
  await ready(page);
  await expect(page.getByTestId('structure-legend')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId('scene3d').screenshot({ path: 'docs/screens/08-structure.png' });
});

test('features: a brise on the west living window, placed from the palette, cuts its December sun', async ({ page }) => {
  await openCasa(page);
  await openEngineering(page, 'environment');
  const row = page.getByTestId('sun-table').locator('tr[data-window="SL-win-07"]');
  const dec0 = parseFloat((await row.locator('td').nth(2).textContent()) ?? '0');
  expect(dec0).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('features').click();
  await page.getByTestId('feature-brise').click();
  await page.locator('[data-opening="SL-win-07"]').first().click({ force: true });
  await expect(page.locator('.flash')).toContainText('Brise-soleil placed');
  await expect(page.locator('.props h3')).toHaveText('Brise-soleil');
  await expect(page.locator('.feat2d.k-brise')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await openEngineering(page, 'environment');
  const dec1 = parseFloat((await row.locator('td').nth(2).textContent()) ?? '0');
  expect(dec1).toBeLessThan(dec0 - 1);
  await expect(row).toContainText('Brise-soleil');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('view-split').click();
  await ready(page);
  await page.getByRole('button', { name: 'Garden' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/screens/08.png' });
});

test('cost card: both methods, biggest items, snapshot and the other versions', async ({ page }) => {
  await openCasa(page);
  await openEngineering(page, 'cost');
  const card = page.getByTestId('cost-card');
  await expect(card).toContainText('By quantities');
  await expect(page.getByTestId('cost-cub')).toContainText('R$');
  await expect(card).toContainText('Against Version 1');
  await page.getByTestId('save-snapshot').click();
  await expect(card).toContainText('Against the snapshot');
  await page.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: 'docs/screens/08-cost.png' });
  // the CUB left empty stays TO CONFIRM, never invented
  await page.getByTestId('eng-tab-assumptions').click();
  await page.getByTestId('as-cub').fill('');
  await page.getByTestId('as-cub').press('Enter');
  await page.getByTestId('eng-tab-cost').click();
  await expect(page.getByTestId('cost-cub')).toHaveText('CUB TO CONFIRM');
});
