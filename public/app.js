/* ==========================================================================
   Anubad Shuddhi - Frontend Client Application Logic
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
  
  // Settings Collapsible Card
  settingsCard: document.getElementById('settingsCard'),
  closeSettings: document.getElementById('closeSettings'), // Legacy fallback
  geminiKeyInput: document.getElementById('geminiKeyInput'),
  toggleKeyVisibility: document.getElementById('toggleKeyVisibility'),
  saveKeyBtn: document.getElementById('saveKeyBtn'),
  deleteKeyBtn: document.getElementById('deleteKeyBtn'),
  activeKeyContainer: document.getElementById('activeKeyContainer'),
  activeKeyDisplay: document.getElementById('activeKeyDisplay'),
  geminiModelSelect: document.getElementById('geminiModelSelect'),
  configToggle: document.getElementById('configToggle'),
  configPanel: document.getElementById('config-panel'),
  configChevron: document.getElementById('config-chevron'),

  // Suggestions
  suggestionsPanel: document.getElementById('suggestionsPanel'),
  btnToggleSuggestions: document.getElementById('btnToggleSuggestions'),
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

  // Inline Panel Previews
  btnOriginalEditor: document.getElementById('btnOriginalEditor'),
  btnOriginalPreview: document.getElementById('btnOriginalPreview'),
  originalInlinePreview: document.getElementById('originalInlinePreview'),
  originalInlinePreviewContent: document.getElementById('originalInlinePreviewContent'),
  btnModeEditor: document.getElementById('btnModeEditor'),
  btnModePreview: document.getElementById('btnModePreview'),
  inlinePreview: document.getElementById('inlinePreview'),
  inlinePreviewContent: document.getElementById('inlinePreviewContent'),

  // Publish
  publishCard: document.getElementById('publishCard'),
  editSummaryInput: document.getElementById('editSummaryInput'),
  publishBtn: document.getElementById('publishBtn'),

  // Dialog Layouts
  toastContainer: document.getElementById('toastContainer'),
  appOverlay: document.getElementById('appOverlay'),

  // Mobile Responsive Elements
  sidebarToggle: document.getElementById('sidebarToggle'),
  darkModeToggle: document.getElementById('darkModeToggle'),
  mobileDarkModeToggle: document.getElementById('mobileDarkModeToggle'),
  appSidebar: document.querySelector('.app-sidebar'), // Legacy fallback
  tabOriginalBtn: document.getElementById('tabOriginalBtn'),
  tabPolishedBtn: document.getElementById('tabPolishedBtn'),
  originalPane: document.querySelector('.original-pane'),
  polishedPane: document.querySelector('.polished-pane'),

  // Wikipedia Preview Modal (Legacy compatibility fallback layer)
  previewOriginalBtn: document.getElementById('previewOriginalBtn'),
  previewPolishedBtn: document.getElementById('previewPolishedBtn'),
  previewModal: document.getElementById('previewModal'),
  closePreviewModal: document.getElementById('closePreviewModal'),
  previewModalTitle: document.getElementById('previewModalTitle'),
  previewContent: document.getElementById('previewContent')
};

// Bangla Numerals Dictionary for beautiful localization
const bnDigits = { '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪', '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯' };
function toBanglaNumber(num) {
  if (num === null || num === undefined) return '০';
  return String(num).split('').map(char => bnDigits[char] || char).join('');
}

// Safely enable/disable a DOM element and toggle its disabled class (preventing crashes)
function safeSetDisabled(el, disabled) {
  if (el) {
    el.disabled = disabled;
    if (disabled) {
      el.classList.add('disabled');
    } else {
      el.classList.remove('disabled');
    }
  }
}

// Safely toggle the publish card panel and button enabled states together
function setPublishPanelEnabled(enabled) {
  if (els.publishCard) {
    if (enabled) {
      els.publishCard.classList.remove('disabled');
    } else {
      els.publishCard.classList.add('disabled');
    }
  }
  safeSetDisabled(els.publishBtn, !enabled);
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
    state.user.publishedCount = data.publishedCount || 0;

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
    if (els.activeArticleTitle) {
      els.activeArticleTitle.innerText = data.title;
      els.activeArticleTitle.classList.remove('hidden');
    }
    els.originalWikitext.value = data.wikitext;
    els.polishedWikitext.value = '';
    
    // Enable AI buttons
    safeSetDisabled(els.correctAiBtn, false);
    
    // Enable original preview button, disable polished preview
    safeSetDisabled(els.previewOriginalBtn, false);
    safeSetDisabled(els.previewPolishedBtn, true);
    
    // Reset Publish pane
    setPublishPanelEnabled(false);

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

  triggerAiProcessingState(true);
  
  showToast('AI প্রসেসিং শুরু', 'Gemini এআই উইকিপাঠ বিশ্লেষণ করছে। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন...', 'info');

  try {
    const selectedModel = els.geminiModelSelect.value;
    const res = await fetch('/api/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        wikitext: state.activeArticle.wikitext,
        model: selectedModel,
        title: state.activeArticle.title
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Gemini processing failed.');
    }

    // Populate polished wikitext area
    els.polishedWikitext.value = data.correctedText;
    
    // Enable polished preview button
    safeSetDisabled(els.previewPolishedBtn, false);
    
    // Enable Publish Panel
    if (state.user.loggedIn) {
      setPublishPanelEnabled(true);
    } else {
      showToast('লগইন করুন', 'পরিমার্জিত সংস্করণ প্রকাশ করতে হলে আপনাকে উইকিপিডিয়া একাউন্টে লগইন করতে হবে।', 'info');
    }

    updateCharCounts();
    showToast('পরিমার্জন সম্পন্ন', 'Gemini এআই সফলভাবে উইকিপাঠ অপরিবর্তিত রেখে বাংলা অনুবাদ নিখুঁত করেছে!', 'success');

    // Automatically switch to the Polished Editor tab on mobile screens so they see the result immediately
    if (window.innerWidth <= 768) {
      els.tabOriginalBtn.classList.remove('active');
      els.tabPolishedBtn.classList.add('active');
      els.originalPane.classList.remove('active');
      els.polishedPane.classList.add('active');
    }
  } catch (err) {
    console.error('AI correction failure:', err);
    showToast('AI প্রসেসিং ত্রুটি', err.message || 'Gemini API থেকে অনুবাদ সংশোধন করতে ব্যর্থ।', 'error');
  } finally {
    triggerAiProcessingState(false);
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
  safeSetDisabled(els.publishBtn, true);
  els.publishBtn.innerHTML = `<span class="material-symbols-outlined text-lg animate-spin">autorenew</span><span>উইকিপিডিয়ায় সংরক্ষণ করা হচ্ছে...</span>`;

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

    // Sync persistent contribution count
    if (data.publishedCount !== undefined) {
      state.user.publishedCount = data.publishedCount;
      renderAuthUI();
    }

    // Reset local title and wikitext states since it has been published
    state.activeArticle.title = null;
    state.activeArticle.wikitext = '';
    
    if (els.activeArticleTitle) {
      els.activeArticleTitle.innerText = 'কোনো নিবন্ধ নির্বাচিত নেই';
      els.activeArticleTitle.classList.add('hidden');
    }
    
    els.originalWikitext.value = '';
    els.polishedWikitext.value = '';
    safeSetDisabled(els.correctAiBtn, true);

    // Disable further publishing till next fetch
    setPublishPanelEnabled(false);
  } catch (err) {
    console.error('Publish error:', err);
    showToast('প্রকাশ ত্রুটি', err.message || 'উইকিপিডিয়ায় নিবন্ধটি সংরক্ষণ করতে ব্যর্থ হয়েছে।', 'error');
  } finally {
    state.isPublishing = false;
    safeSetDisabled(els.publishBtn, false);
    els.publishBtn.innerHTML = `<span class="material-symbols-outlined text-lg" style="font-variation-settings: 'FILL' 1;">publish</span><span>উইকিপিডিয়ায় সংরক্ষণ করুন</span>`;
  }
}

// ==========================================
// 3. UI RENDERING & EVENT CONTROLLERS
// ==========================================

// Toggle Settings Card inline configuration panel
function toggleSettingsDrawer(show) {
  if (!els.configPanel) return;
  
  if (show === undefined) {
    const isHidden = els.configPanel.classList.toggle('hidden');
    if (els.configChevron) {
      els.configChevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  } else if (show) {
    els.configPanel.classList.remove('hidden');
    if (els.configChevron) {
      els.configChevron.style.transform = 'rotate(180deg)';
    }
    // Scroll settings card into view smoothly when clicking API status button
    if (els.settingsCard) {
      els.settingsCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else {
    els.configPanel.classList.add('hidden');
    if (els.configChevron) {
      els.configChevron.style.transform = 'rotate(0deg)';
    }
  }
}

// Render User Status in UI
function renderAuthUI() {
  const lockedOverlay = document.getElementById('lockedOverlay');

  if (state.user.loggedIn) {
    // Hide forced login locked screen overlay
    if (lockedOverlay) {
      lockedOverlay.classList.add('hidden');
    }
    document.body.classList.remove('drawer-open');

    // Show Wikipedia account details & stats badge
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
        <div class="profile-stats" title="সফলভাবে শুদ্ধ ও প্রকাশিত নিবন্ধ সংখ্যা">
          <i class="fa-solid fa-award text-gold"></i>
          <span>${toBanglaNumber(state.user.publishedCount)}টি</span>
        </div>
        <a href="/auth/logout" class="btn-logout" title="লগআউট করুন">
          <i class="fa-solid fa-right-from-bracket"></i>
        </a>
      </div>
    `;
    
    // Enable Publish Panel if article is already polished
    if (els.polishedWikitext.value.trim() !== '' && !state.isProcessingAi) {
      setPublishPanelEnabled(true);
    }
  } else {
    // Show forced login locked screen overlay
    if (lockedOverlay) {
      lockedOverlay.classList.remove('hidden');
    }
    document.body.classList.add('drawer-open'); // Prevent back scrolling

    // Show Login trigger
    els.authSection.innerHTML = `
      <a href="/auth/mediawiki" class="btn btn-wiki-login" id="wikiLoginBtn">
        <i class="fa-brands fa-wikipedia-w"></i>
        <span>উইকিপিডিয়া লগইন</span>
      </a>
    `;
    setPublishPanelEnabled(false);
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
if (els.keyStatusBtn) {
  els.keyStatusBtn.addEventListener('click', () => toggleSettingsDrawer(true));
}

if (els.closeSettings) {
  els.closeSettings.addEventListener('click', () => {
    toggleSettingsDrawer(false);
    if (els.appSidebar) {
      els.appSidebar.classList.remove('active');
    }
    els.appOverlay.classList.remove('active');
    document.body.classList.remove('drawer-open');
  });
}

if (els.appOverlay) {
  els.appOverlay.addEventListener('click', () => {
    toggleSettingsDrawer(false);
    if (els.appSidebar) {
      els.appSidebar.classList.remove('active');
    }
    els.appOverlay.classList.remove('active');
    document.body.classList.remove('drawer-open');
  });
}

// Inline configuration panel header toggle
if (els.configToggle && els.configPanel) {
  els.configToggle.addEventListener('click', () => {
    const isHidden = els.configPanel.classList.toggle('hidden');
    if (els.configChevron) {
      els.configChevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  });
}

// Suggestions panel list collapser
if (els.btnToggleSuggestions && els.suggestionsPanel) {
  els.btnToggleSuggestions.addEventListener('click', () => {
    const isHidden = els.suggestionsPanel.classList.toggle('hidden');
    if (!isHidden) {
      loadSuggestedArticles();
    }
  });
}

// Mobile Navigation Menu Toggle
if (els.sidebarToggle) {
  els.sidebarToggle.addEventListener('click', () => {
    const mobileMenuPanel = document.getElementById('mobileMenuPanel');
    if (mobileMenuPanel) {
      const isHidden = mobileMenuPanel.classList.toggle('hidden');
      const icon = els.sidebarToggle.querySelector('span');
      if (icon) {
        icon.innerText = isHidden ? 'menu' : 'close';
      }
    }
  });
}

// ==========================================
// Dark Mode Toggling Logic
// ==========================================
function updateDarkModeIcons(isDark) {
  const dIcon = els.darkModeToggle ? els.darkModeToggle.querySelector('span') : null;
  const mIcon = els.mobileDarkModeToggle ? els.mobileDarkModeToggle.querySelector('span') : null;
  if (dIcon) dIcon.innerText = isDark ? 'light_mode' : 'dark_mode';
  if (mIcon) mIcon.innerText = isDark ? 'light_mode' : 'dark_mode';
}

function initDarkMode() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
  
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  }
  
  updateDarkModeIcons(isDark);
  
  const toggleAction = () => {
    const activeDark = document.documentElement.classList.contains('dark');
    if (activeDark) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      localStorage.setItem('theme', 'light');
      updateDarkModeIcons(false);
      showToast('ডার্ক মোড', 'ডার্ক মোড নিষ্ক্রিয় করা হয়েছে।', 'info');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      localStorage.setItem('theme', 'dark');
      updateDarkModeIcons(true);
      showToast('ডার্ক মোড', 'ডার্ক মোড সক্রিয় করা হয়েছে।', 'info');
    }
  };
  
  if (els.darkModeToggle) {
    els.darkModeToggle.addEventListener('click', toggleAction);
  }
  if (els.mobileDarkModeToggle) {
    els.mobileDarkModeToggle.addEventListener('click', toggleAction);
  }
}

// Mobile Editor Tabs Switcher
if (els.tabOriginalBtn && els.tabPolishedBtn) {
  els.tabOriginalBtn.addEventListener('click', () => {
    els.tabOriginalBtn.classList.add('active');
    els.tabPolishedBtn.classList.remove('active');
    if (els.originalPane && els.polishedPane) {
      els.originalPane.classList.add('active');
      els.polishedPane.classList.remove('active');
    }
  });

  els.tabPolishedBtn.addEventListener('click', () => {
    els.tabOriginalBtn.classList.remove('active');
    els.tabPolishedBtn.classList.add('active');
    if (els.originalPane && els.polishedPane) {
      els.originalPane.classList.remove('active');
      els.polishedPane.classList.add('active');
    }
  });
}

// Password Toggle visibility
if (els.toggleKeyVisibility) {
  els.toggleKeyVisibility.addEventListener('click', () => {
    const type = els.geminiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
    els.geminiKeyInput.setAttribute('type', type);
    
    // Adapt robustly to FontAwesome OR Material Symbols icon
    const icon = els.toggleKeyVisibility.querySelector('i, span');
    if (icon) {
      if (icon.tagName.toLowerCase() === 'span') {
        icon.innerText = type === 'password' ? 'visibility' : 'visibility_off';
      } else {
        icon.className = type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
      }
    }
  });
}

// Save Gemini API Key
if (els.saveKeyBtn) {
  els.saveKeyBtn.addEventListener('click', async () => {
    const key = els.geminiKeyInput.value.trim();
    
    if (key === '') {
      if (state.hasApiKey) {
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
        loadAvailableModels();
        toggleSettingsDrawer(false);
        showToast('সফলভাবে সংরক্ষিত', 'Gemini API Key আপনার বর্তমান সেশনে সফলভাবে সংরক্ষণ করা হয়েছে!', 'success');
      } else {
        throw new Error(data.error || 'কী সেভ করতে ব্যর্থ।');
      }
    } catch (err) {
      showToast('সংরক্ষণ ত্রুটি', err.message || 'সার্ভারে কীটি সেভ করতে সমস্যা হয়েছে।', 'error');
    }
  });
}

// Delete Gemini API Key
if (els.deleteKeyBtn) {
  els.deleteKeyBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/key/delete', { method: 'POST' });
      if (res.ok) {
        state.hasApiKey = false;
        state.maskedKey = null;
        renderKeyStatusUI();
        loadAvailableModels();
        toggleSettingsDrawer(false);
        showToast('কী অপসারিত', 'সার্ভার সেশন থেকে Gemini API Key সফলভাবে মুছে দেওয়া হয়েছে।', 'success');
      }
    } catch (err) {
      showToast('অপসারণ ত্রুটি', 'কীটি মুছতে সমস্যা হয়েছে।', 'error');
    }
  });
}

// Refresh suggested articles list
if (els.refreshSuggestions) {
  els.refreshSuggestions.addEventListener('click', loadSuggestedArticles);
}

// Manual search event trigger
if (els.fetchArticleBtn) {
  els.fetchArticleBtn.addEventListener('click', () => {
    const title = els.articleSearchInput.value;
    fetchArticle(title);
  });
}

if (els.articleSearchInput) {
  // Trigger article search via ENTER key press
  els.articleSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const title = els.articleSearchInput.value;
      fetchArticle(title);
    }
  });
}

// AI correction action
if (els.correctAiBtn) {
  els.correctAiBtn.addEventListener('click', correctWikitext);
}

// Original editor input updates word counters and autosaves progress
if (els.originalWikitext) {
  els.originalWikitext.addEventListener('input', () => {
    updateCharCounts();
    
    // Dynamically setup draft details for manual typing/pastes if no fetched title exists
    if (!state.activeArticle.title && els.originalWikitext.value.trim() !== '') {
      state.activeArticle.title = 'Untitled';
      if (els.activeArticleTitle) {
        els.activeArticleTitle.innerText = 'Untitled';
        els.activeArticleTitle.classList.remove('hidden');
      }
      if (els.correctAiBtn) {
        els.correctAiBtn.classList.remove('disabled');
        els.correctAiBtn.disabled = false;
      }
    } else if (els.originalWikitext.value.trim() === '' && state.activeArticle.title === 'Untitled') {
      state.activeArticle.title = null;
      if (els.activeArticleTitle) {
        els.activeArticleTitle.innerText = 'কোনো নিবন্ধ নির্বাচিত নেই';
        els.activeArticleTitle.classList.add('hidden');
      }
      if (els.correctAiBtn) {
        els.correctAiBtn.classList.add('disabled');
        els.correctAiBtn.disabled = true;
      }
    }
    
    // Safeguarded toggle preview button state
    if (els.previewOriginalBtn) {
      if (els.originalWikitext.value.trim() !== '') {
        els.previewOriginalBtn.classList.remove('disabled');
        els.previewOriginalBtn.disabled = false;
      } else {
        els.previewOriginalBtn.classList.add('disabled');
        els.previewOriginalBtn.disabled = true;
      }
    }
    
    saveProgressToServer();
  });
}

// Polished editor input updates word counters and autosaves progress
if (els.polishedWikitext) {
  els.polishedWikitext.addEventListener('input', () => {
    updateCharCounts();
    
    // Safeguarded toggle preview button state
    if (els.previewPolishedBtn) {
      if (els.polishedWikitext.value.trim() !== '') {
        els.previewPolishedBtn.classList.remove('disabled');
        els.previewPolishedBtn.disabled = false;
      } else {
        els.previewPolishedBtn.classList.add('disabled');
        els.previewPolishedBtn.disabled = true;
      }
    }
    
    saveProgressToServer();
  });
}

// Publish action
if (els.publishBtn) {
  els.publishBtn.addEventListener('click', publishToWikipedia);
}

// Wikipedia Preview Modal triggers (Legacy compatibility fallbacks)
if (els.previewOriginalBtn) {
  els.previewOriginalBtn.addEventListener('click', () => {
    const wikitext = els.originalWikitext.value;
    showPreview(wikitext, state.activeArticle.title);
  });
}

if (els.previewPolishedBtn) {
  els.previewPolishedBtn.addEventListener('click', () => {
    const wikitext = els.polishedWikitext.value;
    showPreview(wikitext, state.activeArticle.title);
  });
}

if (els.closePreviewModal) {
  els.closePreviewModal.addEventListener('click', closePreview);
}

if (els.previewModal) {
  els.previewModal.addEventListener('click', (e) => {
    if (e.target === els.previewModal) {
      closePreview();
    }
  });
}

// Inline original editor / preview switcher
if (els.btnOriginalEditor && els.btnOriginalPreview) {
  els.btnOriginalEditor.addEventListener('click', () => {
    els.btnOriginalEditor.classList.add('bg-white', 'shadow-sm', 'rounded', 'font-bold');
    els.btnOriginalEditor.classList.remove('text-on-surface-variant');
    els.btnOriginalPreview.classList.remove('bg-white', 'shadow-sm', 'rounded', 'font-bold');
    els.btnOriginalPreview.classList.add('text-on-surface-variant');
    
    els.originalWikitext.classList.remove('hidden');
    if (els.originalInlinePreview) {
      els.originalInlinePreview.classList.add('hidden');
    }
  });

  els.btnOriginalPreview.addEventListener('click', async () => {
    els.btnOriginalPreview.classList.add('bg-white', 'shadow-sm', 'rounded', 'font-bold');
    els.btnOriginalPreview.classList.remove('text-on-surface-variant');
    els.btnOriginalEditor.classList.remove('bg-white', 'shadow-sm', 'rounded', 'font-bold');
    els.btnOriginalEditor.classList.add('text-on-surface-variant');
    
    els.originalWikitext.classList.add('hidden');
    const previewContainer = els.originalInlinePreview;
    const previewContent = els.originalInlinePreviewContent;
    if (previewContainer) {
      previewContainer.classList.remove('hidden');
    }
    
    const wikitext = els.originalWikitext.value;
    if (!previewContent) return;
    
    if (!wikitext || wikitext.trim() === '') {
      previewContent.innerHTML = `<div class="p-4 text-center text-text-muted">কোনো কন্টেন্ট নেই</div>`;
      return;
    }
    
    previewContent.innerHTML = `<div class="p-4 text-center text-text-muted"><i class="fa-solid fa-spinner fa-spin mr-2"></i> লোড হচ্ছে...</div>`;
    
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wikitext, title: state.activeArticle.title })
      });
      const data = await res.json();
      if (res.ok) {
        previewContent.innerHTML = data.html;
      } else {
        previewContent.innerHTML = `<div class="p-4 text-center text-destructive-red">লোড করতে ব্যর্থ হয়েছে: ${data.error || 'অজানা ত্রুটি'}</div>`;
      }
    } catch (err) {
      previewContent.innerHTML = `<div class="p-4 text-center text-destructive-red">নেটওয়ার্ক ত্রুটি</div>`;
    }
  });
}

// Inline corrected editor / preview switcher
if (els.btnModeEditor && els.btnModePreview) {
  els.btnModeEditor.addEventListener('click', () => {
    els.btnModeEditor.classList.add('bg-white', 'shadow-sm', 'rounded', 'font-bold');
    els.btnModeEditor.classList.remove('text-on-surface-variant');
    els.btnModePreview.classList.remove('bg-white', 'shadow-sm', 'rounded', 'font-bold');
    els.btnModePreview.classList.add('text-on-surface-variant');
    
    els.polishedWikitext.classList.remove('hidden');
    if (els.inlinePreview) {
      els.inlinePreview.classList.add('hidden');
    }
  });

  els.btnModePreview.addEventListener('click', async () => {
    els.btnModePreview.classList.add('bg-white', 'shadow-sm', 'rounded', 'font-bold');
    els.btnModePreview.classList.remove('text-on-surface-variant');
    els.btnModeEditor.classList.remove('bg-white', 'shadow-sm', 'rounded', 'font-bold');
    els.btnModeEditor.classList.add('text-on-surface-variant');
    
    els.polishedWikitext.classList.add('hidden');
    const previewContainer = els.inlinePreview;
    const previewContent = els.inlinePreviewContent;
    if (previewContainer) {
      previewContainer.classList.remove('hidden');
    }
    
    const wikitext = els.polishedWikitext.value;
    if (!previewContent) return;
    
    if (!wikitext || wikitext.trim() === '') {
      previewContent.innerHTML = `<div class="p-4 text-center text-text-muted">কোনো কন্টেন্ট নেই</div>`;
      return;
    }
    
    previewContent.innerHTML = `<div class="p-4 text-center text-text-muted"><i class="fa-solid fa-spinner fa-spin mr-2"></i> লোড হচ্ছে...</div>`;
    
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wikitext, title: state.activeArticle.title })
      });
      const data = await res.json();
      if (res.ok) {
        previewContent.innerHTML = data.html;
      } else {
        previewContent.innerHTML = `<div class="p-4 text-center text-destructive-red">লোড করতে ব্যর্থ হয়েছে: ${data.error || 'অজানা ত্রুটি'}</div>`;
      }
    } catch (err) {
      previewContent.innerHTML = `<div class="p-4 text-center text-destructive-red">নেটওয়ার্ক ত্রুটি</div>`;
    }
  });
}

// Debounce function to limit autosave HTTP request frequency
function debounce(func, delay) {
  let debounceTimer;
  return function() {
    const context = this;
    const args = arguments;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => func.apply(context, args), delay);
  };
}

// Perform draft autosave to server
const saveProgressToServer = debounce(async () => {
  if (!state.user.loggedIn) return;
  
  const title = state.activeArticle.title || 'Untitled';
  const wikitext = els.originalWikitext.value || '';
  const polishedWikitext = els.polishedWikitext.value || '';
  const baserevisionid = state.activeArticle.baserevisionid;
  const basetimestamp = state.activeArticle.basetimestamp;
  
  try {
    const res = await fetch('/api/article/save-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        title,
        wikitext,
        polishedWikitext,
        baserevisionid,
        basetimestamp
      })
    });
    if (res.ok) {
      console.log('[Autosave] Progress saved successfully.');
    }
  } catch (err) {
    console.error('[Autosave] Failed to autosave draft:', err);
  }
}, 1000); // 1-second debounce

// Request and render Wikipedia-style wikitext preview
async function showPreview(wikitext, title) {
  if (!wikitext || wikitext.trim() === '') {
    showToast('কন্টেন্ট নেই', 'প্রাকদর্শন করার জন্য কোনো উইকিপাঠ লেখা নেই।', 'error');
    return;
  }

  const articleTitle = title || state.activeArticle.title || 'Untitled';
  
  // Set modal header title and initial loading state
  els.previewModalTitle.innerText = articleTitle;
  els.previewContent.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem; color: #7f8c8d; gap: 1rem;">
      <i class="fa-solid fa-compass fa-spin" style="font-size: 2.5rem; color: var(--primary-gold);"></i>
      <span style="font-family: var(--font-bangla); font-size: 1rem;">উইকিপিডিয়া থেকে প্রাকদর্শন সংগ্রহ ও রূপান্তর করা হচ্ছে...</span>
    </div>
  `;
  
  // Display modal (add active class)
  els.previewModal.classList.add('active');
  document.body.classList.add('drawer-open'); // Prevent back scroll

  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wikitext, title: articleTitle })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch preview from Wikipedia.');
    }

    // Load rendered HTML into the container
    els.previewContent.innerHTML = data.html;
  } catch (err) {
    console.error('Preview error:', err);
    els.previewContent.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem; color: #e74c3c; gap: 1rem; text-align: center;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem;"></i>
        <span style="font-family: var(--font-bangla); font-size: 1.05rem; font-weight: 600;">প্রাকদর্শন লোড করা যায়নি</span>
        <span style="font-family: var(--font-bangla); font-size: 0.85rem; color: #7f8c8d; max-width: 400px;">${err.message || 'উইকিপিডিয়া প্রাকদর্শন এপিআই এ সংযোগ করা সম্ভব হয়নি।'}</span>
      </div>
    `;
  }
}

// Dismiss Wikipedia Preview Modal
function closePreview() {
  els.previewModal.classList.remove('active');
  document.body.classList.remove('drawer-open');
}

// Check and recover session active draft progress
async function checkActiveDraftProgress() {
  if (!state.user.loggedIn) return;
  
  try {
    const res = await fetch('/api/article/active');
    const data = await res.json();
    
    if (data.activeDraft) {
      const draft = data.activeDraft;
      console.log(`[Draft Recovery] Found active server draft: "${draft.title}" with status: "${draft.status}"`);
      
      // Restore state
      state.activeArticle.title = draft.title;
      state.activeArticle.wikitext = draft.wikitext;
      state.activeArticle.baserevisionid = draft.baserevisionid;
      state.activeArticle.basetimestamp = draft.basetimestamp;
      
      // Update DOM
      if (els.activeArticleTitle) {
        els.activeArticleTitle.innerText = draft.title;
        els.activeArticleTitle.classList.remove('hidden');
      }
      els.originalWikitext.value = draft.wikitext;
      els.polishedWikitext.value = draft.polishedWikitext || '';
      
      safeSetDisabled(els.correctAiBtn, false);
      
      // Restore preview buttons state on draft recovery
      if (draft.wikitext && draft.wikitext.trim() !== '') {
        safeSetDisabled(els.previewOriginalBtn, false);
      }
      if (draft.polishedWikitext && draft.polishedWikitext.trim() !== '') {
        safeSetDisabled(els.previewPolishedBtn, false);
      }
      
      updateCharCounts();

      if (draft.status === 'processing') {
        // Trigger loading state and start polling!
        triggerAiProcessingState(true);
        startPollingActiveDraft();
      } else if (draft.status === 'completed' && draft.polishedWikitext) {
        if (state.user.loggedIn) {
          setPublishPanelEnabled(true);
        }
      }
    }
  } catch (err) {
    console.error('[Draft Recovery] Failed to recover active draft:', err);
  }
}

let pollingTimer = null;
function startPollingActiveDraft() {
  if (pollingTimer) return;
  
  console.log('[Poller] Starting draft poller...');
  pollingTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/article/active');
      const data = await res.json();
      
      if (data.activeDraft) {
        const draft = data.activeDraft;
        console.log(`[Poller] Checked draft: "${draft.title}". Status: "${draft.status}"`);
        
        if (draft.status !== 'processing') {
          clearInterval(pollingTimer);
          pollingTimer = null;
          
          // Restore text & release loading spinner!
          els.polishedWikitext.value = draft.polishedWikitext || '';
          updateCharCounts();
          triggerAiProcessingState(false);
          
          // Enable polished preview button
          safeSetDisabled(els.previewPolishedBtn, false);
          
          if (state.user.loggedIn && draft.polishedWikitext) {
            setPublishPanelEnabled(true);
          }
          
          showToast('পরিমার্জন সম্পন্ন', 'সার্ভার-সাইডে এআই সংশোধন সফলভাবে শেষ হয়েছে!', 'success');
          
          // Switch to polished tab on mobile screens
          if (window.innerWidth <= 768) {
            els.tabOriginalBtn.classList.remove('active');
            els.tabPolishedBtn.classList.add('active');
            els.originalPane.classList.remove('active');
            els.polishedPane.classList.add('active');
          }
        }
      } else {
        // Active draft cleared
        clearInterval(pollingTimer);
        pollingTimer = null;
        triggerAiProcessingState(false);
      }
    } catch (err) {
      console.error('[Poller] Error polling draft status:', err);
    }
  }, 2000); // Poll every 2 seconds
}

// Utility to switch frontend AI trigger button states
function triggerAiProcessingState(isProcessing) {
  state.isProcessingAi = isProcessing;
  
  const correctAiBtn = els.correctAiBtn;
  const mobileCorrectAiBtn = document.getElementById('mobileCorrectAiBtn');
  
  if (isProcessing) {
    if (correctAiBtn) {
      correctAiBtn.disabled = true;
      correctAiBtn.classList.add('btn-pulse-active');
      const icon = correctAiBtn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.innerText = 'autorenew';
        icon.classList.add('animate-spin');
      }
      const label = correctAiBtn.querySelector('.group-hover\\:opacity-100');
      if (label) {
        label.innerText = 'Busy';
        label.classList.remove('opacity-0');
      }
    }
    
    if (mobileCorrectAiBtn) {
      mobileCorrectAiBtn.disabled = true;
      mobileCorrectAiBtn.innerHTML = `
        <span class="material-symbols-outlined text-xl animate-spin">autorenew</span>
        <span>পরিমার্জন হচ্ছে...</span>
      `;
    }
  } else {
    if (correctAiBtn) {
      correctAiBtn.disabled = false;
      correctAiBtn.classList.remove('btn-pulse-active');
      const icon = correctAiBtn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.innerText = 'auto_fix_high';
        icon.classList.remove('animate-spin');
      }
      const label = correctAiBtn.querySelector('.group-hover\\:opacity-100');
      if (label) {
        label.innerText = 'Magic';
        label.classList.add('opacity-0');
      }
    }
    
    if (mobileCorrectAiBtn) {
      mobileCorrectAiBtn.disabled = false;
      mobileCorrectAiBtn.innerHTML = `
        <span class="material-symbols-outlined text-xl" style="font-variation-settings: 'FILL' 1;">auto_fix_high</span>
        <span>এআই সংশোধন শুরু করুন</span>
      `;
    }
  }
}

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
async function init() {
  initDarkMode();
  parseURLParams();
  await checkAuthStatus();
  if (state.user.loggedIn) {
    checkKeyStatus();
    loadSuggestedArticles();
    checkActiveDraftProgress(); // Restore any unfinished session draft or active AI job
  }
}

// Start app
window.addEventListener('DOMContentLoaded', init);
