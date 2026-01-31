const STYLE_ID = 'klaro-styles';

// Lucide icons as inline SVG
const ICON_LANGUAGES = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;

const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

const ICON_ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

const CSS = `
.klaro-mark {
  position: relative !important;
  border-bottom: 2px dotted #fbbf24 !important;
  background: rgba(251,191,36,0.1) !important;
}
.klaro-badge {
  position: absolute !important;
  top: -10px !important;
  right: -4px !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  height: 20px !important;
  padding: 0 8px !important;
  background: #18181b !important;
  color: #fafafa !important;
  border-radius: 9999px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  cursor: pointer !important;
  z-index: 999999 !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
  transition: background 0.15s !important;
  white-space: nowrap !important;
}
.klaro-badge:hover {
  background: #27272a !important;
}
.klaro-badge svg {
  flex-shrink: 0 !important;
}
.klaro-tooltip {
  position: absolute !important;
  top: -38px !important;
  right: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  height: 28px !important;
  padding: 0 12px !important;
  background: #18181b !important;
  color: #fafafa !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  white-space: nowrap !important;
  opacity: 0 !important;
  visibility: hidden !important;
  transition: opacity 0.15s !important;
  z-index: 9999999 !important;
  cursor: pointer !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
}
.klaro-badge:hover + .klaro-tooltip,
.klaro-tooltip:hover {
  opacity: 1 !important;
  visibility: visible !important;
}
.klaro-tooltip:hover {
  background: #27272a !important;
}
.klaro-tooltip svg {
  flex-shrink: 0 !important;
}
.klaro-loading {
  opacity: 0.5 !important;
}
.klaro-simplified {
  background: #ecfdf5 !important;
  border-bottom: 2px solid #10b981 !important;
}
.klaro-simplified-badge {
  position: absolute !important;
  top: -10px !important;
  right: -4px !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  height: 20px !important;
  padding: 0 8px !important;
  background: #10b981 !important;
  color: #fff !important;
  border-radius: 9999px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  z-index: 999999 !important;
  white-space: nowrap !important;
}
.klaro-simplified-badge svg {
  flex-shrink: 0 !important;
}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function replaceTextOnly(el: Element, newText: string) {
  const textNodes = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
  if (textNodes.length === 0) {
    el.insertBefore(document.createTextNode(newText + ' '), el.firstChild);
    return;
  }
  textNodes[0].textContent = newText;
  for (let i = 1; i < textNodes.length; i++) {
    textNodes[i].textContent = '';
  }
}

async function simplifyText(text: string): Promise<string> {
  const key = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '';
  if (!key) return text;
  
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Vereinfache in Einfache Sprache (kurze Sätze, einfache Wörter). NUR den vereinfachten Text ausgeben:\n\n${text}` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
    })
  });
  
  if (!res.ok) return text;
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
}

async function handleTransform(el: HTMLElement, badge: HTMLElement, tooltip: HTMLElement) {
  const originalText = el.textContent?.trim() || '';
  
  badge.remove();
  tooltip.remove();
  el.classList.remove('klaro-mark');
  el.classList.add('klaro-loading');
  
  try {
    const simplified = await simplifyText(originalText);
    el.classList.remove('klaro-loading');
    el.classList.add('klaro-simplified');
    replaceTextOnly(el, simplified);
    
    const doneBadge = document.createElement('span');
    doneBadge.className = 'klaro-simplified-badge';
    doneBadge.innerHTML = `${ICON_CHECK} Einfach`;
    el.appendChild(doneBadge);
  } catch {
    el.classList.remove('klaro-loading');
  }
}

export function markAllText() {
  injectStyles();
  
  const selectors = [
    'p',
    'article h1, article h2, article h3',
    '.titleline > a',
    'a[href^="http"]:not([href*="vote"])',
    'blockquote',
    'figcaption',
    '.comment-text',
    '[class*="content"] > p',
    '[class*="post"] > p',
  ].join(', ');
  
  const seen = new Set<Element>();
  let count = 0;
  
  document.querySelectorAll(selectors).forEach(el => {
    if (seen.has(el)) return;
    seen.add(el);
    
    const text = el.textContent?.trim();
    if (!text || text.length < 15 || text.length > 500) return;
    if (el.closest('.klaro-mark, .klaro-simplified, nav, header, footer')) return;
    if ((el as HTMLElement).offsetParent === null) return;
    if (el.querySelector('input, button, select, img, svg')) return;
    
    const htmlEl = el as HTMLElement;
    if (getComputedStyle(htmlEl).position === 'static') {
      htmlEl.style.position = 'relative';
    }
    
    el.classList.add('klaro-mark');
    
    const badge = document.createElement('span');
    badge.className = 'klaro-badge';
    badge.innerHTML = `${ICON_LANGUAGES} DE`;
    
    const tooltip = document.createElement('span');
    tooltip.className = 'klaro-tooltip';
    tooltip.innerHTML = `${ICON_ARROW} Einfache Sprache`;
    tooltip.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleTransform(htmlEl, badge, tooltip);
    };
    
    badge.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleTransform(htmlEl, badge, tooltip);
    };
    
    el.appendChild(badge);
    el.appendChild(tooltip);
    count++;
  });
  
  console.log('[Klaro] Marked', count, 'text elements');
}

export function removeMarks() {
  document.querySelectorAll('.klaro-mark, .klaro-simplified').forEach(el => {
    el.classList.remove('klaro-mark', 'klaro-simplified');
    el.querySelectorAll('.klaro-badge, .klaro-tooltip, .klaro-simplified-badge').forEach(b => b.remove());
  });
  document.getElementById(STYLE_ID)?.remove();
}
