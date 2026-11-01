// Registers the service worker that makes electrosparkzz.in installable and offline-capable.
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (err) {
      console.warn('Service worker not registered:', err);
    });
  });
})();
