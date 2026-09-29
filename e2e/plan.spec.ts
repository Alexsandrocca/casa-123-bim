import { expect, test, type Page } from '@playwright/test';

const area = (page: Page, room: string) => page.locator(`text[data-room="${room}"]`);

async function dragLine(page: Page, selector: string, dx: number, dy: number) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

test('opens Version 2 on the street level with the prototype room areas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Version 2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'Street +0.60' })).toHaveAttribute('aria-selected', 'true');
  await expect(area(page, 'Kitchen')).toHaveText('14.0 m²');
  await expect(area(page, 'Dining')).toHaveText('10.8 m²');
  await expect(area(page, 'Living')).toHaveText('16.2 m²');
  await expect(area(page, 'Garage')).toHaveText('27.0 m²');
  await expect(page.getByTestId('checks-fail')).toHaveText('0 fail');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screens/01.png' });
});

test('dragging the kitchen/dining wall changes both rooms live, and undo restores them', async ({ page }) => {
  await page.goto('/');
  await expect(area(page, 'Kitchen')).toHaveText('14.0 m²');
  // Towards the rear (up on screen) makes the kitchen bigger and the dining room smaller.
  await dragLine(page, '[data-line^="h:7.60:"]', 0, -40);
  const kitchen = Number((await area(page, 'Kitchen').textContent())!.split(' ')[0]);
  const dining = Number((await area(page, 'Dining').textContent())!.split(' ')[0]);
  expect(kitchen).toBeGreaterThan(14.0);
  expect(dining).toBeLessThan(10.8);
  expect(Math.abs(kitchen + dining - 24.8)).toBeLessThanOrEqual(0.1 + 1e-9); // labels are rounded to 0.1 m²
  await page.keyboard.press('ControlOrMeta+z');
  await expect(area(page, 'Kitchen')).toHaveText('14.0 m²');
  await expect(area(page, 'Dining')).toHaveText('10.8 m²');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(area(page, 'Kitchen')).toHaveText(`${kitchen.toFixed(1)} m²`);
});

test('the stair walls stay fixed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Upper +3.70' }).click();
  await dragLine(page, '[data-line^="v:1.60:"]', 40, 0);
  await expect(page.getByRole('status')).toContainText('stair core');
  await expect(area(page, 'Bedroom 2')).toHaveText('10.2 m²');
});

test('Version 1 and Version 2 keep their edits separately', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Version 1' }).click();
  await expect(area(page, 'Kitchen')).toHaveText('18.9 m²'); // Version 1 kitchen: 5.4 × 3.5
  await dragLine(page, '[data-line^="v:5.40:0.00"]', -40, 0);
  const v1Kitchen = await area(page, 'Kitchen').textContent();
  expect(v1Kitchen).not.toBe('18.9 m²');
  await page.getByRole('button', { name: 'Version 2' }).click();
  await expect(area(page, 'Kitchen')).toHaveText('14.0 m²');
  await page.getByRole('button', { name: 'Version 1' }).click();
  await expect(area(page, 'Kitchen')).toHaveText(v1Kitchen!);
  // Survives a reload (autosave in the browser).
  await page.waitForTimeout(400);
  await page.reload();
  await expect(area(page, 'Kitchen')).toHaveText(v1Kitchen!);
});

test('select a door, resize it, flip it and delete it', async ({ page }) => {
  await page.goto('/');
  const door = page.locator('[data-opening="SL-door-03"] .hit');
  await door.click();
  await expect(page.getByTestId('op-width')).toHaveValue('0.80');
  await page.getByRole('button', { name: '+ 10 cm' }).click();
  await expect(page.getByTestId('op-width')).toHaveValue('0.90');
  await page.getByRole('button', { name: 'Flip swing' }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-opening="SL-door-03"]')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(page.locator('[data-opening="SL-door-03"]')).toHaveCount(1);
});

test('double-click an outside wall adds a window; checks list opens', async ({ page }) => {
  await page.goto('/');
  const before = await page.locator('[data-opening]').count();
  const wall = (await page.locator('[data-wall="SL-wall-02"]').boundingBox())!; // north wall
  await page.mouse.dblclick(wall.x + wall.width / 2, wall.y + wall.height * 0.1);
  await expect(page.locator('[data-opening]')).toHaveCount(before + 1);
  await page.getByTestId('checks-toggle').click();
  await expect(page.getByRole('cell', { name: /Civil Code/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.getByRole('dialog')).toContainText('licensed professionals');
});

test('drag a door along its wall', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-opening="SL-door-03"] .hit').click();
  await expect(page.getByText('y = 5.00, x 3.40 → 4.20')).toBeVisible();
  await dragLine(page, '[data-opening="SL-door-03"] .hit', 60, 0);
  await expect(page.getByText('y = 5.00, x 3.40 → 4.20')).toHaveCount(0);
  await expect(page.getByText(/^y = 5\.00, x /)).toBeVisible();
});

test('Save model downloads the JSON and Open model loads it back', async ({ page }) => {
  await page.goto('/');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save model' }).click()]);
  expect(download.suggestedFilename()).toBe('casa-123-v2.json');
  const model = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  // Rename the kitchen in the saved file, then open it.
  const kitchen = model.elements.find((e: { type: string; level: string; props: { name: string } }) => e.type === 'Space' && e.level === 'SL' && e.props.name === 'Kitchen');
  kitchen.props.name = 'Cozinha';
  await page.getByTestId('open-file').setInputFiles({ name: 'm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(area(page, 'Cozinha')).toHaveText('14.0 m²');
  await page.getByTestId('undo').click();
  await expect(area(page, 'Kitchen')).toHaveText('14.0 m²');
  await page.getByTestId('open-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole('status')).toContainText('not a Casa 123 model');
});
