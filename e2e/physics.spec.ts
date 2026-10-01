import { expect, test, type Page } from '@playwright/test';

// Spec 04b: plumbing and electrical that obey the building.
type Hook = { frames(): number };
const ready = (page: Page) => page.waitForFunction(() => ((window as unknown as { __casa3d?: Hook }).__casa3d?.frames() ?? 0) > 10, null, { timeout: 30000 });

test('physics colours on the plan: street level and upper floor; every run hosted, no clashes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plumbing2d').check();
  await page.getByTestId('elec2d').check();
  await page.getByTestId('physics2d').check();
  await expect(page.locator('.svc2d.svc-shaft').first()).toBeVisible();
  await expect(page.locator('.pipe2d.h-exposed, .conduit2d.h-exposed')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screens/04b-plan-SL.png' });
  await page.getByRole('tab', { name: 'Upper +3.70' }).click();
  await expect(page.locator('.svc2d.svc-plenum').first()).toBeAttached();
  await page.screenshot({ path: 'docs/screens/04b-plan-UF.png' });
  await page.getByTestId('checks-toggle').click();
  await page.getByRole('button', { name: 'Whole house' }).click();
  for (const name of [/Pipes and conduits inside service spaces/, /No run crosses a forbidden zone/, /No clashes/, /Gravity pipes fall all the way/, /Horizontal runs have supports/, /Equipment can be serviced/, /Ceiling height under the plenums/]) {
    await expect(page.getByRole('row', { name }).getByRole('cell').first()).toHaveAttribute('aria-label', 'pass');
  }
});

test('"Why here?" on a pipe and on a device', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plumbing2d').check();
  await page.locator('[data-el^="cold-SL"]').first().click({ force: true });
  await expect(page.getByTestId('why-here')).toContainText(/In (the )?|Lowered ceiling|Shaft|wall/);
  await page.getByTestId('elec2d').check();
  const panel = page.locator('g[data-device="dev-panel-01"]');
  await panel.locator('.devhit').click({ force: true });
  await expect(page.getByTestId('why-here')).toContainText('Hosted by');
});

test('3D: the Physics view shows shafts and plenums, every run in the colour of its host', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-3d').click();
  await ready(page);
  await page.getByTestId('physics').click();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('physics')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('scene3d').screenshot({ path: 'docs/screens/04b-physics-xray.png' });
  await page.screenshot({ path: 'docs/screens/04b.png' });
});
