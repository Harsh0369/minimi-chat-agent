import { expect, test } from '@playwright/test';

test('creates, resumes and deletes conversations in the browser', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Conversations' }).getByText('New conversation'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('navigation', { name: 'Conversations' }).getByText('New conversation'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete New conversation' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Conversations' }).getByText('New conversation'),
  ).toHaveCount(0);
});

test('keeps workspace sessions in HttpOnly cookies and isolates browser contexts', async ({
  page,
  browser,
}) => {
  const firstSession = page.waitForResponse(
    (response) => response.url().endsWith('/api/session') && response.request().method() === 'POST',
  );
  await page.goto('/');
  expect((await firstSession).ok()).toBe(true);
  const first = await page.evaluate(async () => {
    const session = await fetch('/api/session');
    const created = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Browser session' }),
    });
    return {
      sessionStatus: session.status,
      conversation: (await created.json()) as { id: string },
      visibleCookie: document.cookie,
    };
  });
  expect(first.sessionStatus).toBe(200);
  expect(first.visibleCookie).not.toContain('thread_session');
  await page.reload();
  expect(
    await page.evaluate(
      async (id) => (await fetch('/api/conversations/' + id)).status,
      first.conversation.id,
    ),
  ).toBe(200);
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    const secondSession = second.waitForResponse(
      (response) =>
        response.url().endsWith('/api/session') && response.request().method() === 'POST',
    );
    await second.goto('http://127.0.0.1:3100/');
    expect((await secondSession).ok()).toBe(true);
    const status = await second.evaluate(async (id) => {
      return (await fetch('/api/conversations/' + id)).status;
    }, first.conversation.id);
    expect(status).toBe(404);
  } finally {
    await other.close();
  }
});

test('requires an explicit choice before replacing an expired workspace session', async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: 'thread_session',
      value: 'a'.repeat(43),
      url: 'http://127.0.0.1:3100/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('session has expired');
  expect(await page.evaluate(() => document.cookie)).not.toContain('thread_session');
  const newSession = page.waitForResponse(
    (response) => response.url().endsWith('/api/session') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start new workspace' }).click();
  expect((await newSession).ok()).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(async () => (await fetch('/api/session')).status)).toBe(200);
});

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
  const statusResponse = page.waitForResponse('**/api/status');
  await page.goto('/');
  expect((await statusResponse).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Pick up where you left off.' })).toBeVisible();
  await expect(page.getByText('Local server connected')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await expect(
    page.getByText('Set GEMINI_API_KEY and TAVILY_API_KEY', { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.screenshot({ path: 'test-results/foundation-desktop.png', fullPage: true });
});

test('offers a working retry after a service failure', async ({ page }) => {
  await page.route('**/api/status', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Couldn’t load this workspace.');
  await page.unroute('**/api/status');
  const retryResponse = page.waitForResponse('**/api/status');
  await page.getByRole('button', { name: 'Try again' }).click();
  expect((await retryResponse).ok()).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('fits a narrow viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pick up where you left off.' })).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  await page.screenshot({ path: 'test-results/foundation-mobile.png', fullPage: true });
});

test('keeps the composer within the viewport across layout breakpoints', async ({ page }) => {
  await page.goto('/');
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const composer = await page.getByRole('textbox', { name: 'Message' }).boundingBox();
    expect(composer).not.toBeNull();
    expect(composer!.x).toBeGreaterThanOrEqual(0);
    expect(composer!.x + composer!.width).toBeLessThanOrEqual(width);
  }
});

test('supports keyboard navigation to the conversation and retry control', async ({ page }) => {
  await page.route('**/api/status', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to conversation' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  await page.unroute('**/api/status');
  const retryResponse = page.waitForResponse('**/api/status');
  await page.keyboard.press('Enter');
  expect((await retryResponse).ok()).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
