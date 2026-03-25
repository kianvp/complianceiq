<document> <source>index.js</source> <content> const express = require('express'); const cors = require('cors'); const NodeCache = require('node-cache');
const app = express();
const cache = new NodeCache({ stdTTL: 1800 });
let persistentItems = [];

app.use(cors());
app.use(express.json());

// ============================================
// RBI NOTIFICATIONS - from https://www.rbi.org.in/Scripts/NotificationUser.aspx
// ============================================
async function scrapeRBI() {
const items = [];
const now = new Date();
const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

try {
// Use RBI's notification RSS feed which maps to NotificationUser.aspx
const urls = [
'https://www.rbi.org.in/Rss/Rss_NotificationUser.aspx',
'https://www.rbi.org.in/Rss/rss_noti.xml'
];

text

for (const feedUrl of urls) {
  try {
    console.log(`Fetching RBI notifications from ${feedUrl}...`);
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });

    if (!response.ok) {
      console.log(`RBI feed ${feedUrl} returned ${response.status}`);
      continue;
    }

    const xml = await response.text();
    
    // Parse RSS items
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      
      const title = extractXmlTag(itemXml, 'title');
      const link = extractXmlTag(itemXml, 'link');
      const description = extractXmlTag(itemXml, 'description');
      const pubDate = extractXmlTag(itemXml, 'pubDate');
      
      if (!title || title.length < 5) continue;
      
      const parsedDate = pubDate ? new Date(pubDate) : null;
      if (parsedDate && !isNaN(parsedDate) && parsedDate < ninetyDaysAgo) continue;
      
      items.push({
        id: link || `rbi-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: cleanHtml(title),
        summary: cleanHtml(description || '').substring(0, 500),
        date: parsedDate && !isNaN(parsedDate) ? parsedDate.toISOString() : (pubDate || new Date().toISOString()),
        source: 'RBI',
        link: link || '',
        department: '',
        reference: ''
      });
    }
    
    if (items.length > 0) {
      console.log(`RBI: got ${items.length} notifications from ${feedUrl}`);
      break; // Got data, no need to try other URLs
    }
  } catch (err) {
    console.log(`RBI feed ${feedUrl} failed: ${err.message}`);
  }
}

// Fallback: scrape the HTML page directly
if (items.length === 0) {
  console.log('RBI RSS failed, scraping HTML page...');
  await scrapeRBIHtml(items, ninetyDaysAgo);
}
} catch (err) {
console.error('RBI scrape error:', err.message);
}

console.log(RBI: total ${items.length} notifications);
return items;
}

async function scrapeRBIHtml(items, ninetyDaysAgo) {
try {
for (let page = 1; page <= 5; page++) {
const url = https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12&Mode=0&pg=${page};
console.log(Scraping RBI HTML page ${page}...);

text

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) continue;
  const html = await response.text();

  // Find all notification links
  const linkRegex = /<a[^>]*href=["']([^"']*NotificationUser\.aspx\?Id=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    let href = linkMatch[1].trim();
    const text = cleanHtml(linkMatch[2]).trim();
    if (text.length < 10) continue;

    if (href.startsWith('/')) href = 'https://www.rbi.org.in' + href;
    else if (!href.startsWith('http')) href = 'https://www.rbi.org.in/Scripts/' + href;

    // Skip duplicates
    if (items.some(i => i.id === href)) continue;

    // Try to find date nearby in the HTML
    const dateRegex = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/gi;
    const nearbyHtml = html.substring(Math.max(0, linkMatch.index - 200), linkMatch.index + linkMatch[0].length + 200);
    const dateMatch = nearbyHtml.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
    
    let itemDate = new Date();
    if (dateMatch) {
      itemDate = new Date(`${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}`);
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

// ============================================
// SEBI CIRCULARS ONLY - from https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0
// ============================================
async function scrapeSEBI() {
const items = [];
const now = new Date();
const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
const seenLinks = new Set();

try {
// Method 1: Use SEBI RSS but ONLY keep /legal/circulars/ URLs
console.log('Fetching SEBI RSS feed...');
try {
const response = await fetch('https://www.sebi.gov.in/sebirss.xml', {
headers: {
'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
'Accept': 'application/rss+xml, application/xml, text/xml, /'
}
});

text

  if (response.ok) {
    const xml = await response.text();
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = cleanHtml(extractXmlTag(itemXml, 'title') || '');
      let link = extractXmlTag(itemXml, 'link') || '';
      const description = cleanHtml(extractXmlTag(itemXml, 'description') || '');
      const pubDate = extractXmlTag(itemXml, 'pubDate');

      if (!title || title.length < 10) continue;

      // ONLY keep circulars - filter by URL path
      if (!link.includes('/legal/circulars/')) continue;

      if (!link.startsWith('http')) link = 'https://www.sebi.gov.in' + link;
      if (seenLinks.has(link)) continue;
      seenLinks.add(link);

      const parsedDate = pubDate ? new Date(pubDate) : null;
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
    console.log(`SEBI RSS: found ${items.length} circulars (filtered)`);
  }
} catch (err) {
  console.log(`SEBI RSS failed: ${err.message}`);
}

// Method 2: Scrape the actual circulars listing page
if (items.length < 5) {
  console.log('Scraping SEBI circulars HTML page...');
  await scrapeSEBIHtml(items, seenLinks, ninetyDaysAgo);
}
} catch (err) {
console.error('SEBI scrape error:', err.message);
}

console.log(SEBI: total ${items.length} circulars);
return items;
}

async function scrapeSEBIHtml(items, seenLinks, ninetyDaysAgo) {
try {
for (let page = 1; page <= 10; page++) {
const url = https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0&pg=${page};
console.log(Scraping SEBI circulars page ${page}...);

text

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    console.log(`SEBI page ${page} returned ${response.status}`);
    continue;
  }

  const html = await response.text();
  let foundOld = false;

  // Look for circular links - they always contain /legal/circulars/
  const linkRegex = /<a[^>]*href=["']([^"']*\/legal\/circulars\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;

  while ((linkMatch = linkRegex.exec(html)) !== null) {
    let href = linkMatch[1].trim();
    const text = cleanHtml(linkMatch[2]).trim();
    if (text.length < 10) continue;
    if (!href.startsWith('http')) href = 'https://www.sebi.gov.in' + href;
    if (seenLinks.has(href)) continue;
    seenLinks.add(href);

    // Extract date from URL (e.g., /mar-2026/)
    const dateFromUrl = extractDateFromSebiUrl(href);
    let itemDate = dateFromUrl ? new Date(dateFromUrl) : new Date();
    
    // Also try to find date in surrounding HTML
    const nearbyHtml = html.substring(Math.max(0, linkMatch.index - 300), linkMatch.index + linkMatch[0].length + 100);
    const dateMatch = nearbyHtml.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+(\d{4})/i);
    if (dateMatch) {
      const parsed = new Date(`${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}`);
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

  if (foundOld) break; // Stop pagination if we've gone past 90 days
}
} catch (err) {
console.error('SEBI HTML scrape error:', err.message);
}
}

// ============================================
// HELPERS
// ============================================

function extractXmlTag(xml, tag) {
// Try CDATA first
const cdataRegex = new RegExp(<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>, 'i');
const cdataMatch = xml.match(cdataRegex);
if (cdataMatch) return cdataMatch[1].trim();

// Then try regular tag
const regex = new RegExp(<${tag}[^>]*>([\\s\\S]*?)</${tag}>, 'i');
const match = xml.match(regex);
return match ? match[1].trim() : '';
}

function cleanHtml(text) {
return text
.replace(/<![CDATA[/g, '')
.replace(/]]>/g, '')
.replace(/<[^>]+>/g, '')
.replace(/&/g, '&')
.replace(/</g, '<')
.replace(/>/g, '>')
.replace(/"/g, '"')
.replace(/'/g, "'")
.replace(/ /g, ' ')
.replace(/\s+/g, ' ')
.trim();
}

function extractDateFromSebiUrl(url) {
const months = { 'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12' };
const m = url.match(//(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{4})//i);
if (m) {
return new Date(parseInt(m[2]), parseInt(months[m[1].toLowerCase()]) - 1, 15).toISOString();
}
return null;
}

// ============================================
// AUTO-TAGGING
// ============================================
const TAG_RULES = [
{ tags: ['KYC/AML'], keywords: ['kyc', 'know your customer', 'aml', 'anti-money', 'money laundering', 'pmla', 'cft', 'financing of terrorism', 'customer due diligence', 'cdd', 'uapa', 'sanctions list'] },
{ tags: ['Basel III'], keywords: ['basel', 'capital adequacy', 'lcr', 'nsfr', 'liquidity coverage', 'leverage ratio', 'crar', 'pillar'] },
{ tags: ['Cybersecurity'], keywords: ['cyber', 'information security', 'data protection', 'it governance', 'digital', 'technology risk', 'outsourcing'] },
{ tags: ['SAR/STR'], keywords: ['suspicious transaction', 'sar filing', 'str filing', 'fiu-ind'] },
{ tags: ['NBFC'], keywords: ['nbfc', 'non-banking', 'microfinance', 'housing finance'] },
{ tags: ['Mutual Funds'], keywords: ['mutual fund', 'amc', 'asset management', 'nav', 'sip', 'scheme'] },
{ tags: ['Corporate Governance'], keywords: ['governance', 'board meeting', 'audit committee', 'independent director'] },
{ tags: ['Insider Trading'], keywords: ['insider', 'upsi', 'unpublished price sensitive'] },
{ tags: ['Listing/LODR'], keywords: ['listing', 'ipo', 'offer for sale', 'rights issue', 'lodr', 'stock exchange'] },
{ tags: ['Risk Management'], keywords: ['risk management', 'operational risk', 'market risk', 'credit risk', 'stress test'] },
{ tags: ['Disclosure'], keywords: ['disclosure', 'financial statements', 'presentation and disclosures', 'reporting requirement'] },
{ tags: ['Payment Systems'], keywords: ['payment system', 'upi', 'neft', 'rtgs', 'imps', 'prepaid instrument', 'wallet', 'currency chest'] },
{ tags: ['Foreign Exchange'], keywords: ['forex', 'fema', 'foreign exchange', 'ecb', 'fdi', 'liberalised remittance', 'export and import of currency'] },
{ tags: ['Priority Sector'], keywords: ['priority sector', 'psl', 'agriculture lending', 'msme lending', 'weaker section'] },
{ tags: ['Interest Rate'], keywords: ['interest rate', 'repo rate', 'mclr', 'base rate', 'benchmark rate'] },
{ tags: ['Deposit/Lending'], keywords: ['deposit', 'lending rate', 'loan', 'advance', 'npa', 'asset quality', 'provisioning'] },
{ tags: ['Co-operative Banks'], keywords: ['co-operative bank', 'cooperative bank', 'urban co-operative', 'rural co-operative', 'regional rural'] },
{ tags: ['Stock Brokers'], keywords: ['stock broker', 'trading member', 'clearing member', 'depository participant', 'demat'] }
];

function autoTag(title, summary) {
const text = ${title} ${summary}.toLowerCase();
const tags = [];
for (const rule of TAG_RULES) {
if (rule.keywords.some(kw => text.includes(kw))) {
tags.push(...rule.tags);
}
}
return tags.length ? [...new Set(tags)] : ['General'];
}

function scoreSeverity(title, summary) {
const text = ${title} ${summary}.toLowerCase();
let score = 3;
if (/penalty|fine|action|violation|non-compliance|enforcement/.test(text)) score += 3;
if (/deadline|mandatory|must comply|immediate effect|with effect from/.test(text)) score += 2;
if (/amendment|revised|updated|modification|change|new framework/.test(text)) score += 1;
if (/master direction|master circular/.test(text)) score += 2;
if (/uapa|sanctions|terror/.test(text)) score += 2;
if (/draft|consultation|discussion|feedback|comments invited/.test(text)) score -= 1;
if (/money market operations|auction result/.test(text)) score -= 1;
return Math.max(1, Math.min(10, score));
}

// ============================================
// MAIN FEED
// ============================================
async function fetchAllFeeds() {
const cached = cache.get('feeds');
if (cached) return cached;

console.log('Scraping fresh data from RBI and SEBI...');

const [rbiItems, sebiItems] = await Promise.all([
scrapeRBI(),
scrapeSEBI()
]);

const allItems = [...rbiItems, ...sebiItems].map(item => ({
...item,
tags: autoTag(item.title, item.summary),
severity: scoreSeverity(item.title, item.summary)
}));

allItems.sort((a, b) => new Date(b.date) - new Date(a.date));

// Remove duplicates
const seen = new Set();
const unique = allItems.filter(item => {
const key = item.title.toLowerCase().substring(0, 60);
if (seen.has(key)) return false;
seen.add(key);
return true;
});

if (unique.length > 0) {
const newIds = new Set(unique.map(i => i.id));
const oldUnique = persistentItems.filter(i => !newIds.has(i.id));
persistentItems = [...unique, ...oldUnique].slice(0, 500);
cache.set('feeds', persistentItems);
}

console.log(Total: ${persistentItems.length} items (RBI: ${rbiItems.length}, SEBI: ${sebiItems.length}));
return persistentItems.length > 0 ? persistentItems : unique;
}

// ============================================
// API ROUTES
// ============================================

app.get('/health', (req, res) => {
res.json({ status: 'ok', time: new Date().toISOString(), items: persistentItems.length });
});

app.get('/api/feed', async (req, res) => {
try {
const items = await fetchAllFeeds();
res.json({ items, count: items.length, timestamp: new Date().toISOString() });
} catch (err) {
console.error('Feed error:', err.message);
res.status(500).json({ error: 'Failed to fetch feeds' });
}
});

app.post('/api/chat', async (req, res) => {
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
return res.status(500).json({ error: 'API key not configured on server' });
}

const { message, circulars } = req.body;

// Fix: make sure message is not empty
const userMessage = (message || '').trim();
if (!userMessage) {
return res.status(400).json({ error: 'Please enter a message' });
}

const circularContext = circulars && circulars.length
? '\n\nLive circulars currently on screen:\n' + circulars.slice(0, 15).map(i => - ${i.source}: ${i.title} (${(i.tags || []).join(', ')})).join('\n')
: '';

const systemPrompt = You are ComplianceIQ AI, an expert on Indian banking and securities compliance. You specialize in RBI and SEBI regulations including KYC/AML, Basel III, PMLA, LODR, and all banking compliance matters. Give specific, practical answers with thresholds, deadlines, and penalties where relevant. If the user asks about current circulars, use the context provided.${circularContext};

try {
const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
method: 'POST',
headers: {
'Authorization': Bearer ${GROQ_API_KEY},
'Content-Type': 'application/json'
},
body: JSON.stringify({
model: 'llama-3.1-8b-instant',
messages: [
{ role: 'system', content: systemPrompt },
{ role: 'user', content: userMessage }
],
max_tokens: 1024,
temperature: 0.3
})
});

text

const data = await response.json();

if (data.error) {
  console.error('Groq error:', JSON.stringify(data.error));
  return res.status(500).json({ error: `AI error: ${data.error.message || 'Unknown'}` });
}

const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
if (!reply) {
  console.error('Unexpected response:', JSON.stringify(data).substring(0, 500));
  return res.status(500).json({ error: 'Unexpected response from AI' });
}

res.json({ reply });
} catch (err) {
console.error('Chat error:', err.message);
res.status(500).json({ error: 'AI request failed' });
}
});

app.post('/api/ask-about', async (req, res) => {
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
return res.status(500).json({ error: 'API key not configured on server' });
}

const { title, summary, source, tags } = req.body;

const safeTitle = (title || '').trim();
const safeSummary = (summary || '').trim();
const safeSource = (source || 'Unknown').trim();
const safeTags = (tags || []).join(', ');

if (!safeTitle) {
return res.status(400).json({ error: 'No circular title provided' });
}

const prompt = `Analyze this ${safeSource} circular for a banking compliance team:

Title: ${safeTitle}
Summary: ${safeSummary}
Tags: ${safeTags}

Provide:

Plain English summary (2-3 sentences)
Key compliance actions required
Relevant thresholds or deadlines
Potential penalties for non-compliance
Which departments need to act on this`;
try {
const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
method: 'POST',
headers: {
'Authorization': Bearer ${GROQ_API_KEY},
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

text

const data = await response.json();

if (data.error) {
  return res.status(500).json({ error: `AI error: ${data.error.message}` });
}

const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
if (!reply) {
  return res.status(500).json({ error: 'No response from AI' });
}

res.json({ reply });
} catch (err) {
console.error('Ask-about error:', err.message);
res.status(500).json({ error: 'AI request failed' });
}
});

// ============================================
// START
// ============================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
console.log(ComplianceIQ API running on port ${PORT});
fetchAllFeeds().then(items => {
console.log(Pre-fetched ${items.length} items on startup);
}).catch(err => {
console.error('Pre-fetch failed:', err.message);
});
});
</content>
</document>

