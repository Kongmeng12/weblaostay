/**
 * Turns CMS page bodies into HTML that is safe to insert.
 *
 * The pages are written by an admin in a plain textarea, and they write HTML —
 * headings, paragraphs, lists. Rendering that as text put literal `<h2>` and
 * `<p>` in front of every visitor reading the terms of service, so it has to be
 * interpreted. But `dangerouslySetInnerHTML` over whatever a textarea contained
 * is how a stored `<script>` becomes every reader's problem, and this app's one
 * privileged screen writes to it.
 *
 * So: an allowlist, not a blocklist. Anything not named below is dropped, which
 * makes the failure mode "a tag did not render" rather than "a tag ran". No
 * dependency — the same reasoning as the hand-written QR encoder: a sanitiser is
 * a security boundary, and one npm advisory away from being the reason a page
 * ships something it should not.
 *
 * Deliberately no `img`, no `iframe`, no `style`, no `class`, no event
 * attributes. `a` keeps only an href, and only one that cannot execute.
 */

/** Tags that survive. Everything else is unwrapped to its text. */
const ALLOWED = new Set([
  'p',
  'br',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'a',
  'blockquote',
  'hr',
]);

/** Schemes an `href` may use. `javascript:` and `data:` are the reason. */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i;

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Whether the body looks like markup at all.
 *
 * A page written as plain text with blank lines between paragraphs must keep
 * rendering the way it always has — running it through the sanitiser would
 * collapse its line breaks, because in HTML a newline is just whitespace.
 */
export function looksLikeHtml(body: string): boolean {
  return /<\/?(p|h[2-4]|ul|ol|li|strong|em|b|i|a|br|blockquote|hr)\b[^>]*>/i.test(body);
}

/**
 * Rewrites a body to contain only allowlisted tags.
 *
 * Parsing is done by the browser rather than by regex — a regex-based sanitiser
 * loses to malformed markup, and malformed markup is exactly what a textarea
 * produces. `DOMParser` builds an inert document: nothing loads, nothing runs,
 * scripts are parsed as elements and never executed.
 */
export function sanitiseHtml(body: string): string {
  if (typeof DOMParser === 'undefined') return escapeText(body);

  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');

  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(clean).join('');

    // `script` and `style` carry their payload as text, so unwrapping them the
    // way an unknown tag is unwrapped would print the payload onto the page.
    if (tag === 'script' || tag === 'style') return '';
    // Anything else unrecognised keeps its content and loses its box.
    if (!ALLOWED.has(tag)) return inner;

    if (tag === 'br' || tag === 'hr') return `<${tag}>`;

    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (!SAFE_HREF.test(href)) return inner;
      const safe = escapeText(href).replace(/"/g, '&quot;');
      // Every link here points off this page, and `noopener` keeps the opened
      // tab from reaching back through `window.opener`.
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }

    return `<${tag}>${inner}</${tag}>`;
  };

  return Array.from(doc.body.childNodes).map(clean).join('');
}
