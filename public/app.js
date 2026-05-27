/* ==========================================================================
   ShuddhoWiki - Frontend Client Application Logic
   ========================================================================== */

// Client State Management
const state = {
  user: {
    loggedIn: false,
    username: null,
    isMock: false
  },
  hasApiKey: false,
  activeArticle: {
    title: null,
    wikitext: '',
    baserevisionid: null,
    basetimestamp: null
  },
  isProcessingAi: false,
  isPublishing: false
};

// DOM Elements cache
const els = {
  // Auth & Top bar
  keyStatusBtn: document.getElementById('keyStatusBtn'),
  keyDot: document.getElementById('keyDot'),
  keyStatusText: document.getElementById('keyStatusText'),
  authSection: document.getElementById('authSection'),
  
  // Settings Drawer
  settingsCard: document.getElementById('settingsCard'),
  closeSettings: document.getElementById('closeSettings'),
  geminiKeyInput: document.getElementById('geminiKeyInput'),
  toggleKeyVisibility: document.getElementById('toggleKeyVisibility'),
  saveKeyBtn: document.getElementById('saveKeyBtn'),
  deleteKeyBtn: document.getElementById('deleteKeyBtn'),
  activeKeyContainer: document.getElementById('activeKeyContainer'),
  activeKeyDisplay: document.getElementById('activeKeyDisplay'),
  geminiModelSelect: document.getElementById('geminiModelSelect'),

  // Suggestions
  suggestionsList: document.getElementById('suggestionsList'),
  refreshSuggestions: document.getElementById('refreshSuggestions'),

  // Search
  articleSearchInput: document.getElementById('articleSearchInput'),
  fetchArticleBtn: document.getElementById('fetchArticleBtn'),

  // Workspace
  activeArticleTitle: document.getElementById('activeArticleTitle'),
  correctAiBtn: document.getElementById('correctAiBtn'),
  originalWikitext: document.getElementById('originalWikitext'),
  polishedWikitext: document.getElementById('polishedWikitext'),
  originalCharCount: document.getElementById('originalCharCount'),
  polishedCharCount: document.getElementById('polishedCharCount'),
  polishedWordCount: document.getElementById('polishedWordCount'),

  // Publish
  publishCard: document.getElementById('publishCard'),
  editSummaryInput: document.getElementById('editSummaryInput'),
  publishBtn: document.getElementById('publishBtn'),

  // Dialog Layouts
  toastContainer: document.getElementById('toastContainer'),
  appOverlay: document.getElementById('appOverlay')
};

// Bangla Numerals Dictionary for beautiful localization
const bnDigits = { '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪', '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯' };
function toBanglaNumber(num) {
  if (num === null || num === undefined) return '০';
  return String(num).split('').map(char => bnDigits[char] || char).join('');
}

// ==========================================
// 1. DYNAMIC TOAST SYSTEM (Alert Overlays)
// ==========================================
function showToast(title, message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconClass = 'fa-circle-info';
  if (type === 'success') iconClass = 'fa-circle-check';
  if (type === 'error') iconClass = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <div class="toast-icon"><i class="fa-solid ${iconClass}"></i></div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
  `;

  // Append & Setup Auto-Remove
  els.toastContainer.appendChild(toast);
  
  const removeToast = () => {
    toast.style.animation = 'slideInToast 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector('.toast-close').addEventListener('click', removeToast);
  setTimeout(removeToast, 6000);
}

// ==========================================
// 2. CORE API SERVICE BRIDGE
// ==========================================

// Check Logged-in User Status
async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    
    state.user.loggedIn = data.loggedIn;
    state.user.username = data.username;
    state.user.isMock = data.isMock;

    renderAuthUI();
  } catch (err) {
    console.error('Auth check failure:', err);
    showToast('সেশন ত্রুটি', 'ব্যবহারকারীর সেশন চেক করা সম্ভব হয়নি।', 'error');
  }
}

// Check if Gemini Key is loaded in server session
async function checkKeyStatus() {
  try {
    const res = await fetch('/api/key/status');
    const data = await res.json();
    state.hasApiKey = data.hasKey;
    state.maskedKey = data.maskedKey;
    renderKeyStatusUI();
    loadAvailableModels(); // Load models dynamically once status is retrieved
  } catch (err) {
    console.error('Key status check failure:', err);
  }
}

// Load available models dynamically from the server key proxy
async function loadAvailableModels() {
  if (!state.hasApiKey) {
    // Reset to standard static options if no key active
    els.geminiModelSelect.innerHTML = `
      <option value="gemini-3.5-flash">gemini-3.5-flash (ডিফল্ট)</option>
      <option value="gemini-2.0-flash">gemini-2.0-flash</option>
    `;
    return;
  }

  try {
    console.log('[App] Fetching available models for active key...');
    const res = await fetch('/api/key/models');
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch models list');
    }

    if (data.models && data.models.length > 0) {
      els.geminiModelSelect.innerHTML = '';
      data.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.innerText = `${model.id} (${model.displayName})`;
        
        // Prioritize gemini-3.5-flash as default, then fallback to gemini-2.0-flash
        if (model.id === 'gemini-3.5-flash') {
          option.selected = true;
        } else if (model.id === 'gemini-2.0-flash' && !els.geminiModelSelect.querySelector('option[selected]')) {
          option.selected = true;
        }
        
        els.geminiModelSelect.appendChild(option);
      });
      
      // If no option was explicitly marked as selected, select the first one
      if (els.geminiModelSelect.options.length > 0 && els.geminiModelSelect.selectedIndex === -1) {
        els.geminiModelSelect.selectedIndex = 0;
      }
      
      console.log(`[App] Dropdown populated with ${data.models.length} dynamic models.`);
    }
  } catch (err) {
    console.error('[App] Failed to load available models from API, using fallback list:', err);
    els.geminiModelSelect.innerHTML = `
      <option value="gemini-3.5-flash">gemini-3.5-flash (ডিফল্ট)</option>
      <option value="gemini-2.0-flash">gemini-2.0-flash</option>
    `;
  }
}

// Fetch suggested articles from category members
async function loadSuggestedArticles() {
  els.suggestionsList.innerHTML = `
    <div class="skeleton-item"></div>
    <div class="skeleton-item"></div>
    <div class="skeleton-item"></div>
  `;

  try {
    const res = await fetch('/api/suggestions');
    const data = await res.json();
    
    els.suggestionsList.innerHTML = '';
    
    data.articles.forEach(article => {
      const button = document.createElement('button');
      button.className = 'suggestion-item';
      button.innerHTML = `
        <span class="suggestion-item-title">${article.title}</span>
        <i class="fa-solid fa-angle-right"></i>
      `;
      button.addEventListener('click', () => {
        els.articleSearchInput.value = article.title;
        fetchArticle(article.title);
      });
      els.suggestionsList.appendChild(button);
    });

    if (data.source === 'fallback') {
      console.log('Suggested list uses static fallback values.');
    }
  } catch (err) {
    console.error('Failed to load suggested articles:', err);
    els.suggestionsList.innerHTML = `<p class="text-xs text-muted" style="font-family: var(--font-bangla);">তালিকা লোড করা ব্যর্থ হয়েছে।</p>`;
  }
}

// Fetch Article revision and wikitext content
async function fetchArticle(title) {
  if (!title || title.trim() === '') {
    showToast('নিবন্ধের নাম অনুপস্থিত', 'অনুগ্রহ করে নিবন্ধের নাম টাইপ করুন বা তালিকা থেকে নির্বাচন করুন।', 'error');
    return;
  }

  els.fetchArticleBtn.disabled = true;
  els.fetchArticleBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> লোড হচ্ছে...`;

  try {
    const res = await fetch(`/api/article?title=${encodeURIComponent(title.trim())}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'নিবন্ধ সংগ্রহ করতে ব্যর্থ।');
    }

    // Save article details in state
    state.activeArticle.title = data.title;
    state.activeArticle.wikitext = data.wikitext;
    state.activeArticle.baserevisionid = data.baserevisionid;
    state.activeArticle.basetimestamp = data.basetimestamp;

    // Load to original editor and clear corrected editor
    els.activeArticleTitle.innerText = data.title;
    els.originalWikitext.value = data.wikitext;
    els.polishedWikitext.value = '';
    
    // Enable AI buttons
    els.correctAiBtn.classList.remove('disabled');
    els.correctAiBtn.disabled = false;
    
    // Reset Publish pane
    els.publishCard.classList.add('disabled');

    // Update character counts
    updateCharCounts();
    
    showToast('নিবন্ধ লোড সম্পন্ন', `"${data.title}" নিবন্ধের মূল উইকিপাঠ সফলভাবে আনা হয়েছে!`, 'success');
  } catch (err) {
    console.error('Fetch article error:', err);
    showToast('সংগ্রহ ত্রুটি', err.message || 'বাংলা উইকিপিডিয়া থেকে নিবন্ধটি লোড করা যায়নি।', 'error');
  } finally {
    els.fetchArticleBtn.disabled = false;
    els.fetchArticleBtn.innerHTML = `<i class="fa-solid fa-download"></i> সংগ্রহ`;
  }
}

// Request AI correction from Gemini API Proxy
async function correctWikitext() {
  if (!state.hasApiKey) {
    showToast('Gemini কী প্রয়োজন', 'দয়া করে প্রথমে উপরে ডান পাশের বাটনে ক্লিক করে একটি Gemini API Key সংরক্ষণ করুন।', 'error');
    toggleSettingsDrawer(true);
    return;
  }

  if (!state.activeArticle.wikitext || state.activeArticle.wikitext.trim() === '') {
    showToast('কোনো কন্টেন্ট নেই', 'প্রথমে উইকিপিডিয়া থেকে কোনো নিবন্ধ সংগ্রহ করুন।', 'error');
    return;
  }

  state.isProcessingAi = true;
  els.correctAiBtn.disabled = true;
  els.correctAiBtn.classList.add('btn-pulse-active');
  els.correctAiBtn.innerHTML = `<i class="fa-solid fa-compass fa-spin"></i> পরিমার্জন হচ্ছে...`;
  
  showToast('AI প্রসেসিং শুরু', 'Gemini এআই উইকিপাঠ বিশ্লেষণ করছে। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন...', 'info');

  try {
    const selectedModel = els.geminiModelSelect.value;
    const res = await fetch('/api/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        wikitext: state.activeArticle.wikitext,
        model: selectedModel
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Gemini processing failed.');
    }

    // Populate polished wikitext area
    els.polishedWikitext.value = data.correctedText;
    
    // Enable Publish Panel
    if (state.user.loggedIn) {
      els.publishCard.classList.remove('disabled');
    } else {
      showToast('লগইন করুন', 'পরিমার্জিত সংস্করণ প্রকাশ করতে হলে আপনাকে উইকিপিডিয়া একাউন্টে লগইন করতে হবে।', 'info');
    }

    updateCharCounts();
    showToast('পরিমার্জন সম্পন্ন', 'Gemini এআই সফলভাবে উইকিপাঠ অপরিবর্তিত রেখে বাংলা অনুবাদ নিখুঁত করেছে!', 'success');
  } catch (err) {
    console.error('AI correction failure:', err);
    showToast('AI প্রসেসিং ত্রুটি', err.message || 'Gemini API থেকে অনুবাদ সংশোধন করতে ব্যর্থ।', 'error');
  } finally {
    state.isProcessingAi = false;
    els.correctAiBtn.disabled = false;
    els.correctAiBtn.classList.remove('btn-pulse-active');
    els.correctAiBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> এআই সংশোধন শুরু করুন`;
  }
}

// Publish Polished Wikitext to Bangla Wikipedia
async function publishToWikipedia() {
  if (!state.user.loggedIn) {
    showToast('অনুমতি ত্রুটি', 'উইকিপিডিয়ায় প্রকাশ করার জন্য আপনার একাউন্টে লগইন থাকা আবশ্যক।', 'error');
    return;
  }

  const polishedText = els.polishedWikitext.value;
  if (!polishedText || polishedText.trim() === '') {
    showToast('খালি নিবন্ধ', 'উইকিপিডিয়ায় প্রকাশ করার মতো কোনো পরিমার্জিত লেখা নেই।', 'error');
    return;
  }

  state.isPublishing = true;
  els.publishBtn.disabled = true;
  els.publishBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> উইকিপিডিয়ায় আপলোড হচ্ছে...`;

  try {
    const payload = {
      title: state.activeArticle.title,
      wikitext: polishedText,
      baserevisionid: state.activeArticle.baserevisionid,
      basetimestamp: state.activeArticle.basetimestamp,
      summary: els.editSummaryInput.value
    };

    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'প্রকাশের অনুরোধ ব্যর্থ হয়েছে।');
    }

    showToast(
      data.mock ? 'মক পাবলিশ সম্পন্ন' : 'উইকিপিডিয়ায় সংরক্ষিত',
      data.message || `নিবন্ধ "${state.activeArticle.title}" সফলভাবে প্রকাশ করা হয়েছে!`,
      'success'
    );

    // Disable further publishing till next fetch
    els.publishCard.classList.add('disabled');
  } catch (err) {
    console.error('Publish error:', err);
    showToast('প্রকাশ ত্রুটি', err.message || 'উইকিপিডিয়ায় নিবন্ধটি সংরক্ষণ করতে ব্যর্থ হয়েছে।', 'error');
  } finally {
    state.isPublishing = false;
    els.publishBtn.disabled = false;
    els.publishBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> উইকিপিডিয়ায় পোস্ট করুন`;
  }
}

// ==========================================
// 3. UI RENDERING & EVENT CONTROLLERS
// ==========================================

// Toggle Settings Card visibility
function toggleSettingsDrawer(show) {
  if (show === undefined) {
    els.settingsCard.classList.toggle('hidden');
    els.appOverlay.classList.toggle('hidden');
  } else if (show) {
    els.settingsCard.classList.remove('hidden');
    els.appOverlay.classList.remove('hidden');
  } else {
    els.settingsCard.classList.add('hidden');
    els.appOverlay.classList.add('hidden');
  }
}

// Render User Status in UI
function renderAuthUI() {
  if (state.user.loggedIn) {
    // Show Wikipedia account details
    const labelText = state.user.isMock ? 'মক সেশন' : 'উইকি এডিটর';
    els.authSection.innerHTML = `
      <div class="user-profile-badge">
        <div class="profile-avatar">
          <i class="fa-solid fa-user"></i>
        </div>
        <div class="profile-info">
          <span class="profile-name">${state.user.username}</span>
          <span class="profile-label">${labelText}</span>
        </div>
        <a href="/auth/logout" class="btn-logout" title="লগআউট করুন">
          <i class="fa-solid fa-right-from-bracket"></i>
        </a>
      </div>
    `;
    
    // Enable Publish Panel if article is already polished
    if (els.polishedWikitext.value.trim() !== '' && !state.isProcessingAi) {
      els.publishCard.classList.remove('disabled');
    }
  } else {
    // Show Login trigger
    els.authSection.innerHTML = `
      <a href="/auth/mediawiki" class="btn btn-wiki-login" id="wikiLoginBtn">
        <i class="fa-brands fa-wikipedia-w"></i>
        <span>উইকিপিডিয়া লগইন</span>
      </a>
    `;
    els.publishCard.classList.add('disabled');
  }
}

// Render Key Indicators
function renderKeyStatusUI() {
  if (state.hasApiKey) {
    els.keyDot.className = 'status-dot green';
    els.keyStatusText.innerText = 'Gemini কী সক্রিয়';
    els.deleteKeyBtn.classList.remove('hidden');
    els.saveKeyBtn.innerText = 'কী সংরক্ষণ করুন';
    els.geminiKeyInput.value = ''; // Leave blank so they don't submit literal dots
    els.geminiKeyInput.placeholder = 'নতুন কী লিখুন (পরিবর্তন করতে)';
    
    if (state.maskedKey) {
      els.activeKeyContainer.classList.remove('hidden');
      els.activeKeyDisplay.innerText = state.maskedKey;
    } else {
      els.activeKeyContainer.classList.add('hidden');
    }
  } else {
    els.keyDot.className = 'status-dot red';
    els.keyStatusText.innerText = 'Gemini কী নেই';
    els.deleteKeyBtn.classList.add('hidden');
    els.saveKeyBtn.innerText = 'কী সংরক্ষণ করুন';
    els.geminiKeyInput.value = '';
    els.geminiKeyInput.placeholder = 'AIzaSy... কী পেস্ট করুন';
    els.activeKeyContainer.classList.add('hidden');
  }
}

// Update Character and Word counts on input
function updateCharCounts() {
  const originalText = els.originalWikitext.value || '';
  const polishedText = els.polishedWikitext.value || '';

  // Calculate numbers
  const origChars = originalText.length;
  const polChars = polishedText.length;
  const polWords = polishedText.trim() === '' ? 0 : polishedText.trim().split(/\s+/).length;

  // Localize counts
  els.originalCharCount.innerText = `${toBanglaNumber(origChars)} অক্ষর`;
  els.polishedCharCount.innerText = `${toBanglaNumber(polChars)} অক্ষর`;
  els.polishedWordCount.innerText = `${toBanglaNumber(polWords)} শব্দ`;
}

// ==========================================
// 4. ADVANCED EDITOR SYNCED SCROLL
// ==========================================
let isScrollingLeft = false;
let isScrollingRight = false;

els.originalWikitext.addEventListener('scroll', () => {
  if (isScrollingRight) {
    isScrollingRight = false;
    return;
  }
  isScrollingLeft = true;
  
  const percentage = els.originalWikitext.scrollTop / (els.originalWikitext.scrollHeight - els.originalWikitext.clientHeight);
  els.polishedWikitext.scrollTop = percentage * (els.polishedWikitext.scrollHeight - els.polishedWikitext.clientHeight);
});

els.polishedWikitext.addEventListener('scroll', () => {
  if (isScrollingLeft) {
    isScrollingLeft = false;
    return;
  }
  isScrollingRight = true;
  
  const percentage = els.polishedWikitext.scrollTop / (els.polishedWikitext.scrollHeight - els.polishedWikitext.clientHeight);
  els.originalWikitext.scrollTop = percentage * (els.originalWikitext.scrollHeight - els.originalWikitext.clientHeight);
});

// ==========================================
// 5. ATTACH STATIC LISTENERS
// ==========================================

// Settings Card toggle
els.keyStatusBtn.addEventListener('click', () => toggleSettingsDrawer(true));
els.closeSettings.addEventListener('click', () => toggleSettingsDrawer(false));
els.appOverlay.addEventListener('click', () => toggleSettingsDrawer(false));

// Password Toggle visibility
els.toggleKeyVisibility.addEventListener('click', () => {
  const type = els.geminiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
  els.geminiKeyInput.setAttribute('type', type);
  els.toggleKeyVisibility.querySelector('i').className = type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
});

// Save Gemini API Key
els.saveKeyBtn.addEventListener('click', async () => {
  const key = els.geminiKeyInput.value.trim();
  
  if (key === '') {
    if (state.hasApiKey) {
      // If key already loaded and they left input blank, they just want to close the configurations.
      toggleSettingsDrawer(false);
      return;
    }
    showToast('কী তথ্য নেই', 'অনুগ্রহ করে একটি নতুন Gemini API Key প্রবেশ করান।', 'error');
    return;
  }

  try {
    const res = await fetch('/api/key/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      state.hasApiKey = true;
      state.maskedKey = data.maskedKey;
      renderKeyStatusUI();
      loadAvailableModels(); // Load models dynamically for new key!
      toggleSettingsDrawer(false);
      showToast('সফলভাবে সংরক্ষিত', 'Gemini API Key আপনার বর্তমান সেশনে সফলভাবে সংরক্ষণ করা হয়েছে!', 'success');
    } else {
      throw new Error(data.error || 'কী সেভ করতে ব্যর্থ।');
    }
  } catch (err) {
    showToast('সংরক্ষণ ত্রুটি', err.message || 'সার্ভারে কীটি সেভ করতে সমস্যা হয়েছে।', 'error');
  }
});

// Delete Gemini API Key
els.deleteKeyBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/key/delete', { method: 'POST' });
    if (res.ok) {
      state.hasApiKey = false;
      state.maskedKey = null;
      renderKeyStatusUI();
      loadAvailableModels(); // Reset models select dropdown!
      toggleSettingsDrawer(false);
      showToast('কী অপসারিত', 'সার্ভার সেশন থেকে Gemini API Key সফলভাবে মুছে দেওয়া হয়েছে।', 'success');
    }
  } catch (err) {
    showToast('অপসারণ ত্রুটি', 'কীটি মুছতে সমস্যা হয়েছে।', 'error');
  }
});

// Refresh suggested articles list
els.refreshSuggestions.addEventListener('click', loadSuggestedArticles);

// Manual search event trigger
els.fetchArticleBtn.addEventListener('click', () => {
  const title = els.articleSearchInput.value;
  fetchArticle(title);
});

// Trigger article search via ENTER key press
els.articleSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const title = els.articleSearchInput.value;
    fetchArticle(title);
  }
});

// AI correction action
els.correctAiBtn.addEventListener('click', correctWikitext);

// Polished editor input updates word counters
els.polishedWikitext.addEventListener('input', updateCharCounts);

// Publish action
els.publishBtn.addEventListener('click', publishToWikipedia);

// Check url query for auth callback errors
function parseURLParams() {
  const params = new URLSearchParams(window.location.search);
  const errorMsg = params.get('error');
  if (errorMsg) {
    showToast('অনুমোদন ব্যর্থ', errorMsg, 'error');
    // Clear history query state
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// Initialise App
function init() {
  parseURLParams();
  checkAuthStatus();
  checkKeyStatus();
  loadSuggestedArticles();
}

// Start app
window.addEventListener('DOMContentLoaded', init);
