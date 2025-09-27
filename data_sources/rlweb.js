const puppeteer = require('puppeteer');
const fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const proxyString = 'http://brd-customer-hl_d7534c2d-zone-naukri:2od53pxasv0t@brd.superproxy.io:33335';
const proxyUrl = new URL(proxyString);
const proxyHostPort = `${proxyUrl.hostname}:${proxyUrl.port}`;
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function navigateWithRetry(page, url, options = {}, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      await page.goto(url, options);
      return;
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    args: [
      `--window-size=1920,1080`,
      `--proxy-server=http=${proxyHostPort};https=${proxyHostPort}`
    ],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
  });

  const page = await browser.newPage();
  await page.authenticate({ username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) });
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.setUserAgent(DESKTOP_UA);

  let allNews = [];

  // First, list scraping across first 2 pages
  for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
    const url = `https://reliefweb.int/updates?list=Sudan%20Situation%20Reports&advanced-search=%28PC220%29_%28F10%29&page=${pageIndex}`;
    await navigateWithRetry(page, url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('article', { timeout: 15000 }).catch(() => {});

    // Scrape all news items on the current listing
    const newsItems = await page.$$eval('article', articles =>
      articles.map(article => {
        const titleEl = article.querySelector('h3, h4, a[href*="/report/"]');
        const linkEl = article.querySelector('a[href*="/report/"]');
        const summaryEl = article.querySelector('div[itemprop="articleBody"], p, .description');
        const dateEl = article.querySelector('.page__date, time, .date');
        const orgEl = article.querySelector('a[href*="/organization/"], .source, .org, .headline__org');
        return {
          title: titleEl ? titleEl.innerText.trim() : '',
          url: linkEl ? linkEl.href : '',
          summary: summaryEl ? summaryEl.innerText.trim() : '',
          date: dateEl ? dateEl.innerText.trim() : '',
          organization: orgEl ? orgEl.innerText.trim() : ''
        };
      })
    );
    allNews = allNews.concat(newsItems);
  }

  // Filter out items without a detail URL
  allNews = allNews.filter(item => item.url);

  // Now, scrape detail info for each news item
  for (let i = 0; i < allNews.length; i++) {
    const item = allNews[i];
    try {
      const detailPage = await browser.newPage();
      await detailPage.authenticate({ username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) });
      await detailPage.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await detailPage.setUserAgent(DESKTOP_UA);
      await navigateWithRetry(detailPage, item.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      const details = await detailPage.evaluate(() => {
        function getMeta(label) {
          let val = '';
          const nodes = Array.from(document.querySelectorAll('body *')).filter(n => n.textContent && n.textContent.includes(label));
          for (const n of nodes) {
            if (n.textContent.trim().startsWith(label)) {
              let sibling = n.nextSibling;
              if (sibling && sibling.textContent && sibling.textContent.trim()) {
                val = sibling.textContent.trim();
              } else if (n.nextElementSibling && n.nextElementSibling.innerText.trim()) {
                val = n.nextElementSibling.innerText.trim();
              } else {
                val = n.textContent.replace(label, '').trim().replace(/^:/, '');
              }
              break;
            }
          }
          return val;
        }

        const title = document.querySelector('h1, h2') ? document.querySelector('h1, h2').innerText.trim() : '';
        let article = '';
        const mainSection = document.querySelector('article') || document.body;
        if (mainSection) {
          const paras = Array.from(mainSection.querySelectorAll('p')).map(p => p.innerText.trim());
          article = paras.join('\n\n');
        }
        const attachments = Array.from(document.querySelectorAll('a[href*="/attachments/"], a[href$=".pdf"], a[href$=".doc"], a[href$=".xlsx"]')).map(a => ({
          text: a.innerText.trim(),
          url: a.href
        }));

        const sections = {};
        Array.from(document.querySelectorAll('strong, b, th, span')).forEach(el => {
          const label = el.textContent.replace(':', '').trim();
          if (
            [
              "Primary country", "Source", "Disaster", "Format", "Theme",
              "Disaster type", "Language", "Origin"
            ].includes(label)
          ) {
            let vals = [];
            let sib = el.parentElement;
            if (sib) {
              sib.querySelectorAll('a').forEach(a => vals.push(a.innerText.trim()));
            }
            if (!vals.length) {
              vals.push(getMeta(label));
            }
            sections[label] = vals.flat().filter(Boolean);
          }
        });

        return {
          detail_title: title,
          posted: getMeta('Posted'),
          original_date: getMeta('Originally published'),
          origin: getMeta('Origin'),
          article,
          attachments,
          ...sections
        };
      });

      // Add details to the news item
      allNews[i].details = details;

      await detailPage.close();
    } catch (e) {
      allNews[i].scrape_error = e.toString();
    }
  }

  fs.writeFileSync('reliefweb_sudan_situation_reports.json', JSON.stringify(allNews, null, 2));
  await browser.close();
})();
