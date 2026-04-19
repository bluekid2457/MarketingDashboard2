const { chromium } = require('playwright');

(async () => {
  const BASE = 'http://localhost:3000';
  const results = {
    test1_anglesTimeout: 'FAIL',
    test1_detail: '',
    test2_adaptH1: 'FAIL',
    test2_h1Text: '',
    test3_duplicateKey: 'PASS',
    regression_dashboard: 'FAIL',
    regression_ideas: 'FAIL',
    regression_angles_fallback: 'FAIL',
    regression_settings: 'FAIL',
    overallVerdict: 'FAIL'
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const duplicateKeyWarnings = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (
      /Zero-Click Search/i.test(text) &&
      /(duplicate|unique|key)/i.test(text)
    ) {
      duplicateKeyWarnings.push(text);
    }
  });

  try {
    // Login flow
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[type="email"], input[name="email"]', 'qa@example.com');
    await page.fill('input[type="password"], input[name="password"]', 'Sample!');
    await page.click('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")');
    await page.waitForURL('**/dashboard**', { timeout: 20000 });

    // TEST 1: Angles timeout fallback
    await page.goto(`${BASE}/angles?ideaId=nonexistent-id-xyz-12345`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const t1Start = Date.now();
    let loadingDisappeared = false;
    let sawErrorWithin11s = false;

    // Poll until 12s max for loading to disappear and detect errors up to 11s
    while (Date.now() - t1Start < 12000) {
      const bodyText = (await page.textContent('body')) || '';
      const loadingVisible = bodyText.includes('Loading selected idea...');
      const hasError =
        /error|not found|could not be found|unable|failed/i.test(bodyText);

      if (!loadingVisible) {
        loadingDisappeared = true;
      }

      if (Date.now() - t1Start <= 11000 && hasError) {
        sawErrorWithin11s = true;
      }

      if (loadingDisappeared) {
        break;
      }

      await page.waitForTimeout(250);
    }

    const t1FinalBody = (await page.textContent('body')) || '';
    const t1StillOnlyLoading =
      t1FinalBody.includes('Loading selected idea...') &&
      !/error|not found|could not be found|unable|failed/i.test(t1FinalBody) &&
      !/Choose an Idea First|selected idea|angles/i.test(t1FinalBody.replace('Loading selected idea...', ''));

    if (t1StillOnlyLoading) {
      results.test1_anglesTimeout = 'FAIL';
      results.test1_detail = 'Still showing only "Loading selected idea..." after 12s';
    } else if (loadingDisappeared || sawErrorWithin11s) {
      results.test1_anglesTimeout = 'PASS';
      results.test1_detail = loadingDisappeared
        ? 'Loading state resolved before 12s'
        : 'Error state became visible within 11s';
    } else {
      results.test1_anglesTimeout = 'FAIL';
      results.test1_detail = 'No clear resolution signal within timeout window';
    }

    // TEST 2: Adapt h1 clean
    await page.goto(`${BASE}/adapt/new`, { waitUntil: 'networkidle', timeout: 30000 });
    const h1Locator = page.locator('h1').first();
    const hasH1 = (await h1Locator.count()) > 0;
    const h1Text = hasH1 ? ((await h1Locator.textContent()) || '').trim() : '';
    results.test2_h1Text = h1Text;

    if (!hasH1) {
      results.test2_adaptH1 = 'FAIL';
      results.test2_h1Text = 'No h1 found';
    } else if (
      h1Text.includes('Original Content Title from') ||
      h1Text.includes('[IMAGE')
    ) {
      results.test2_adaptH1 = 'FAIL';
    } else {
      results.test2_adaptH1 = 'PASS';
    }

    // TEST 3: No duplicate key warning on adapt page
    // Revisit adapt page once to ensure any render-time warning is captured.
    await page.goto(`${BASE}/adapt/new`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    results.test3_duplicateKey = duplicateKeyWarnings.length === 0 ? 'PASS' : 'FAIL';

    // TEST 4: Regression sweep
    // /dashboard
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 });
    const dashHeadingCount = await page.locator('h1, h2, [role="heading"]').count();
    results.regression_dashboard = dashHeadingCount > 0 ? 'PASS' : 'FAIL';

    // /ideas
    await page.goto(`${BASE}/ideas`, { waitUntil: 'networkidle', timeout: 30000 });
    const ideasFormCount = await page.locator('form').count();
    results.regression_ideas = ideasFormCount > 0 ? 'PASS' : 'FAIL';

    // /angles (no ideaId)
    await page.goto(`${BASE}/angles`, { waitUntil: 'networkidle', timeout: 30000 });
    const anglesFallback = await page.locator('text=/Choose an Idea First/i').count();
    results.regression_angles_fallback = anglesFallback > 0 ? 'PASS' : 'FAIL';

    // /settings
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 30000 });
    const settingsHasAIConfig = await page.locator('text=/AI config|AI Config|AI Configuration/i').count();
    results.regression_settings = settingsHasAIConfig > 0 ? 'PASS' : 'FAIL';
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (!results.test1_detail) {
      results.test1_detail = `Execution error: ${message}`;
    }
  } finally {
    await browser.close();
  }

  const checks = [
    results.test1_anglesTimeout,
    results.test2_adaptH1,
    results.test3_duplicateKey,
    results.regression_dashboard,
    results.regression_ideas,
    results.regression_angles_fallback,
    results.regression_settings
  ];

  const allPass = checks.every((c) => c === 'PASS');
  const anyPass = checks.some((c) => c === 'PASS');

  if (allPass) {
    results.overallVerdict = 'PASS';
  } else if (anyPass) {
    results.overallVerdict = 'PARTIAL';
  } else {
    results.overallVerdict = 'FAIL';
  }

  console.log(JSON.stringify(results, null, 2));
})();
