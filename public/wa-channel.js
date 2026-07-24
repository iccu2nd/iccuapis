(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const item = document.getElementById('waChannelMenuItem');
    if (!item) return;

    fetch('/manifest.json', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        const link = data?.result?.links?.whatsappChannel;
        if (link) {
          item.href = link;
          item.hidden = false;
        } else {
          item.hidden = true;
        }
      })
      .catch(() => {
        item.hidden = true;
      });
  });
})();
