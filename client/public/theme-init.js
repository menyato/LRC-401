/* Applies the saved theme before first paint — see the comment in index.html. */
(function () {
  try {
    var stored = localStorage.getItem('lrc-theme') || 'system';
    var dark =
      stored === 'dark' ||
      (stored === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    /* Storage blocked — light mode is a safe default. */
  }
})();
