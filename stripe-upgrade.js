import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const SHOW_FOUNDING_OFFER = true;
const UNLOCKED_PLANS = new Set(['plus', 'founding']);
const DEFAULT_RETURN = 'teacher-dashboard.html';

const PRICE_TO_PLAN = {
  price_1TqmEK3PzX3bHrbQEkK6vaes: 'founding',
  price_1TqmEJ3PzX3bHrbQ2cWDevb5: 'plus',
  price_1TqmEM3PzX3bHrbQh3wylsSF: 'plus',
  price_1TqY6k4Gz51pZDtQR6oFrYDp: 'founding',
  price_1TqY5P4Gz51pZDtQOiymXQZ4: 'plus',
  price_1TqY444Gz51pZDtQmTMOq3Gv: 'plus',
};

let currentUser = null;
let currentPlan = 'free';
let planUnsubscribe = null;

const accountTitle = document.getElementById('accountTitle');
const accountText = document.getElementById('accountText');
const accountEmail = document.getElementById('accountEmail');
const planPill = document.getElementById('planPill');
const checkoutMessage = document.getElementById('checkoutMessage');
const checkoutButtons = Array.from(document.querySelectorAll('.checkout-button'));
const foundingOffer = document.querySelector('[data-founding-offer]');

if (foundingOffer && !SHOW_FOUNDING_OFFER) {
  foundingOffer.hidden = true;
}

checkoutButtons.forEach((button) => {
  button.dataset.defaultLabel = button.textContent;
});

function getReturnTo() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('returnTo') || params.get('return') || '';
  if (!raw) return DEFAULT_RETURN;

  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return DEFAULT_RETURN;
    const path = `${url.pathname.replace(/^\//, '')}${url.search}${url.hash}`;
    return path && !path.startsWith('teacher-login.html') ? path : DEFAULT_RETURN;
  } catch {
    if (raw.startsWith('http') || raw.startsWith('//')) return DEFAULT_RETURN;
    return raw.replace(/^\//, '') || DEFAULT_RETURN;
  }
}

function setMessage(text = '', type = '') {
  if (!checkoutMessage) return;
  checkoutMessage.textContent = text;
  checkoutMessage.className = 'checkout-message';
  if (text) checkoutMessage.classList.add('show');
  if (type) checkoutMessage.classList.add(type);
}

function setButtonsDisabled(disabled) {
  checkoutButtons.forEach((button) => {
    button.disabled = disabled;
    button.textContent = button.dataset.defaultLabel || 'Start checkout';
  });
}

function updateAccountUi(user, plan = 'free') {
  currentPlan = plan || 'free';

  if (!user) {
    accountTitle.textContent = 'Sign in before checkout';
    accountText.textContent = 'Your upgrade is connected to the Literacy Arcade account shown here. Saved activities are tied to the account used when they were created.';
    accountEmail.innerHTML = '<a href="teacher-login.html?returnTo=founding-teacher.html">Sign in to continue</a>';
    planPill.textContent = 'Free';
    setButtonsDisabled(true);
    return;
  }

  const email = user.email || 'Signed-in teacher';
  const unlocked = UNLOCKED_PLANS.has(currentPlan);
  accountTitle.textContent = unlocked ? 'Your account is upgraded' : 'Ready for checkout';
  accountText.textContent = unlocked
    ? 'This signed-in account already has unlimited saved and shared classroom activities.'
    : 'Choose a plan below. Checkout will open in Stripe and return you here when complete.';
  accountEmail.textContent = `Signed in as: ${email}`;
  planPill.textContent = currentPlan === 'founding' ? 'Founding' : currentPlan === 'plus' ? 'Plus' : 'Free';
  setButtonsDisabled(false);
}

function getCheckoutUrl(plan) {
  const url = new URL('founding-teacher.html', window.location.origin);
  url.searchParams.set('checkout', 'success');
  url.searchParams.set('plan', plan);
  const returnTo = getReturnTo();
  if (returnTo && returnTo !== DEFAULT_RETURN) url.searchParams.set('returnTo', returnTo);
  return url.toString();
}

function getCancelUrl() {
  const url = new URL('founding-teacher.html', window.location.origin);
  url.searchParams.set('checkout', 'cancel');
  const returnTo = getReturnTo();
  if (returnTo && returnTo !== DEFAULT_RETURN) url.searchParams.set('returnTo', returnTo);
  return url.toString();
}

function isLocalCheckoutHost() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function getButtonPriceId(button) {
  if (isLocalCheckoutHost() && button.dataset.testPriceId) {
    return button.dataset.testPriceId;
  }
  return button.dataset.priceId;
}

function addSuccessActions() {
  if (!checkoutMessage) return;
  const returnTo = getReturnTo();
  const canReturn = returnTo && returnTo !== DEFAULT_RETURN;
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.flexWrap = 'wrap';
  wrapper.style.gap = '10px';
  wrapper.style.marginTop = '12px';

  const dashboard = document.createElement('a');
  dashboard.className = 'btn btn-primary';
  dashboard.href = 'teacher-dashboard.html';
  dashboard.textContent = 'Go to Dashboard';
  wrapper.appendChild(dashboard);

  if (canReturn) {
    const returnLink = document.createElement('a');
    returnLink.className = 'btn btn-secondary';
    returnLink.href = returnTo;
    returnLink.textContent = 'Return to activity';
    wrapper.appendChild(returnLink);
  }

  checkoutMessage.appendChild(wrapper);
}

function watchPlan(user) {
  if (planUnsubscribe) planUnsubscribe();
  planUnsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
    const plan = snapshot.exists() ? snapshot.data().plan || 'free' : 'free';
    updateAccountUi(user, plan);

    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      if (UNLOCKED_PLANS.has(plan)) {
        setMessage(`Your Literacy Arcade account is now ${plan === 'founding' ? 'Founding' : 'Plus'}. Unlimited saves and shares are unlocked.`, 'success');
        addSuccessActions();
      } else {
        setMessage('Checking your upgrade… Stripe may take a moment to confirm your subscription.', '');
      }
    }
  }, () => {
    setMessage('We could not check your plan yet. Refresh this page in a moment.', 'error');
  });
}

async function startCheckout(button) {
  if (!currentUser) {
    window.location.href = 'teacher-login.html?returnTo=founding-teacher.html';
    return;
  }

  const priceId = getButtonPriceId(button);
  const expectedPlan = PRICE_TO_PLAN[priceId];
  if (!expectedPlan) {
    setMessage('This plan is not configured yet. Please choose another option.', 'error');
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Opening checkout…';
  setMessage('Creating your secure Stripe checkout…');

  try {
    const sessionRef = await addDoc(collection(db, 'customers', currentUser.uid, 'checkout_sessions'), {
      price: priceId,
      success_url: getCheckoutUrl(expectedPlan),
      cancel_url: getCancelUrl(),
      allow_promotion_codes: true,
      metadata: {
        firebaseUID: currentUser.uid,
        literacyArcadePlan: expectedPlan,
      },
    });

    const unsubscribe = onSnapshot(sessionRef, (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      if (data.error) {
        unsubscribe();
        button.disabled = false;
        button.textContent = originalText;
        setMessage(data.error.message || 'Stripe checkout could not be created. Please try again.', 'error');
      }
      if (data.url) {
        unsubscribe();
        window.location.assign(data.url);
      }
    });
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    setMessage(error?.message || 'Checkout could not start. Please try again.', 'error');
  }
}

checkoutButtons.forEach((button) => {
  button.addEventListener('click', () => startCheckout(button));
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!user) {
    if (planUnsubscribe) planUnsubscribe();
    updateAccountUi(null);
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      setMessage('Sign in with the account you used at checkout so we can confirm your upgrade.', 'error');
    } else if (params.get('checkout') === 'cancel') {
      setMessage('Checkout was canceled. You can keep using free tools or choose a plan anytime.');
    }
    return;
  }

  watchPlan(user);
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'cancel') {
    setMessage('Checkout was canceled. You can keep using free tools or choose a plan anytime.');
  }
});
