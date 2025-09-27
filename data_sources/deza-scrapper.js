const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const baseUrl = 'https://www.eda.admin.ch/content/deza/en/home/projekte/projekte.filterResults.html?searchTerm=&filtersdctopic%253A=Selection&filtersdcsubtopic%253A=Selection&filtercountry%253A=country%253Asd&filteragency%253A=Selection&filtercontinent%253A=Selection&filtercredit%253A=Selection&filterpartnercontracttype%253A=Selection&filterpartnercontract%253A=Selection&filtereutopic%253A=Selection&filtereusubsubtopic%253A=Selection&filterdacsector%253A=Selection&filterdacsubsector%253A=Selection&swissBudget=-1&fromDate=&toDate=';
  await page.goto(baseUrl, {waitUntil: 'networkidle0'});
  let allData = [];
  let detailPage;
  let pageNum = 1;

  while (true) {
    await page.waitForSelector('h4', {timeout: 20000}).catch(() => {});
    // Scrape entries from listing page
    const entries = await page.$$eval('h4', h4s => {
      return h4s.map(h4 => {
        const title = h4.innerText;
        const a = h4.querySelector('a');
        const url = a ? a.href : null;
        // Get the next siblings: time and description
        let time = '';
        let desc = '';
        let el = h4.nextElementSibling;
        if (el) {
          time = el.textContent.trim();
          el = el.nextElementSibling;
        }
        if (el && el.tagName === 'B') {
          desc = el.textContent.trim();
        }
        if (!desc && el) {
          desc = el.textContent.trim();
        }
        return { title, time, desc, url };
      });
    });

    // Visit each detail page for extra info
    for (let entry of entries) {
      if (!entry.url) continue;
      try {
        detailPage = await browser.newPage();
        await detailPage.goto(entry.url, {waitUntil: 'networkidle0'});
        await detailPage.waitForSelector('body', {timeout: 15000}).catch(() => {});
        entry.details = await detailPage.evaluate(() => {
          function norm(str) {
            return (str || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
          }

          function getTextFromEl(el) {
            return el ? norm(el.textContent) : '';
          }

          // Parse the summary table with headers (Country/region | Topic | Period | Budget)
          function parseSummaryTable() {
            const candidateTables = Array.from(document.querySelectorAll('table')).filter(t => {
              const headers = Array.from(t.querySelectorAll('thead th, tr th'));
              const headerText = headers.map(h => norm(h.textContent.toLowerCase()));
              return headerText.some(h => h.includes('country/region') || h === 'country') &&
                     headerText.some(h => h.includes('topic')) &&
                     headerText.some(h => h.includes('period')) &&
                     headerText.some(h => h.includes('budget'));
            });
            if (candidateTables.length === 0) return null;

            const table = candidateTables[0];
            const headerCells = Array.from(table.querySelectorAll('thead tr th'));
            const headers = headerCells.length > 0 ? headerCells : Array.from(table.querySelectorAll('tr')).find(tr => tr.querySelectorAll('th').length)?.querySelectorAll('th') || [];
            const headerTexts = Array.from(headers).map(h => norm(h.textContent.toLowerCase()));

            const bodyRow = table.querySelector('tbody tr') || Array.from(table.querySelectorAll('tr')).find(tr => tr.querySelectorAll('td').length);
            if (!bodyRow) return null;
            const bodyCells = Array.from(bodyRow.querySelectorAll('td'));

            function readByHeader(name) {
              const idx = headerTexts.findIndex(h => h === name || h.includes(name));
              return idx >= 0 && bodyCells[idx] ? getTextFromEl(bodyCells[idx]) : '';
            }

            return {
              country_region: readByHeader('country/region') || readByHeader('country'),
              topic: readByHeader('topic'),
              period: readByHeader('period'),
              swiss_budget: readByHeader('budget')
            };
          }

          // Parse any 2-column label/value table by label in first td and value in second td
          function getTableCellText(searchText) {
            const tables = Array.from(document.querySelectorAll('table'));
            for (const table of tables) {
              const rows = Array.from(table.querySelectorAll('tr'));
              for (const row of rows) {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length >= 2) {
                  const labelCell = cells[0];
                  const valueCell = cells[1];
                  if ((labelCell.textContent || '').toLowerCase().includes(searchText.toLowerCase())) {
                    return getTextFromEl(valueCell);
                  }
                }
              }
            }
            return '';
          }

          function getMultipleTableText(labels) {
            for (let label of labels) {
              const v = getTableCellText(label);
              if (v) return v;
            }
            return '';
          }

          function getText(selector) {
            const el = document.querySelector(selector);
            return getTextFromEl(el);
          }

          // Extract continuous text after a given header (h3/h4) until next header
          function extractSectionText(headerIncludes) {
            const headers = Array.from(document.querySelectorAll('h3, h4'));
            const hdr = headers.find(h => getTextFromEl(h).toLowerCase().includes(headerIncludes));
            if (!hdr) return '';
            let text = '';
            let el = hdr.nextElementSibling;
            while (el && !/^H[34]$/.test(el.tagName)) {
              text += ' ' + getTextFromEl(el);
              el = el.nextElementSibling;
            }
            return norm(text);
          }

          const summary = parseSummaryTable() || {};

          const embassyText = extractSectionText('embassy');
          const partnerText = extractSectionText('partner');
          const sdcText = extractSectionText('sdc');

          const lastUpdateEl = document.querySelector('#page-end');
          const last_update = lastUpdateEl ? getTextFromEl(lastUpdateEl) : '';
          const status = getText('.project-status, .status') || (document.body.innerText.includes('Project completed') ? 'Project completed' : '');

          return {
            // Summary
            country_region: summary.country_region || '',
            topic: summary.topic || '',
            period: summary.period || '',
            swiss_budget: summary.swiss_budget || '',

            // Technical details (text only)
            background: getTableCellText('Background'),
            objectives: getMultipleTableText(['Objectives', 'Objective']),
            target_groups: getMultipleTableText(['Target groups', 'Target group']),
            outcomes: getMultipleTableText(['Medium-term outcomes', 'Outcomes', 'Outcome']),
            results: getMultipleTableText(['Results', 'Result']),
            directorate: getMultipleTableText(['Directorate/federal office responsible', 'Directorate', 'Federal office']),
            project_partners: getMultipleTableText(['Project partners', 'Partners', 'Partner']),
            coordination: getTableCellText('Coordination with other projects and actors'),
            budget_details: getTableCellText('Budget'),
            project_phases: getTableCellText('Project phases'),

            // Further technical details (text only)
            sector: getTableCellText('Sector according to the OECD'),
            sub_sector: getTableCellText('Sub-Sector according to the OECD'),
            cross_cutting_topics: getTableCellText('Cross-cutting topics'),
            aid_type: getTableCellText('Aid Type'),
            project_number: getTableCellText('Project number'),

            // Contacts and metadata (text only)
            contact_info: getText('.contact, .contactview'),
            embassy_contact: embassyText,
            partner_contact: partnerText,
            sdc_contact: sdcText,
            last_update,
            project_status: status
          };
        });
      } catch (e) {
        entry.details_error = String(e.message || e);
      } finally {
        if (detailPage) { await detailPage.close().catch(()=>{}); }
      }
    }

    allData = allData.concat(entries);

    // Next page navigation
    const nextByText = await page.$x("//a[normalize-space(text())='Next' and not(contains(@class,'disabled'))]");
    const nextClickable = nextByText.length ? nextByText[0] : null;
    if (nextClickable) {
      await Promise.all([
        page.waitForNavigation({waitUntil: 'networkidle0'}),
        nextClickable.click()
      ]);
      pageNum++;
    } else {
      // Fallback: try next page number
      const currentActive = await page.$x("//a[@class='active' or contains(@class,'active')]");
      if (currentActive.length) {
        const currentNum = await page.evaluate(el => parseInt(el.textContent, 10), currentActive[0]).catch(()=>NaN);
        if (!isNaN(currentNum)) {
          const nextNumLink = await page.$x(`//a[normalize-space(text())='${currentNum + 1}']`);
          if (nextNumLink.length) {
            await Promise.all([
              page.waitForNavigation({waitUntil: 'networkidle0'}),
              nextNumLink[0].click()
            ]);
            pageNum++;
          } else {
            break;
          }
        } else {
          break;
        }
      } else {
        break;
      }
    }
  }

  fs.writeFileSync('projects.json', JSON.stringify(allData, null, 2));
  await browser.close();
})();
