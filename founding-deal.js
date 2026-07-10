const FOUNDING_DEAL_END_AT = '2026-07-14T23:59:59-05:00';

const countdownNodes = Array.from(document.querySelectorAll('[data-founding-countdown]'));
const dealEndTime = new Date(FOUNDING_DEAL_END_AT).getTime();
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function formatCountdown(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

function updateFoundingCountdowns() {
  if (!countdownNodes.length || !Number.isFinite(dealEndTime)) return;

  const remaining = Math.max(0, dealEndTime - Date.now());

  countdownNodes.forEach((node) => {
    if (remaining <= 0) {
      node.textContent = node.dataset.expiredText || 'Founding Teacher deal has ended';
      node.classList.add('is-expired');
      return;
    }

    const prefix = node.dataset.countdownPrefix || 'Ends in:';
    node.textContent = `${prefix} ${formatCountdown(remaining)}`;
    node.classList.remove('is-expired');
  });
}

updateFoundingCountdowns();
setInterval(updateFoundingCountdowns, 60000);

function highlightFoundingPlan() {
  if (reducedMotionQuery.matches) return;

  const foundingPlan = document.querySelector('.plan-card.founding');
  if (!foundingPlan) return;

  foundingPlan.classList.remove('plan-scroll-highlight');
  void foundingPlan.offsetWidth;
  foundingPlan.classList.add('plan-scroll-highlight');
  window.setTimeout(() => {
    foundingPlan.classList.remove('plan-scroll-highlight');
  }, 1700);
}

document.querySelectorAll('[data-scroll-to-plans]').forEach((link) => {
  link.addEventListener('click', () => {
    if (window.location.hash === '#plus-plans') {
      window.setTimeout(highlightFoundingPlan, reducedMotionQuery.matches ? 0 : 120);
    }
  });
});

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#plus-plans') {
    window.setTimeout(highlightFoundingPlan, reducedMotionQuery.matches ? 0 : 120);
  }
});

if (window.location.hash === '#plus-plans') {
  window.setTimeout(highlightFoundingPlan, 250);
}
