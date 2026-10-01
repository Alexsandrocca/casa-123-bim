import { expect, test, type Page } from '@playwright/test';

type Hook = { frames(): number; project(x: number, y: number, z: number): [number, number] };
const ready = (page: Page) => page.waitForFunction(() => ((window as unknown as { __casa3d?: Hook }).__casa3d?.frames() ?? 0) > 10, null, { timeout: 30000 });

test('Version 3 opens by default: no garage, patio and carport, about 78 m², two checks to confirm', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Version 3' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('text[data-room="Garage"]')).toHaveCount(0);
  await expect(page.getByTestId('gross')).toHaveText(/Version 3 · 78\.\d m² gross/);
  await expect(page.locator('rect.carport')).toHaveCount(1);
  await expect(page.getByTestId('checks-fail')).toHaveText('0 fail');
  await expect(page.getByTestId('checks-confirm')).toHaveText('2 to confirm'); // carport (02b) and design rainfall (03)
  await page.getByTestId('checks-toggle').click();
  await expect(page.getByRole('row', { name: /Carport in the front setback/ })).toContainText('TO CONFIRM');
  await page.getByTestId('checks-toggle').click();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.planwrap').screenshot({ path: 'docs/screens/02b-plan-SL.png' });
  // Version 2 is still there, with its garage
  await page.getByRole('button', { name: 'Version 2' }).click();
  await expect(page.locator('text[data-room="Garage"]')).toHaveText('27.0 m²');
});

test('clicking the carport shows its properties', async ({ page }) => {
  await page.goto('/');
  await page.locator('rect.carport').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('.props h3')).toHaveText('Carport');
  await expect(page.locator('.props')).toContainText('2 bays of 2.50 × 5.00 m');
});

test('street view of Version 3', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-3d').click();
  await ready(page);
  await page.getByRole('button', { name: 'Street', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByTestId('scene3d').screenshot({ path: 'docs/screens/02b-street.png' });
  // click the carport roof in 3D
  const [x, y] = await page.evaluate(() => (window as unknown as { __casa3d: Hook }).__casa3d.project(4.0, -2.5, 2.9));
  await page.mouse.click(x, y);
  await expect(page.locator('.props h3')).toHaveText('Carport');
});
