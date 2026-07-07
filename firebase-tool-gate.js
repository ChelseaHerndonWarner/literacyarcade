import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getEmailLinkErrorMessage,
  rememberPostLoginDestination,
  sendEmailMagicLink,
  signInWithGoogleProvider,
} from './literacy-arcade-auth.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const body = document.body;
const toolId = body.dataset.toolId || location.pathname.split('/').pop().replace(/\.html$/i, '') || 'literacy-tool';
const toolName = body.dataset.toolName || 'Literacy Arcade Tool';

let currentUser = null;
let authorizedUid = null;
let currentSessionId = null;
let gateElement = null;
let authReadyResolve;
let pendingAccessPromise = null;
let pendingAccessResolve = null;
const authReady = new Promise((resolve) => { authReadyResolve = resolve; });

function googleMark() {
  return `<svg class="la-auth-google-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.57-.14-3.08-.41-4.55H24v9.1h12.62c-.54 2.9-2.18 5.36-4.65 7.01l7.18 5.57C43.35 37.76 46.5 31.57 46.5 24.5z"/><path fill="#FBBC05" d="M10.54 28.59A14.43 14.43 0 0 1 9.75 24c0-1.59.28-3.14.79-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.92 7.53 2.56 10.78l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.47 0 11.9-2.13 15.87-5.78l-7.18-5.57c-2 1.34-4.55 2.13-8.69 2.13-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
}

function renderGate({ error = '' } = {}) {
  body.classList.add('la-auth-gate-open');
  if (!gateElement) {
    gateElement = document.createElement('main');
    gateElement.className = 'la-auth-gate';
    gateElement.setAttribute('role', 'dialog');
    gateElement.setAttribute('aria-modal', 'true');
    gateElement.setAttribute('aria-live', 'polite');
    body.appendChild(gateElement);
  }

  gateElement.innerHTML = `
    <section class="la-auth-gate-card" aria-labelledby="laAuthGateTitle">
      <button class="la-auth-gate-close" id="laAuthGateClose" type="button" aria-label="Return to game setup">×</button>
      <img class="la-auth-gate-mark" src="./apple-touch-icon.png" alt="Literacy Arcade">
      <h1 id="laAuthGateTitle">Create a free teacher account to use this fluency tool.</h1>
      <p class="la-auth-gate-copy">Sign in to open ${toolName}. Your account helps keep teacher tools and usage organized in one place.</p>
      <div class="la-auth-gate-actions">
        <button class="la-auth-provider-btn la-auth-google-btn" id="laAuthGoogleButton" type="button">
          ${googleMark()}
          <span>Continue with Google</span>
        </button>
        <div class="la-auth-email-panel">
          <label class="la-auth-email-label" for="laAuthEmailInput">Email address</label>
          <input class="la-auth-email-input" id="laAuthEmailInput" type="email" autocomplete="email" placeholder="teacher@example.com">
          <p class="la-auth-email-helper">We’ll email you a secure sign-in link. No password needed.</p>
          <button class="la-auth-provider-btn la-auth-email-btn" id="laAuthEmailButton" type="button">Continue with email</button>
        </div>
      </div>
      <div class="la-auth-gate-sent" id="laAuthGateSent" aria-live="polite"></div>
      <div class="la-auth-gate-error${error ? ' is-visible' : ''}" id="laAuthGateError">${error}</div>
      <p class="la-auth-gate-reminder">Saved activities are tied to the account you used when you created them. If your dashboard looks empty, try signing in with the same Google or email account you used before.</p>
      <p class="la-auth-gate-note">Free to use. Student accounts are not required.</p>
    </section>`;

  gateElement.querySelector('#laAuthGoogleButton').addEventListener('click', signInWithGoogle);
  gateElement.querySelector('#laAuthEmailButton').addEventListener('click', sendGateEmailLink);
  gateElement.querySelector('#laAuthGateClose').addEventListener('click', () => closeGate(null));
  gateElement.querySelector('#laAuthGoogleButton').focus();
}

function closeGate(result) {
  body.classList.remove('la-auth-gate-open');
  if (gateElement) {
    gateElement.remove();
    gateElement = null;
  }
  if (pendingAccessResolve) pendingAccessResolve(result);
  pendingAccessPromise = null;
  pendingAccessResolve = null;
}

async function recordUserDates(user) {
  try {
    const userRef = doc(db, 'users', user.uid);
    const snapshot = await getDoc(userRef);
    const creationDate = user.metadata.creationTime ? new Date(user.metadata.creationTime) : new Date();
    const lastLoginDate = user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime) : new Date();
    const userData = {
      displayName: user.displayName || '',
      email: user.email || '',
      lastLoginAt: lastLoginDate,
      lastSeenAt: serverTimestamp(),
    };
    if (!snapshot.exists()) userData.createdAt = creationDate;
    await setDoc(userRef, userData, { merge: true });
  } catch (error) {
    console.warn('Literacy Arcade user tracking was unavailable.', error);
  }
}

function cleanDetails(details) {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

async function track(eventName, details = {}) {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'usageEvents'), {
      eventName,
      toolId,
      toolName,
      pagePath: location.pathname,
      occurredAt: serverTimestamp(),
      ...cleanDetails(details),
    });
  } catch (error) {
    console.warn(`Literacy Arcade event tracking failed for ${eventName}.`, error);
  }
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

window.LiteracyArcadeToolTracking = {
  track,
  trackSessionStarted(details = {}) {
    currentSessionId = createSessionId();
    return track('repeated_reading_session_started', { sessionId: currentSessionId, ...details });
  },
  trackSessionCompleted(details = {}) {
    const sessionId = currentSessionId;
    currentSessionId = null;
    return track('reading_session_completed', { sessionId, ...details });
  },
};

async function authorize(user) {
  currentUser = user;
  body.dataset.authState = 'signed-in';
  closeGate(user);
  if (authorizedUid === user.uid) return;
  authorizedUid = user.uid;
  document.dispatchEvent(new CustomEvent('literacyarcade:tool-authorized', { detail: { user } }));
  await Promise.allSettled([
    recordUserDates(user),
    track('tool_opened'),
  ]);
}

async function requireSignIn() {
  await authReady;
  if (currentUser) return currentUser;
  if (!pendingAccessPromise) {
    pendingAccessPromise = new Promise((resolve) => { pendingAccessResolve = resolve; });
    renderGate();
  }
  return pendingAccessPromise;
}

window.LiteracyArcadeToolAccess = { requireSignIn };

function currentReturnTo() {
  return `${location.pathname.replace(/^\//, '')}${location.search}${location.hash}` || `${toolId}.html`;
}

async function signInWithGoogle() {
  const button = gateElement?.querySelector('#laAuthGoogleButton');
  const label = button?.querySelector('span');
  if (button) button.disabled = true;
  if (label) label.textContent = 'Signing in…';
  try {
    rememberPostLoginDestination(currentReturnTo());
    const user = await signInWithGoogleProvider();
    await authorize(user);
  } catch (error) {
    console.error(error);
    renderGate({ error: getEmailLinkErrorMessage(error) });
  }
}

async function sendGateEmailLink() {
  const button = gateElement?.querySelector('#laAuthEmailButton');
  const input = gateElement?.querySelector('#laAuthEmailInput');
  const sent = gateElement?.querySelector('#laAuthGateSent');
  const errorBox = gateElement?.querySelector('#laAuthGateError');
  if (errorBox) errorBox.classList.remove('is-visible');
  if (sent) sent.classList.remove('is-visible');
  if (button) {
    button.disabled = true;
    button.textContent = 'Sending link…';
  }
  try {
    const email = await sendEmailMagicLink(input?.value || '', { returnTo: currentReturnTo() });
    if (sent) {
      sent.textContent = `Check ${email} for your secure Literacy Arcade sign-in link.`;
      sent.classList.add('is-visible');
    }
  } catch (error) {
    console.error(error);
    renderGate({ error: getEmailLinkErrorMessage(error) });
  } finally {
    const nextButton = gateElement?.querySelector('#laAuthEmailButton');
    if (nextButton) {
      nextButton.disabled = false;
      nextButton.textContent = 'Continue with email';
    }
  }
}

onAuthStateChanged(auth, (user) => {
  authReadyResolve();
  if (user) {
    authorize(user);
  } else {
    currentUser = null;
    authorizedUid = null;
    currentSessionId = null;
    body.dataset.authState = 'signed-out';
  }
});
