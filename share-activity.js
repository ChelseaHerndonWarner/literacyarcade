(function () {
  const PARAM = 'activity';
  const LEGACY_PARAM = 'la_share';
  const PUBLIC_ORIGIN = 'https://literacyarcade.com';
  const REGISTRY = new Map();

  function encode(data) {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function decode(value) {
    if (!value) return null;
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function baseUrl(config) {
    const path = window.location.pathname.split('/').pop() || 'index.html';
    const isLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
    if (window.location.protocol === 'file:') return `${config.publicOrigin || PUBLIC_ORIGIN}/${path}`;
    if (isLocal) return `${window.location.origin}/${path}`;
    return `${config.publicOrigin || window.location.origin}${window.location.pathname}`;
  }

  function sharedUrl(activity, config) {
    const url = new URL(baseUrl(config || {}));
    url.searchParams.set(PARAM, activity.shareId || encode(activity));
    url.hash = '';
    return url.toString();
  }

  function copyText(text, statusEl) {
    const setStatus = msg => {
      if (!statusEl) return;
      statusEl.textContent = msg;
      window.clearTimeout(statusEl._timer);
      statusEl._timer = window.setTimeout(() => { statusEl.textContent = ''; }, 2200);
    };

    const fallbackCopy = () => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      setStatus(copied ? 'Copied' : 'Select the field and copy manually');
    };

    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
        .then(() => setStatus('Copied'))
        .catch(fallbackCopy);
    }

    fallbackCopy();
    return Promise.resolve();
  }

  function ensureStyles() {
    if (document.getElementById('laShareStyles')) return;
    const style = document.createElement('style');
    style.id = 'laShareStyles';
    style.textContent = `
      .la-share-btn{display:inline-flex;align-items:center;gap:6px;border:1.5px solid #087A70;background:#D9F8F5;border-radius:8px;padding:6px 13px;font-size:12px;font-weight:800;color:#087A70;cursor:pointer;font-family:Lexend,Nunito,Arial,sans-serif;transition:all .13s;white-space:nowrap}
      .la-share-btn:hover{background:#2EC4B6;color:#fff;transform:translateY(-1px)}
      .la-share-btn svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
      .la-share-overlay{position:fixed;inset:0;background:rgba(27,42,74,.42);display:none;align-items:center;justify-content:center;padding:18px;z-index:10000}
      .la-share-overlay.open{display:flex}
      .la-share-modal{width:min(520px,100%);background:#fff;border-radius:14px;box-shadow:0 18px 60px rgba(27,42,74,.25);border:1px solid rgba(27,42,74,.12);overflow:hidden;color:#1B2A4A;font-family:Lexend,Nunito,Arial,sans-serif}
      .la-share-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #E1E4EA}
      .la-share-title{font-family:Nunito,Lexend,Arial,sans-serif;font-size:20px;font-weight:900;line-height:1.1}
      .la-share-close{width:34px;height:34px;border:1px solid #E1E4EA;background:#fff;border-radius:8px;cursor:pointer;font-size:22px;line-height:1;color:#4B5875}
      .la-share-body{padding:18px;display:flex;flex-direction:column;gap:12px}
      .la-share-field{display:flex;flex-direction:column;gap:6px}
      .la-share-label{font-size:12px;font-weight:800;color:#4B5875}
      .la-share-input{width:100%;border:1.5px solid #D5DAE4;border-radius:9px;padding:10px 11px;font:600 12px Lexend,Nunito,Arial,sans-serif;color:#1B2A4A;background:#FBFCFE}
      .la-share-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}
      .la-share-action{border:0;border-radius:9px;min-height:40px;padding:9px 12px;font:900 13px Nunito,Lexend,Arial,sans-serif;cursor:pointer;background:#087A70;color:#fff}
      .la-share-action.secondary{background:#fff;color:#087A70;border:1.5px solid #2EC4B6}
      .la-share-action.disabled{background:#F4F6F8;color:#6B7A99;border:1.5px solid #D5DAE4}
      .la-share-note{font-size:12px;line-height:1.45;color:#4B5875}
      .la-share-status{min-height:16px;font-size:12px;font-weight:800;color:#087A70}
      .la-share-login-text{font-size:14px;line-height:1.5;color:#4B5875}
      @media(max-width:560px){.la-share-actions{grid-template-columns:1fr}.la-share-modal{border-radius:12px}}
    `;
    document.head.appendChild(style);
  }

  function ensureShareModal() {
    ensureStyles();
    let overlay = document.getElementById('laShareOverlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'laShareOverlay';
    overlay.className = 'la-share-overlay';
    overlay.innerHTML = `
      <div class="la-share-modal" role="dialog" aria-modal="true" aria-labelledby="laShareTitle">
        <div class="la-share-head">
          <div class="la-share-title" id="laShareTitle">Share this game</div>
          <button class="la-share-close" type="button" aria-label="Close share dialog">&times;</button>
        </div>
        <div class="la-share-body">
          <div class="la-share-field">
            <label class="la-share-label" for="laShareLink">Student link</label>
            <input class="la-share-input" id="laShareLink" readonly>
          </div>
          <div class="la-share-actions">
            <button class="la-share-action" type="button" id="laCopyLink">Copy Link</button>
            <button class="la-share-action secondary" type="button" id="laCopyEmbed">Copy Embed Code</button>
          </div>
          <button class="la-share-action disabled" type="button" id="laClassroom">Google Classroom sharing coming soon</button>
          <div class="la-share-note">Students can open this link directly. No student login is required.</div>
          <div class="la-share-status" id="laShareStatus" aria-live="polite"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.classList.remove('open');
    overlay.querySelector('.la-share-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    return overlay;
  }

  function ensureLoginModal() {
    ensureStyles();
    let overlay = document.getElementById('laShareLoginOverlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'laShareLoginOverlay';
    overlay.className = 'la-share-overlay';
    overlay.innerHTML = `
      <div class="la-share-modal" role="dialog" aria-modal="true" aria-labelledby="laShareLoginTitle">
        <div class="la-share-head">
          <div class="la-share-title" id="laShareLoginTitle">Sign in to share this game</div>
          <button class="la-share-close" type="button" aria-label="Close sign in dialog">&times;</button>
        </div>
        <div class="la-share-body">
          <div class="la-share-login-text">Create a free teacher account or sign in to save and share this activity with students.</div>
          <div class="la-share-actions">
            <button class="la-share-action" type="button" id="laShareLoginBtn">Sign in / Create Account</button>
            <button class="la-share-action secondary" type="button" id="laShareCancelBtn">Cancel</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.classList.remove('open');
    overlay.querySelector('.la-share-close').addEventListener('click', close);
    overlay.querySelector('#laShareCancelBtn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    return overlay;
  }

  function openLoginModal(config) {
    const overlay = ensureLoginModal();
    overlay.querySelector('#laShareLoginBtn').onclick = () => {
      if (typeof config.onLoginRequired === 'function') config.onLoginRequired();
      else window.location.href = 'teacher-login.html';
    };
    overlay.classList.add('open');
  }

  function openModal(activity, config) {
    const overlay = ensureShareModal();
    const link = sharedUrl(activity, config);
    const embed = `<iframe src="${link.replace(/"/g, '&quot;')}" width="100%" height="720" loading="lazy" title="${String(activity.title || 'Literacy Arcade activity').replace(/"/g, '&quot;')}"></iframe>`;
    overlay.querySelector('#laShareLink').value = link;
    overlay.querySelector('#laCopyLink').onclick = () => copyText(link, overlay.querySelector('#laShareStatus'));
    overlay.querySelector('#laCopyEmbed').onclick = () => copyText(embed, overlay.querySelector('#laShareStatus'));
    overlay.querySelector('#laClassroom').onclick = () => {
      overlay.querySelector('#laShareStatus').textContent = 'Google Classroom sharing is not connected yet.';
    };
    overlay.classList.add('open');
  }

  function makeButton(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'la-share-btn';
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6l6.8-4.2M8.6 13.4l6.8 4.2"/></svg><span>${label || 'Share this game'}</span>`;
    return btn;
  }

  function isAuthenticated(config) {
    if (typeof config.isAuthenticated === 'function') return Boolean(config.isAuthenticated());
    return config.requireAuth === false;
  }

  async function handleShareClick(config) {
    if (!isAuthenticated(config)) {
      openLoginModal(config);
      return;
    }

    const activity = await config.getActivity();
    if (!activity) return;

    const shareActivity = {
      version: 1,
      title: activity.title || document.title || 'Literacy Arcade Activity',
      toolType: config.toolType,
      words: activity.words || [],
      settings: activity.settings || {},
      savedActivityId: activity.savedActivityId || null,
      autoStart: activity.autoStart !== false
    };

    const saved = typeof config.saveActivity === 'function'
      ? await config.saveActivity(shareActivity)
      : shareActivity;

    openModal(Object.assign(shareActivity, saved || {}), config);
  }

  function mountButton(config) {
    const target = typeof config.mount === 'string' ? document.querySelector(config.mount) : config.mount;
    if (!target || document.getElementById(config.buttonId || 'shareActivityBtn')) return;
    const btn = makeButton(config.buttonLabel);
    btn.id = config.buttonId || 'shareActivityBtn';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const originalText = btn.querySelector('span')?.textContent || '';
      const label = btn.querySelector('span');
      if (label && isAuthenticated(config)) label.textContent = 'Preparing link...';
      try {
        await handleShareClick(config);
      } catch (err) {
        console.error('Share Activity error:', err);
        alert('This activity could not be shared. Please try again.');
      } finally {
        btn.disabled = false;
        if (label) label.textContent = originalText || 'Share this game';
      }
    });
    target.appendChild(btn);
  }

  function getPayload() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(PARAM) || params.get(LEGACY_PARAM);
    if (!raw) return null;
    try { return decode(raw); } catch (err) {
      console.warn('Could not read shared Literacy Arcade activity.', err);
      return null;
    }
  }

  function getActivityParam() {
    const params = new URLSearchParams(window.location.search);
    return params.get(PARAM) || params.get(LEGACY_PARAM) || '';
  }

  function register(config) {
    if (!config || !config.toolType) return;
    REGISTRY.set(config.toolType, config);
    ensureStyles();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => mountButton(config), { once: true });
    } else {
      mountButton(config);
    }

    const rawActivity = getActivityParam();
    if (rawActivity && typeof config.loadActivity === 'function') {
      const load = async () => {
        let activity = getPayload();
        if (!activity && typeof config.loadSharedActivity === 'function') {
          activity = await config.loadSharedActivity(rawActivity);
        }
        if (activity && activity.toolType === config.toolType) config.loadActivity(activity);
      };
      if (document.readyState === 'complete') setTimeout(load, config.loadDelay || 120);
      else window.addEventListener('load', () => setTimeout(load, config.loadDelay || 120), { once: true });
    }
  }

  window.LiteracyArcadeShare = { register, getPayload, sharedUrl, encode, decode };
})();
