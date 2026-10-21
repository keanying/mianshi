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
  check(/道题/.test(await text(pool, '#pageSub')), 'pool not rendered');
  check((await pool.locator('.q').count()) > 0, 'pool: no question cards');
  await pool.click('#dimFilter [data-dim="logic"]');
  check(/逻辑思维/.test(await text(pool, '#pageSub')), 'dimension filter not applied');
  await pool.click('#dimFilter [data-dim="drive"]');
  check((await pool.locator('.q .dim-drive').count()) > 0, 'pool: no 自驱力 questions');
  await pool.click('#dimFilter [data-dim=""]');
  // 面试模式：打开、翻页、显示要点、退出。
  await pool.click('#focusButton');
  check(await pool.locator('#focus').isVisible(), 'focus mode did not open');
  await pool.keyboard.press('ArrowRight');
  check(/^2 \//.test(await text(pool, '#focusPos')), 'focus mode: next question failed');
  await pool.keyboard.press(' ');
  check(await pool.locator('#focusAnswer').isVisible(), 'focus mode: answer not revealed');
  await pool.keyboard.press('Escape');
  check(!(await pool.locator('#focus').isVisible()), 'focus mode did not close');

  const locked = await pool.evaluate(() => Boolean(JSON.parse(document.getElementById('questionData').textContent).locked));
  if (locked) {
    const context = await browser.newContext();
    const page = await open('#/resume/B/B-p2', undefined, context);
    check(await page.locator('#unlockForm').isVisible(), 'locked: unlock form not shown');
    await page.fill('#unlockInput', 'wrong-password');
    await page.click('#unlockForm button[type="submit"]');
    await page.locator('#unlockForm .error').waitFor({ timeout: 15000 });

    if (!password) {
      console.warn('No password available: skipped unlock checks');
    } else {
      await page.fill('#unlockInput', password);
      await page.click('#unlockForm button[type="submit"]');
      await page.locator('#blockTabs').waitFor({ state: 'visible', timeout: 15000 });
      check(/B-p2$/.test(page.url()), 'deep link not restored after unlock');
      check((await text(page, '#blockTabs button.active')).includes('知识中台'), 'deep link opened the wrong block');
      check((await page.locator('.q').count()) > 0, 'block shows no questions');
      await page.click('[data-nav="back"]');
      check((await page.locator('[data-open-cand]').count()) > 0, 'no boards on the overview');

      // 记住密码后，新页面自动解锁。
      const again = await open('#/resume', undefined, context);
      await again.locator('[data-open-cand]').first().waitFor({ timeout: 15000 });
      await again.locator('[data-open-cand]').first().click();
      check(await again.locator('.overview').isVisible(), 'board does not open on the overview tab');
      check((await again.locator('.scale').count()) === 5 && (await again.locator('.scale').first().locator('button').count()) === 6, 'scoring panel is not 5 dimensions × 0-5');
      await again.click('#blockTabs [data-tab="dims"]');
      check((await again.locator('.q .dim-drive').count()) > 0 && (await again.locator('.q .dim-trait').count()) > 0, '五维题 tab: missing 自驱力 / 性格特质 questions');
      await again.click('#blockTabs [data-tab="overview"]');
      const tabs = again.locator('#blockTabs button');
      await tabs.nth(2).click();
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
