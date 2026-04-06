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
  { keywords: ['mutual fund', 'scheme', 'NAV', 'AIF'], tag: 'Funds' },
  { keywords: ['CRR', 'SLR', 'cash reserve', 'statutory liquidity'], tag: 'CRR/SLR' },
];

const EXCLUDE_KEYWORDS = [
  'prohibitory order', 'adjudication order', 'recovery certificate',
  'release order', 'cancellation of recovery', 'notice of demand',
  'takes charge', 'appointed as', 'sad proceedings', 'consent order',
  'debarment', 'disgorgement', 'writ', 'tribunal'
];

function isRealCircular(title, link) {
  const t = (title || '').toLowerCase();
  const l = (link || '').toLowerCase();
  if (l.includes('sebi.gov.in') && !l.includes('/legal/circulars/') && !l.includes('/legal/master-circulars/')) return false;
  return !EXCLUDE_KEYWORDS.some(kw => t.includes(kw));
}

function classifyTags(title, summary) {
  title = title || ''; summary = summary || '';
  const text = (title + ' ' + summary).toLowerCase();
  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.keywords.some(kw => text.includes(kw.toLowerCase()))) tags.push(rule.tag);
  }
  return tags.length ? tags : ['General'];
}

function scoreSeverity(title, summary) {
  const text = (title + ' ' + summary).toLowerCase();
  const critical = ['penalty', 'deadline', 'immediate', 'mandatory', 'enforcement', 'suspension', 'comply by'];
  const high = ['amendment', 'revised', 'new circular', 'master direction', 'framework', 'guidelines', 'regulation', 'aml', 'kyc', 'pmla', 'basel', 'capital', 'liquidity', 'pca', 'directions'];
  if (critical.some(w => text.includes(w))) return 8 + Math.floor(Math.random() * 2);
  if (high.some(w => text.includes(w))) return 5 + Math.floor(Math.random() * 3);
  return 3;
}

async function fetchFeed(key, config) {
  try {
    const feed = await parser.parseURL(config.url);
    return (feed.items || [])
      .filter(item => isRealCircular(item.title, item.link))
      .slice(0, 25)
      .map(item => ({
        id: item.guid || item.link || item.title,
        title: item.title || 'Untitled',
        summary: item.contentSnippet || item.summary || '',
        link: item.link || '',
        date: item.pubDate || item.isoDate || new Date().toISOString(),
        source: config.label,
        category: config.category,
        color: config.color,
        tags: classifyTags(item.title, item.contentSnippet || ''),
        severity: scoreSeverity(item.title, item.contentSnippet || ''),
      }));
  } catch (err) {
    console.error('Failed to fetch ' + key + ':', err.message);
    return [];
  }
}

// Fetch RBI circulars via RSS proxy
async function fetchRBICirculars() {
  const proxyUrls = [
    'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.rbi.org.in/notifications_rss.xml'),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.rbi.org.in/pressreleases_rss.xml'),
  ];

  for (const url of proxyUrls) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (text && (text.includes('<item>') || text.includes('<rss'))) {
        const feed = await parser.parseString(text);
        const items = (feed.items || [])
          .filter(item => isRealCircular(item.title, item.link))
          .slice(0, 20)
          .map(item => ({
            id: item.guid || item.link || item.title,
            title: item.title || 'RBI Circular',
            summary: item.contentSnippet || item.summary || '',
            link: item.link || 'https://rbi.org.in',
            date: item.pubDate || item.isoDate || new Date().toISOString(),
            source: 'RBI',
            category: 'Circular',
            color: 'blue',
            tags: classifyTags(item.title, item.contentSnippet || ''),
            severity: scoreSeverity(item.title, item.contentSnippet || ''),
          }));
        if (items.length > 0) {
          console.log('RBI: got ' + items.length + ' items');
          return items;
        }
      }
    } catch (e) {
      console.error('RBI proxy failed:', e.message);
    }
  }
  return [];
}

let bestKnownItems = [];

app.get('/api/feed', async (req, res) => {
  const cached = cache.get('feed');
  if (cached) return res.json({ items: cached, cached: true, fetchedAt: cache.get('fetchedAt') });

  const [feedResults, rbiItems] = await Promise.all([
    Promise.allSettled(Object.entries(FEEDS).map(([key, config]) => fetchFeed(key, config))),
    fetchRBICirculars()
  ]);

  const freshItems = [
    ...feedResults.filter(r => r.status === 'fulfilled').flatMap(r => r.value),
    ...rbiItems
  ].filter((item, idx, arr) => arr.findIndex(i => i.id === item.id) === idx)
   .sort((a, b) => new Date(b.date) - new Date(a.date))
   .slice(0, 60);

  if (freshItems.length > 0) {
    const merged = [...freshItems];
    for (const old of bestKnownItems) {
      if (!merged.find(i => i.id === old.id)) merged.push(old);
    }
    bestKnownItems = merged.slice(0, 100);
  }

  const allItems = bestKnownItems.slice(0, 60);
  const fetchedAt = new Date().toISOString();
  cache.set('feed', allItems);
  cache.set('fetchedAt', fetchedAt);
  res.json({ items: allItems, cached: false, fetchedAt });
});

app.post('/api/feed/refresh', (req, res) => {
  cache.del('feed'); cache.del('fetchedAt');
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  const { messages, circulars } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'API key not configured on server' });

  const circularContext = circulars && circulars.length
    ? 'Live circulars on screen:\n' + circulars.slice(0, 15).map(i => '- ' + i.source + ': ' + i.title + ' (' + i.tags.join(', ') + ')').join('\n')
    : '';

  const lastMessage = messages[messages.length - 1];
  const msgContent = (lastMessage && lastMessage.content && lastMessage.content.trim()) || 'Explain this regulation for a bank compliance team.';
  
  console.log('Chat request, msg:', msgContent.slice(0, 100));

  const systemPrompt = 'You are a senior banking compliance officer in India with deep expertise in RBI regulations, PMLA, Basel III, KYC/AML, SEBI, and FEMA. Answer clearly and practically. Be specific with numbers, thresholds, deadlines. Keep answers under 200 words. Plain prose only.\n\n' + circularContext;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: msgContent }],
        max_tokens: 500
      })
    });
    const data = await response.json();
    console.log('Groq response status:', response.status, JSON.stringify(data).slice(0, 200));
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (reply) { res.json({ reply }); }
    else { res.json({ error: 'Unexpected: ' + JSON.stringify(data).slice(0, 200) }); }
  } catch (err) {
    res.status(500).json({ error: 'AI request failed: ' + err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('ComplianceIQ API running on port ' + PORT));
