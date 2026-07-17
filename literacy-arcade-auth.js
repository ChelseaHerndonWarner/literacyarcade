import { auth, db } from './firebase-config.js';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CANONICAL_LOGIN_URL = 'https://literacyarcade.com/teacher-login.html';
const EMAIL_STORAGE_KEY = 'literacyArcadeEmailForSignIn';
const RETURN_STORAGE_KEY = 'literacyArcadePostLoginReturnTo';
const googleProvider = new GoogleAuthProvider();
let initialAuthStatePromise = null;

export function getEmailActionUrl() {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${window.location.origin}/teacher-login.html`;
  }
  return CANONICAL_LOGIN_URL;
}

function cleanPath(value) {
  const fallback = 'teacher-dashboard.html';
  if (!value) return fallback;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    const path = `${url.pathname.replace(/^\//, '')}${url.search}${url.hash}`;
    if (!path || path.startsWith('teacher-login.html')) return fallback;
    return path;
  } catch {
    const text = String(value).trim();
    if (!text || text.startsWith('http') || text.startsWith('//')) return fallback;
    return text.replace(/^\//, '') || fallback;
  }
}

function getReturnToFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('returnTo') || params.get('return') || '';
}

export function rememberPostLoginDestination(returnTo = '') {
  const destination = cleanPath(returnTo || getReturnToFromUrl());
  if (destination && destination !== 'teacher-dashboard.html') {
    localStorage.setItem(RETURN_STORAGE_KEY, destination);
  }
  return destination;
}

export function getPostLoginDestination() {
  if (sessionStorage.getItem('wordSpinnerPendingAuthSetup')) return 'reading-word-spinner.html';
  if (sessionStorage.getItem('sentenceSpinnerPendingAuthSetup')) return 'sentence-spinner.html';
  if (sessionStorage.getItem('readRacePendingAuthSetup')) return 'read-and-race.html';
  if (sessionStorage.getItem('magicWordRoadPendingAuthSetup')) return 'magic-word-road.html';
  if (sessionStorage.getItem('digitalReadingFlashcardsPendingAuthSetup')) return 'digital-reading-flashcards.html';
  if (sessionStorage.getItem('vocabularyFlashcardsPendingAuthSetup')) return 'vocabulary-flashcards.html';
  if (sessionStorage.getItem('pendingActivityData')) return 'phoneme-counter.html?autoSavePendingActivity=1';

  const urlReturnTo = getReturnToFromUrl();
  if (urlReturnTo) return cleanPath(urlReturnTo);

  const storedReturnTo = localStorage.getItem(RETURN_STORAGE_KEY);
  if (storedReturnTo) {
    localStorage.removeItem(RETURN_STORAGE_KEY);
    return cleanPath(storedReturnTo);
  }

  return 'teacher-dashboard.html';
}

export async function recordUserProfile(user) {
  if (!user) return;
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
    console.warn('Literacy Arcade user profile tracking was unavailable.', error);
  }
}

export async function signInWithGoogleProvider() {
  const result = await signInWithPopup(auth, googleProvider);
  await recordUserProfile(result.user);
  return result.user;
}

export async function signInWithEmailPassword(email, password) {
  const cleanEmail = String(email || '').trim();
  const result = await signInWithEmailAndPassword(auth, cleanEmail, password);
  await recordUserProfile(result.user);
  return result.user;
}

export async function createEmailPasswordAccount(email, password) {
  const cleanEmail = String(email || '').trim();
  const result = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  await recordUserProfile(result.user);
  return result.user;
}

export async function sendEmailPasswordReset(email) {
  const cleanEmail = String(email || '').trim();
  await sendPasswordResetEmail(auth, cleanEmail, {
    url: getEmailActionUrl(),
  });
  return cleanEmail;
}

export async function signOutCurrentUser() {
  await signOut(auth);
}

export function getEmailLinkErrorMessage(error) {
  const code = error?.code || '';
  if (
    code === 'auth/account-exists-with-different-credential' ||
    code === 'auth/credential-already-in-use'
  ) {
    return 'This email may already be connected to another sign-in method. Try Continue with Google to access your saved activities.';
  }
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/missing-password') return 'Enter your password.';
  if (code === 'auth/weak-password') return 'Use a password with at least 6 characters.';
  if (code === 'auth/email-already-in-use') return 'An account already exists for this email. Try signing in instead.';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'That email and password did not match. Check your password or create an account.';
  }
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a few minutes and try again.';
  if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
    return 'This sign-in link is expired or invalid. Please request a new email link.';
  }
  return 'Sign-in did not work. Please try again.';
}

export async function sendEmailMagicLink(email, options = {}) {
  const cleanEmail = String(email || '').trim();
  if (!cleanEmail) {
    const error = new Error('Enter your email address.');
    error.code = 'auth/invalid-email';
    throw error;
  }

  if (options.returnTo) rememberPostLoginDestination(options.returnTo);
  localStorage.setItem(EMAIL_STORAGE_KEY, cleanEmail);

  try {
    const methods = await fetchSignInMethodsForEmail(auth, cleanEmail);
    if (methods.includes('google.com') && !methods.includes('emailLink')) {
      const error = new Error('This email may already be connected to another sign-in method.');
      error.code = 'auth/account-exists-with-different-credential';
      throw error;
    }
  } catch (error) {
    if (error?.code === 'auth/account-exists-with-different-credential') throw error;
    console.warn('Could not check existing sign-in methods before sending an email link.', error);
  }

  const actionCodeSettings = {
    url: getEmailActionUrl(),
    handleCodeInApp: true,
  };
  console.info('Literacy Arcade email sign-in: sending link.', {
    email: cleanEmail,
    actionCodeSettings,
    authDomain: auth?.app?.options?.authDomain || '',
  });

  try {
    await sendSignInLinkToEmail(auth, cleanEmail, actionCodeSettings);
    console.info('Literacy Arcade email sign-in: Firebase accepted the email-link request.', {
      email: cleanEmail,
      actionUrl: actionCodeSettings.url,
    });
  } catch (error) {
    console.error('Literacy Arcade email sign-in: Firebase rejected the email-link request.', {
      code: error?.code || '',
      message: error?.message || '',
      actionCodeSettings,
      authDomain: auth?.app?.options?.authDomain || '',
    });
    throw error;
  }
  return cleanEmail;
}

export function hasEmailSignInLink(url = window.location.href) {
  return isSignInWithEmailLink(auth, url);
}

export async function completeEmailMagicLink(url = window.location.href, emailOverride = '') {
  if (!hasEmailSignInLink(url)) return null;
  const email = String(emailOverride || localStorage.getItem(EMAIL_STORAGE_KEY) || '').trim();
  if (!email) return { needsEmail: true };
  const result = await signInWithEmailLink(auth, email, url);
  localStorage.removeItem(EMAIL_STORAGE_KEY);
  await recordUserProfile(result.user);
  return { user: result.user };
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function waitForInitialAuthState() {
  if (!initialAuthStatePromise) {
    initialAuthStatePromise = new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          resolve(user);
        },
        (error) => {
          unsubscribe();
          const authError = new Error('Literacy Arcade authentication could not initialize.', { cause: error });
          authError.code = 'auth-initialization-failed';
          reject(authError);
        }
      );
    });
  }
  return initialAuthStatePromise;
}

export { auth, onAuthStateChanged };
