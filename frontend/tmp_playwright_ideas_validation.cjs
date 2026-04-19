const { chromium } = require('playwright');

(async () => {
  const base = 'http://localhost:3000';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const result = {
    baseUrl: base,
    initialUrl: null,
    finalUrl: null,
    authBlocked: false,
    happy: { status: 'FAIL', evidence: [] },
    edge: { status: 'FAIL', evidence: [] },
    saveHandling: { checked: false, status: 'FAIL', evidence: [] },
    regression: { status: 'FAIL', evidence: [] },
    runtime: {
      consoleErrorCount: 0,
      pageErrorCount: 0,
      consoleErrors: [],
      pageErrors: []
    }
  };

  try {
    await page.goto(base + '/ideas', { waitUntil: 'networkidle', timeout: 30000 });
    result.initialUrl = page.url();

    const isLogin = page.url().includes('/login');
    if (isLogin) {
      result.authBlocked = true;
      result.happy.evidence.push('Navigation to /ideas redirected to /login, indicating auth gating.');
      const loginHeading = await page.locator('text=Sign in to your account').count();
      if (loginHeading > 0) {
        result.edge.evidence.push('Could not execute form validations because Ideas page UI is inaccessible without authentication.');
      }
    } else {
      const hasHeader = (await page.locator('h1:has-text("Idea Input & Backlog")').count()) > 0;
      const hasNewIdea = (await page.locator('h2:has-text("New Idea")').count()) > 0;
      const hasYourIdeas = (await page.locator('h2:has-text("Your Ideas")').count()) > 0;
      const hasTrendSnapshot =
        (await page.locator('h2:has-text("Live Trend Snapshot")').count()) > 0 ||
        (await page.locator('h2:has-text("Live Trend Signals")').count()) > 0;

      result.happy.evidence.push('Header found=' + hasHeader);
      result.happy.evidence.push('New Idea section found=' + hasNewIdea);
      result.happy.evidence.push('Your Ideas section found=' + hasYourIdeas);
      result.happy.evidence.push('Trend panel/snapshot found=' + hasTrendSnapshot);
      result.happy.status = (hasHeader && hasNewIdea && hasYourIdeas && hasTrendSnapshot) ? 'PASS' : 'FAIL';

      const addIdeaBtn = page.locator('button:has-text("Add Idea")');
      const textarea = page.locator('textarea[placeholder="Enter a new content idea..."]');

      await textarea.fill('');
      await addIdeaBtn.click();
      const emptyErr = (await page.locator('text=Idea text is required.').count()) > 0;
      result.edge.evidence.push('Empty idea error visible=' + emptyErr);

      await textarea.fill('short');
      await addIdeaBtn.click();
      const shortErr = (await page.locator('text=Idea text should be at least 8 characters so it is useful later.').count()) > 0;
      result.edge.evidence.push('Too-short idea error visible=' + shortErr);
      result.edge.status = (emptyErr && shortErr) ? 'PASS' : 'FAIL';

      await textarea.fill('This is a valid test idea for save handling');
      await addIdeaBtn.click();
      result.saveHandling.checked = true;

      const saved = (await page.locator('text=Idea saved to your Firebase backlog.').count()) > 0;
      const authMsg = (await page.locator('text=You must be signed in with Firebase configured before saving ideas.').count()) > 0;
      const saveErr = (await page.locator('text=Unable to save your idea right now. Please try again.').count()) > 0;

      if (saved) {
        result.saveHandling.status = 'PASS';
        result.saveHandling.evidence.push('Valid save succeeded.');
      } else if (authMsg || saveErr) {
        result.saveHandling.status = 'PASS';
        result.saveHandling.evidence.push('Save blocked gracefully with user-facing error message. authMsg=' + authMsg + ', genericSaveErr=' + saveErr);
      } else {
        result.saveHandling.status = 'FAIL';
        result.saveHandling.evidence.push('No success or expected graceful error observed after valid submission attempt.');
      }
    }

    await page.goto(base + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    const dashUrl = page.url();
    const dashVisible = dashUrl.includes('/dashboard') || dashUrl.includes('/login');
    result.regression.evidence.push('Visited /dashboard -> ' + dashUrl);

    await page.goto(base + '/ideas', { waitUntil: 'networkidle', timeout: 30000 });
    const ideasUrl2 = page.url();
    const ideasBackVisible = ideasUrl2.includes('/ideas') || ideasUrl2.includes('/login');
    result.regression.evidence.push('Returned to /ideas -> ' + ideasUrl2);
    result.regression.status = (dashVisible && ideasBackVisible) ? 'PASS' : 'FAIL';

    result.finalUrl = page.url();
  } catch (e) {
    result.happy.evidence.push('Script error: ' + String(e));
    result.edge.evidence.push('Script error prevented full edge validation.');
    result.regression.evidence.push('Regression not fully executed due to script error.');
  } finally {
    result.runtime.consoleErrorCount = consoleErrors.length;
    result.runtime.pageErrorCount = pageErrors.length;
    result.runtime.consoleErrors = consoleErrors.slice(0, 10);
    result.runtime.pageErrors = pageErrors.slice(0, 10);
    await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
})();
