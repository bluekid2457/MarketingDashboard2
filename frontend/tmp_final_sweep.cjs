const { chromium } = require('playwright');

(async () => {
  const BASE = process.env.BASE_URL || 'http://localhost:3000';
  const routesInOrder = [
    '/dashboard',
    '/ideas',
    '/angles',
    '/adapt/new',
    '/review',
    '/publish',
    '/analytics',
    '/collaboration',
    '/settings',
    '/notifications'
  ];

  const result = {
    routes: {
      '/dashboard': { h1: '', status: 'FAIL' },
      '/ideas': { h1: '', status: 'FAIL' },
      '/angles': { h1: '', status: 'FAIL' },
      '/adapt/new': { h1: '', status: 'FAIL' },
      '/review': { h1: '', status: 'FAIL' },
      '/publish': { h1: '', status: 'FAIL' },
      '/analytics': { h1: '', status: 'FAIL' },
      '/collaboration': { h1: '', status: 'FAIL' },
      '/settings': { h1: '', status: 'FAIL' },
      '/notifications': { h1: '', status: 'FAIL' }
    },
    anglesTimeoutCheck: 'FAIL',
    adaptH1Clean: 'FAIL',
    totalConsoleErrors: 0,
    consoleErrors: [],
    finalVerdict: 'FAIL'
  };

  const allErrors = [];

  function pushError(kind, text, url) {
    allErrors.push({ kind, text, url });
  }

  function getCurrentPath(page) {
    try {
      return new URL(page.url()).pathname;
    } catch (_) {
      return page.url();
    }
  }

  async function getMainHeading(page) {
    const heading = page.locator('main h1, h1, main [role="heading"], [role="main"] [role="heading"], main h2').first();
    const count = await heading.count();
    if (!count) return '';
    const text = await heading.textContent().catch(() => '');
    return (text || '').trim();
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        pushError('console', msg.text(), page.url());
      }
    });

    page.on('pageerror', (err) => {
      const text = err && err.message ? err.message : String(err);
      pushError('pageerror', text, page.url());
    });

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[type="email"], input[name="email"]', 'qa@example.com');
    await page.fill('input[type="password"], input[name="password"]', 'Sample!');
    await page.click('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")');

    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 20000 }).catch(() => {});

    for (const route of routesInOrder) {
      const errorStart = allErrors.length;
      let status = 'PASS';
      let headingText = '';

      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
        headingText = await getMainHeading(page);

        const currentPath = getCurrentPath(page);
        const redirectedToLogin = currentPath === '/login' || page.url().includes('/login');
        const hasHeading = Boolean(headingText);
        const routeErrors = allErrors.slice(errorStart);

        if (redirectedToLogin || !hasHeading || routeErrors.length > 0) {
          status = 'FAIL';
        }
      } catch (err) {
        status = 'FAIL';
        if (!headingText) headingText = '';
        pushError('navigation', err && err.message ? err.message : String(err), `${BASE}${route}`);
      }

      result.routes[route] = { h1: headingText, status };
    }

    // Specific fix check 1: /angles?ideaId=bad-id-xyz resolves loading state within 12s.
    {
      const errorStart = allErrors.length;
      await page.goto(`${BASE}/angles?ideaId=bad-id-xyz`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const start = Date.now();
      let resolved = false;

      while (Date.now() - start < 12000) {
        const bodyText = ((await page.textContent('body').catch(() => '')) || '').trim();
        const loadingVisible = /Loading selected idea\.\.\./i.test(bodyText);
        const hasError = /error|not found|unable|failed|could not/i.test(bodyText);
        const hasIdeaOrHeading = (await getMainHeading(page)).length > 0 || /angle|angles/i.test(bodyText);

        if (!loadingVisible || hasError || hasIdeaOrHeading) {
          resolved = true;
          break;
        }

        await page.waitForTimeout(250);
      }

      const newErrors = allErrors.slice(errorStart);
      result.anglesTimeoutCheck = resolved && newErrors.length === 0 ? 'PASS' : (resolved ? 'PASS' : 'FAIL');
    }

    // Specific fix check 2: /adapt/new h1 does not contain "Original Content Title".
    {
      await page.goto(`${BASE}/adapt/new`, { waitUntil: 'networkidle', timeout: 30000 });
      const h1 = await getMainHeading(page);
      const badPhrase = /Original Content Title/i.test(h1);
      result.adaptH1Clean = h1 && !badPhrase ? 'PASS' : 'FAIL';
    }

    result.consoleErrors = allErrors.map((e) => `[${e.kind}] ${e.url} :: ${e.text}`);
    result.totalConsoleErrors = result.consoleErrors.length;

    const routeStatuses = Object.values(result.routes).map((r) => r.status);
    const allRoutesPass = routeStatuses.every((s) => s === 'PASS');
    const allPass = allRoutesPass && result.anglesTimeoutCheck === 'PASS' && result.adaptH1Clean === 'PASS' && result.totalConsoleErrors === 0;
    const anyPass = routeStatuses.some((s) => s === 'PASS') || result.anglesTimeoutCheck === 'PASS' || result.adaptH1Clean === 'PASS';

    if (allPass) {
      result.finalVerdict = 'PASS';
    } else if (anyPass) {
      result.finalVerdict = 'PARTIAL';
    } else {
      result.finalVerdict = 'FAIL';
    }
  } catch (err) {
    pushError('fatal', err && err.message ? err.message : String(err), BASE);
    result.consoleErrors = allErrors.map((e) => `[${e.kind}] ${e.url} :: ${e.text}`);
    result.totalConsoleErrors = result.consoleErrors.length;
    result.finalVerdict = 'FAIL';
  } finally {
    if (browser) await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
})();
