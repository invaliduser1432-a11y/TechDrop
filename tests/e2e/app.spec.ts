import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const token = readFileSync('.dev.vars', 'utf8').match(/^LOCAL_ADMIN_TOKEN=(.+)$/m)?.[1];
async function login(page: any) {
  await page.goto('/admin/login');
  await page.getByLabel('Local admin token').fill(token);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
test('public pages render evidence, search and filters without hydration dependence', async ({
  page,
  request,
}) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Atlas 2TB NVMe SSD');
  await page.goto('/');
  await expect(page.getByText('DEMONSTRATION MODE', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Good tech. Better prices.' })).toBeVisible();
  await page.getByLabel('Search tech deals').fill('Atlas');
  await page.getByLabel('Search tech deals').press('Enter');
  await expect(page).toHaveURL(/search\?q=Atlas/);
  await expect(page.locator('.deal-card')).toHaveCount(2);
  await page.goto('/deals');
  await page.getByLabel('Filter category').selectOption('storage');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('.deal-card')).toHaveCount(2);
  await page.goto('/deals?max=50');
  await expect(page.locator('.deal-card')).toHaveCount(3);
});
test('detail chart, theme and mobile layout work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/deals/atlas-2tb');
  await expect(page.getByRole('heading', { name: 'Atlas 2TB NVMe SSD' })).toBeVisible();
  await expect(page.getByText('$89.00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('We may earn a commission', { exact: false }).first()).toBeVisible();
  await page.locator('.chart-wrap').scrollIntoViewIfNeeded();
  await expect(page.locator('.recharts-surface')).toBeVisible();
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test('expired offers use 410 and unknown deals use 404', async ({ request }) => {
  expect((await request.get('/deals/beam-mini')).status()).toBe(410);
  expect((await request.get('/deals/unknown')).status()).toBe(404);
  expect((await request.get('/missing-page')).status()).toBe(404);
});
test('admin API blocks anonymous mutations and CSRF', async ({ page, request }) => {
  const blocked = await request.post('/api/admin/action', { data: { action: 'stop' } });
  expect(blocked.status()).toBe(401);
  await login(page);
  expect(
    (await page.request.post('/api/admin/action', { data: { action: 'stop' } })).status(),
  ).toBe(403);
  await expect(page.getByRole('heading', { name: 'DealRadar control center' })).toBeVisible();
});
test('retailer offers stay empty in demo and admin can prepare a search without activating an API', async ({
  page,
  request,
}) => {
  const response = await request.get('/offers');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.text()).toContain('No fresh retailer offers yet');
  await login(page);
  const section = page.locator('#retailer-sources');
  await expect(section).toContainText('Real retailer APIs require production mode');
  const form = section.locator('[data-form=retailer-target]');
  await form.locator('[name=provider]').selectOption('bestbuy');
  await form.locator('[name=query]').fill('NVMe SSD');
  await form.locator('[name=category]').selectOption('storage');
  await form.getByRole('button', { name: 'Add retailer search' }).click();
  await page.waitForLoadState('networkidle');
  const row = section.locator('tr').filter({ hasText: 'NVMe SSD' });
  await expect(row).toContainText('Review first');
  await page.getByRole('button', { name: 'Enable bestbuy', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('require production mode');
  await row.getByRole('button', { name: 'Remove search' }).click();
  await page.waitForLoadState('networkidle');
  await expect(section.locator('tr').filter({ hasText: 'NVMe SSD' })).toHaveCount(0);
});
test('admin saves settings, approves candidates and exercises simulated Buffer queue', async ({
  page,
}) => {
  await login(page);
  const settings = page.locator('#settings-form');
  await settings.locator('[name=postingMode]').selectOption('manual');
  await settings.locator('[name=organizationId]').fill('demo-org');
  await settings.locator('[name=channelId]').fill('demo-x');
  await settings.locator('[name=accountEligible]').check();
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#social')).toContainText('Mode: manual');
  const candidate = page.locator('#review tr').filter({ hasText: 'Stride 14 Gaming Laptop' });
  await candidate.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await expect(
    page.locator('#review tr').filter({ hasText: 'Stride 14 Gaming Laptop' }),
  ).toContainText('active');
  await page
    .locator('#review tr')
    .filter({ hasText: 'Aster G7 Graphics Card' })
    .getByRole('button', { name: 'Create draft' })
    .click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.post-preview').first()).toContainText('#ad');
  await page.getByRole('button', { name: 'Approve for queue' }).first().click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Process social queue' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#social')).toContainText('demo-queued');
  await page.getByRole('button', { name: 'Run monitoring now' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Stop everything' }).click();
  await expect(page.locator('.toast')).toContainText('stopped');
  await page.reload();
  await expect(page.locator('#social')).toContainText('Mode: disabled');
  // Restore safe development monitoring for the handoff; live publishing stays disabled.
  await page.locator('[name=monitoringEnabled]').check();
  await page.locator('#settings-form').getByRole('button', { name: 'Save settings' }).click();
  await page.waitForLoadState('networkidle');
});
