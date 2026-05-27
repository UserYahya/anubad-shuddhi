import express from 'express';
import session from 'express-session';
import axios from 'axios';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

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
  secret: process.env.SESSION_SECRET || 'shuddhowiki_default_fallback_secret_998877',
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

// ==========================================
// 1. AUTHENTICATION & OAUTH 2.0 ROUTES
// ==========================================

// Get Current Auth Status
app.get('/api/auth/status', (req, res) => {
  if (req.session.username) {
    return res.json({
      loggedIn: true,
      username: req.session.username,
      isMock: !!req.session.isMock
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
app.post('/api/key/save', (req, res) => {
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
app.get('/api/key/status', (req, res) => {
  res.json({ 
    hasKey: !!req.session.geminiKey,
    maskedKey: req.session.geminiMaskedKey || null
  });
});

// Delete Gemini Key from Session
app.post('/api/key/delete', (req, res) => {
  delete req.session.geminiKey;
  delete req.session.geminiMaskedKey;
  res.json({ success: true, message: 'Gemini API Key removed.' });
});

// Get available models list from Gemini API for the stored key
app.get('/api/key/models', async (req, res) => {
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
app.get('/api/suggestions', async (req, res) => {
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
app.get('/api/article', async (req, res) => {
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

// ==========================================
// 4. GEMINI API CORRECTION GATEWAY
// ==========================================

app.post('/api/correct', async (req, res) => {
  const { wikitext, model } = req.body;
  const geminiKey = req.session.geminiKey;

  if (!geminiKey) {
    return res.status(401).json({ error: 'Gemini API Key is missing. Please save a valid API key in the session settings first.' });
  }

  if (!wikitext || wikitext.trim() === '') {
    return res.status(400).json({ error: 'Wikitext content is required for processing.' });
  }

  // Target model name - prioritises client-selected model, defaults to gemini-3.5-flash
  const targetModel = model || 'gemini-3.5-flash';

  try {
    console.log(`[Gemini SDK] Initializing client with key. Target Model: ${targetModel}`);
    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const systemInstruction = `You are an expert Bangla Wikipedia editor. Rewrite the following machine-translated Bangla text into natural, encyclopedic standard Bangla (চলিত ভাষা/Chalita bhasha). 
CRITICAL RULE: You must perfectly preserve ALL Wikitext markup exactly as it appears in the original text. Do not translate, alter, or remove internal links [[ ]], templates {{ }}, citations <ref>, HTML tags, categories, or heading markers == ==. Only correct the narrative Bangla prose around the markup.`;

    console.log(`[Gemini SDK] Sending translation request using model: ${targetModel}...`);
    
    // Call using official SDK directly
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: wikitext,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2 // Lower temperature to focus strictly on structural consistency
      }
    });

    const correctedText = response.text;

    if (!correctedText) {
      throw new Error('Gemini API returned an empty response.');
    }

    console.log(`[Gemini SDK] Successfully processed translation using model: ${targetModel}`);
    res.json({ correctedText });
  } catch (err) {
    console.error(`[Gemini API Processing Error] Model: ${targetModel}`, err);
    let errorMessage = err.message || 'An error occurred during Gemini translation processing.';
    
    // Capture specific inner JSON error messages packaged in the SDK exception strings
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

app.post('/api/publish', async (req, res) => {
  const { title, wikitext, baserevisionid, basetimestamp, summary } = req.body;
  const isLoggedIn = !!req.session.username;
  const isMock = !!req.session.isMock;
  const oauthToken = req.session.oauthToken;

  if (!isLoggedIn) {
    return res.status(401).json({ error: 'You must be logged in to Wikipedia to publish edits.' });
  }

  if (!title || !wikitext) {
    return res.status(400).json({ error: 'Missing article title or wikitext payload.' });
  }

  const editSummary = summary || 'যান্ত্রিক অনুবাদ সংশোধন করা হয়েছে। বিস্তারিত: https://anubad-shuddhi.toolforge.org/';

  // Mock Publishing Flow for Local Testing
  if (isMock) {
    console.log(`[Mock Publish] Intercepted edit for "${title}" by user "${req.session.username}".`);
    console.log('[Mock Publish] Summary:', editSummary);
    console.log('[Mock Publish] Text snippet (50 chars):', wikitext.substring(0, 50));
    
    // Artificial delay to simulate real network request
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return res.json({
      success: true,
      mock: true,
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
      return res.json({
        success: true,
        mock: false,
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
  console.log(`  ShuddhoWiki Express Server started successfully!   `);
  console.log(`  Running locally on: http://localhost:${PORT}        `);
  if (isMockOAuthEnabled()) {
    console.log(`  MOCK OAUTH mode is ENABLED (Local Sandbox).       `);
  } else {
    console.log(`  REAL OAUTH mode is ENABLED using Meta-Wiki.       `);
  }
  console.log(`====================================================`);
});
