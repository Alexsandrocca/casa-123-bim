import { expect, test, type Page } from '@playwright/test';

type Hook = { frames(): number };
const ready = (page: Page) => page.waitForFunction(() => ((window as unknown as { __casa3d?: Hook }).__casa3d?.frames() ?? 0) > 10, null, { timeout: 30000 });

test('add an outlet to a bedroom: the circuit load, the cable check and the schedule update', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('elec2d').check();
  await page.getByRole('tab', { name: 'Upper +3.70' }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screens/04.png' });
  // the circuit table before
  await page.getByTestId('electrical').click();
  const rowText = async () => (await page.getByTestId('circuit-table').locator('tr', { hasText: 'Outlets UF general' }).allInnerTexts()).join('|');
  const before = await rowText();
  await page.keyboard.press('Escape');
  // click inside Bedroom 3 with the outlet tool
  await page.getByTestId('tool-outlet').click();
  const label = (await page.locator('text[data-room="Bedroom 3"]').boundingBox())!;
  await page.mouse.click(label.x + label.width / 2 + 60, label.y + 40);
  await expect(page.locator('.props h3')).toHaveText('Outlet 10 A');
  await expect(page.locator('.props')).toContainText('Bedroom 3');
  await expect(page.locator('.props')).toContainText('On circuit');
  await page.getByTestId('electrical').click();
  expect(await rowText()).not.toBe(before);
  await page.getByRole('tab', { name: 'Materials' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('elec-csv').click()]);
  expect(download.suggestedFilename()).toBe('casa-123-v3-electrical.csv');
  await page.keyboard.press('Escape');
  await page.getByTestId('checks-toggle').click();
  await page.getByRole('button', { name: 'Whole house' }).click();
  for (const name of [/Breakers protect their cables/, /Voltage drop/, /Points · Bedroom 3/]) {
    await expect(page.getByRole('row', { name }).getByRole('cell').first()).toHaveAttribute('aria-label', 'pass');
  }
});

test('kitchen minimum points fail when its outlets are removed', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('elec2d').check();
  await page.getByTestId('checks-toggle').click();
  await expect(page.getByRole('row', { name: /Points · Kitchen/ })).toContainText('outlets 5 of 5');
  await page.getByTestId('checks-toggle').click();
  const kitchenOutlet = page.locator('g[data-device^="dev-outlet"]', { has: page.locator('title', { hasText: 'Outlet · Kitchen' }) }).first();
  await kitchenOutlet.locator('.devhit').click({ force: true });
  await expect(page.locator('.props')).toContainText('Kitchen');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByTestId('checks-toggle').click();
  await expect(page.getByRole('row', { name: /Points · Kitchen/ })).toContainText('outlets 4 of 5');
  await expect(page.getByRole('row', { name: /Points · Kitchen/ }).getByRole('cell').first()).toHaveAttribute('aria-label', 'fail');
});

test('electrical window: circuits, panels, solar and camera coverage; screenshots', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('electrical').click();
  await expect(page.getByTestId('circuit-table')).toBeVisible();
  await page.locator('.modal .box').screenshot({ path: 'docs/screens/04-circuits.png' });
  await page.getByRole('tab', { name: 'Panels' }).click();
  await expect(page.getByTestId('board-panel')).toBeVisible();
  await expect(page.getByTestId('single-line')).toBeVisible();
  await page.getByRole('tab', { name: 'Solar' }).click();
  await expect(page.getByTestId('solar-roof').locator('.rp-mod')).toHaveCount(12);
  await page.locator('.modal .box').screenshot({ path: 'docs/screens/04-solar.png' });
  await page.getByTestId('battery').check();
  await page.getByRole('tab', { name: 'Panels' }).click();
  await expect(page.getByTestId('single-line')).toContainText('battery 10 kWh');
  await page.getByRole('tab', { name: 'Cameras' }).click();
  await expect(page.getByTestId('coverage-pct')).toHaveText(/9\d %/);
  await page.locator('.modal .box').screenshot({ path: 'docs/screens/04-cameras.png' });
});

test('3D: camera views and solar modules', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-3d').click();
  await ready(page);
  await page.getByTestId('cones').click();
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('cones')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('scene3d').screenshot({ path: 'docs/screens/04-cameras-3d.png' });
});
