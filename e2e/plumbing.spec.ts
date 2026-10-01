import { expect, test, type Page } from '@playwright/test';

type Hook = { frames(): number };
const ready = (page: Page) => page.waitForFunction(() => ((window as unknown as { __casa3d?: Hook }).__casa3d?.frames() ?? 0) > 10, null, { timeout: 30000 });

test('plumbing on the plan: moving the kitchen sink 1 m re-routes its branch and the checks update', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plumbing2d').check();
  await expect(page.locator('[data-fixture="fx-kitchen-sink-01"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screens/03.png' });
  const branch = () => page.locator('line.pipe2d.s-sewage[data-el^="sew-kitchen"]').evaluateAll((ls) => ls.map((l) => [l.getAttribute('x1'), l.getAttribute('y1'), l.getAttribute('x2'), l.getAttribute('y2')].join()).sort().join('|'));
  const before = await branch();
  await page.locator('[data-fixture="fx-kitchen-sink-01"]').click();
  await expect(page.locator('.props h3')).toHaveText('Kitchen sink');
  await page.getByTestId('fx-y').fill('7.30');
  await page.getByTestId('fx-y').press('Enter');
  await expect(page.getByTestId('fx-y')).toHaveValue('7.30');
  expect(await branch()).not.toBe(before);
  await page.getByTestId('checks-toggle').click();
  await page.getByRole('button', { name: 'Whole house' }).click();
  await expect(page.getByRole('row', { name: /Slope · Kitchen line/ })).toContainText('lowest');
  await expect(page.getByRole('row', { name: /Pipe size · Kitchen line/ })).toBeVisible();
  // undo puts the sink back
  await page.keyboard.press('ControlOrMeta+z');
  expect(await branch()).toBe(before);
});

test('drag a fixture on the plan', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plumbing2d').check();
  const g = page.locator('[data-fixture="fx-kitchen-sink-01"] circle');
  const b = (await g.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2 - i * 6, b.y + b.height / 2 - i * 6);
  await page.mouse.up();
  await expect(page.locator('.props h3')).toHaveText('Kitchen sink');
  expect(Number(await page.getByTestId('fx-x').inputValue())).toBeLessThan(8.33);
});

test('plumbing window: sewer section, sewer depth 3.5 m makes the lower level pass, schedule CSV', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plumbing').click();
  await expect(page.getByTestId('riser')).toBeVisible();
  await page.getByRole('tab', { name: 'Sewer section' }).click();
  await expect(page.getByTestId('sewer-section')).toContainText('lift station needed');
  await page.locator('.modal .box').screenshot({ path: 'docs/screens/03-sewer-section.png' });
  await page.getByTestId('sewer-depth').fill('3.5');
  await page.getByTestId('sewer-depth').press('Enter');
  await expect(page.getByTestId('sewer-section')).toContainText('works');
  await page.getByRole('tab', { name: 'Schedule' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv').click()]);
  expect(download.suggestedFilename()).toBe('casa-123-v3-plumbing-schedule.csv');
  await page.keyboard.press('Escape');
  await page.getByTestId('checks-toggle').click();
  await page.getByRole('button', { name: 'Whole house' }).click();
  await expect(page.getByRole('row', { name: /Lower level drains to the street by gravity/ })).toContainText('gravity works');
});

test('3D systems x-ray', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-3d').click();
  await ready(page);
  await page.getByTestId('xray').click(); // turns to an overview from the north-front corner
  await page.waitForTimeout(900);
  await page.getByTestId('scene3d').screenshot({ path: 'docs/screens/03-xray.png' });
  await expect(page.getByTestId('xray')).toHaveAttribute('aria-pressed', 'true');
});
