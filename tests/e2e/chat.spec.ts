import { test, expect } from '@playwright/test';

test('copies answers and edits a question before regenerating its dependent reply', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let edited = false;
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
    route.fulfill({ json: { items: [{ id: 'fixture', title: 'First question' }] } }),
  );
  await page.route('**/api/conversations/fixture/latest-turn', (route) =>
    route.fulfill({ json: null }),
  );
  await page.route('**/api/conversations/fixture/messages?*', (route) =>
    route.fulfill({
      json: {
        items: edited
          ? [
              { id: 'replacement', role: 'user', text: 'Revised question', createdAt: 3 },
              { id: 'new-answer', role: 'assistant', text: 'Revised answer', createdAt: 4 },
            ]
          : [
              { id: 'first', role: 'user', text: 'First question', createdAt: 1 },
              { id: 'answer', role: 'assistant', text: 'First answer', createdAt: 2 },
            ],
        hasMore: false,
      },
    }),
  );
  await page.route('**/api/conversations/fixture/messages/first/edit', (route) => {
    edited = true;
    route.fulfill({
      body: '{"type":"delta","text":"Revised answer"}\n{"type":"done","turnId":"replacement-turn","state":"completed"}\n',
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  });
  await page.goto('/');
  await page
    .locator('[data-message-id="answer"]')
    .locator('..')
    .getByRole('button', { name: 'Copy message' })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('First answer');
  await page
    .locator('[data-message-id="first"]')
    .locator('..')
    .getByRole('button', { name: 'Edit message' })
    .click();
  await page.getByRole('textbox', { name: 'Edit your message' }).fill('Revised question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Assistant message', { exact: true })).toHaveText('Revised answer');
  await expect(page.getByText('First answer')).toHaveCount(0);
});

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
  await transcript.hover();
  await page.mouse.wheel(0, -3000);
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
                appendTestStream: (text: string) => {
                  controller.enqueue(
                    encoder.encode(`${JSON.stringify({ type: 'delta', text })}\n`),
                  );
                },
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
    (window as unknown as { appendTestStream: (text: string) => void }).appendTestStream(
      '\n\n' +
        Array.from({ length: 45 }, (_, index) => `Paragraph ${index}. A streamed sentence.`).join(
          '\n\n',
        ),
    ),
  );
  await expect(page.getByLabel('Answer in progress')).toContainText('Paragraph 44');
  const transcript = page.getByTestId('transcript');
  await expect
    .poll(() =>
      transcript.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
    )
    .toBeLessThan(12);
  await transcript.hover();
  await page.mouse.wheel(0, -500);
  await expect(page.getByRole('button', { name: 'Jump to latest message' })).toBeVisible();
  const pausedAt = await transcript.evaluate((node) => node.scrollTop);
  await page.evaluate(() =>
    (window as unknown as { appendTestStream: (text: string) => void }).appendTestStream(
      '\n\nMore streamed content after scrolling away.\n\nMore content again.',
    ),
  );
  await expect(page.getByLabel('Answer in progress')).toContainText('More content again');
  expect(await transcript.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(pausedAt + 12);
  await page.getByRole('button', { name: 'Jump to latest message' }).click();
  await expect
    .poll(() =>
      transcript.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
    )
    .toBeLessThan(12);
  await page.evaluate(() =>
    (window as unknown as { finishTestStream: () => void }).finishTestStream(),
  );
  await expect(page.getByLabel('Assistant message', { exact: true })).toHaveText(
    'First chunk. Final answer.',
  );
  await expect(page.getByLabel('Answer in progress')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
});

test('shows inline citations and compact source details without a URL appendix', async ({
  page,
}) => {
  await page.route('**/api/conversations?*', (route) =>
    route.fulfill({ json: { items: [{ id: 'sources-fixture', title: 'Cited answer' }] } }),
  );
  await page.route('**/api/conversations/sources-fixture/messages?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'answer',
            role: 'assistant',
            createdAt: 1,
            text: 'The price is listed here [S1].\n\nSources:\n[S1] Acme official pricing — https://example.com/pricing',
            sources: [
              {
                id: 'S1',
                title: 'Acme official pricing',
                url: 'https://example.com/pricing',
                excerpt: 'Price evidence',
                published: null,
                observedAt: '2026-11-12T00:00:00Z',
              },
            ],
          },
        ],
        hasMore: false,
      },
    }),
  );
  await page.route('**/api/conversations/sources-fixture/latest-turn', (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto('/');
  const answer = page.getByLabel('Assistant message', { exact: true });
  await expect(answer.getByRole('link', { name: 'Source 1' })).toHaveAttribute(
    'href',
    'https://example.com/pricing',
  );
  await expect(answer).not.toContainText('https://example.com/pricing');
  await expect(answer.getByText('1 source')).toBeVisible();
  await answer.getByText('1 source').click();
  await expect(answer.getByRole('link', { name: /Acme official pricing/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/compact-sources.png' });
});

test('searches all chats or the current chat and opens the matching message', async ({ page }) => {
  const messages = Array.from({ length: 24 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: index === 2 ? 'Gold price in India' : `Earlier question ${index}`,
    createdAt: index,
  }));
  await page.route('**/api/conversations?*', (route) =>
    route.fulfill({ json: { items: [{ id: 'research', title: 'Gold price in India' }] } }),
  );
  await page.route('**/api/conversations/research/messages?*', (route) =>
    route.fulfill({ json: { items: messages, hasMore: false } }),
  );
  await page.route('**/api/conversations/research/latest-turn', (route) =>
    route.fulfill({ json: null }),
  );
  const searched: string[] = [];
  await page.route('**/api/search?*', (route) => {
    searched.push(route.request().url());
    route.fulfill({
      json: {
        conversations: [],
        messages: [
          {
            messageId: 'message-2',
            conversationId: 'research',
            conversationTitle: 'Gold price in India',
            role: 'user',
            preview: 'Gold price in India',
            createdAt: 2,
          },
        ],
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('Earlier question 23')).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search conversations' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Search chats' }).fill('gold');
  await expect(dialog.getByRole('button', { name: /Gold price in India/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/search-desktop.png' });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: 'test-results/search-mobile.png' });
  await dialog.getByRole('button', { name: 'This chat' }).click();
  await expect.poll(() => searched.at(-1)).toContain('conversationId=research');
  await dialog.getByRole('button', { name: /Gold price in India/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-message-id="message-2"]')).toHaveClass(/ring-accent/);
  await expect(page.locator('[data-message-id="message-2"]')).toBeInViewport();
});

test('search remains usable with many results on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route('**/api/search?*', (route) =>
    route.fulfill({
      json: {
        conversations: [],
        messages: Array.from({ length: 40 }, (_, index) => ({
          messageId: `result-${index}`,
          conversationId: 'fixture',
          conversationTitle: `Research ${index}`,
          role: 'user',
          preview: `A long message about gold prices and regional markets ${index}`,
          createdAt: index,
        })),
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Search chats' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search conversations' });
  await dialog.getByRole('textbox', { name: 'Search chats' }).fill('gold');
  await expect(dialog.getByRole('button', { name: /Research 39/ })).toHaveCount(1);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(312);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: /Research 39/ }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: /Research 39/ })).toBeInViewport();
  await page.screenshot({ path: 'test-results/search-narrow-many-results.png' });
});
