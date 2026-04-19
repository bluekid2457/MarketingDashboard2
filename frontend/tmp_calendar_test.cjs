const { chromium } = require('playwright');

(async () => {
  const BASE = process.env.BASE_URL || 'http://localhost:3000';
  
  const result = {
    dashboard: {
      calendarVisible: false,
      daysDisplayed: false,
      datesCorrect: false,
      clickableElements: 0,
      status: 'FAIL'
    },
    publish: {
      schedulePickerVisible: false,
      dateInputWorks: false,
      timeInputWorks: false,
      visualCalendarVisible: false,
      selectionSaved: false,
      apiCallsMade: 0,
      status: 'FAIL'
    },
    consoleErrors: [],
    calendarSystemVerdict: 'NEEDS_IMPLEMENTATION'
  };

  const allErrors = [];
  const apiCalls = [];

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

    page.on('response', (resp) => {
      if (resp.status() < 400) {
        apiCalls.push({
          method: resp.request().method(),
          url: resp.url(),
          status: resp.status()
        });
      }
    });

    // Login
    console.log('Logging in...');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[type="email"], input[name="email"]', 'qa@example.com');
    await page.fill('input[type="password"], input[name="password"]', 'Sample!');
    await page.click('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")');
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 20000 }).catch(() => {});
    
    // ===== DASHBOARD CALENDAR TEST =====
    console.log('\n--- Testing Dashboard Calendar ---');
    try {
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Check if calendar/content calendar section is visible
      const calendarSection = await page.locator('text=/Content Calendar|Calendar|Schedule/i').first();
      const calendarSectionCount = await calendarSection.count();
      result.dashboard.calendarVisible = calendarSectionCount > 0;
      console.log('Calendar section visible:', result.dashboard.calendarVisible);

      // Check for day headers (Mon, Tue, Wed, etc.)
      const dayPattern = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i;
      const allElements = await page.locator('*').all();
      let dayCount = 0;
      let daysFound = [];
      
      for (const elem of allElements) {
        const text = await elem.textContent().catch(() => '');
        if (text && dayPattern.test(text.trim())) {
          dayCount++;
          daysFound.push(text.trim());
        }
      }
      
      result.dashboard.daysDisplayed = dayCount >= 7; // At least a full week
      console.log('Days displayed (found ' + dayCount + '):', result.dashboard.daysDisplayed, daysFound.slice(0, 7));

      // Check if calendar dates display correctly (numbers 1-31)
      const datePattern = /^\d{1,2}$/;
      
      // Try multiple approaches to find calendar dates
      let validDates = 0;
      
      // Approach 1: Look for elements with role="gridcell"
      const gridCells = await page.locator('[role="gridcell"]').all();
      for (const elem of gridCells) {
        const text = await elem.textContent().catch(() => '');
        if (text && datePattern.test(text.trim())) {
          const num = parseInt(text.trim());
          if (num >= 1 && num <= 31) {
            validDates++;
          }
        }
      }
      
      // Approach 2: Look for button elements that might contain dates
      if (validDates === 0) {
        const buttons = await page.locator('button').all();
        for (const elem of buttons) {
          const text = await elem.textContent().catch(() => '');
          if (text && datePattern.test(text.trim())) {
            const num = parseInt(text.trim());
            if (num >= 1 && num <= 31) {
              validDates++;
            }
          }
        }
      }
      
      // Approach 3: Look for div elements with just numbers
      if (validDates === 0) {
        const divs = await page.locator('div').all();
        let dateCount = 0;
        for (const elem of divs) {
          const text = await elem.textContent().catch(() => '');
          const directText = await elem.evaluate(el => el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.textContent : '').catch(() => '');
          
          if ((directText || text) && datePattern.test((directText || text).trim())) {
            const num = parseInt((directText || text).trim());
            if (num >= 1 && num <= 31) {
              dateCount++;
            }
          }
        }
        validDates = Math.min(dateCount, 31); // Cap at 31 to avoid double counting
      }
      
      result.dashboard.datesCorrect = validDates > 0;
      console.log('Valid calendar dates found:', validDates, result.dashboard.datesCorrect);

      // Count all potential calendar cells
      const gridCells2 = await page.locator('[role="gridcell"]').all();
      const calendarButtons = await page.locator('button').all();
      result.dashboard.clickableElements = Math.max(gridCells2.length, calendarButtons.length);
      console.log('Clickable elements found:', result.dashboard.clickableElements);

      // Dashboard verdict
      if (result.dashboard.calendarVisible && result.dashboard.daysDisplayed && result.dashboard.datesCorrect) {
        result.dashboard.status = 'PASS';
      }

    } catch (e) {
      pushError('dashboard-test', e.message, page.url());
      console.error('Dashboard calendar test error:', e.message);
    }

    // ===== PUBLISH PAGE SCHEDULE PICKER TEST =====
    console.log('\n--- Testing Publish Schedule Picker ---');
    try {
      const apiCallsBeforePublish = apiCalls.length;
      await page.goto(`${BASE}/publish`, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Check if schedule picker section is visible
      const scheduleSection = await page.locator('text=/Schedule|Date|Time|Calendar|Publish/i').first();
      const scheduleSectionCount = await scheduleSection.count();
      result.publish.schedulePickerVisible = scheduleSectionCount > 0;
      console.log('Schedule picker visible:', result.publish.schedulePickerVisible);

      // Look for date input field
      const dateInputs = await page.locator('input[type="date"], input[placeholder*="date" i], input[placeholder*="Date" i]').all();
      console.log('Date input fields found:', dateInputs.length);
      
      // Try to find date/time inputs more broadly
      const allInputs = await page.locator('input').all();
      let dateInputCount = 0;
      let timeInputCount = 0;
      let inputLabels = [];
      
      for (const input of allInputs) {
        const type = await input.evaluate(el => el.type);
        const placeholder = await input.evaluate(el => el.placeholder);
        const ariaLabel = await input.evaluate(el => el.getAttribute('aria-label'));
        
        if (type === 'date' || placeholder?.toLowerCase().includes('date') || ariaLabel?.toLowerCase().includes('date')) {
          dateInputCount++;
          inputLabels.push(`date[${type}]: ${placeholder || ariaLabel || 'no label'}`);
        }
        if (type === 'time' || placeholder?.toLowerCase().includes('time') || ariaLabel?.toLowerCase().includes('time')) {
          timeInputCount++;
          inputLabels.push(`time[${type}]: ${placeholder || ariaLabel || 'no label'}`);
        }
      }
      
      result.publish.dateInputWorks = dateInputCount > 0;
      result.publish.timeInputWorks = timeInputCount > 0;
      console.log('Date inputs found:', dateInputCount);
      console.log('Time inputs found:', timeInputCount);
      console.log('Input labels:', inputLabels);

      // Check for visual calendar/content calendar
      const visualCalendar = await page.locator('text=/Visual Calendar|Content Calendar|Schedule Picker/i').first();
      const visualCalendarCount = await visualCalendar.count();
      result.publish.visualCalendarVisible = visualCalendarCount > 0;
      console.log('Visual calendar visible:', result.publish.visualCalendarVisible);

      // Try to interact with date/time inputs
      if (dateInputCount > 0) {
        try {
          const dateInput = await page.locator('input[type="date"]').first();
          const dateInputExists = await dateInput.count();
          if (dateInputExists > 0) {
            await dateInput.fill('2026-04-25');
            result.publish.dateInputWorks = true;
            console.log('Date input interaction: SUCCESS');
          }
        } catch (e) {
          console.log('Date input interaction failed:', e.message);
        }
      }

      if (timeInputCount > 0) {
        try {
          const timeInput = await page.locator('input[type="time"]').first();
          const timeInputExists = await timeInput.count();
          if (timeInputExists > 0) {
            await timeInput.fill('14:30');
            result.publish.timeInputWorks = true;
            console.log('Time input interaction: SUCCESS');
          }
        } catch (e) {
          console.log('Time input interaction failed:', e.message);
        }
      }

      // Check if any API calls were made (calendar/schedule related)
      const apiCallsAfterPublish = apiCalls.length;
      result.publish.apiCallsMade = apiCallsAfterPublish - apiCallsBeforePublish;
      console.log('API calls made on publish page:', result.publish.apiCallsMade);

      // Check if selection is saved (look for any visual feedback)
      try {
        await page.waitForTimeout(500); // Brief wait
        const dateInputValues = await page.locator('input[type="date"]').evaluate(
          elements => elements.map(el => el.value)
        ).catch(() => []);
        const timeInputValues = await page.locator('input[type="time"]').evaluate(
          elements => elements.map(el => el.value)
        ).catch(() => []);
        const allSaved = [...dateInputValues, ...timeInputValues];
        result.publish.selectionSaved = allSaved.some(v => v && v.length > 0);
        console.log('Selection saved status:', result.publish.selectionSaved, { dateInputValues, timeInputValues });
      } catch (e) {
        console.log('Could not check saved selection:', e.message);
      }

      // Publish verdict
      const publishFeatureCount = [
        result.publish.schedulePickerVisible,
        result.publish.dateInputWorks,
        result.publish.timeInputWorks
      ].filter(Boolean).length;

      if (publishFeatureCount >= 2) {
        result.publish.status = 'PASS';
      }

    } catch (e) {
      pushError('publish-test', e.message, page.url());
      console.error('Publish schedule test error:', e.message);
    }

    // ===== CONSOLE ERROR COLLECTION =====
    result.consoleErrors = allErrors.filter(err => err.kind === 'console').map(err => err.text);
    console.log('\nTotal console errors:', result.consoleErrors.length);
    if (result.consoleErrors.length > 0) {
      console.log('Errors:', result.consoleErrors.slice(0, 5));
    }

    // ===== CALENDAR SYSTEM VERDICT =====
    if (result.dashboard.status === 'PASS' && result.publish.status === 'PASS') {
      result.calendarSystemVerdict = 'FUNCTIONAL';
    } else if (result.dashboard.status === 'PASS' || result.publish.status === 'PASS') {
      result.calendarSystemVerdict = 'PARTIAL';
    } else {
      result.calendarSystemVerdict = 'NEEDS_IMPLEMENTATION';
    }

    console.log('\n========== FINAL RESULT ==========');
    console.log(JSON.stringify(result, null, 2));

    await browser.close();

  } catch (err) {
    console.error('Fatal test error:', err);
    result.calendarSystemVerdict = 'NEEDS_IMPLEMENTATION';
    console.log(JSON.stringify(result, null, 2));
  }
})();
