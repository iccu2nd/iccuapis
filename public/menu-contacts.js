(() => {
  'use strict';

  function applyLink(id, url) {
    const el = document.getElementById(id);
    if (!el) return;
    if (url) {
      el.href = url;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const waItem = document.getElementById('waChannelMenuItem');
    const ownerItem = document.getElementById('ownerContactMenuItem');
    if (!waItem && !ownerItem) return;

    fetch('/manifest.json', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        const links = data?.result?.links || {};
        applyLink('waChannelMenuItem', links.whatsappChannel);
        applyLink('ownerContactMenuItem', links.ownerContact);
      })
      .catch(() => {
        applyLink('waChannelMenuItem', null);
        applyLink('ownerContactMenuItem', null);
      });
  });
})();
