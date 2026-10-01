/*
 * touch-guard.js — stop the browser treating swirls as a page of text.
 *
 * swirls is all drag: a cast is a finger pulled across the canvas, and on a
 * tablet a thumb resting near the wordmark, the family names round the mark
 * or the sound panel's labels is a long press, while a drag that starts on
 * one of them is a text selection — Safari highlights words and offers
 * Copy / Look Up over the swirl. The inline styles in index.html turn
 * selection and the callout off; this is the half CSS cannot promise, for
 * the engines and the edges where it is not honoured:
 *
 *   selectstart   cancelled unless it begins in a real text field
 *   contextmenu   cancelled likewise — on touch it IS the long-press menu
 *   selectionchange  anything that slipped through anyway is cleared, unless
 *                 a field has focus (none ships today; the day one does, a
 *                 player must still be able to select what they typed)
 *
 * The cost, written down: no right-click menu over the toy on desktop
 * either. Nothing in it wants one, and devtools stay a keystroke away.
 *
 * A classic script, self-contained, touching no global but the document, so
 * it sits beside main.js rather than inside it: a failure there must not
 * take this down, and this must not take anything else down. Copied from
 * lobbots/js/touch-guard.js, the hub reference.
 */
(function () {
  'use strict';

  function editable(node) {
    return !!(node && node.closest && node.closest('input, textarea, select, [contenteditable="true"]'));
  }

  document.addEventListener('selectstart', function (e) {
    if (!editable(e.target)) e.preventDefault();
  });

  document.addEventListener('contextmenu', function (e) {
    if (!editable(e.target)) e.preventDefault();
  });

  document.addEventListener('selectionchange', function () {
    if (editable(document.activeElement)) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges();
  });
})();
