const { chromium } = require('playwright');

(async () => {
  const base = 'http://localhost:3000';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = {};
  const globalConsoleErrors = [];
  const globalPageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      globalConsoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => globalPageErrors.push(String(err)));

  async function getH1() {
    try {
      const h1 = page.locator('h1').first();
      const count = await h1.count();
      if (count > 0) return await h1.textContent({ timeout: 3000 });
    } catch (_) {}
    return null;
  }

  async function snapshotConsoleErrors() {
    return [...globalConsoleErrors];
  }

  // ── STEP 1: Login ──────────────────────────────────────────────────────────
  const loginResult = { step: 'login', status: 'FAIL', details: {} };
  try {
    await page.goto(base + '/login', { waitUntil: 'networkidle', timeout: 30000 });
    loginResult.details.url = page.url();

    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const signInBtn = page.locator('button:has-text("Sign In"), button[type="submit"]').first();

    await emailInput.fill('qa@example.com');
    await passwordInput.fill('Sample!');
    await signInBtn.click();

    await page.waitForURL('**/dashboard**', { timeout: 15000 }).catch(() => {});
    loginResult.details.afterLoginUrl = page.url();
    loginResult.details.redirectedToDashboard = page.url().includes('/dashboard');

    if (page.url().includes('/dashboard')) {
      loginResult.status = 'PASS';
    } else {
      // Check if there's an error message on the login page
      const errMsg = await page.locator('[class*="error"], [class*="alert"], p:has-text("Invalid"), p:has-text("error")').first().textContent({ timeout: 3000 }).catch(() => null);
      loginResult.details.errorMessage = errMsg;
      loginResult.status = 'FAIL';
    }
  } catch (e) {
    loginResult.details.exception = e.message;
    loginResult.status = 'FAIL';
  }
  results.login = loginResult;

  // ── STEP 2: /dashboard ────────────────────────────────────────────────────
  const dashResult = { route: '/dashboard', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    dashResult.finalUrl = page.url();
    dashResult.h1 = await getH1();

    const authCheck = page.url().includes('/login');
    dashResult.authBlocked = authCheck;
    if (!authCheck) {
      const h1Text = dashResult.h1 || '';
      dashResult.keyContent.push('h1=' + h1Text);
      const welcomeOrDash = (await page.locator('h1, h2, h3').count()) > 0;
      dashResult.keyContent.push('headingsFound=' + welcomeOrDash);
      dashResult.status = welcomeOrDash ? 'PASS' : 'FAIL';
    } else {
      dashResult.keyContent.push('Redirected to login - auth gating active');
      dashResult.status = 'AUTH_BLOCKED';
    }
    dashResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    dashResult.exception = e.message;
  }
  results.dashboard = dashResult;

  // ── STEP 3: /ideas - check form renders + empty submit validation ─────────
  const ideasFormResult = { route: '/ideas (form validation)', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  let capturedIdeaId = null;
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/ideas', { waitUntil: 'networkidle', timeout: 30000 });
    ideasFormResult.finalUrl = page.url();
    ideasFormResult.authBlocked = page.url().includes('/login');

    if (!ideasFormResult.authBlocked) {
      ideasFormResult.h1 = await getH1();
      ideasFormResult.keyContent.push('h1=' + ideasFormResult.h1);

      // Check form renders
      const textarea = page.locator('textarea, input[type="text"]').first();
      const formVisible = (await textarea.count()) > 0;
      ideasFormResult.keyContent.push('formFieldVisible=' + formVisible);

      if (formVisible) {
        // Try empty submit
        const submitBtn = page.locator('button[type="submit"], button:has-text("Add"), button:has-text("Submit"), button:has-text("Save")').first();
        const submitCount = await submitBtn.count();
        if (submitCount > 0) {
          await submitBtn.click();
          await page.waitForTimeout(1000);
          const errVisible = (await page.locator('[class*="error"], [class*="warning"], text=/required|empty|fill in/i').count()) > 0;
          ideasFormResult.keyContent.push('emptySubmitValidationError=' + errVisible);
        } else {
          ideasFormResult.keyContent.push('submitButtonNotFound=true');
        }
      }

      ideasFormResult.status = formVisible ? 'PASS' : 'FAIL';
    } else {
      ideasFormResult.keyContent.push('Redirected to login - auth gating active');
      ideasFormResult.status = 'AUTH_BLOCKED';
    }
    ideasFormResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    ideasFormResult.exception = e.message;
  }
  results.ideasFormValidation = ideasFormResult;

  // ── STEP 4: /ideas - submit valid idea ────────────────────────────────────
  const ideasSubmitResult = { route: '/ideas (submit valid idea)', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [], capturedIdeaId: null };
  try {
    const priorErrors = globalConsoleErrors.length;

    if (!ideasFormResult.authBlocked) {
      // Already on /ideas, or navigate back
      if (!page.url().includes('/ideas')) {
        await page.goto(base + '/ideas', { waitUntil: 'networkidle', timeout: 30000 });
      }

      // Fill in the idea form - try to find tone, audience, format fields
      const textarea = page.locator('textarea, input[placeholder*="idea" i]').first();
      if ((await textarea.count()) > 0) {
        await textarea.fill('Auto loop test idea for angles flow');
      }

      // Try to find and set tone
      const toneSelect = page.locator('select[name*="tone" i], [data-testid*="tone"], label:has-text("Tone") + select, label:has-text("Tone") ~ select').first();
      if ((await toneSelect.count()) > 0) {
        await toneSelect.selectOption({ label: 'professional' }).catch(async () => {
          await toneSelect.selectOption('professional').catch(() => {});
        });
        ideasSubmitResult.keyContent.push('toneFieldSet=true');
      } else {
        ideasSubmitResult.keyContent.push('toneFieldNotFound=true');
      }

      // Try to find and set audience
      const audienceInput = page.locator('input[name*="audience" i], input[placeholder*="audience" i], [data-testid*="audience"]').first();
      if ((await audienceInput.count()) > 0) {
        await audienceInput.fill('B2B marketers');
        ideasSubmitResult.keyContent.push('audienceFieldSet=true');
      } else {
        ideasSubmitResult.keyContent.push('audienceFieldNotFound=true');
      }

      // Try to find and set format
      const formatSelect = page.locator('select[name*="format" i], [data-testid*="format"], label:has-text("Format") + select, label:has-text("Format") ~ select').first();
      if ((await formatSelect.count()) > 0) {
        await formatSelect.selectOption({ label: 'LinkedIn Post' }).catch(async () => {
          await formatSelect.selectOption('LinkedIn Post').catch(() => {});
        });
        ideasSubmitResult.keyContent.push('formatFieldSet=true');
      } else {
        ideasSubmitResult.keyContent.push('formatFieldNotFound=true');
      }

      // Submit the form
      const submitBtn = page.locator('button[type="submit"], button:has-text("Add"), button:has-text("Submit"), button:has-text("Save")').first();
      if ((await submitBtn.count()) > 0) {
        await submitBtn.click();
        await page.waitForTimeout(2000);

        // Look for saved idea ID in DOM
        // Try data attributes or list items
        const ideaItems = page.locator('[data-idea-id], [data-id], li[id], .idea-item').first();
        if ((await ideaItems.count()) > 0) {
          capturedIdeaId = await ideaItems.getAttribute('data-idea-id') || await ideaItems.getAttribute('data-id') || await ideaItems.getAttribute('id');
          ideasSubmitResult.capturedIdeaId = capturedIdeaId;
          ideasSubmitResult.keyContent.push('ideaIdFromDOM=' + capturedIdeaId);
        }

        // Check for success or error
        const successMsg = (await page.locator('text=/saved|success|added/i').count()) > 0;
        const errorMsg = (await page.locator('text=/error|failed|unable/i').count()) > 0;
        ideasSubmitResult.keyContent.push('successMessageVisible=' + successMsg);
        ideasSubmitResult.keyContent.push('errorMessageVisible=' + errorMsg);
        ideasSubmitResult.status = successMsg ? 'PASS' : (errorMsg ? 'EXPECTED_ERROR' : 'UNKNOWN');
      } else {
        ideasSubmitResult.keyContent.push('submitButtonNotFound=true');
        ideasSubmitResult.status = 'FAIL';
      }
    } else {
      ideasSubmitResult.keyContent.push('Auth blocked - cannot submit idea');
      ideasSubmitResult.status = 'AUTH_BLOCKED';
    }
    ideasSubmitResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    ideasSubmitResult.exception = e.message;
  }
  results.ideasValidSubmit = ideasSubmitResult;

  // ── STEP 5: /angles (no ideaId) ──────────────────────────────────────────
  const anglesNoIdResult = { route: '/angles (no ideaId)', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/angles', { waitUntil: 'networkidle', timeout: 30000 });
    anglesNoIdResult.finalUrl = page.url();
    anglesNoIdResult.authBlocked = page.url().includes('/login');

    if (!anglesNoIdResult.authBlocked) {
      anglesNoIdResult.h1 = await getH1();
      anglesNoIdResult.keyContent.push('h1=' + anglesNoIdResult.h1);

      const fallbackText = await page.locator('text=/Choose an Idea First|choose an idea|select an idea/i').count();
      anglesNoIdResult.keyContent.push('fallbackMessageVisible=' + (fallbackText > 0));
      anglesNoIdResult.status = fallbackText > 0 ? 'PASS' : 'FAIL';
    } else {
      anglesNoIdResult.keyContent.push('Redirected to login - auth gating active');
      anglesNoIdResult.status = 'AUTH_BLOCKED';
    }
    anglesNoIdResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    anglesNoIdResult.exception = e.message;
  }
  results.anglesNoId = anglesNoIdResult;

  // ── STEP 6: /angles?ideaId=<id> ──────────────────────────────────────────
  const anglesWithIdResult = { route: '/angles?ideaId=...', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    const testIdeaId = capturedIdeaId || 'test123';
    anglesWithIdResult.testedIdeaId = testIdeaId;
    await page.goto(base + '/angles?ideaId=' + testIdeaId, { waitUntil: 'networkidle', timeout: 30000 });
    anglesWithIdResult.finalUrl = page.url();
    anglesWithIdResult.authBlocked = page.url().includes('/login');

    if (!anglesWithIdResult.authBlocked) {
      anglesWithIdResult.h1 = await getH1();
      anglesWithIdResult.keyContent.push('h1=' + anglesWithIdResult.h1);

      const loadingStuck = (await page.locator('text=/Loading selected idea/i').count()) > 0;
      const anglesContent = (await page.locator('text=/angle|angles|generate/i').count()) > 0;
      const fallbackShown = (await page.locator('text=/not found|choose an idea|no idea/i').count()) > 0;

      anglesWithIdResult.keyContent.push('stuckOnLoading=' + loadingStuck);
      anglesWithIdResult.keyContent.push('anglesContentVisible=' + anglesContent);
      anglesWithIdResult.keyContent.push('fallbackShown=' + fallbackShown);

      if (!loadingStuck && (anglesContent || fallbackShown)) {
        anglesWithIdResult.status = 'PASS';
      } else if (loadingStuck) {
        anglesWithIdResult.status = 'STUCK_LOADING';
      } else {
        anglesWithIdResult.status = 'UNKNOWN';
      }
    } else {
      anglesWithIdResult.keyContent.push('Redirected to login - auth gating active');
      anglesWithIdResult.status = 'AUTH_BLOCKED';
    }
    anglesWithIdResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    anglesWithIdResult.exception = e.message;
  }
  results.anglesWithId = anglesWithIdResult;

  // ── STEP 7: /drafts/new ───────────────────────────────────────────────────
  const draftsResult = { route: '/drafts/new', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/drafts/new', { waitUntil: 'networkidle', timeout: 30000 });
    draftsResult.finalUrl = page.url();
    draftsResult.authBlocked = page.url().includes('/login');

    if (!draftsResult.authBlocked) {
      draftsResult.h1 = await getH1();
      draftsResult.keyContent.push('h1=' + draftsResult.h1);

      const fallback = (await page.locator('text=/No draft context was found|no draft context/i').count()) > 0;
      const draftContent = (await page.locator('textarea, [contenteditable]').count()) > 0;

      draftsResult.keyContent.push('fallbackMessageVisible=' + fallback);
      draftsResult.keyContent.push('draftEditorVisible=' + draftContent);
      draftsResult.status = (fallback || draftContent) ? 'PASS' : 'FAIL';
    } else {
      draftsResult.keyContent.push('Redirected to login - auth gating active');
      draftsResult.status = 'AUTH_BLOCKED';
    }
    draftsResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    draftsResult.exception = e.message;
  }
  results.draftsNew = draftsResult;

  // ── STEP 8: /adapt/new ───────────────────────────────────────────────────
  const adaptResult = { route: '/adapt/new', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/adapt/new', { waitUntil: 'networkidle', timeout: 30000 });
    adaptResult.finalUrl = page.url();
    adaptResult.authBlocked = page.url().includes('/login');

    if (!adaptResult.authBlocked) {
      adaptResult.h1 = await getH1();
      adaptResult.keyContent.push('h1=' + adaptResult.h1);

      const anyContent = (await page.locator('h1, h2, main, [class*="adapt"], [class*="container"]').count()) > 0;
      const errorState = (await page.locator('text=/error|not found|404/i').count()) > 0;

      adaptResult.keyContent.push('pageHasContent=' + anyContent);
      adaptResult.keyContent.push('errorStateVisible=' + errorState);
      adaptResult.status = anyContent && !errorState ? 'PASS' : (errorState ? 'ERROR_STATE' : 'FAIL');
    } else {
      adaptResult.keyContent.push('Redirected to login - auth gating active');
      adaptResult.status = 'AUTH_BLOCKED';
    }
    adaptResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    adaptResult.exception = e.message;
  }
  results.adaptNew = adaptResult;

  // ── STEP 9: /review ───────────────────────────────────────────────────────
  const reviewResult = { route: '/review', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/review', { waitUntil: 'networkidle', timeout: 30000 });
    reviewResult.finalUrl = page.url();
    reviewResult.authBlocked = page.url().includes('/login');

    if (!reviewResult.authBlocked) {
      reviewResult.h1 = await getH1();
      reviewResult.keyContent.push('h1=' + reviewResult.h1);

      const sections = await page.locator('h1, h2, h3, section').count();
      reviewResult.keyContent.push('sectionCount=' + sections);
      reviewResult.status = sections > 0 ? 'PASS' : 'FAIL';
    } else {
      reviewResult.keyContent.push('Redirected to login - auth gating active');
      reviewResult.status = 'AUTH_BLOCKED';
    }
    reviewResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    reviewResult.exception = e.message;
  }
  results.review = reviewResult;

  // ── STEP 10: /publish ─────────────────────────────────────────────────────
  const publishResult = { route: '/publish', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/publish', { waitUntil: 'networkidle', timeout: 30000 });
    publishResult.finalUrl = page.url();
    publishResult.authBlocked = page.url().includes('/login');

    if (!publishResult.authBlocked) {
      publishResult.h1 = await getH1();
      publishResult.keyContent.push('h1=' + publishResult.h1);

      const sections = await page.locator('h1, h2, h3, section').count();
      publishResult.keyContent.push('sectionCount=' + sections);

      // Try clicking Publish button
      const publishBtn = page.locator('button:has-text("Publish")').first();
      const btnCount = await publishBtn.count();
      publishResult.keyContent.push('publishButtonFound=' + (btnCount > 0));

      if (btnCount > 0) {
        await publishBtn.click();
        await page.waitForTimeout(1000);
        const afterClickMsg = await page.locator('text=/published|success|error|failed/i').count();
        publishResult.keyContent.push('afterPublishClickMessageVisible=' + (afterClickMsg > 0));
      }

      publishResult.status = sections > 0 ? 'PASS' : 'FAIL';
    } else {
      publishResult.keyContent.push('Redirected to login - auth gating active');
      publishResult.status = 'AUTH_BLOCKED';
    }
    publishResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    publishResult.exception = e.message;
  }
  results.publish = publishResult;

  // ── STEP 11: /analytics ───────────────────────────────────────────────────
  const analyticsResult = { route: '/analytics', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/analytics', { waitUntil: 'networkidle', timeout: 30000 });
    analyticsResult.finalUrl = page.url();
    analyticsResult.authBlocked = page.url().includes('/login');

    if (!analyticsResult.authBlocked) {
      analyticsResult.h1 = await getH1();
      analyticsResult.keyContent.push('h1=' + analyticsResult.h1);

      const sections = await page.locator('h1, h2, h3, section').count();
      analyticsResult.keyContent.push('sectionCount=' + sections);
      analyticsResult.status = sections > 0 ? 'PASS' : 'FAIL';
    } else {
      analyticsResult.keyContent.push('Redirected to login - auth gating active');
      analyticsResult.status = 'AUTH_BLOCKED';
    }
    analyticsResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    analyticsResult.exception = e.message;
  }
  results.analytics = analyticsResult;

  // ── STEP 12: /collaboration ───────────────────────────────────────────────
  const collabResult = { route: '/collaboration', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/collaboration', { waitUntil: 'networkidle', timeout: 30000 });
    collabResult.finalUrl = page.url();
    collabResult.authBlocked = page.url().includes('/login');

    if (!collabResult.authBlocked) {
      collabResult.h1 = await getH1();
      collabResult.keyContent.push('h1=' + collabResult.h1);

      const sections = await page.locator('h1, h2, h3, section').count();
      collabResult.keyContent.push('sectionCount=' + sections);
      collabResult.status = sections > 0 ? 'PASS' : 'FAIL';
    } else {
      collabResult.keyContent.push('Redirected to login - auth gating active');
      collabResult.status = 'AUTH_BLOCKED';
    }
    collabResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    collabResult.exception = e.message;
  }
  results.collaboration = collabResult;

  // ── STEP 13: /settings ────────────────────────────────────────────────────
  const settingsResult = { route: '/settings', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/settings', { waitUntil: 'networkidle', timeout: 30000 });
    settingsResult.finalUrl = page.url();
    settingsResult.authBlocked = page.url().includes('/login');

    if (!settingsResult.authBlocked) {
      settingsResult.h1 = await getH1();
      settingsResult.keyContent.push('h1=' + settingsResult.h1);

      const aiConfigSection = (await page.locator('text=/AI Config|AI Settings|AI configuration|Model|API Key/i').count()) > 0;
      const sections = await page.locator('h1, h2, h3, section').count();

      settingsResult.keyContent.push('aiConfigSectionVisible=' + aiConfigSection);
      settingsResult.keyContent.push('sectionCount=' + sections);
      settingsResult.status = (aiConfigSection || sections > 0) ? 'PASS' : 'FAIL';
    } else {
      settingsResult.keyContent.push('Redirected to login - auth gating active');
      settingsResult.status = 'AUTH_BLOCKED';
    }
    settingsResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    settingsResult.exception = e.message;
  }
  results.settings = settingsResult;

  // ── STEP 14: /notifications ───────────────────────────────────────────────
  const notifResult = { route: '/notifications', status: 'FAIL', h1: null, keyContent: [], consoleErrors: [] };
  try {
    const priorErrors = globalConsoleErrors.length;
    await page.goto(base + '/notifications', { waitUntil: 'networkidle', timeout: 30000 });
    notifResult.finalUrl = page.url();
    notifResult.authBlocked = page.url().includes('/login');

    if (!notifResult.authBlocked) {
      notifResult.h1 = await getH1();
      notifResult.keyContent.push('h1=' + notifResult.h1);

      const sections = await page.locator('h1, h2, h3, section').count();
      notifResult.keyContent.push('sectionCount=' + sections);
      notifResult.status = sections > 0 ? 'PASS' : 'FAIL';
    } else {
      notifResult.keyContent.push('Redirected to login - auth gating active');
      notifResult.status = 'AUTH_BLOCKED';
    }
    notifResult.consoleErrors = globalConsoleErrors.slice(priorErrors);
  } catch (e) {
    notifResult.exception = e.message;
  }
  results.notifications = notifResult;

  // ── Final summary ─────────────────────────────────────────────────────────
  await browser.close();

  const summary = {
    testDate: new Date().toISOString(),
    baseUrl: base,
    credentialsUsed: { email: 'qa@example.com', password: 'Sample!' },
    loginSuccess: results.login.status === 'PASS',
    capturedIdeaId: capturedIdeaId,
    routeResults: Object.fromEntries(
      Object.entries(results).map(([k, v]) => [k, v.status])
    ),
    globalConsoleErrors,
    globalPageErrors,
    fullDetails: results
  };

  console.log(JSON.stringify(summary, null, 2));
})();
