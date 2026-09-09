import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const password = 'playwright-password-123';

const register = async (
  context: BrowserContext,
  displayName: string,
  email: string
): Promise<Page> => {
  const page = await context.newPage();
  await page.goto('/register');
  await page.getByLabel('Display name').fill(displayName);
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

const expectEditorText = async (page: Page, text: string): Promise<void> => {
  await expect(page.getByTestId('product-editor').locator('.monaco-editor')).toContainText(text);
};

test('nested workspace sharing, collaboration, presence, versions, and restore', async ({
  browser
}) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ownerEmail = `owner-${unique}@example.test`;
  const memberEmail = `member-${unique}@example.test`;
  const ownerName = `Owner ${unique.slice(-5)}`;
  const memberName = `Member ${unique.slice(-5)}`;
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  await ownerContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:3000'
  });

  try {
    const ownerPage = await register(ownerContext, ownerName, ownerEmail);
    const ownerWorkspaceUrl = ownerPage.url();
    expect(new URL(ownerWorkspaceUrl).hash).toBe('');

    const memberPage = await register(memberContext, memberName, memberEmail);
    await memberPage.getByRole('button', { name: 'Sign out' }).click();
    await expect(memberPage).toHaveURL(/\/login$/);

    await ownerPage.getByRole('button', { name: 'Folder', exact: true }).click();
    await ownerPage.getByLabel('Folder name').fill('Insurance');
    await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(ownerPage.getByText('Insurance', { exact: true })).toBeVisible();

    await ownerPage.getByRole('button', { name: 'Folder', exact: true }).click();
    await ownerPage.getByLabel('Folder name').fill('Claims');
    await ownerPage.getByLabel('Parent folder').selectOption({ label: 'Insurance' });
    await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(ownerPage.getByText('Claims', { exact: true })).toBeVisible();

    await ownerPage.getByRole('button', { name: 'Diagram', exact: true }).click();
    await ownerPage.getByLabel('Diagram title').fill('Claim Lifecycle');
    await ownerPage
      .getByLabel('Folder', { exact: true })
      .selectOption({ label: 'Insurance / Claims' });
    await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(ownerPage).toHaveURL(/\/workspace\/[\da-f-]+\/diagram\/[\da-f-]+$/);
    expect(new URL(ownerPage.url()).hash).toBe('');
    await expect(ownerPage.getByText('Live and synchronized')).toBeVisible({ timeout: 30_000 });
    await expectEditorText(ownerPage, 'Christmas');
    const sharedDiagramUrl = ownerPage.url();

    await ownerPage.getByRole('button', { name: 'Share' }).click();
    await ownerPage.getByLabel('Registered user email').fill(memberEmail);
    await ownerPage.getByLabel('Role').selectOption('editor');
    await ownerPage.getByRole('button', { name: 'Add access' }).click();
    await expect(ownerPage.getByText('Access added.')).toBeVisible();
    const memberRoleSelect = ownerPage.getByLabel(`Role for ${memberName}`);
    await expect(ownerPage.getByText(memberEmail, { exact: true })).toBeVisible();
    await expect(memberRoleSelect).toHaveValue('editor');
    await expect(
      ownerPage.getByRole('button', { name: `Remove access for ${memberName}` })
    ).toBeVisible();
    await memberRoleSelect.selectOption('viewer');
    await expect(ownerPage.getByText(`${memberName}'s role updated to viewer.`)).toBeVisible();
    await memberRoleSelect.selectOption('editor');
    await expect(ownerPage.getByText(`${memberName}'s role updated to editor.`)).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Close' }).click();

    await memberPage.getByLabel('Email address').fill(memberEmail);
    await memberPage.getByLabel('Password').fill(password);
    await memberPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(memberPage).toHaveURL(/\/workspace\/[\da-f-]+$/);
    await memberPage.goto(ownerWorkspaceUrl);
    await expect(memberPage.getByText('Claims', { exact: true })).toBeVisible();
    await expect(memberPage.getByText('Claim Lifecycle', { exact: true })).toBeVisible();
    await expect(memberPage.getByText('Insurance', { exact: true })).toHaveCount(0);
    await memberPage.goto(sharedDiagramUrl);
    await expect(memberPage.getByText('Live and synchronized')).toBeVisible({ timeout: 30_000 });
    await expectEditorText(memberPage, 'Christmas');

    await expect(ownerPage.getByTestId('presence-user')).toHaveAttribute('title', memberName);
    await expect(memberPage.getByTestId('presence-user')).toHaveAttribute('title', ownerName);

    const ownerPreview = ownerPage.getByRole('region', { name: 'Diagram preview' });
    const ownerPreviewBounds = await ownerPreview.boundingBox();
    if (!ownerPreviewBounds) throw new Error('Owner preview has no bounds');
    await ownerPage.mouse.move(
      ownerPreviewBounds.x + ownerPreviewBounds.width / 2,
      ownerPreviewBounds.y + ownerPreviewBounds.height / 2
    );
    await expect(memberPage.getByTestId('preview-cursor').getByText(ownerName)).toBeVisible();

    const ownerMarker = `Owner${unique.replaceAll(/\W/g, '')}`;
    const memberMarker = `Member${unique.replaceAll(/\W/g, '')}`;
    const versionContent = `flowchart LR\n  ${ownerMarker} --> Shared`;
    await replaceEditorText(ownerPage, versionContent);
    await expectEditorText(memberPage, ownerMarker);
    await ownerPage.getByRole('button', { name: 'Hide code' }).click();
    await ownerPage
      .locator('#container svg')
      .getByText(ownerMarker, { exact: true })
      .first()
      .dblclick();
    await expect(ownerPage.getByRole('button', { name: 'Hide code' })).toBeVisible();
    await ownerPage.keyboard.press('Control+C');
    await expect
      .poll(() => ownerPage.evaluate(() => navigator.clipboard.readText()))
      .toBe(`${ownerMarker} --> Shared`);
    const sharedContent = `${versionContent}\n  Shared --> ${memberMarker}`;
    await replaceEditorText(memberPage, sharedContent);
    await expectEditorText(ownerPage, memberMarker);

    await ownerPage.getByRole('button', { name: 'Versions' }).click();
    await ownerPage.getByPlaceholder('Version note (optional)').fill('Collaborative baseline');
    await ownerPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(ownerPage.getByText('Version saved.')).toBeVisible();
    await ownerPage.getByRole('button', { name: /Collaborative baseline/ }).click();
    await expect(ownerPage.getByText(/Version \d+ preview and diff/)).toBeVisible();

    const laterMarker = `Later${unique.replaceAll(/\W/g, '')}`;
    await replaceEditorText(memberPage, `${sharedContent}\n  ${memberMarker} --> ${laterMarker}`);
    await expectEditorText(ownerPage, laterMarker);

    ownerPage.once('dialog', (dialog) => dialog.accept());
    await ownerPage.getByRole('button', { name: 'Restore', exact: true }).click();
    await expectEditorText(ownerPage, memberMarker);
    await expectEditorText(memberPage, memberMarker);
    await expect(
      ownerPage.getByTestId('product-editor').locator('.monaco-editor')
    ).not.toContainText(laterMarker);
    await expect(
      memberPage.getByTestId('product-editor').locator('.monaco-editor')
    ).not.toContainText(laterMarker);

    await ownerPage.getByRole('button', { name: 'Share' }).click();
    ownerPage.once('dialog', (dialog) => dialog.accept());
    await ownerPage.getByRole('button', { name: `Remove access for ${memberName}` }).click();
    await expect(ownerPage.getByText(`Access removed for ${memberName}.`)).toBeVisible();
    await expect(ownerPage.getByText(memberEmail, { exact: true })).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});
