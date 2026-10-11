/* =============================================================================
 * i18n.js — which language swirls speaks, and every word it says.
 *
 * Bokmål first and English second, switchable live from the language row in
 * the one panel, which is also the title screen — so the stranger who cannot
 * read the Norwegian swirls opened in finds the row before casting anything.
 * The contract is the hub's (CLAUDE.md §2, "Two languages, Norwegian first")
 * and the mechanism is kitchens' js/i18n.js with its three differences:
 *
 *   - NORWEGIAN OUTRIGHT when nothing valid is stored. No navigator.language
 *     sniffing; an English speaker is one tap from English.
 *   - ONE KEY FOR THE WHOLE HUB, `arcade.lang.v1`, holding "nb" or "en" and
 *     nothing else. A language is a fact about the player, not the cabinet,
 *     so this is the one key in swirls without the slug in front of it.
 *   - THE EVENT IS `arcade:lang`, dispatched on document with the language as
 *     `detail`. screen.js listens for it with a two-word table of its own,
 *     because it is self-contained and reads nothing from here.
 *
 * A CLASSIC SCRIPT ON window.I18N, not a module: swirls has always run on
 * classic scripts on one global and §2 says to leave games of that vintage
 * that way. It is loaded synchronously in <head>, before anything that
 * speaks, so <html lang> is right before the first paint; index.html then
 * calls paintStatic() inline straight after the markup, before the long parse
 * of effects.js, so the page never shows a word in the wrong language.
 *
 * The markup's own text is the Norwegian, so a swirls that somehow lost this
 * file still opens in the default language rather than in a third state.
 *
 * WHAT IS NOT HERE: the name swirls (it is the wordmark), the manifest (one
 * language, read by the arcade card), console output and storage keys.
 * ========================================================================== */
(function () {
  'use strict';

  var KEY = 'arcade.lang.v1';
  var DEFAULT = 'nb';

  function valid(l) { return l === 'nb' || l === 'en'; }

  /* Lower case throughout, because swirls writes in lower case — the menu
   * words are the hub's glossary ("lyd", "musikk", "tilbake til arkaden") in
   * this game's case. The twelve names are the game's own and are translated
   * as names rather than word for word: a Norwegian child should hear
   * "blomsterdryss", not "kronbladfall". */
  var STRINGS = {
    nb: {
      'menu': 'meny',
      'menu.dialog': 'meny',
      'mute.on': 'slå av lyden',
      'mute.off': 'slå på lyden',
      'mute.key': function (label) { return label + ' (m)'; },
      'prev': 'forrige virvel',
      'next': 'neste virvel',
      'ring': 'virvel',
      'hint': 'trykk eller dra for å trylle · hold inne for å lade opp · ‹ › bytt virvel',
      'sound': 'lyd',
      'music': 'musikk',
      'effects': 'effekter',
      'sound.note': 'swirls starter helt stille. skru opp musikk for å høre melodien, og effekter for å høre hver gang du tryller.',
      'lang': 'språk',
      'lang.group': 'språk',
      /* The one capital letter in swirls: the way out is the same object in
         every cabinet of the hub, words and case included (CLAUDE.md §2,
         "One button, and it looks and behaves the same in every game"). */
      'exit.arcade': 'Tilbake til arkaden',
      'exit.close': 'Lukk',
      'exit.refused': 'Lukk denne fanen selv',
      'error': 'fant ingen virvler',
      'effectN': function (n) { return 'virvel ' + n; },
      'fx.drift-tide': 'flo og fjære',
      'fx.ember-breath': 'glødepust',
      'fx.aurora-veil': 'nordlysslør',
      'fx.still-orbits': 'stille baner',
      'fx.night-pond': 'nattdam',
      'fx.verdant-surge': 'grønn vekst',
      'fx.petal-fall': 'blomsterdryss',
      'fx.opal-rise': 'stigende opal',
      'fx.firefly-meadow': 'ildflueeng',
      'fx.dusk-fountain': 'skumringsfontene',
      'fx.ink-eddy': 'blekkvirvel',
      'fx.stone-rill': 'steinbekk'
    },
    en: {
      'menu': 'menu',
      'menu.dialog': 'menu',
      'mute.on': 'mute',
      'mute.off': 'unmute',
      'mute.key': function (label) { return label + ' (m)'; },
      'prev': 'previous effect',
      'next': 'next effect',
      'ring': 'effect',
      'hint': 'tap or drag to cast · hold to charge · ‹ › change mode',
      'sound': 'sound',
      'music': 'music',
      'effects': 'effects',
      'sound.note': 'swirls starts silent. bring music up for the theme, effects up and every cast rings.',
      'lang': 'language',
      'lang.group': 'language',
      'exit.arcade': 'Back to arcade',
      'exit.close': 'Close',
      'exit.refused': 'Close this tab yourself',
      'error': 'no effects loaded',
      'effectN': function (n) { return 'effect ' + n; },
      'fx.drift-tide': 'drift tide',
      'fx.ember-breath': 'ember breath',
      'fx.aurora-veil': 'aurora veil',
      'fx.still-orbits': 'still orbits',
      'fx.night-pond': 'night pond',
      'fx.verdant-surge': 'verdant surge',
      'fx.petal-fall': 'petal fall',
      'fx.opal-rise': 'opal rise',
      'fx.firefly-meadow': 'firefly meadow',
      'fx.dusk-fountain': 'dusk fountain',
      'fx.ink-eddy': 'ink eddy',
      'fx.stone-rill': 'stone rill'
    }
  };

  function initial() {
    try {
      var saved = window.localStorage.getItem(KEY);
      if (valid(saved)) return saved;
    } catch (e) { /* no storage: the default applies */ }
    return DEFAULT;
  }

  var lang = initial();
  document.documentElement.lang = lang;

  var warned = {};

  /** The current language, else English, else the key itself — warned once. */
  function t(key) {
    var v = STRINGS[lang][key];
    if (v === undefined) v = STRINGS.en[key];
    if (v === undefined) {
      if (!warned[key]) {
        warned[key] = true;
        if (window.console && console.warn) console.warn('swirls i18n: missing key', key);
      }
      return key;
    }
    if (typeof v === 'function') return v.apply(null, Array.prototype.slice.call(arguments, 1));
    return v;
  }

  function getLang() { return lang; }

  /* Every [data-i18n] gets its text, every [data-i18n-label] its aria-label
   * and title, and the two language buttons say which one is chosen. */
  function paintStatic(root) {
    root = root || document;
    var i, el, nodes;
    nodes = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    nodes = root.querySelectorAll('[data-i18n-label]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      var label = t(el.getAttribute('data-i18n-label'));
      el.setAttribute('aria-label', label);
      el.title = label;
    }
    nodes = root.querySelectorAll('[data-set-lang]');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('aria-pressed', String(nodes[i].getAttribute('data-set-lang') === lang));
    }
  }

  /* Live, and nothing else moves: no reload, no restart, the panel stays
   * open and focus stays on the button that was pressed. main.js and
   * screen.js repaint what they draw themselves off the event. */
  function setLang(next) {
    if (!valid(next)) return;
    lang = next;
    document.documentElement.lang = lang;
    try { window.localStorage.setItem(KEY, lang); } catch (e) { /* this visit still switches */ }
    paintStatic(document);
    var ev;
    try {
      ev = new CustomEvent('arcade:lang', { detail: lang });
    } catch (e) {
      ev = document.createEvent('CustomEvent');
      ev.initCustomEvent('arcade:lang', false, false, lang);
    }
    document.dispatchEvent(ev);
  }

  // One delegated listener rather than one per button, so it holds for any
  // copy of the row and needs nothing from main.js — which may have bailed.
  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-set-lang]') : null;
    if (target) setLang(target.getAttribute('data-set-lang'));
  });

  window.I18N = { t: t, getLang: getLang, setLang: setLang, paintStatic: paintStatic };
})();
