const express = require('express');
const cors = require('cors');
const RSSParser = require('rss-parser');
const NodeCache = require('node-cache');
const Groq = require('groq-sdk');

const app = express();
const parser = new RSSParser();
const cache = new NodeCache({ stdTTL: 1800 });

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const FEEDS = {
  sebi_circulars: 'https://www.sebi.gov.in/sebirss.xml',
  rbi_circulars: 'https://www.rbi.org.in/Scripts/rss.aspx?Id=6'
};

function tagItem(title, summary) {
  const text = (title + ' ' + summary).toLowerCase();
  const tags = [];
  if (text.includes('kyc') || text.includes('know your customer')) tags.push('KYC');
  if (text.includes('aml') || text.includes('money laundering')) tags.push('AML');
  if (text.includes('basel') || text.includes('lcr') || text.includes('capital')) tags.push('Basel III');
  if (text.includes('cyber') || text.includes('data') || text.includes('security')) tags.push('Cybersecurity');
  if (text.includes('sar') || text.includes('suspicious')) tags.push('SAR');
  if (text.includes('fraud')) tags.push('Fraud');
  if (text.includes('mutual fund') || text.includes('mf')) tags.push('Mutual Funds');
  if (text.includes('insider') || text.includes('trading')) tags.push('Insider Trading');
  if (text.includes('listing') || text.includes('ipo')) tags.push('IPO/Listing');
  if (tags.length === 0) tags.push('General');
  return tags;
}

function scoreItem(title, summary) {
  const text = (title + ' ' + summary).toLowerCase();
  let score = 3;
  if (text.includes('penalty') || text.includes('deadline') || text.includes('immediate') || text.includes('urgent')) score += 4;
  if (text.includes('amendment') || text.includes('circular') || text.includes('directive')) score += 2;
  if (text.includes('compliance') || text.includes('mandatory')) score += 2;
  if (text.includes('press release') || text.includes('appointment') || text.includes('personnel')) score -= 2;
  return Math.min(10, Math.max(1, score));
}

function isCircular(title, summary, source) {
  const text = (title + ' ' + summary).toLowerCase();
  
  // Filter out court cases, press releases, appointments
  const exclude = [
    'court', 'judgement', 'judgment', 'tribunal', 'adjudication',
    'press release', 'appointment', 'takes charge', 'personnel',
    'exemption order', 'quasi judicial', 'order against',
    'settlement', 'consent order'
  ];
  
  for (const word of exclude) {
    if (text.includes(word)) return false;
  }
  
  // For SEBI only keep actual circulars
  if (source === 'SEBI') {
    const include = ['circular', 'regulation', 'guideline', 'framework', 'direction', 'amendment', 'compliance', 'reporting'];
    return include.some(word => text.includes(word));
  }
  
  return true;
}

let lastGoodData = [];

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/feed', async (req, res) => {
  const cached = cache.get('feed');
  if (cached) return res.json({ items: cached });

  const results = [];

  for (const [source, url] of Object.entries(FEEDS)) {
    try {
      const feed = await parser.parseURL(url);
      const sourceName = source.includes('sebi') ? 'SEBI' : 'RBI';
      
      for (const item of feed.items.slice(0, 20)) {
        const title = item.title || '';
        const summary = item.contentSnippet || item.content || item.summary || '';
        
        // Only include actual circulars
        if (!isCircular(title, summary, sourceName)) continue;
        
        results.push({
          id: item.link || item.guid || Math.random().toString(),
          title,
          summary,
          link: item.link || '',
          date: item.pubDate || item.isoDate || '',
          source: sourceName,
          tags: tagItem(title, summary),
          severity: scoreItem(title, summary)
        });
      }
    } catch (err) {
      console.error(`Failed to fetch ${source}:`, err.message);
    }
  }

  if (results.length > 0) {
    lastGoodData = results;
    cache.set('feed', results);
    return res.json({ items: results });
  }

  if (lastGoodData.length > 0) {
    return res.json({ items: lastGoodData, stale: true });
  }

  res.json({ items: [] });
});

app.post('/api/chat', async (req, res) => {
  const { message, circulars } = req.body;

  if (!message || message.trim() === '') {
    return res.status(400).json({ error: 'Message is empty' });
  }

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const circularContext = circulars && circulars.length
    ? 'Live circulars currently on screen:\n' + circulars.slice(0, 15).map(i => `- ${i.source}: ${i.title} (${i.tags.join(', ')})`).join('\n')
    : '';

  try {
    const groq = new Groq({ apiKey: GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are a senior banking compliance expert specializing in Indian banking regulations including RBI, SEBI, PMLA, KYC, AML, and Basel III norms. Give specific, practical answers with key thresholds and deadlines highlighted. ${circularContext}`
        },
        {
          role: 'user',
          content: message.trim()
        }
      ],
      max_tokens: 1024
    });

    const reply = completion.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ error: 'No reply from AI' });

    res.json({ reply });
  } catch (err) {
    console.error('Groq error:', JSON.stringify(err.error || err.message));
    res.status(500).json({ error: 'AI request failed', detail: err.message });
  }
});

app.post('/api/ask', async (req, res) => {
  const { title, summary, source } = req.body;

  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Title is empty' });
  }

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  try {
    const groq = new Groq({ apiKey: GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a senior banking compliance officer in India. When given a regulatory circular, explain what it means, what action the compliance team needs to take, any deadlines, and the consequences of non-compliance. Be specific and practical.'
        },
        {
          role: 'user',
          content: `Circular from ${source}:\nTitle: ${title}\nSummary: ${summary || 'No summary available'}\n\nWhat does this mean for our compliance team?`.trim()
        }
      ],
      max_tokens: 800
    });

    const reply = completion.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ error: 'No reply from AI' });

    res.json({ reply });
  } catch (err) {
    console.error('Ask error:', JSON.stringify(err.error || err.message));
    res.status(500).json({ error: 'AI request failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ComplianceIQ API running on port ${PORT}`));
