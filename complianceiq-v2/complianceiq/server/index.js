const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 1800 });
let persistentItems = [];

app.use(cors());
app.use(express.json());

async function scrapeRBI() {
  const items = [];
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  try {
    const urls = [
      'https://www.rbi.org.in/Rss/Rss_NotificationUser.aspx',
      'https://www.rbi.org.in/Rss/rss_noti.xml'
    ];

    for (const feedUrl of urls) {
      try {
        console.log('Fetching RBI from ' + feedUrl);
        const response = await fetch(feedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          }
        });

        if (!response.ok) {
          console.log('RBI feed returned ' + response.status);
          continue;
        }

        const xml = await response.text();
        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        let match;

        while ((match = itemRegex.exec(xml)) !== null) {
          const itemXml = match[1];
          const title = cleanHtml(extractXmlTag(itemXml, 'title'));
          const link = extractXmlTag(itemXml, 'link');
          const description = cleanHtml(extractXmlTag(itemXml, 'description'));
          const pubDate = extractXmlTag(itemXml, 'pubDate');

          if (!title || title.length < 5) continue;

          const parsedDate = pubDate ? new Date(pubDate) : null;
          if (parsedDate && !isNaN(parsedDate) && parsedDate < ninetyDaysAgo) continue;

          items.push({
            id: link || 'rbi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            title: title,
            summary: (description || '').substring(0, 500),
            date: parsedDate && !isNaN(parsedDate) ? parsedDate.toISOString() : (pubDate || new Date().toISOString()),
            source: 'RBI',
            link: link || '',
            department: '',
            reference: ''
          });
        }

        if (items.length > 0) {
          console.log('RBI: got ' + items.length + ' notifications');
          break;
        }
      } catch (err) {
        console.log('RBI feed failed: ' + err.message);
      }
    }

    if (items.length === 0) {
      console.log('RBI RSS failed, scraping HTML...');
      await scrapeRBIHtml(items, ninetyDaysAgo);
    }
  } catch (err) {
    console.error('RBI scrape error:', err.message);
  }

  console.log('RBI: total ' + items.length + ' notifications');
  return items;
}

async function scrapeRBIHtml(items, ninetyDaysAgo) {
  try {
    for (var page = 1; page <= 5; page++) {
      var url = 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12&Mode=0&pg=' + page;
      console.log('Scraping RBI HTML page ' + page);

      var response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!response.ok) continue;
      var html = await response.text();

      var linkRegex = /<a[^>]*href=["']([^"']*NotificationUser\.aspx\?Id=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      var linkMatch;

      while ((linkMatch = linkRegex.exec(html)) !== null) {
        var href = linkMatch[1].trim();
        var text = cleanHtml(linkMatch[2]).trim();
        if (text.length < 10) continue;

        if (href.startsWith('/')) href = 'https://www.rbi.org.in' + href;
        else if (!href.startsWith('http')) href = 'https://www.rbi.org.in/Scripts/' + href;

        if (items.some(function(i) { return i.id === href; })) continue;

        var nearbyHtml = html.substring(Math.max(0, linkMatch.index - 200), linkMatch.index + linkMatch[0].length + 200);
        var dateMatch = nearbyHtml.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);

        var itemDate = new Date();
        if (dateMatch) {
          itemDate = new Date(dateMatch[2] + ' ' + dateMatch[1] + ', ' + dateMatch[3]);
          if (isNaN(itemDate)) itemDate = new Date();
          if (itemDate < ninetyDaysAgo) continue;
        }

        items.push({
          id: href,
          title: text,
          summary: '',
          date: itemDate.toISOString(),
          source: 'RBI',
          link: href,
          department: '',
          reference: ''
        });
      }
    }
  } catch (err) {
    console.error('RBI HTML scrape error:', err.message);
  }
}

async function scrapeSEBI() {
  var items = [];
  var now = new Date();
  var ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  var seenLinks = new Set();

  try {
    console.log('Fetching SEBI RSS feed...');
    try {
      var response = await fetch('https://www.sebi.gov.in/sebirss.xml', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      });

      if (response.ok) {
        var xml = await response.text();
        var itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        var match;

        while ((match = itemRegex.exec(xml)) !== null) {
          var itemXml = match[1];
          var title = cleanHtml(extractXmlTag(itemXml, 'title') || '');
          var link = extractXmlTag(itemXml, 'link') || '';
          var description = cleanHtml(extractXmlTag(itemXml, 'description') || '');
          var pubDate = extractXmlTag(itemXml, 'pubDate');

          if (!title || title.length < 10) continue;
          if (!link.includes('/legal/circulars/')) continue;

          if (!link.startsWith('http')) link = 'https://www.sebi.gov.in' + link;
          if (seenLinks.has(link)) continue;
          seenLinks.add(link);

          var parsedDate = pubDate ? new Date(pubDate) : null;
          if (parsedDate && !isNaN(parsedDate) && parsedDate < ninetyDaysAgo) continue;

          items.push({
            id: link,
            title: title,
            summary: description.substring(0, 500),
            date: parsedDate && !isNaN(parsedDate) ? parsedDate.toISOString() : (pubDate || new Date().toISOString()),
            source: 'SEBI',
            link: link,
            department: 'SEBI',
            reference: ''
          });
        }
        console.log('SEBI RSS: found ' + items.length + ' circulars');
      }
    } catch (err) {
      console.log('SEBI RSS failed: ' + err.message);
    }

    if (items.length < 5) {
      console.log('Scraping SEBI circulars HTML...');
      await scrapeSEBIHtml(items, seenLinks, ninetyDaysAgo);
    }
  } catch (err) {
    console.error('SEBI scrape error:', err.message);
  }

  console.log('SEBI: total ' + items.length + ' circulars');
  return items;
}

async function scrapeSEBIHtml(items, seenLinks, ninetyDaysAgo) {
  try {
    for (var page = 1; page <= 10; page++) {
      var url = 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0&pg=' + page;
      console.log('Scraping SEBI page ' + page);

      var response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!response.ok) continue;
      var html = await response.text();
      var foundOld = false;

      var linkRegex = /<a[^>]*href=["']([^"']*\/legal\/circulars\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      var linkMatch;

      while ((linkMatch = linkRegex.exec(html)) !== null) {
        var href = linkMatch[1].trim();
        var text = cleanHtml(linkMatch[2]).trim();
        if (text.length < 10) continue;
        if (!href.startsWith('http')) href = 'https://www.sebi.gov.in' + href;
        if (seenLinks.has(href)) continue;
        seenLinks.add(href);

        var dateFromUrl = extractDateFromSebiUrl(href);
        var itemDate = dateFromUrl ? new Date(dateFromUrl) : new Date();

        var nearbyHtml = html.substring(Math.max(0, linkMatch.index - 300), linkMatch.index + linkMatch[0].length + 100);
        var dateMatch = nearbyHtml.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+(\d{4})/i);
        if (dateMatch) {
          var parsed = new Date(dateMatch[2] + ' ' + dateMatch[1] + ', ' + dateMatch[3]);
          if (!isNaN(parsed)) itemDate = parsed;
        }

        if (itemDate < ninetyDaysAgo) {
          foundOld = true;
          continue;
        }

        items.push({
          id: href,
          title: text,
          summary: '',
          date: itemDate.toISOString(),
          source: 'SEBI',
          link: href,
          department: 'SEBI',
          reference: ''
        });
      }

      if (foundOld) break;
    }
  } catch (err) {
    console.error('SEBI HTML scrape error:', err.message);
  }
}

function extractXmlTag(xml, tag) {
  var cdataRegex = new RegExp('<' + tag + '[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</' + tag + '>', 'i');
  var cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  var regex = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
  var m = xml.match(regex);
  return m ? m[1].trim() : '';
}

function cleanHtml(text) {
  return text
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDateFromSebiUrl(url) {
  var months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  var m = url.match(/\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{4})\//i);
  if (m) {
    return new Date(parseInt(m[2]), parseInt(months[m[1].toLowerCase()]) - 1, 15).toISOString();
  }
  return null;
}

var TAG_RULES = [
  { tags: ['KYC/AML'], keywords: ['kyc', 'know your customer', 'aml', 'anti-money', 'money laundering', 'pmla', 'cft', 'financing of terrorism', 'uapa', 'sanctions list'] },
  { tags: ['Basel III'], keywords: ['basel', 'capital adequacy', 'lcr', 'nsfr', 'liquidity coverage', 'leverage ratio', 'crar'] },
  { tags: ['Cybersecurity'], keywords: ['cyber', 'information security', 'data protection', 'it governance', 'digital', 'technology risk'] },
  { tags: ['NBFC'], keywords: ['nbfc', 'non-banking', 'microfinance', 'housing finance'] },
  { tags: ['Mutual Funds'], keywords: ['mutual fund', 'amc', 'asset management', 'nav', 'sip', 'scheme'] },
  { tags: ['Corporate Governance'], keywords: ['governance', 'board meeting', 'audit committee', 'independent director'] },
  { tags: ['Insider Trading'], keywords: ['insider', 'upsi', 'unpublished price sensitive'] },
  { tags: ['Listing/LODR'], keywords: ['listing', 'ipo', 'offer for sale', 'rights issue', 'lodr', 'stock exchange'] },
  { tags: ['Risk Management'], keywords: ['risk management', 'operational risk', 'market risk', 'credit risk', 'stress test'] },
  { tags: ['Disclosure'], keywords: ['disclosure', 'financial statements', 'presentation and disclosures', 'reporting requirement'] },
  { tags: ['Payment Systems'], keywords: ['payment system', 'upi', 'neft', 'rtgs', 'imps', 'prepaid', 'currency chest'] },
  { tags: ['Foreign Exchange'], keywords: ['forex', 'fema', 'foreign exchange', 'ecb', 'fdi', 'liberalised remittance'] },
  { tags: ['Co-operative Banks'], keywords: ['co-operative bank', 'cooperative bank', 'urban co-operative', 'rural co-operative', 'regional rural'] },
  { tags: ['Stock Brokers'], keywords: ['stock broker', 'trading member', 'clearing member', 'depository participant', 'demat'] },
  { tags: ['Interest Rate'], keywords: ['interest rate', 'repo rate', 'mclr', 'base rate', 'benchmark rate'] },
  { tags: ['Deposit/Lending'], keywords: ['deposit', 'lending', 'loan', 'advance', 'npa', 'asset quality', 'provisioning'] }
];

function autoTag(title, summary) {
  var text = (title + ' ' + summary).toLowerCase();
  var tags = [];
  for (var i = 0; i < TAG_RULES.length; i++) {
    var rule = TAG_RULES[i];
    for (var j = 0; j < rule.keywords.length; j++) {
      if (text.includes(rule.keywords[j])) {
        for (var k = 0; k < rule.tags.length; k++) {
          if (tags.indexOf(rule.tags[k]) === -1) tags.push(rule.tags[k]);
        }
        break;
      }
    }
  }
  return tags.length ? tags : ['General'];
}

function scoreSeverity(title, summary) {
  var text = (title + ' ' + summary).toLowerCase();
  var score = 3;
  if (/penalty|fine|action|violation|non-compliance|enforcement/.test(text)) score += 3;
  if (/deadline|mandatory|must comply|immediate effect|with effect from/.test(text)) score += 2;
  if (/amendment|revised|updated|modification|change|new framework/.test(text)) score += 1;
  if (/master direction|master circular/.test(text)) score += 2;
  if (/uapa|sanctions|terror/.test(text)) score += 2;
  if (/draft|consultation|discussion|feedback|comments invited/.test(text)) score -= 1;
  if (/money market operations|auction result/.test(text)) score -= 1;
  return Math.max(1, Math.min(10, score));
}

async function fetchAllFeeds() {
  var cached = cache.get('feeds');
  if (cached) return cached;

  console.log('Scraping fresh data from RBI and SEBI...');

  var results = await Promise.all([scrapeRBI(), scrapeSEBI()]);
  var rbiItems = results[0];
  var sebiItems = results[1];

  var allItems = rbiItems.concat(sebiItems).map(function(item) {
    return Object.assign({}, item, {
      tags: autoTag(item.title, item.summary),
      severity: scoreSeverity(item.title, item.summary)
    });
  });

  allItems.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

  var seen = {};
  var unique = allItems.filter(function(item) {
    var key = item.title.toLowerCase().substring(0, 60);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });

  if (unique.length > 0) {
    var newIds = {};
    unique.forEach(function(i) { newIds[i.id] = true; });
    var oldUnique = persistentItems.filter(function(i) { return !newIds[i.id]; });
    persistentItems = unique.concat(oldUnique).slice(0, 500);
    cache.set('feeds', persistentItems);
  }

  console.log('Total: ' + persistentItems.length + ' items (RBI: ' + rbiItems.length + ', SEBI: ' + sebiItems.length + ')');
  return persistentItems.length > 0 ? persistentItems : unique;
}

app.get('/health', function(req, res) {
  res.json({ status: 'ok', time: new Date().toISOString(), items: persistentItems.length });
});

app.get('/api/feed', async function(req, res) {
  try {
    var items = await fetchAllFeeds();
    res.json({ items: items, count: items.length, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Feed error:', err.message);
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

app.post('/api/chat', async function(req, res) {
  var GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  var message = (req.body.message || '').trim();
  var circulars = req.body.circulars || [];

  if (!message) {
    return res.status(400).json({ error: 'Please enter a message' });
  }

  var circularContext = '';
  if (circulars.length > 0) {
    circularContext = '\n\nLive circulars currently on screen:\n' + circulars.slice(0, 15).map(function(i) {
      return '- ' + i.source + ': ' + i.title + ' (' + (i.tags || []).join(', ') + ')';
    }).join('\n');
  }

  var systemPrompt = 'You are ComplianceIQ AI, an expert on Indian banking and securities compliance. You specialize in RBI and SEBI regulations including KYC/AML, Basel III, PMLA, LODR, and all banking compliance matters. Give specific, practical answers with thresholds, deadlines, and penalties where relevant.' + circularContext;

  try {
    var response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROQ_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        max_tokens: 1024,
        temperature: 0.3
      })
    });

    var data = await response.json();

    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error));
      return res.status(500).json({ error: 'AI error: ' + (data.error.message || 'Unknown') });
    }

    var reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply) {
      console.error('Unexpected response:', JSON.stringify(data).substring(0, 500));
      return res.status(500).json({ error: 'Unexpected response from AI' });
    }

    res.json({ reply: reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'AI request failed' });
  }
});

app.post('/api/ask-about', async function(req, res) {
  var GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  var title = (req.body.title || '').trim();
  var summary = (req.body.summary || '').trim();
  var source = (req.body.source || 'Unknown').trim();
  var tags = (req.body.tags || []).join(', ');

  if (!title) {
    return res.status(400).json({ error: 'No circular title provided' });
  }

  var prompt = 'Analyze this ' + source + ' circular for a banking compliance team:\n\nTitle: ' + title + '\nSummary: ' + summary + '\nTags: ' + tags + '\n\nProvide:\n1. Plain English summary (2-3 sentences)\n2. Key compliance actions required\n3. Relevant thresholds or deadlines\n4. Potential penalties for non-compliance\n5. Which departments need to act on this';

  try {
    var response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROQ_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You are an expert Indian banking compliance analyst specializing in RBI and SEBI regulations.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1024,
        temperature: 0.3
      })
    });

    var data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: 'AI error: ' + data.error.message });
    }

    var reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply) {
      return res.status(500).json({ error: 'No response from AI' });
    }

    res.json({ reply: reply });
  } catch (err) {
    console.error('Ask-about error:', err.message);
    res.status(500).json({ error: 'AI request failed' });
  }
});

var PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('ComplianceIQ API running on port ' + PORT);
  fetchAllFeeds().then(function(items) {
    console.log('Pre-fetched ' + items.length + ' items on startup');
  }).catch(function(err) {
    console.error('Pre-fetch failed:', err.message);
  });
});
