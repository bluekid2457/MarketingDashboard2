/**
 * Playwright e2e — /publish direct-LinkedIn-post flow.
 *
 * This spec exercises the connected-user path on the Publish page:
 *
 *   1. Mock GET /api/v1/integrations/status to return LinkedIn as connected.
 *   2. Mock POST /api/v1/publish/linkedin/now to return a fake post URN/URL.
 *   3. Sign the test user in (Firebase auth) and seed an adaptation with
 *      LinkedIn copy.
 *   4. Run the plagiarism check (or mock it through) so the button enables.
 *   5. Click "Publish to LinkedIn".
 *   6. Assert the notice flips to success and renders an anchor pointing to
 *      the mocked postUrl.
 *
 * NOTE: At the time this file was added, Playwright was not yet installed in
 * the frontend workspace and no other e2e specs existed. This spec is the
 * canonical reference for the direct-publish acceptance criteria once
 * Playwright + a Firebase emulator are wired up. Until then the assertions
 * below should be treated as the contract the implementation must satisfy.
 *
 * Run (once Playwright is installed):
 *   npx playwright test frontend/tests/e2e/publish-linkedin.spec.ts
 */

import { expect, test } from '@playwright/test';

const FAKE_POST_URN = 'urn:li:share:1234567890';
const FAKE_POST_URL = `https://www.linkedin.com/feed/update/${encodeURIComponent(FAKE_POST_URN)}`;

test.describe('Publish page — direct LinkedIn publishing', () => {
  test.beforeEach(async ({ page }) => {
    // 1. LinkedIn appears as a connected provider.
    await page.route('**/api/v1/integrations/status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connections: [
            {
              provider: 'linkedin',
              label: 'LinkedIn',
              authTypes: ['oauth2'],
              supportsDirectPublish: true,
              supportsScheduledPublish: false,
              supportedContentTypes: ['post'],
              status: 'connected',
              scopes: ['openid', 'profile', 'email', 'w_member_social'],
              metadata: { publishAuthorUrn: 'urn:li:person:test-member' },
            },
          ],
        }),
      });
    });

    // 2. Publish endpoint returns a deterministic success body.
    await page.route('**/api/v1/publish/linkedin/now', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          postUrn: FAKE_POST_URN,
          postUrl: FAKE_POST_URL,
        }),
      });
    });
  });

  test('connected user clicking "Publish to LinkedIn" sees a success notice with a working permalink', async ({
    page,
  }) => {
    await page.goto('/publish');

    // The test environment is expected to seed an adaptation containing
    // LinkedIn copy and to have run a passing plagiarism check so the button
    // is enabled. This is environment-specific and handled by the harness.
    const linkedinCard = page.getByTestId('publish-card-linkedin').first();
    await expect(linkedinCard).toBeVisible();

    const publishButton = linkedinCard.getByRole('button', { name: /Publish to LinkedIn/i });
    await expect(publishButton).toBeEnabled();

    await publishButton.click();

    // The button briefly transitions to "Posting…" before the mocked fetch
    // resolves. We assert the eventual success state and the link target.
    await expect(page.getByText('Published to LinkedIn.')).toBeVisible();
    const permalinkAnchor = page.getByRole('link', { name: /View on LinkedIn/i });
    await expect(permalinkAnchor).toHaveAttribute('href', FAKE_POST_URL);
  });

  test('expired token surfaces a "Reconnect" notice that links to /settings#integrations', async ({ page }) => {
    await page.route('**/api/v1/publish/linkedin/now', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'token_expired',
          status: 401,
        }),
      });
    });

    await page.goto('/publish');
    const publishButton = page
      .getByTestId('publish-card-linkedin')
      .first()
      .getByRole('button', { name: /Publish to LinkedIn/i });
    await publishButton.click();

    await expect(page.getByText(/Reconnect in Settings/i)).toBeVisible();
    const reconnectLink = page.getByRole('link', { name: /Open Settings/i });
    await expect(reconnectLink).toHaveAttribute('href', '/settings#integrations');
  });
});
