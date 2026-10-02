// P0: Projects home, DESIGN / BIM tabs, approval, a second project, AI without a key, dry run, language.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCasa } from './helpers';

const area = (page: Page, room: string) => page.locator(`text[data-room="${room}"]`);

async function dragLine(page: Page, selector: string, dx: number, dy: number) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

test('Projects home shows Casa 123; opening it lands on DESIGN with Version 3 in the simple style', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('casabim.lang', 'en'); localStorage.setItem('casabim.legacyImported', 'yes'); });
  await page.goto('/#/');
  await expect(page.getByTestId('project-casa-123')).toContainText('Casa 123');
  await expect(page.getByTestId('project-casa-123')).toContainText('Rua Alceu Maynardi Araújo');
  await expect(page.getByTestId('legal-footer')).toContainText('ART/RRT');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screens/P0-home.png' });

  // a test copy, so the committed project stays as it is
  await openCasa(page, { tab: 'design' });
  await expect(page.getByTestId('tab-design')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Version 3' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('approval-bar')).toContainText('Approved 1');
  // the simple style: rooms, names, areas, walls, doors and windows — no dimension chains, systems or checks bar
  await expect(area(page, 'Kitchen')).toBeVisible();
  await expect(page.locator('.plan .dim')).toHaveCount(0);
  await expect(page.getByTestId('checks-toggle')).toHaveCount(0);
  await expect(page.getByTestId('plumbing2d')).toHaveCount(0);
  await expect(page.getByTestId('step-lot')).toBeDisabled();
  await expect(page.getByTestId('step-lot')).toContainText('coming in P1');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screens/P0-design.png' });

  // BIM = today's app on the approved Version 3
  await page.getByTestId('tab-bim').click();
  await expect(page.getByTestId('gross')).toHaveText(/Version 3 · BIM · 78\.\d m² gross/);
  await expect(page.getByTestId('checks-confirm')).toHaveText('3 to confirm');
  await expect(page.getByTestId('engineering')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screens/P0-bim.png' });
});

test('approval: a wall edited in DESIGN shows 1 change on both tabs; Re-approve updates BIM; Discard restores', async ({ page }) => {
  await openCasa(page, { tab: 'design' });
  await expect(page.getByTestId('approval-bar')).toContainText('No changes since approval');
  await expect(area(page, 'Kitchen')).toHaveText('14.0 m²');
  // the kitchen/dining wall, towards the rear
  await dragLine(page, '[data-line^="h:7.60:"]', 0, -40);
  await expect(page.getByTestId('changes-since-approval')).toHaveText('Changes since approval: 1');
  const kitchen = await area(page, 'Kitchen').textContent();
  expect(kitchen).not.toBe('14.0 m²');
  // BIM still shows the approved design, with the same notice
  await page.getByTestId('tab-bim').click();
  await expect(page.getByTestId('changes-since-approval')).toHaveText('Changes since approval: 1');
  await expect(area(page, 'Kitchen')).toHaveText('14.0 m²');
  // Re-approve: BIM follows the design
  await page.getByTestId('reapprove').click();
  await expect(page.getByTestId('approval-bar')).toContainText('Approved 2');
  await expect(page.getByTestId('approval-bar')).toContainText('No changes since approval');
  await expect(area(page, 'Kitchen')).toHaveText(kitchen!);
  // a new edit (a rename), then Discard: the design goes back to Approved 2
  await page.getByTestId('tab-design').click();
  await page.locator('.roomlist button', { hasText: 'Kitchen' }).click();
  await page.getByTestId('design-room-name').fill('Cozinha');
  await page.getByTestId('design-room-name').press('Enter');
  await expect(page.getByTestId('changes-since-approval')).toHaveText('Changes since approval: 1');
  await page.getByTestId('discard').click();
  await expect(page.getByTestId('approval-bar')).toContainText('No changes since approval');
  await expect(area(page, 'Kitchen')).toHaveText(kitchen!);
  await expect(area(page, 'Cozinha')).toHaveCount(0);
});

test('the flat-lot project opens without errors, with its own place and no Casa 123 facts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../tests/fixtures/flat-lot/${f}`, import.meta.url), 'utf8'));
  const model = read('versions/v1.json');
  const made = await (await page.request.post('/api/projects/import', { data: { schema: 'casabim-export/1', project: { ...read('project.json'), language: 'en' }, files: { 'versions/v1.json': model, 'originals/v1.json': model } } })).json();
  await page.addInitScript(() => { localStorage.setItem('casabim.lang', 'en'); localStorage.setItem('casabim.ui.1', JSON.stringify({ level: 'GF', view: 'split' })); });
  await page.goto(`/#/p/${made.id}/design`);
  await expect(page.getByTestId('project-name')).toHaveText('Flat lot test');
  await expect(area(page, 'Bedroom')).toBeVisible();
  await expect(page.locator('.plan .street')).toHaveText('STREET · WEST ↓ · NORTH ←');
  await expect(page.getByTestId('scene3d')).toBeVisible();
  await page.waitForFunction(() => ((window as unknown as { __casa3d?: { frames(): number } }).__casa3d?.frames() ?? 0) > 10, null, { timeout: 30000 });
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('tab-bim')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('checks-toggle').click();
  await page.getByRole('button', { name: 'Whole house' }).click();
  await expect(page.getByRole('row', { name: /City rules for Florianópolis/ })).toContainText('TO CONFIRM');
  const text = await page.locator('body').innerText();
  for (const w of ['Piracicaba', 'Alceu', 'CPFL', 'SEMAE']) expect(text).not.toContain(w);
  await page.getByTestId('checks-toggle').click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screens/P0-flat-lot.png' });
  expect(errors).toEqual([]);
});

test('AI without a key: the app runs and explains how to add it', async ({ page }) => {
  await openCasa(page, { tab: 'design' });
  await expect(page.getByTestId('ai-indicator')).toHaveText('AI: no key');
  await page.getByTestId('ai-indicator').click();
  await expect(page.getByTestId('ai-howto')).toContainText('Add AI key.command');
  await expect(page.getByTestId('ai-howto')).toContainText('Never paste the key into a chat');
  await expect(page.getByTestId('ai-test')).toBeDisabled();
});

test('dry run from the hidden developer panel: shows the diff and changes nothing until Apply', async ({ page }) => {
  await openCasa(page, { tab: 'design', version: 'v2' });
  await expect(area(page, 'Garage')).toHaveText('27.0 m²');
  await page.keyboard.press('ControlOrMeta+Shift+D');
  await page.getByTestId('dev-input').fill('[{ "name": "resize_room", "args": { "room": "Garage", "deltaM2": -2 } }]');
  await page.getByTestId('dev-run').click();
  await expect(page.getByTestId('dev-diff')).toContainText('Garage: 27.0 → 25.1 m²');
  await expect(page.getByTestId('dev-diff')).toContainText('Wall between Garage and Kitchen moved 0.35 m east');
  await expect(area(page, 'Garage')).toHaveText('27.0 m²');
  await page.getByTestId('dev-apply').click();
  await expect(area(page, 'Garage')).toHaveText('25.1 m²');
  await page.getByTestId('undo').click();
  await expect(area(page, 'Garage')).toHaveText('27.0 m²');
});

test('the pt-BR toggle switches the visible UI; numbers in Brazilian format', async ({ page }) => {
  await openCasa(page, { tab: 'design' });
  await page.getByTestId('lang-pt-BR').click();
  await expect(page.getByTestId('tab-design')).toHaveText('PROJETO');
  await expect(page.getByTestId('approve')).toHaveText(/Reaprovar projeto/);
  await expect(page.getByTestId('home')).toContainText('Projetos');
  await expect(page.getByTestId('gross')).toContainText(/78,\d m²/);
  await page.getByTestId('tab-bim').click();
  await expect(page.getByTestId('engineering')).toContainText('Engenharia');
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('tab-design')).toHaveText('DESIGN');
});
