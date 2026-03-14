const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const NodeCache = require('node-cache');

const app = express();
const parser = new Parser({ timeout: 10000 });
const cache = new NodeCache({ stdTTL: 1800 });

app.use(cors({ origin: '*' }));
app.use(express.json());

const FEEDS = {
  sebi_circulars: { url: 'https://www.sebi.gov.in/sebirss.xml', label: 'SEBI', category: 'Circular', color: 'green' },
  sebi_press: { url: 'https://www.sebi.gov.in/sebi_data/rss/pressrelease.xml', label: 'SEBI', category: 'Press Release', color: 'green' },
  rbi_press: { url: 'https://www.rbi.org.in/scripts/rss.aspx', label: 'RBI', category: 'Press Release', color: 'blue' },
  rbi_circulars: { url: 'https://rbidocs.rbi.org.in/rdocs/content/docs/CIRU.xml', label: 'RBI', category: 'Circular', color: 'blue' },
};

const TAG_RULES = [
  { keywords: ['KYC', 'know your customer', 'customer due diligence', 'CDD'], tag: 'KYC' },
  { keywords: ['AML', 'anti-money laundering', 'PMLA', 'money laundering', 'FIU'], tag: 'AML/CFT' },
  { keywords: ['SAR', 'STR', 'suspicious transaction', 'suspicious activity'], tag: 'SAR/STR' },
  { keywords: ['Basel', 'capital adequacy', 'CRAR', 'tier 1', 'tier 2'], tag: 'Basel III' },
  { keywords: ['LCR', 'liquidity coverage', 'NSFR', 'liquidity ratio'], tag: 'Liquidity' },
  { keywords: ['PCA', 'prompt corrective action', 'NPA', 'non-performing'], tag: 'PCA/NPA' },
  { keywords: ['cyber', 'information security', 'data protection', 'CERT'], tag: 'Cybersecurity' },
  { keywords: ['crypto', 'virtual digital asset', 'VDA', 'cryptocurrency', 'blockchain'], tag: 'Crypto/VDA' },
  { keywords: ['FEMA', 'foreign exchange', 'forex', 'ECB', 'external commercial'], tag: 'FEMA' },
  { keywords: ['insider trading', 'UPSI', 'designated person', 'price sensitive'], tag: 'Insider Trading' },
  { keywords: ['interest rate', 'repo rate', 'monetary policy', 'MPC'], tag: 'Monetary Policy' },
  { keywords: ['payment', 'UPI', 'NEFT', 'RTGS', 'digital payment'], tag: 'Payments' },
  { keywords: ['NBFC', 'non-banking'], tag: 'NBFC' },
];

function classifyTags(title = '', summary = '') {
  const text = (title + ' ' + summary).toLowerCase();
  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.keywords.some(kw => text.includes(kw.toLowerCase()))) tags.push(rule.tag);
  }
  return tags.length ? tags : ['General'];
}

async function fetchFeed(key, config) {
  try {
    const feed = await parser.parseURL(config.url);
    return (feed.items || []).slice(0, 20).map(item => ({
      id: item.guid || item.link || item.title,
      title: item.title || 'Untitled',
      summary: item.contentSnippet || item.summary || '',
      link: item.link || '',
      date: item.pubDate || item.isoDate || new Date().toISOString(),
      source: config.label,
      category: config.category,
      color: config.color,
      tags: classifyTags(item.title, item.contentSnippet || ''),
    }));
  } catch (err) {
    console.error(`Failed to fetch ${key}:`, err.message);
    return [];
  }
}

app.get('/api/feed', async (req, res) => {
  const cached = cache.get('feed');
  if (cached) return res.json({ items: cached, cached: true, fetchedAt: cache.get('fetchedAt') });

  const results = await Promise.allSettled(
    Object.entries(FEEDS).map(([key, config]) => fetchFeed(key, config))
  );

  const allItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter((item, idx, arr) => arr.findIndex(i => i.id === item.id) === idx)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 60);

  const fetchedAt = new Date().toISOString();
  cache.set('feed', allItems);
  cache.set('fetchedAt', fetchedAt);
  res.json({ items: allItems, cached: false, fetchedAt });
});

app.post('/api/feed/refresh', (req, res) => {
  cache.del('feed');
  cache.del('fetchedAt');
  res.json({ ok: true });
});

// ── AI Chat endpoint ──────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, circulars } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const circularContext = circulars && circulars.length
    ? 'Live circulars currently on screen:\n' + circulars.slice(0, 15).map(i => `- ${i.source}: ${i.title} (${i.tags.join(', ')})`).join('\n')
    : '';

  const systemPrompt = `You are a senior banking compliance officer in India with deep expertise in RBI regulations, PMLA, Basel III, KYC/AML, SEBI, and FEMA. Answer questions clearly and practically. Be specific with numbers, thresholds, and deadlines. Keep answers concise (under 200 words). Write in plain prose — no bullet points.\n\n${circularContext}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: systemPrompt,
        messages
      })
    });

    const data = await response.json();
    console.log('Anthropic response:', JSON.stringify(data).slice(0, 500));
    if (data.content && data.content[0]) {
      res.json({ reply: data.content[0].text });
    } else {
      res.json({ error: 'Unexpected response: ' + JSON.stringify(data).slice(0, 200) });
    }
  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: 'AI request failed' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ComplianceIQ API running on port ${PORT}`));
