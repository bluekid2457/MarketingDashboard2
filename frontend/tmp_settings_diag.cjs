const { chromium } = require('playwright');

(async () => {
  const BASE = process.env.BASE_URL || 'http://localhost:3000';

  const result = {
    url: '',
    h1: '',
    aiConfigSectionVisible: false,
    saveButtonVisible: false,
    sessionSectionVisible: false,
    sectionCount: 0,
    consoleErrors: [],
    pageErrors: [],
    verdict: 'FAIL',
    failReason: ''
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        result.consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      result.pageErrors.push(error && error.message ? error.message : String(error));
    });

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });

    await page.fill('input[type="email"], input[name="email"]', 'qa@example.com');
    await page.fill('input[type="password"], input[name="password"]', 'Sample!');
    await page.click('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")');

    try {
      await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 20000 });
    } catch (_) {
      // Continue diagnostics even if login navigation is slow.
    }

    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 30000 });

    const h1Locator = page.locator('main h1, h1, [role="main"] [role="heading"]').first();
    if (await h1Locator.count()) {
      result.h1 = ((await h1Locator.textContent()) || '').trim();
    }

    const aiSection = page.locator('section').filter({ hasText: /AI API Keys|Active Provider/i }).first();
    if (await aiSection.count()) {
      result.aiConfigSectionVisible = await aiSection.isVisible().catch(() => false);
      result.saveButtonVisible = await aiSection.getByRole('button', { name: /save/i }).first().isVisible().catch(() => false);
    } else {
      result.aiConfigSectionVisible = await page.getByText(/AI API Keys|Active Provider/i).first().isVisible().catch(() => false);
      result.saveButtonVisible = await page.getByRole('button', { name: /save/i }).first().isVisible().catch(() => false);
    }

    result.sessionSectionVisible = await page.getByText(/Log out|Session/i).first().isVisible().catch(() => false);
    result.sectionCount = await page.locator('section').count();
    result.url = page.url();

    const failReasons = [];
    if (!result.h1) failReasons.push('Missing page heading');
    if (!result.aiConfigSectionVisible) failReasons.push('AI API Keys/Active Provider section not visible');
    if (!result.saveButtonVisible) failReasons.push('Save button not visible in AI config section');
    if (!result.sessionSectionVisible) failReasons.push('Session/Log out section not visible');

    let pathname = '';
    try {
      pathname = new URL(result.url).pathname;
    } catch (_) {
      pathname = '';
    }
    if (pathname !== '/settings') {
      failReasons.push(`Unexpected final path: ${pathname || result.url}`);
    }

    if (result.consoleErrors.length > 0) {
      failReasons.push(`Console errors detected: ${result.consoleErrors.length}`);
    }
    if (result.pageErrors.length > 0) {
      failReasons.push(`Page errors detected: ${result.pageErrors.length}`);
    }

    if (failReasons.length === 0) {
      result.verdict = 'PASS';
      result.failReason = '';
    } else {
      result.verdict = 'FAIL';
      result.failReason = failReasons.join('; ');
    }
  } catch (error) {
    result.verdict = 'FAIL';
    result.failReason = error && error.message ? error.message : String(error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(JSON.stringify(result, null, 2));
})();
