// Runs before the page first paints (the one script that isn't deferred, and the only code outside
// data/ that looks at the browser's storage, docs/web-architecture.md). A device that keeps a sign-in
// shows the frame and "Loading…" while the app starts; one that doesn't shows the welcome the build
// drew into the page (web/ui/pages/welcome.js), which the app's first screen then draws in its place.
// It only asks whether a sign-in is kept, never reads one.
(function () {
  var member = true;
  try {
    member = Object.keys(localStorage).some(function (k) { return /^sb-.+-auth-token$/.test(k); })
      || !!sessionStorage.getItem('mh_preview_session');
  } catch (_) { /* storage blocked: show "Loading…", never the wrong screen */ }
  if (member) document.documentElement.classList.add('member');
})();
