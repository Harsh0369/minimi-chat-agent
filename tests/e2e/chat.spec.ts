import { test, expect } from '@playwright/test';

test('mobile history is a modal drawer with Escape and focus restoration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open conversations' });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveCount(0);
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Conversations' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close conversations' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await trigger.click();
  await expect(page.getByRole('navigation').getByText('New conversation')).toBeVisible();
  await page.screenshot({ path: 'test-results/chat-mobile-drawer.png' });
});

test('active chat fills the viewport, renders Markdown, and preserves scroll position', async ({
  page,
}) => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    role: i % 2 ? 'assistant' : 'user',
    text:
      i % 2
        ? `### Answer ${i}\n\nA **clear explanation** with [a source](https://example.com).\n\n- First point\n- Second point`
        : `Question ${i}`,
    createdAt: i,
  }));
  await page.route('**/api/conversations?*', (route) =>
    route.fulfill({ json: { items: [{ id: 'fixture', title: 'Research conversation' }] } }),
  );
  await page.route('**/api/conversations/fixture/messages?*', (route) =>
    route.fulfill({ json: { items: messages, hasMore: false } }),
  );
  await page.route('**/api/conversations/fixture/latest-turn', (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Answer 29' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pick up where you left off.' })).toHaveCount(0);
  await expect(
    page.getByText('Conversations are stored on this computer.', { exact: false }),
  ).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.getByRole('textbox', { name: 'Message' }).boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(844);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/chat-${width}.png` });
  }
  const transcript = page.getByTestId('transcript');
  await transcript.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.getByRole('button', { name: 'Jump to latest message' })).toBeVisible();
  await page.getByRole('button', { name: 'Jump to latest message' }).click();
  await expect(page.getByRole('heading', { name: 'Answer 29' })).toBeInViewport();
});

test('renders incremental text before completion and replaces it with the persisted final answer', async ({
  page,
}) => {
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: {
        stage: 'agent',
        capabilities: { chat: true, memory: true, webSearch: true },
        configuration: { providersConfigured: true, missing: [] },
      },
    }),
  );
  await page.route('**/api/conversations?*', (route) =>
    route.fulfill({ json: { items: [{ id: 'stream-fixture', title: 'Streaming test' }] } }),
  );
  await page.route('**/api/conversations/stream-fixture/latest-turn', (route) =>
    route.fulfill({ json: null }),
  );
  await page.addInitScript(() => {
    const original = window.fetch;
    let completed = false;
    window.fetch = async (input, init) => {
      const path = String(input);
      if (path.includes('/stream-fixture/messages?'))
        return Response.json({
          items: completed
            ? [
                { id: 'user', role: 'user', text: 'Explain streaming', createdAt: 1 },
                {
                  id: 'answer',
                  role: 'assistant',
                  text: 'First chunk. Final answer.',
                  createdAt: 2,
                },
              ]
            : [],
          hasMore: false,
        });
      if (path.endsWith('/stream-fixture/messages') && init?.method === 'POST') {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"type":"delta","text":"First chunk."}\n'));
              Object.assign(window, {
                finishTestStream: () => {
                  completed = true;
                  controller.enqueue(
                    encoder.encode(
                      '{"type":"delta","text":" Final answer."}\n{"type":"done","turnId":"fixture","state":"completed"}\n',
                    ),
                  );
                  controller.close();
                },
              });
            },
          }),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
      return original(input, init);
    };
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeEnabled();
  await input.fill('Explain streaming');
  await input.press('Enter');
  await expect(page.getByLabel('Answer in progress')).toHaveText('First chunk.');
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pick up where you left off.' })).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { finishTestStream: () => void }).finishTestStream(),
  );
  await expect(page.getByLabel('Assistant message', { exact: true })).toHaveText(
    'First chunk. Final answer.',
  );
  await expect(page.getByLabel('Answer in progress')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
});
