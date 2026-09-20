/* screen.js — the fullscreen toggle in swirls' top-right corner.
 *
 * SELF-CONTAINED ON PURPOSE. It reads one button out of the document and
 * talks to nothing else in the game; main.js does not know it exists and does
 * not need to. A generative toy that fails to find a single effect still
 * deserves the one control that makes it fill the screen, and keeping this
 * file independent of main.js is what guarantees that.
 *
 * A CLASSIC SCRIPT, like everything else here. swirls has always run on
 * classic scripts and hub CLAUDE.md §2 says to leave games of that vintage
 * alone — but it is worth saying that the choice pays for itself twice over
 * in this particular file, because a classic script cannot take a module
 * graph down with it when it fails to load.
 *
 * NOT NAMED fullscreen.js, and the word appears in no path in this repo.
 * uBlock Origin's default lists ban that basename across the whole of
 * github.io — adware is hosted there under that name — and the rule never
 * looks inside the file. It blanked fishtank for every visitor running uBlock
 * before anyone worked out why. See the hub's CLAUDE.md §2.
 *
 * SUPPORT IS NOT UNIVERSAL. Safari on iPhone has no element fullscreen at
 * all; it reserves the whole idea for <video>. So the button is `hidden` in
 * the markup and this file is the only thing that ever un-hides it, and only
 * after both halves of the pair have answered. A button that does nothing
 * when pressed is worse than no button — the corner simply comes out one icon
 * narrower, which nothing else has to know about.
 *
 * Escape and the browser's own chrome leave fullscreen without ever touching
 * this button, so the glyph and aria-pressed are repainted from the
 * fullscreenchange event rather than only from the click handler.
 */
(function () {
  'use strict';

  var button = document.getElementById('screen-toggle');
  if (!button) return;

  var root = document.documentElement;
  // The webkit-prefixed pair is older Safari; everywhere else swirls runs,
  // the unprefixed names are the ones that exist.
  var request = root.requestFullscreen || root.webkitRequestFullscreen || null;
  var exit = document.exitFullscreen || document.webkitExitFullscreen || null;
  if (!request || !exit) return;

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  /* The label is the only thing that tells a screen reader which way this
     toggle is currently pointing — the picture is swapped by CSS off the same
     aria-pressed, so the two cannot drift.

     Plain words, against this game's habit of speaking in lower case about
     casting and swirling. Fullscreen is not part of the fiction: it is a
     thing the browser does, it has one name everywhere, and the player
     already knows it. */
  function paint() {
    var active = isFullscreen();
    var label = active ? 'exit fullscreen' : 'fullscreen';
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  button.hidden = false;
  paint();

  button.addEventListener('click', function () {
    var result = isFullscreen() ? exit.call(document) : request.call(root);
    // Either call returns a promise that can reject — a permissions policy
    // refusing it, or the player backing out of the browser's own prompt.
    // paint() via fullscreenchange already reports whatever actually
    // happened, so this exists only to keep a refusal from surfacing as an
    // unhandled rejection.
    if (result && typeof result.catch === 'function') result.catch(function () {});
    button.blur();
  });

  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
})();
