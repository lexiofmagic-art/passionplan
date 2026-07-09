/**
 * PassionPlan server — serves the website AND safely proxies AI requests.
 *
 * This one file replaces the whole Cloudflare Worker + Pages + KV setup:
 * - It serves your website (the files in /public) at your Glitch URL.
 * - It has one endpoint, /api/claude, that holds your real Anthropic API
 *   key (kept secret in the .env file, never in your code) and forwards
 *   requests to Claude.
 * - It caches every AI-generated lesson/test in a simple file (cache.json)
 *   so each lesson is only ever generated (and paid for) once, then reused
 *   for free by every student after that.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CACHE_FILE = path.join(__dirname, 'cache.json');

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (e) {
    return {}; // no cache file yet — that's fine, start empty
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch (e) {
    console.error('Could not save cache:', e);
  }
}

app.post('/api/claude', async (req, res) => {
  const { cacheKey, ...anthropicBody } = req.body || {};

  // 1. Check the cache first — free, instant, no API cost.
  if (cacheKey) {
    const cache = loadCache();
    if (cache[cacheKey]) {
      return res.json(cache[cacheKey]);
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Missing ANTHROPIC_API_KEY. Add it in the .env file (see the tutorial).',
    });
  }

  // 2. Not cached — actually call Anthropic (this is what costs money).
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await response.json();

    // 3. Save to cache for next time, if it succeeded.
    if (response.ok && cacheKey) {
      const cache = loadCache();
      cache[cacheKey] = data;
      saveCache(cache);
    }

    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Anthropic: ' + String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('PassionPlan server running on port ' + port);
});
