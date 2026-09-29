import { expect, test, type Page } from '@playwright/test';

type Hook = { frames(): number; project(x: number, y: number, z: number): [number, number] };
const ready = (page: Page) => page.waitForFunction(() => ((window as unknown as { __casa3d?: Hook }).__casa3d?.frames() ?? 0) > 10, null, { timeout: 30000 });
const screen = (page: Page, x: number, y: number, z: number) =>
  page.evaluate(([a, b, c]) => (window as unknown as { __casa3d: Hook }).__casa3d.project(a!, b!, c!), [x, y, z]);

test('switch between 2D, 3D and split', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('svg.plan')).toBeVisible();
  await page.getByTestId('view-3d').click();
  await ready(page);
  await expect(page.locator('svg.plan')).toHaveCount(0);
  await expect(page.getByTestId('scene3d').locator('canvas')).toBeVisible();
  await page.getByTestId('view-split').click();
  await expect(page.locator('svg.plan')).toBeVisible();
  await expect(page.getByTestId('scene3d').locator('canvas')).toBeVisible();
  await page.getByTestId('view-2d').click();
  await expect(page.getByTestId('scene3d')).toHaveCount(0);
});

test('click a wall in 3D selects it in both views; and the 2D plan follows', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-split').click();
  await ready(page);
  await page.getByRole('button', { name: 'Street', exact: true }).click();
  await page.waitForTimeout(500);
  // Upper floor front wall, above its windows
  const [x, y] = await screen(page, 2.0, 5, 6.4);
  await page.mouse.click(x, y);
  await expect(page.locator('.props h3')).toHaveText('Exterior wall');
  await expect(page.locator('.props')).toContainText('UF-wall-01');
  // the 2D plan switched to the upper floor and highlights the wall
  await expect(page.getByRole('tab', { name: 'Upper +3.70' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('line.selwall')).toHaveCount(1);
  // clicking empty sky clears the selection
  const box = (await page.getByTestId('scene3d').boundingBox())!;
  await page.mouse.click(box.x + box.width - 20, box.y + box.height * 0.35);
  await expect(page.locator('.props h3')).not.toHaveText('Exterior wall');
});

test('screenshots: street, garden and section', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-3d').click();
  await ready(page);
  await page.getByRole('button', { name: 'Street', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByTestId('scene3d').screenshot({ path: 'docs/screens/02-street.png' });
  await page.getByRole('button', { name: 'Garden', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByTestId('scene3d').screenshot({ path: 'docs/screens/02-garden.png' });
  await page.getByRole('button', { name: 'Section & sun ▾' }).click();
  await page.getByRole('button', { name: '21 Dec 15:00' }).click();
  await page.getByTestId('section-along').click(); // cut through the down flight, looking from the north
  await expect(page.getByTestId('section-pos')).toHaveValue('2.45');
  await page.getByRole('button', { name: 'Less ▴' }).click();
  await page.waitForTimeout(800);
  await page.getByTestId('scene3d').screenshot({ path: 'docs/screens/02-section.png' });
});

test('walk mode starts at the street and moves with the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-3d').click();
  await ready(page);
  await page.getByTestId('walk').click();
  await expect(page.getByLabel('Walk controls')).toBeVisible();
  const before = await page.evaluate(() => (window as unknown as { __casa3d: Hook }).__casa3d.project(4.5, 0, 3.2));
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowUp');
  const after = await page.evaluate(() => (window as unknown as { __casa3d: Hook }).__casa3d.project(4.5, 0, 3.2));
  expect(after).not.toEqual(before); // the camera moved
});

test('drag the section plane by its red bar', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-3d').click();
  await ready(page);
  await page.getByRole('button', { name: 'Section & sun ▾' }).click();
  await page.getByTestId('section-along').click();
  await page.getByRole('button', { name: 'Less ▴' }).click();
  await page.waitForTimeout(500);
  const [x, y] = await screen(page, 2.45, 14, 8);
  const [x2, y2] = await screen(page, 4.45, 14, 8);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + ((x2 - x) * i) / 10, y + ((y2 - y) * i) / 10);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Section & sun ▾' }).click();
  const v = Number(await page.getByTestId('section-pos').inputValue());
  expect(v).toBeGreaterThan(3.5);
});
