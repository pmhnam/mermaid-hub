import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const password = 'playwright-password-123';

const register = async (context: BrowserContext, email: string): Promise<Page> => {
  const page = await context.newPage();
  await page.goto('/register');
  await page.getByLabel('Display name').fill('Public Link Owner');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/workspace\/[\da-f-]+$/);
  return page;
};

const replaceEditorText = async (page: Page, text: string): Promise<void> => {
  const editor = page.getByTestId('product-editor').locator('.monaco-editor');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
};

test('public links support view, edit, export, and immediate revocation', async ({ browser }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext({ acceptDownloads: true });
  await guestContext.addInitScript(() => {
    class TestClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    Object.defineProperty(window, 'ClipboardItem', { value: TestClipboardItem });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        write: async (items: TestClipboardItem[]) => {
          const mimeType = Object.keys(items[0]?.items ?? {})[0];
          await Promise.all(Object.values(items[0]?.items ?? {}));
          (window as Window & { copiedMimeType?: string }).copiedMimeType = mimeType;
        }
      }
    });
  });

  try {
    const ownerPage = await register(ownerContext, `public-${unique}@example.test`);
    await ownerPage.getByRole('button', { name: 'Diagram', exact: true }).click();
    await ownerPage.getByLabel('Diagram title').fill('Public Architecture');
    await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(ownerPage.getByText('Live and synchronized')).toBeVisible({ timeout: 30_000 });

    await ownerPage.getByRole('button', { name: 'Share' }).click();
    await expect(ownerPage.getByRole('heading', { name: 'Share diagram' })).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Create link' }).click();
    await expect(ownerPage.getByText('Public link created.')).toBeVisible();
    const publicUrl = await ownerPage.getByLabel('Public diagram link').inputValue();
    expect(publicUrl).toMatch(/\/share#[\w.-]+$/);
    const token = new URL(publicUrl).hash.slice(1);

    const guestPage = await guestContext.newPage();
    const leakedRequests: string[] = [];
    guestPage.on('request', (request) => {
      if (request.url().includes(token)) leakedRequests.push(request.url());
    });
    await guestPage.goto(publicUrl);
    await expect(guestPage.getByText('Public view link, live and read only')).toBeVisible();
    await expect(guestPage.getByTestId('product-editor')).toHaveCount(0);
    expect(leakedRequests).toEqual([]);

    await guestPage.getByRole('button', { name: 'Export' }).click();
    await expect(guestPage.getByRole('heading', { name: 'Export diagram' })).toBeVisible();
    await guestPage.getByText('black', { exact: true }).click();
    await guestPage.getByRole('button', { name: 'Copy PNG' }).click();
    await expect(guestPage.getByRole('button', { name: 'Copied PNG' })).toBeVisible();
    expect(
      await guestPage.evaluate(
        () => (window as Window & { copiedMimeType?: string }).copiedMimeType
      )
    ).toBe('image/png');
    await guestPage.getByText('MMD', { exact: true }).click();
    const downloadPromise = guestPage.waitForEvent('download');
    await guestPage.getByRole('button', { name: 'Download MMD' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('public-architecture.mmd');
    await guestPage.getByRole('button', { name: 'Cancel' }).click();

    await guestPage.getByRole('button', { name: 'Export' }).click();
    await guestPage.getByText('SVG', { exact: true }).click();
    const svgDownloadPromise = guestPage.waitForEvent('download');
    await guestPage.getByRole('button', { name: 'Download SVG' }).click();
    expect((await svgDownloadPromise).suggestedFilename()).toBe('public-architecture.svg');
    await guestPage.getByRole('button', { name: 'Cancel' }).click();

    await ownerPage.getByText('Can edit', { exact: true }).click();
    await expect(ownerPage.getByText('Public link updated.')).toBeVisible();
    await expect(guestPage.getByText('Public edit link, live and synchronized')).toBeVisible();
    await guestPage.getByRole('button', { name: 'Config' }).click();
    await replaceEditorText(guestPage, '{ "theme": "dark" }');
    await expect(guestPage.getByRole('button', { name: 'Config' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await guestPage.getByRole('button', { name: 'Code', exact: true }).click();
    const marker = `Guest${unique.replaceAll(/\W/g, '')}`;
    await replaceEditorText(guestPage, `flowchart LR\n  ${marker} --> Saved`);
    await ownerPage.getByRole('button', { name: 'Close' }).click();
    await expect(ownerPage.getByTestId('product-editor').locator('.monaco-editor')).toContainText(
      marker
    );

    ownerPage.once('dialog', (dialog) => dialog.accept());
    await ownerPage.getByRole('button', { name: 'Share' }).click();
    await ownerPage.getByRole('button', { name: 'Turn off' }).click();
    await expect(ownerPage.getByText('Public access turned off.')).toBeVisible();
    await expect(guestPage.getByText(/Retrying automatically/)).toBeVisible();

    const revokedPage = await guestContext.newPage();
    await revokedPage.goto(publicUrl);
    await expect(
      revokedPage.getByRole('heading', { name: 'Shared diagram unavailable' })
    ).toBeVisible();
  } finally {
    await Promise.allSettled([ownerContext.close(), guestContext.close()]);
  }
});

test('workspace navigation and editor controls adapt to a narrow viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { height: 844, width: 390 } });
  try {
    const page = await register(context, `mobile-${Date.now()}@example.test`);
    await expect(page.getByRole('button', { name: 'Open workspace navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'Open workspace navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Workspace diagrams' })).toBeVisible();
    await page.getByRole('button', { name: 'Diagram', exact: true }).click();
    await page.getByLabel('Diagram title').fill('Mobile Diagram');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('region', { name: 'Diagram preview' })).toBeVisible();
    await page.locator('#container svg').getByText('Christmas', { exact: true }).first().dblclick();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
    await page.setViewportSize({ height: 900, width: 960 });
    await expect(page.getByRole('button', { name: 'Hide code' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Diagram editor' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Diagram preview' })).toBeVisible();
  } finally {
    await context.close();
  }
});
