// Headless check of the built workbench: views, filters, résumé boards, deep links, mobile layout.
// Usage: node scripts/check_ui.js   (needs Playwright; run scripts/build.py first)
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (file, hash = '', viewport = { width: 1440, height: 900 }) => {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', e => errors.push(`${file}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${file}: ${m.text()}`); });
    await page.goto('file://' + path.join(DIST, file) + hash);
    return page;
  };
  const text = (page, selector) => page.locator(selector).first().textContent();

  // 公开版：只有通用题池，简历入口禁用。
  const pub = await open('interview-workbench-public.html');
  check(/道题/.test(await text(pub, '#resultCount')), 'public: pool not rendered');
  check(await pub.locator('[data-view="resume"]').isDisabled(), 'public: résumé view should be disabled');
  await pub.click('#dimFilter [data-dim="exp"]');
  check(/表达/.test(await text(pub, '#resultCount')), 'public: dimension filter not applied');

  const full = 'interview-workbench.html';
  if (fs.existsSync(path.join(DIST, full))) {
    const page = await open(full, '#/resume');
    const boards = await page.locator('[data-open-cand]').count();
    check(boards > 0, 'full: no résumé boards on the overview');
    await page.locator('[data-open-cand]').first().click();
    check(await page.locator('#blockTabs').isVisible(), 'full: block tabs not visible inside a board');
    const tabs = page.locator('#blockTabs button');
    await tabs.nth(1).click();
    check(/#\/resume\/[^/]+\/.+/.test(page.url()), 'full: block selection not reflected in the URL');
    await page.click('[data-nav="back"]');
    check((await text(page, '#categoryTitle')) === '简历板块', 'full: back to overview failed');

    for (const file of fs.readdirSync(path.join(DIST, 'candidates'))) {
      const single = await open('candidates/' + file);
      check(await single.locator('#blockTabs').isVisible(), `candidates/${file}: board not opened directly`);
      check((await single.locator('[data-nav="back"]').count()) === 0, `candidates/${file}: should not link to other boards`);
    }

    const mobile = await open(full, '#/resume', { width: 390, height: 844 });
    await mobile.locator('[data-open-cand]').first().click();
    check(await mobile.locator('#blockTabs').isVisible(), 'mobile: block tabs not visible');
    check(!(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'mobile: horizontal overflow');
  }

  check(errors.length === 0, 'console errors:\n  ' + errors.join('\n  '));
  await browser.close();
  if (failures.length) { console.error('FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('UI check passed');
})();
