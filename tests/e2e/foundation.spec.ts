import { expect, test } from '@playwright/test';

test('loads the real local shell with no provider traffic or browser errors', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:3100/')) external.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pick up where you left off.' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Local server connected');
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await expect(
    page.getByText('No messages are collected or sent to AI providers.', { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.screenshot({ path: 'test-results/foundation-desktop.png', fullPage: true });
});

test('offers a working retry after a service failure', async ({ page }) => {
  await page.route('**/api/status', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Connection unavailable');
  await page.unroute('**/api/status');
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('status')).toHaveText('Local server connected');
});

test('fits a narrow viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Local server connected');
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  await page.screenshot({ path: 'test-results/foundation-mobile.png', fullPage: true });
});
