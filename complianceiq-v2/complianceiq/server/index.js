const express = require('express');
const cors = require('cors');
const RSSParser = require('rss-parser');
const NodeCache = require('node-cache');

const app = express();
const parser = new RSSParser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  }
});
const cache = new NodeCache({ stdTTL: 1800 });
let persistentItems = [];

app.use(cors());
app.use(express.json());

const FEEDS = {
  sebi: 'https://www.sebi.gov.in/sebirss.xml',
  rbi_notifications: 'https://www.rbi.org.in/pressreleases_rss.xml',
  rbi_circulars: 'https://www.rbi.org.in/notifications_rss.xml'
};

// Court case / enforcement keywords to EXCLUDE
const EXCLUDE_KEYWORDS = [
  'adjudication', 'prohibitory order', 'recovery certificate',
  'release order', 'penalty', 'settlement order', 'consent order',
  'debarment', 'restrain', 'suo motu', 'appellate tribunal',
  'take charge', 'executive director', 'chairperson',
  'recovery proceedings', 'enforcement'
];

// Circular / policy keywords to INCLUDE
const CIRCULAR_KEYWORDS = [
  'circular', 'guideline', 'framework', 'amendment', 'regulation',
  'master direction', 'notification', 'policy', 'norm', 'compliance',
  'disclosure', 'reporting', 'listing', 'mutual fund', 'custodian',
  'broker', 'depository', 'clearing', 'settlement', 'trading',
  'kyc', 'aml', 'cft', 'basel', 'liquidity', 'capital adequacy',
  'risk management', 'corporate governance', 'insider trading',
  'takeover', 'ipo', 'rights issue', 'buyback', 'delisting',
  'credit rating', 'portfolio manager', 'investment adviser',
  'alternative investment', 'reit', 'invit', 'nbfc', 'bank'
];

const TAG_RULES = [
  { tags: ['KYC/AML'], keywords: ['kyc', 'know your customer', 'aml', 'anti-money', 'money laundering', 'pmla', 'cft', 'financing of terrorism'] },
  { tags: ['Basel III'], keywords: ['basel', 'capital adequacy', 'lcr', 'nsfr', 'liquidity coverage', 'leverage ratio', 'crar'] },
  { tags: ['Cybersecurity'], keywords: ['cyber', 'information security', 'data protection', 'it governance', 'digital', 'technology risk'] },
  { tags: ['SAR/STR'], keywords: ['suspicious', 'sar', 'str', 'transaction report', 'fiu'] },
  { tags: ['NBFC'], keywords: ['nbfc', 'non-banking', 'microfinance', 'housing finance'] },
  { tags: ['Mutual Funds'], keywords: ['mutual fund', 'amc', 'asset management', 'nav', 'sip'] },
  { tags: ['Corporate Governance'], keywords: ['governance', 'board', 'director', 'audit committee', 'independent director'] },
  { tags: ['Insider Trading'], keywords: ['insider', 'upsi', 'unpublished price sensitive'] },
  { tags: ['Listing'], keywords: ['listing', 'ipo', 'offer for sale', 'rights issue', 'sme platform'] },
  { tags: ['Risk Management'], keywords: ['risk management', 'operational risk', 'market risk', 'credit risk'] },
  { tags: ['Disclosure'], keywords: ['disclosure', 'reporting', 'filing', 'lodr'] },
  { tags: ['Payment Systems'], keywords: ['payment', 'upi', 'neft', 'rtgs', 'imps', 'prepaid', 'wallet'] }
];

function isCircular(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  
  // Exclude court cases and enforcement
  for (const kw of EXCLUDE_KEYWORDS) {
    if (text.includes(kw)) return false;
  }
  
  // Include if it matches circular keywords
  for (const kw of CIRCULAR_KEYWORDS) {
    if (text.includes(kw)) return true;
  }
  
  // Default: include if from RBI, exclude if from SEBI (SEBI has more noise)
  return true;
}

function autoTag(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.keywords.some(kw => text.includes(kw))) {
      tags.push(...rule.tags);
    }
  }
  return tags.length ? [...new Set(tags)] : ['General'];
}

function scoreSeverity(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  let score = 3;
  
  if (/penalty|fine|action|violation|non-compliance|enforcement/.test(text)) score += 3;
  if (/deadline|mandatory|must comply|immediate effect|with effect from/.test(text)) score += 2;
  if (/amendment|revised|updated|modification|change/.test(text)) score += 1;
  if (/draft|consultation|discussion|feedback/.test(text)) score -= 1;
  if (/routine|annual|periodic|quarterly/.test(text)) score -= 1;
  
  return Math.max(1, Math.min(10, score));
}

async function fetchAllFeeds() {
  const cached = cache.get('feeds');
  if (cached) return cached;

  const allItems = [];
  
  for (const [source, url] of Object.entries(FEEDS)) {
    try {
      const feed = await parser.parseURL(url);
      const sourceLabel = source.startsWith('rbi') ? 'RBI' : 'SEBI';
      
      for (const item of (feed.items || [])) {
        const title = (item.title || '').trim();
        const summary = (item.contentSnippet || item.content || '').trim();
        
        // Filter: only include real circulars
        if (sourceLabel === 'SEBI' && !isCircular(title, summary)) continue;
        
        const tags = autoTag(title, summary);
        const severity = scoreSeverity(title, summary);
        
        allItems.push({
          id: item.link || item.guid || `${source}-${Date.now()}-${Math.random()}`,
          title,
          summary: summary.substring(0, 500),
          date: item.pubDate || item.isoDate || '',
          source: sourceLabel,
          link: item.link || '',
          tags,
          severity,
          feedSource: source
        });
      }
      console.log(`Fetched ${source}: ${feed.items?.length || 0} items`);
    } catch (err) {
      console.error(`Failed to fetch ${source}: ${err.message}`);
    }
  }

  // Sort by date descending
  allItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Merge with persistent items (keep old data when feeds are empty)
  if (allItems.length > 0) {
    const newIds = new Set(allItems.map(i => i.id));
    const oldUnique = persistentItems.filter(i => !newIds.has(i.id));
    persistentItems = [...allItems, ...oldUnique].slice(0, 200);
    cache.set('feeds', persistentItems);
  }

  return persistentItems.length > 0 ? persistentItems : allItems;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Feed endpoint
app.get('/api/feed', async (req, res) => {
  try {
    const items = await fetchAllFeeds();
    res.json({ items, count: items.length, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Feed error:', err.message);
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

// Chat endpoint (Groq)
app.post('/api/chat', async (req, res) => {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const { message, circulars } = req.body;

  const circularContext = circulars && circulars.length
    ? 'Live circulars currently on screen:\n' + circulars.slice(0, 15).map(i => `- ${i.source}: ${i.title} (${i.tags.join(', ')})`).join('\n')
    : '';

  const systemPrompt = `You are ComplianceIQ AI, an expert on Indian banking and securities compliance.
You specialize in RBI and SEBI regulations including KYC/AML, Basel III, PMLA, LODR, and all banking compliance matters.
Give specific, practical answers with thresholds, deadlines, and penalties where relevant.
If the user asks about current circulars, use the context provided.
${circularContext}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
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

    const data = await response.json();
    
    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error));
      return res.status(500).json({ error: `AI error: ${data.error.message || 'Unknown'}` });
    }

    const reply = data.choices?.[0]?.message?.content;
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

// Ask AI about a specific circular
app.post('/api/ask-about', async (req, res) => {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const { title, summary, source, tags } = req.body;

  const prompt = `Analyze this ${source} circular for a banking compliance team:

Title: ${title}
Summary: ${summary}
Tags: ${(tags || []).join(', ')}

Provide:
1. Plain English summary (2-3 sentences)
2. Key compliance actions required
3. Relevant thresholds or deadlines
4. Potential penalties for non-compliance
5. Which departments need to act on this`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
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

    const data = await response.json();
    
    if (data.error) {
      return res.status(500).json({ error: `AI error: ${data.error.message}` });
    }

    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      return res.status(500).json({ error: 'No response from AI' });
    }

    res.json({ reply });
  } catch (err) {
    console.error('Ask-about error:', err.message);
    res.status(500).json({ error: 'AI request failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ComplianceIQ API running on port ${PORT}`);
  // Pre-fetch feeds on startup
  fetchAllFeeds().then(items => {
    console.log(`Pre-fetched ${items.length} circulars`);
  }).catch(err => {
    console.error('Pre-fetch failed:', err.message);
  });
});
