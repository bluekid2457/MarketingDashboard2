// tmp_retest_cycle1.cjs - Verification re-test cycle 1
const { chromium } = require('playwright');

(async () => {
  const results = {
    verifyFix1_anglesHang: 'BLOCKED',
    verifyFix1_detail: '',
    verifyFix2_adaptH1: 'FAIL',
    verifyFix2_h1Text: '',
    verifyFix3_duplicateKey: 'FAIL',
    verifyFix3_consoleErrors: [],
    regression_dashboard: 'FAIL',
    regression_ideas: 'FAIL',
    regression_review: 'FAIL',
    regression_settings: 'FAIL',
    overallVerdict: 'FAIL'
  };

  const BASE = 'http://localhost:3000';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // --- LOGIN ---
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.fill('input[type="email"], input[name="email"]', 'qa@example.com');
    await page.fill('input[type="password"], input[name="password"]', 'Sample!');
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`, { timeout: 15000 });
  } catch (e) {
    results.verifyFix1_detail = `Login failed: ${e.message}`;
    console.log(JSON.stringify(results, null, 2));
    await browser.close();
    return;
  }

  // --- FIX 1: Angles page should not hang ---
  try {
    const consoleErrors1 = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors1.push(msg.text());
    });

    await page.goto(`${BASE}/ideas`, { waitUntil: 'networkidle', timeout: 15000 });

    // Wait up to 5s for an idea row to appear
    let ideaClicked = false;
    try {
      // Try common selectors for idea rows
      await page.waitForSelector(
        '[data-testid="idea-row"], [class*="idea"] li, li[class*="idea"], .idea-item, [role="listitem"], table tbody tr, ul li button, [class*="IdeaCard"], [class*="idea-card"]',
        { timeout: 5000 }
      );
      const ideaEl = await page.$(
        '[data-testid="idea-row"], [class*="idea"] li, li[class*="idea"], .idea-item, [role="listitem"], table tbody tr, ul li button, [class*="IdeaCard"], [class*="idea-card"]'
      );
      if (ideaEl) {
        await ideaEl.click();
        ideaClicked = true;
      }
    } catch (_) {
      // No idea rows found — try clicking any clickable list item
      try {
        const items = await page.$$('ul li, ol li');
        if (items.length > 0) {
          await items[0].click();
          ideaClicked = true;
        }
      } catch (__) {}
    }

    // Click "Generate Angles" button
    try {
      await page.waitForSelector(
        'button:has-text("Generate Angles"), button:has-text("generate angles"), [data-testid="generate-angles"]',
        { timeout: 5000 }
      );
      await page.click('button:has-text("Generate Angles"), button:has-text("generate angles"), [data-testid="generate-angles"]');
    } catch (_) {
      // Try finding it by text
      const btn = await page.$('button');
      const buttons = await page.$$('button');
      let found = false;
      for (const b of buttons) {
        const txt = await b.textContent();
        if (txt && txt.toLowerCase().includes('generate angle')) {
          await b.click();
          found = true;
          break;
        }
      }
      if (!found) {
        results.verifyFix1_detail = `Could not find "Generate Angles" button. ideaClicked=${ideaClicked}`;
        results.verifyFix1_anglesHang = 'BLOCKED';
      }
    }

    if (results.verifyFix1_anglesHang !== 'BLOCKED') {
      // Wait up to 8s for /angles route
      try {
        await page.waitForURL(/\/angles/, { timeout: 8000 });
      } catch (_) {}

      // Check for loading state vs resolved
      await page.waitForTimeout(8000);
      const bodyText = await page.textContent('body');
      const currentUrl = page.url();

      const stillLoading = bodyText.includes('Loading selected idea...');
      const errorShown = bodyText.includes('could not be found') || bodyText.includes('error') || bodyText.includes('Error');
      const notSelected = bodyText.includes('Not selected yet');
      const hasIdeaTopic = !notSelected && !stillLoading;

      if (stillLoading) {
        results.verifyFix1_anglesHang = 'FAIL';
        results.verifyFix1_detail = 'Still showing "Loading selected idea..." after 8 seconds';
      } else if (errorShown) {
        results.verifyFix1_anglesHang = 'PASS';
        results.verifyFix1_detail = `Error message shown (acceptable). URL: ${currentUrl}`;
      } else if (hasIdeaTopic) {
        results.verifyFix1_anglesHang = 'PASS';
        results.verifyFix1_detail = `Idea loaded successfully. URL: ${currentUrl}`;
      } else if (notSelected) {
        results.verifyFix1_anglesHang = 'FAIL';
        results.verifyFix1_detail = 'Still showing "Not selected yet"';
      } else {
        results.verifyFix1_anglesHang = 'PASS';
        results.verifyFix1_detail = `No hang detected. URL: ${currentUrl}`;
      }
    } else if (results.verifyFix1_detail.includes('Could not find "Generate Angles"') || results.verifyFix1_detail.includes('ideaClicked=false')) {
      // Fallback: directly navigate to /angles with a nonexistent ideaId to test the no-hang fix
      try {
        await page.goto(`${BASE}/angles?ideaId=nonexistent-test-id-000`, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(8000);
        const bodyText = await page.textContent('body');
        const stillLoading = bodyText.includes('Loading selected idea...');
        const errorShown =
          bodyText.includes('could not be found') ||
          bodyText.includes('not found') ||
          bodyText.includes('Error') ||
          bodyText.includes('error') ||
          bodyText.includes('invalid');
        const notSelected = bodyText.includes('Not selected yet');
        if (stillLoading) {
          results.verifyFix1_anglesHang = 'FAIL';
          results.verifyFix1_detail = 'Direct nav to /angles with nonexistent ID: still showing "Loading selected idea..." after 8s (hang NOT fixed)';
        } else if (notSelected) {
          results.verifyFix1_anglesHang = 'FAIL';
          results.verifyFix1_detail = 'Direct nav to /angles with nonexistent ID: still showing "Not selected yet" after 8s';
        } else if (errorShown) {
          results.verifyFix1_anglesHang = 'PASS';
          results.verifyFix1_detail = `Direct nav to /angles with nonexistent ID: error/fallback shown (hang fixed). No ideas in QA account to click.`;
        } else {
          results.verifyFix1_anglesHang = 'PASS';
          results.verifyFix1_detail = `Direct nav to /angles with nonexistent ID: resolved without hang. No ideas in QA account to click.`;
        }
      } catch (e2) {
        results.verifyFix1_anglesHang = 'BLOCKED';
        results.verifyFix1_detail = `Fallback direct nav failed: ${e2.message}`;
      }
    }
  } catch (e) {
    results.verifyFix1_anglesHang = 'BLOCKED';
    results.verifyFix1_detail = `Exception: ${e.message}`;
  }

  // --- FIX 2 & FIX 3: Adapt page ---
  try {
    const adaptConsoleErrors = [];
    const dupKeyWarnings = [];

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Zero-Click Search') && (text.includes('key') || text.includes('duplicate') || text.includes('unique'))) {
        dupKeyWarnings.push(text);
      }
      if (msg.type() === 'warning' || msg.type() === 'error') {
        if (text.includes('Zero-Click Search')) {
          dupKeyWarnings.push(text);
        }
        adaptConsoleErrors.push(text);
      }
    });

    await page.goto(`${BASE}/adapt/new`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    // FIX 2: h1 text check
    const h1El = await page.$('h1');
    if (h1El) {
      const h1Text = await h1El.textContent();
      results.verifyFix2_h1Text = h1Text ? h1Text.trim() : '';
      const hasBadText =
        h1Text.includes('Original Content Title from') ||
        h1Text.includes('[IMAGE');
      results.verifyFix2_adaptH1 = hasBadText ? 'FAIL' : 'PASS';
    } else {
      results.verifyFix2_h1Text = 'No h1 found';
      results.verifyFix2_adaptH1 = 'FAIL';
    }

    // FIX 3: duplicate key check
    results.verifyFix3_consoleErrors = adaptConsoleErrors.slice(0, 20);
    results.verifyFix3_duplicateKey = dupKeyWarnings.length === 0 ? 'PASS' : 'FAIL';
  } catch (e) {
    results.verifyFix2_h1Text = `Exception: ${e.message}`;
    results.verifyFix2_adaptH1 = 'FAIL';
    results.verifyFix3_duplicateKey = 'FAIL';
    results.verifyFix3_consoleErrors = [e.message];
  }

  // --- REGRESSION TESTS ---

  // /dashboard
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    const h1 = await page.$('h1');
    const h1Text = h1 ? await h1.textContent() : '';
    results.regression_dashboard = (h1Text && h1Text.trim().length > 0) || body.includes('Dashboard') ? 'PASS' : 'FAIL';
  } catch (e) {
    results.regression_dashboard = 'FAIL';
  }

  // /ideas
  try {
    await page.goto(`${BASE}/ideas`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    const form = await page.$('form, textarea, input[type="text"], [data-testid="idea-input"]');
    results.regression_ideas = form ? 'PASS' : 'FAIL';
  } catch (e) {
    results.regression_ideas = 'FAIL';
  }

  // /review
  try {
    await page.goto(`${BASE}/review`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    const h1 = await page.$('h1');
    const h1Text = h1 ? await h1.textContent() : '';
    results.regression_review = (h1Text && h1Text.trim().length > 0) ? 'PASS' : 'FAIL';
  } catch (e) {
    results.regression_review = 'FAIL';
  }

  // /settings
  try {
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    results.regression_settings =
      body.includes('AI') || body.includes('config') || body.includes('Config') || body.includes('Settings') ? 'PASS' : 'FAIL';
  } catch (e) {
    results.regression_settings = 'FAIL';
  }

  // --- OVERALL VERDICT ---
  const fixes = [
    results.verifyFix1_anglesHang,
    results.verifyFix2_adaptH1,
    results.verifyFix3_duplicateKey
  ];
  const regressions = [
    results.regression_dashboard,
    results.regression_ideas,
    results.regression_review,
    results.regression_settings
  ];

  const anyFail = [...fixes, ...regressions].some(r => r === 'FAIL');
  const anyBlocked = fixes.some(r => r === 'BLOCKED');
  const allPass = [...fixes, ...regressions].every(r => r === 'PASS');

  if (allPass) {
    results.overallVerdict = 'PASS';
  } else if (anyFail) {
    results.overallVerdict = anyBlocked ? 'PARTIAL' : 'FAIL';
  } else {
    results.overallVerdict = 'PARTIAL';
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();
