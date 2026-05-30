import express from 'express';
import session from 'express-session';
import axios from 'axios';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve static assets path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Sessions (In-memory store, secure session options)
app.use(session({
  secret: process.env.SESSION_SECRET || 'anubadshuddhi_default_fallback_secret_998877',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if deploying with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Helper to determine if we are in Mock OAuth mode
const isMockOAuthEnabled = () => {
  const clientId = process.env.WIKIMEDIA_CLIENT_ID;
  return !clientId || clientId.includes('placeholder') || clientId === 'dummy_client_id_placeholder';
};

// ==========================================================
// A. CORE UTILITIES: AUTH MIDDLEWARE, STATS & AI CACHE STORE
// ==========================================================

// Authenticated Route Guard Middleware
function requireAuth(req, res, next) {
  if (!req.session.username) {
    return res.status(401).json({ error: 'উইকিপিডিয়ায় লগইন করা আবশ্যক।' });
  }
  next();
}

// Persistent User Stats Storage Filesystem
const USER_STATS_FILE = path.join(__dirname, 'user_stats.json');

function getUserStats(username) {
  try {
    if (fs.existsSync(USER_STATS_FILE)) {
      const fileContent = fs.readFileSync(USER_STATS_FILE, 'utf8');
      const data = JSON.parse(fileContent);
      return data[username] || 0;
    }
  } catch (err) {
    console.error('[Stats Database] Failed to read user stats:', err);
  }
  return 0;
}

function incrementUserStats(username) {
  try {
    let data = {};
    if (fs.existsSync(USER_STATS_FILE)) {
      const fileContent = fs.readFileSync(USER_STATS_FILE, 'utf8');
      data = JSON.parse(fileContent);
    }
    data[username] = (data[username] || 0) + 1;
    fs.writeFileSync(USER_STATS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return data[username];
  } catch (err) {
    console.error('[Stats Database] Failed to save user stats:', err);
  }
  return 0;
}

// Persistent MD5 Hashed Translation Cache Storage Filesystem
const TRANSLATION_CACHE_FILE = path.join(__dirname, 'translation_cache.json');

function getCachedTranslation(wikitext) {
  try {
    const md5Hash = crypto.createHash('md5').update(wikitext).digest('hex');
    if (fs.existsSync(TRANSLATION_CACHE_FILE)) {
      const fileContent = fs.readFileSync(TRANSLATION_CACHE_FILE, 'utf8');
      const cache = JSON.parse(fileContent);
      if (cache[md5Hash]) {
        console.log(`[Token Saver] Cache HIT! MD5: ${md5Hash} (Saved Gemini tokens!)`);
        return cache[md5Hash];
      }
    }
  } catch (err) {
    console.error('[Token Saver] Failed to read translation cache:', err);
  }
  return null;
}

function saveTranslationToCache(wikitext, polishedWikitext) {
  try {
    const md5Hash = crypto.createHash('md5').update(wikitext).digest('hex');
    let cache = {};
    if (fs.existsSync(TRANSLATION_CACHE_FILE)) {
      const fileContent = fs.readFileSync(TRANSLATION_CACHE_FILE, 'utf8');
      cache = JSON.parse(fileContent);
    }
    cache[md5Hash] = polishedWikitext;
    fs.writeFileSync(TRANSLATION_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    console.log(`[Token Saver] Saved text to cache. MD5: ${md5Hash}`);
  } catch (err) {
    console.error('[Token Saver] Failed to write translation cache:', err);
  }
}

// In-Memory active background AI translation jobs
const activeAiJobs = new Map();

// ==========================================
// 1. AUTHENTICATION & OAUTH 2.0 ROUTES
// ==========================================

// Get Current Auth Status
app.get('/api/auth/status', (req, res) => {
  if (req.session.username) {
    const publishedCount = getUserStats(req.session.username);
    return res.json({
      loggedIn: true,
      username: req.session.username,
      isMock: !!req.session.isMock,
      publishedCount: publishedCount
    });
  }
  res.json({ loggedIn: false });
});

// Trigger OAuth Redirection
app.get('/auth/mediawiki', (req, res) => {
  // If no credentials or placeholder configured, trigger Mock Authentication
  if (isMockOAuthEnabled() || req.query.mock === 'true') {
    console.log('[Auth] Using Mock Authentication mode for local development.');
    req.session.username = 'বাংলা_সম্পাদক_১';
    req.session.isMock = true;
    req.session.oauthToken = 'mock_access_token_12345';
    return res.redirect('/');
  }

  // Real OAuth 2.0 Redirection Flow
  const state = Math.random().toString(36).substring(2, 15);
  req.session.oauthState = state;

  const authUrl = new URL('https://meta.wikimedia.org/w/rest.php/oauth2/authorize');
  authUrl.searchParams.append('client_id', process.env.WIKIMEDIA_CLIENT_ID);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('redirect_uri', process.env.WIKIMEDIA_REDIRECT_URI);
  authUrl.searchParams.append('state', state);

  res.redirect(authUrl.toString());
});

// OAuth Callback Handler
app.get('/auth/mediawiki/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[OAuth Callback Error]', error);
    return res.redirect(`/?error=${encodeURIComponent('OAuth access denied: ' + error)}`);
  }

  // Validate state to prevent CSRF attacks
  if (!state || state !== req.session.oauthState) {
    console.error('[OAuth State Mismatch] Session state:', req.session.oauthState, 'Callback state:', state);
    return res.redirect(`/?error=${encodeURIComponent('Authentication state verification failed.')}`);
  }

  // Clean state
  delete req.session.oauthState;

  try {
    // Exchange Code for Access Token
    const tokenUrl = 'https://meta.wikimedia.org/w/rest.php/oauth2/access_token';
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', process.env.WIKIMEDIA_REDIRECT_URI);
    params.append('client_id', process.env.WIKIMEDIA_CLIENT_ID);
    params.append('client_secret', process.env.WIKIMEDIA_CLIENT_SECRET);

    const tokenResponse = await axios.post(tokenUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, refresh_token } = tokenResponse.data;

    // Save tokens in session
    req.session.oauthToken = access_token;
    if (refresh_token) {
      req.session.oauthRefreshToken = refresh_token;
    }

    // Retrieve User Profile (Meta-Wiki OAuth profile)
    const profileUrl = 'https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile';
    const profileResponse = await axios.get(profileUrl, {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    req.session.username = profileResponse.data.username;
    req.session.isMock = false;

    console.log(`[Auth] User ${req.session.username} successfully authenticated via MediaWiki OAuth 2.0`);
    res.redirect('/');
  } catch (err) {
    console.error('[OAuth Token Exchange Error]', err.response?.data || err.message);
    res.redirect(`/?error=${encodeURIComponent('Failed to exchange credentials with Wikimedia.')}`);
  }
});

// Logout Route
app.get('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Logout Error]', err);
    }
    res.redirect('/');
  });
});

// ==========================================
// 2. GEMINI API KEY MANAGEMENT
// ==========================================

// Save Gemini Key in Ephemeral Session
app.post('/api/key/save', requireAuth, (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(400).json({ error: 'API key is required.' });
  }

  const trimmedKey = apiKey.trim();
  req.session.geminiKey = trimmedKey;
  
  // Store a masked version of the key to safely display on the client (e.g., AIzaSy...7e9A)
  if (trimmedKey.length > 10) {
    req.session.geminiMaskedKey = `${trimmedKey.substring(0, 8)}...${trimmedKey.substring(trimmedKey.length - 4)}`;
  } else {
    req.session.geminiMaskedKey = 'Key Saved';
  }

  res.json({ 
    success: true, 
    message: 'Gemini API Key saved securely in session.',
    maskedKey: req.session.geminiMaskedKey
  });
});

// Get Key Status (check if exists and return masked version)
app.get('/api/key/status', requireAuth, (req, res) => {
  res.json({ 
    hasKey: !!req.session.geminiKey,
    maskedKey: req.session.geminiMaskedKey || null
  });
});

// Delete Gemini Key from Session
app.post('/api/key/delete', requireAuth, (req, res) => {
  delete req.session.geminiKey;
  delete req.session.geminiMaskedKey;
  res.json({ success: true, message: 'Gemini API Key removed.' });
});

// Get available models list from Gemini API for the stored key
app.get('/api/key/models', requireAuth, async (req, res) => {
  const geminiKey = req.session.geminiKey;
  if (!geminiKey) {
    return res.status(401).json({ error: 'Gemini API Key is missing.' });
  }

  try {
    console.log('[Gemini SDK] Retrieving available models for session key...');
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const modelListResponse = await ai.models.list();
    
    // Collect elements from SDK Pager object using a bulletproof polymorphic parser
    const rawModels = [];
    if (Array.isArray(modelListResponse)) {
      rawModels.push(...modelListResponse);
    } else if (modelListResponse && Array.isArray(modelListResponse.models)) {
      rawModels.push(...modelListResponse.models);
    } else if (modelListResponse && typeof modelListResponse[Symbol.iterator] === 'function') {
      for (const model of modelListResponse) {
        rawModels.push(model);
      }
    } else if (modelListResponse && typeof modelListResponse[Symbol.asyncIterator] === 'function') {
      for await (const model of modelListResponse) {
        rawModels.push(model);
      }
    }
    
    // Filter models that support content generation and simplify objects
    const models = rawModels
      .filter(m => m.name && m.name.includes('gemini'))
      .map(m => ({
        id: m.name.replace('models/', ''),
        name: m.name,
        displayName: m.displayName || m.name.replace('models/', '')
      }));

    console.log(`[Gemini SDK] Successfully fetched and parsed ${models.length} Gemini models.`);
    res.json({ models });
  } catch (err) {
    console.error('[Gemini API List Models Error]', err);
    let errorMessage = err.message || 'Failed to retrieve available models.';
    if (err.message && err.message.includes('{"error"')) {
      try {
        const jsonStart = err.message.indexOf('{');
        const parsed = JSON.parse(err.message.substring(jsonStart));
        if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch (e) {}
    }
    res.status(500).json({ error: errorMessage });
  }
});

// ==========================================
// 3. MEDIAWIKI API PROXY (SUGGESTIONS & WIKITEXT FETCH)
// ==========================================

// Fetch Suggested Articles from Category members
app.get('/api/suggestions', requireAuth, async (req, res) => {
  const backupSuggestions = [
    { title: 'কৃত্রিম বুদ্ধিমত্তা', snippet: 'Artificial Intelligence - needs narrative flow improvement.' },
    { title: 'মেশিন লার্নিং', snippet: 'Machine Learning - machine translated terminology polishing.' },
    { title: 'কোয়ান্টাম কম্পিউটিং', snippet: 'Quantum Computing - complex sentence syntax cleanup.' },
    { title: 'জেমস ওয়েব স্পেস টেলিস্কোপ', snippet: 'James Webb Space Telescope - needs standard Bangla translation.' },
    { title: 'মঙ্গল গ্রহ', snippet: 'Mars planet - articles flagged with translation review tags.' }
  ];

  try {
    // Bangla Wikipedia API category endpoint
    // Category: বিষয়শ্রেণী:অনুবাদের পর নিরীক্ষণ জরুরি নিবন্ধসমূহ (Articles needing cleanup after translation)
    const categoryName = 'বিষয়শ্রেণী:অনুবাদের পর নিরীক্ষণ জরুরি নিবন্ধসমূহ';
    const wikiUrl = 'https://bn.wikipedia.org/w/api.php';
    
    const response = await axios.get(wikiUrl, {
      params: {
        action: 'query',
        list: 'categorymembers',
        cmtitle: categoryName,
        cmlimit: 10,
        cmtype: 'page',
        format: 'json',
        origin: '*'
      },
      headers: {
        'User-Agent': 'AnubadShuddhiTranslationHelper/1.0 (https://github.com/UserYahya/anubad-shuddhi)'
      }
    });

    const members = response.data?.query?.categorymembers || [];

    if (members.length === 0) {
      console.log('[MediaWiki Proxy] Suggested category returned 0 members, sending fallback list.');
      return res.json({ source: 'fallback', articles: backupSuggestions });
    }

    // Map members and slice top 5
    const articles = members.slice(0, 5).map(member => ({
      title: member.title,
      snippet: 'Bangla Wikipedia category flagged article.'
    }));

    res.json({ source: 'bangla_wikipedia', articles });
  } catch (err) {
    console.error('[MediaWiki Suggestions Fetch Error]', err.message);
    // Fall back gracefully so frontend still works
    res.json({ source: 'fallback', articles: backupSuggestions });
  }
});

// Fetch Raw Wikitext, revision ID, and timestamp for conflict checks
app.get('/api/article', requireAuth, async (req, res) => {
  const { title } = req.query;
  if (!title) {
    return res.status(400).json({ error: 'Article title is required.' });
  }

  try {
    const wikiUrl = 'https://bn.wikipedia.org/w/api.php';
    const response = await axios.get(wikiUrl, {
      params: {
        action: 'query',
        prop: 'revisions',
        titles: title,
        rvslots: 'main',
        rvprop: 'content|timestamp|ids',
        format: 'json',
        origin: '*'
      },
      headers: {
        'User-Agent': 'AnubadShuddhiTranslationHelper/1.0 (https://github.com/UserYahya/anubad-shuddhi)'
      }
    });

    const pages = response.data?.query?.pages;
    if (!pages) {
      return res.status(404).json({ error: 'Article not found.' });
    }

    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];

    if (page.missing !== undefined) {
      return res.status(404).json({ error: `Article "${title}" does not exist on Bangla Wikipedia.` });
    }

    const latestRevision = page.revisions?.[0];
    if (!latestRevision) {
      return res.status(500).json({ error: 'Failed to fetch article revisions.' });
    }

    // Extract wikitext content (handles transition layouts in newer API structure)
    const wikitext = latestRevision.slots?.main?.['*'] || latestRevision['*'] || '';

    // Cache the loaded article status in session to prevent loss
    req.session.activeArticle = {
      title: page.title,
      wikitext: wikitext,
      polishedWikitext: '',
      baserevisionid: latestRevision.revid,
      basetimestamp: latestRevision.timestamp,
      status: 'idle'
    };
    req.session.save();

    res.json({
      title: page.title,
      wikitext: wikitext,
      baserevisionid: latestRevision.revid,
      basetimestamp: latestRevision.timestamp
    });
  } catch (err) {
    console.error('[MediaWiki Article Fetch Error]', err.message);
    res.status(500).json({ error: `Failed to fetch article from Wikipedia: ${err.message}` });
  }
});

// Get Session Active Draft
app.get('/api/article/active', requireAuth, (req, res) => {
  if (req.session.activeArticle) {
    const draft = req.session.activeArticle;
    
    // If the server-side has an active background Gemini job running for this draft,
    // update the status to processing to ensure the frontend polling resumes perfectly!
    const job = activeAiJobs.get(draft.title);
    if (job && job.status === 'processing') {
      draft.status = 'processing';
    }
    
    return res.json({ activeDraft: draft });
  }
  res.json({ activeDraft: null });
});

// Autosave Polished Text Draft in Server Session
app.post('/api/article/save-progress', requireAuth, (req, res) => {
  const { polishedWikitext } = req.body;
  if (!req.session.activeArticle) {
    return res.status(404).json({ error: 'No active article loaded in session.' });
  }
  
  req.session.activeArticle.polishedWikitext = polishedWikitext || '';
  if (req.session.activeArticle.status === 'idle') {
    req.session.activeArticle.status = 'completed';
  }
  req.session.save();
  res.json({ success: true });
});

// ==========================================
// 4. GEMINI API CORRECTION GATEWAY
// ==========================================

app.post('/api/correct', requireAuth, async (req, res) => {
  const { wikitext, model, title } = req.body;
  const geminiKey = req.session.geminiKey;

  if (!geminiKey) {
    return res.status(401).json({ error: 'Gemini API Key is missing. Please save a valid API key in the session settings first.' });
  }

  if (!wikitext || wikitext.trim() === '') {
    return res.status(400).json({ error: 'Wikitext content is required for processing.' });
  }

  const articleTitle = title || (req.session.activeArticle && req.session.activeArticle.title) || 'Untitled';
  const targetModel = model || 'gemini-3.5-flash';

  // 1. Check MD5 Hashed Translation Cache first to save token usage
  const cachedText = getCachedTranslation(wikitext);
  if (cachedText) {
    if (req.session.activeArticle) {
      req.session.activeArticle.polishedWikitext = cachedText;
      req.session.activeArticle.status = 'completed';
      req.session.save();
    }
    return res.json({ correctedText: cachedText, cached: true });
  }

  // Set active article status to processing in session
  if (req.session.activeArticle) {
    req.session.activeArticle.status = 'processing';
    req.session.save();
  }

  // 2. Async Background Reload-Proof Job Registry
  let job = activeAiJobs.get(articleTitle);

  if (!job) {
    console.log(`[Reload Saver] Creating new AI correction background job for: "${articleTitle}"`);
    
    // Create the background task
    const aiPromise = (async () => {
      console.log(`[Gemini SDK] Initializing client with key. Target Model: ${targetModel}`);
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      const systemInstruction = `You are an expert Bangla Wikipedia editor. Rewrite the following machine-translated Bangla text into natural, encyclopedic standard Bangla (চলিত ভাষা/Chalita bhasha). 

CRITICAL RULES:
1. In case of complex or convoluted sentences, you should break them down into multiple shorter, simpler sentences to keep the flow natural, clear, and readable.
2. For Wikilinks with suffixes (e.g., [[নজরুল]]-এর or [[নজরুল]]এর or [[নজরুল]]কে), do NOT write them as [[নজরুল]]-Suffix. Instead, format them beautifully inside the brackets as [[নজরুল|নজরুলের]] or [[নজরুল|নজরুলকে]]. Keep the link target identical but adjust the display text to include the suffixes naturally.
3. You must perfectly preserve ALL other Wikitext markup exactly as it appears in the original text. Do not translate, alter, or remove templates {{ }}, citations <ref>, HTML tags, categories, or heading markers == ==. Only correct the narrative Bangla prose around the markup.`;

      console.log(`[Gemini SDK] Sending translation request using model: ${targetModel}...`);
      
      const response = await ai.models.generateContent({
        model: targetModel,
        contents: wikitext,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.2
        }
      });

      const correctedText = response.text;
      if (!correctedText) {
        throw new Error('Gemini API returned an empty response.');
      }

      return correctedText;
    })();

    job = {
      promise: aiPromise,
      status: 'processing'
    };

    activeAiJobs.set(articleTitle, job);

    // Run post-processing in background once resolved
    aiPromise.then((correctedText) => {
      console.log(`[Reload Saver] Background AI job COMPLETED for: "${articleTitle}"`);
      
      // Save result to translation token-saving cache
      saveTranslationToCache(wikitext, correctedText);

      // Save to active session
      if (req.session.activeArticle && req.session.activeArticle.title === articleTitle) {
        req.session.activeArticle.polishedWikitext = correctedText;
        req.session.activeArticle.status = 'completed';
        req.session.save();
      }

      activeAiJobs.delete(articleTitle);
    }).catch((err) => {
      console.error(`[Reload Saver] Background AI job FAILED for: "${articleTitle}"`, err);
      
      if (req.session.activeArticle && req.session.activeArticle.title === articleTitle) {
        req.session.activeArticle.status = 'idle';
        req.session.save();
      }

      activeAiJobs.delete(articleTitle);
    });
  } else {
    console.log(`[Reload Saver] Attaching to existing ongoing AI job for: "${articleTitle}"`);
  }

  try {
    // Wait for the promise to resolve for this synchronous response
    const correctedText = await job.promise;
    res.json({ correctedText, cached: false });
  } catch (err) {
    console.error(`[Gemini API Processing Error] Model: ${targetModel}`, err);
    let errorMessage = err.message || 'An error occurred during Gemini translation processing.';
    
    if (err.message && err.message.includes('{"error"')) {
      try {
        const jsonStart = err.message.indexOf('{');
        const parsed = JSON.parse(err.message.substring(jsonStart));
        if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch (e) {
        console.error('[JSON Error Parser Error]', e);
      }
    } else if (err.response?.data?.error?.message) {
      errorMessage = err.response.data.error.message;
    }

    res.status(500).json({ error: errorMessage });
  }
});

// ==========================================
// 5. MEDIAWIKI API WRITE/EDIT PROXY
// ==========================================

app.post('/api/publish', requireAuth, async (req, res) => {
  const { title, wikitext, baserevisionid, basetimestamp, summary } = req.body;
  const isMock = !!req.session.isMock;
  const oauthToken = req.session.oauthToken;

  if (!title || !wikitext) {
    return res.status(400).json({ error: 'Missing article title or wikitext payload.' });
  }

  const editSummary = summary || '[[উইকিপিডিয়া:অনুবাদ-শুদ্ধি|অনুবাদ-শুদ্ধি]] ব্যবহার করে যান্ত্রিক অনুবাদ সংশোধন করা হয়েছে';

  // Mock Publishing Flow for Local Testing
  if (isMock) {
    console.log(`[Mock Publish] Intercepted edit for "${title}" by user "${req.session.username}".`);
    console.log('[Mock Publish] Summary:', editSummary);
    console.log('[Mock Publish] Text snippet (50 chars):', wikitext.substring(0, 50));
    
    // Artificial delay to simulate real network request
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Increment server-side user published statistics database
    const newCount = incrementUserStats(req.session.username);

    // Clear active session draft on publish
    req.session.activeArticle = null;
    req.session.save();
    
    return res.json({
      success: true,
      mock: true,
      publishedCount: newCount,
      message: `[MOCK] Successfully saved edit to "${title}" on Bangla Wikipedia! (Mock Session active)`,
      info: {
        title,
        revisionId: Math.floor(Math.random() * 9000000) + 1000000,
        result: 'Success'
      }
    });
  }

  // Real Edit Flow on Bangla Wikipedia
  try {
    const wikiUrl = 'https://bn.wikipedia.org/w/api.php';
    const authHeaders = {
      'Authorization': `Bearer ${oauthToken}`,
      'User-Agent': 'AnubadShuddhiTranslationHelper/1.0 (https://github.com/UserYahya/anubad-shuddhi)'
    };

    console.log(`[Wikipedia Proxy] Requesting CSRF Token for page edit: "${title}"...`);
    
    // Step 1: Request CSRF Token
    const tokenResponse = await axios.get(wikiUrl, {
      params: {
        action: 'query',
        meta: 'tokens',
        type: 'csrf',
        format: 'json'
      },
      headers: authHeaders
    });

    const csrfToken = tokenResponse.data?.query?.tokens?.csrftoken;
    if (!csrfToken || csrfToken === '+\\') {
      return res.status(403).json({ error: 'Invalid or missing CSRF token. The user might not have edit permissions or the session expired.' });
    }

    console.log('[Wikipedia Proxy] CSRF Token fetched successfully. Initiating page edit...');

    // Step 2: Perform the edit (Post with URL-encoded parameters to avoid mediawiki API structure blocks)
    const editParams = new URLSearchParams();
    editParams.append('action', 'edit');
    editParams.append('title', title);
    editParams.append('text', wikitext);
    editParams.append('summary', editSummary);
    editParams.append('token', csrfToken);
    editParams.append('format', 'json');

    // Add revision markers if present to check for edit conflicts
    if (baserevisionid) {
      editParams.append('baserevisionid', baserevisionid);
    }
    if (basetimestamp) {
      editParams.append('basetimestamp', basetimestamp);
    }

    const editResponse = await axios.post(wikiUrl, editParams, {
      headers: {
        ...authHeaders,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const editResult = editResponse.data?.edit;

    if (!editResult) {
      const errorDetails = editResponse.data?.error;
      console.error('[Wikipedia Proxy] Edit failed with response:', editResponse.data);

      if (errorDetails) {
        if (errorDetails.code === 'editconflict') {
          return res.status(409).json({ 
            error: 'Edit conflict detected! Someone else has modified this article while you were editing. Please fetch the article again to incorporate their changes.' 
          });
        }
        return res.status(400).json({ error: `Wikipedia edit failed: ${errorDetails.info} (${errorDetails.code})` });
      }
      return res.status(500).json({ error: 'Failed to commit edit. Wikipedia returned an unexpected response structure.' });
    }

    if (editResult.result === 'Success') {
      console.log(`[Wikipedia Proxy] Successfully published edit to "${title}". New RevID: ${editResult.newrevid}`);
      
      // Increment server-side user published statistics database
      const newCount = incrementUserStats(req.session.username);

      // Clear active session draft on publish
      req.session.activeArticle = null;
      req.session.save();

      return res.json({
        success: true,
        mock: false,
        publishedCount: newCount,
        message: `Successfully published edit to "${title}" on Bangla Wikipedia!`,
        info: {
          title: editResult.title,
          revisionId: editResult.newrevid,
          result: editResult.result
        }
      });
    } else {
      console.warn('[Wikipedia Proxy] Unexpected edit result status:', editResult.result);
      return res.status(400).json({ error: `Wikipedia returned unexpected edit status: ${editResult.result}` });
    }

  } catch (err) {
    console.error('[Wikipedia Publish Error]', err.response?.data || err.message);
    res.status(500).json({ error: `Failed to publish changes to Wikipedia: ${err.message}` });
  }
});

// Run Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  Anubad Shuddhi Express Server started successfully!   `);
  console.log(`  Running locally on: http://localhost:${PORT}        `);
  if (isMockOAuthEnabled()) {
    console.log(`  MOCK OAUTH mode is ENABLED (Local Sandbox).       `);
  } else {
    console.log(`  REAL OAUTH mode is ENABLED using Meta-Wiki.       `);
  }
  console.log(`====================================================`);
});
