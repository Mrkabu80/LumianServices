
const fs = require('fs');
async function run() {
  let chromium;
  try { chromium = require('playwright').chromium; }
  catch (e) { chromium = require('playwright-core').chromium; }
  const browser = await chromium.launch({headless:true, executablePath: process.env.CHROME_PATH || undefined});
  const page = await browser.newPage({viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true});
  await page.goto('file:///mnt/data/lumian_v27_work_1783405321/empfehlung/index.html?ref=LM1001', {waitUntil:'networkidle'});
  await page.screenshot({path:'/mnt/data/lumian_v27_previews/empfehlung-mobile.png', fullPage:true});
  const page2 = await browser.newPage({viewport:{width:1365,height:900}, deviceScaleFactor:1});
  await page2.goto('file:///mnt/data/lumian_v27_work_1783405321/empfehlung/index.html?ref=LM1001', {waitUntil:'networkidle'});
  await page2.screenshot({path:'/mnt/data/lumian_v27_previews/empfehlung-desktop.png', fullPage:true});
  const page3 = await browser.newPage({viewport:{width:1365,height:900}, deviceScaleFactor:1});
  await page3.goto('file:///mnt/data/lumian_v27_work_1783405321/index.html#booking', {waitUntil:'networkidle'});
  await page3.screenshot({path:'/mnt/data/lumian_v27_previews/main-booking-desktop.png', fullPage:false});
  await browser.close();
}
run().catch(e=>{console.error(e); process.exit(1);});
