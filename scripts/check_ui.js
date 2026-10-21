// Headless check of index.html: pool, unlock, résumé boards, deep links, mobile layout.
// Usage: node scripts/check_ui.js   (needs Playwright; run scripts/build.py first)
// The unlock steps read the password from $MIANSHI_PASSWORD or private/.password.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const passwordFile = path.join(ROOT, 'private/.password');
const password = process.env.MIANSHI_PASSWORD || (fs.existsSync(passwordFile) ? fs.readFileSync(passwordFile, 'utf8').trim() : '');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (hash = '', viewport = { width: 1440, height: 900 }, context = browser) => {
    const page = await context.newPage({ viewport });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(PAGE + hash);
    return page;
  };
  const text = (page, selector) => page.locator(selector).first().textContent();

  // 通用题池无需密码。
  const pool = await open();
  check(/道题/.test(await text(pool, '#resultCount')), 'pool not rendered');
  await pool.click('#dimFilter [data-dim="exp"]');
  check(/表达/.test(await text(pool, '#resultCount')), 'dimension filter not applied');

  const locked = await pool.evaluate(() => Boolean(JSON.parse(document.getElementById('questionData').textContent).locked));
  if (locked) {
    const context = await browser.newContext();
    const page = await open('#/resume/B/B-p2', undefined, context);
    check(await page.locator('#unlockForm').isVisible(), 'locked: unlock form not shown');
    await page.fill('#unlockInput', 'wrong-password');
    await page.click('#unlockForm button[type="submit"]');
    await page.locator('.unlock-error').waitFor({ timeout: 15000 });

    if (!password) {
      console.warn('No password available: skipped unlock checks');
    } else {
      await page.fill('#unlockInput', password);
      await page.click('#unlockForm button[type="submit"]');
      await page.locator('#blockTabs').waitFor({ state: 'visible', timeout: 15000 });
      check(/B-p2$/.test(page.url()), 'deep link not restored after unlock');
      check(/企业知识中台/.test(await text(page, '#categoryTitle')), 'deep link opened the wrong block');
      await page.click('[data-nav="back"]');
      check((await page.locator('[data-open-cand]').count()) > 0, 'no boards on the overview');

      // 记住密码后，新页面自动解锁。
      const again = await open('#/resume', undefined, context);
      await again.locator('[data-open-cand]').first().waitFor({ timeout: 15000 });
      await again.locator('[data-open-cand]').first().click();
      const tabs = again.locator('#blockTabs button');
      await tabs.nth(1).click();
      check(/#\/resume\/[^/]+\/.+/.test(again.url()), 'block selection not reflected in the URL');

      const mobile = await open('#/resume', { width: 390, height: 844 }, context);
      await mobile.locator('[data-open-cand]').first().waitFor({ timeout: 15000 });
      await mobile.locator('[data-open-cand]').first().click();
      check(await mobile.locator('#blockTabs').isVisible(), 'mobile: block tabs not visible');
      check(!(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'mobile: horizontal overflow');
    }
    await context.close();
  }

  check(errors.length === 0, 'console errors:\n  ' + errors.join('\n  '));
  await browser.close();
  if (failures.length) { console.error('FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('UI check passed');
})();
