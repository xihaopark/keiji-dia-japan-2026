/* Interface language: one toggle between the Chinese and English interface.
   Pages render Chinese; in English mode visible interface text is translated in place with
   a phrase table (longest phrase first). Agent replies, study decision values, data tables,
   reports and user input are never translated; reports stay in their own language (English). */
const I18N_STORAGE_KEY = 'eragent:language';
const I18N_SKIP = '[data-i18n-skip], .conversation-markdown, .turn-message, .agent-summary, .hub-value, .hub-basis > p, '
  + '.decision-value, .decision-basis > p, .proposal-item strong, .proposal-item p, .live-table td, '
  + '.data-table td, .readiness-card li, .candidate-findings li, .endpoint-row strong, pre, code, textarea, iframe, script, style';
const I18N_ATTRIBUTES = ['placeholder', 'title', 'aria-label'];
const I18N_PUNCTUATION = [['，', ', '], ['。', '. '], ['：', ': '], ['；', '; '], ['、', ', '], ['（', ' ('],
  ['）', ') '], ['「', '"'], ['」', '"'], ['？', '?'], ['！', '!'], ['…', '...'], ['·', '·']];
// Counters such as "14 项" or "3 次" read naturally after the number in English.
const I18N_UNITS = [[/检查\s*([\d,]+)\s*个 ADaM 数据表/g, 'Check $1 ADaM tables'], [/已选\s*([\d,]+)\s*项?/g, '$1 selected'], [/共\s*([\d,]+)/g, '$1 in total'], [/([\d,]+)\s*个源文件/g, '$1 source files'], [/([\d,]+)\s*个文件/g, '$1 files'], [/([\d,]+)\s*张数据表/g, '$1 tables'], [/([\d,]+)\s*张表/g, '$1 tables'],
  [/([\d,]+)\s*个字段/g, '$1 fields'], [/([\d,]+)\s*位受试者/g, '$1 subjects'], [/([\d,]+)\s*条原始记录/g, '$1 source records'], [/([\d,]+)\s*条记录/g, '$1 records'], [/([\d,]+)\s*条同类发现/g, '$1 similar findings'], [/([\d,]+)\s*条发现/g, '$1 findings'],
  [/([\d,]+)\s*项/g, '$1 items'], [/([\d,]+)\s*条/g, '$1'], [/([\d,]+)\s*次/g, '$1 times'], [/([\d,]+)\s*人/g, '$1 subjects'],
  [/([\d,]+)\s*行/g, '$1 rows'], [/([\d,]+)\s*个/g, '$1'], [/([\d,]+)\s*天/g, '$1 days'], [/([\d,]+)\s*周/g, '$1 weeks'],
  [/([\d,]+)\s*小时/g, '$1 hours']];

let i18nPhrases = null;
let i18nObserver = null;
const i18nOriginal = new WeakMap();
// The value this module last wrote, so its own writes are not taken for a re-render.
const i18nWritten = new WeakMap();

function i18nTable() {
  if (!i18nPhrases) {
    const entries = Object.entries(typeof I18N_EN === 'object' ? I18N_EN : {});
    i18nPhrases = {
      exact: new Map(entries),
      // Single characters are too ambiguous to replace inside longer text.
      phrases: entries.filter(([zh]) => zh.length > 1).sort((a, b) => b[0].length - a[0].length),
    };
  }
  return i18nPhrases;
}

function translateText(text) {
  const trimmed = text.trim();
  if (!/[一-鿿]/.test(trimmed)) return text;
  const table = i18nTable();
  if (table.exact.has(trimmed)) return text.replace(trimmed, table.exact.get(trimmed));
  let value = text;
  for (const [pattern, english] of I18N_UNITS) value = value.replace(pattern, english);
  for (const [zh, en] of table.phrases) if (value.includes(zh)) value = value.split(zh).join(en);
  // A partly translated sentence reads worse than the original, so keep the original then.
  if (/[\u4e00-\u9fff]/.test(value)) return text;
  for (const [zh, en] of I18N_PUNCTUATION) value = value.split(zh).join(en);
  // "1 findings" reads as a slip; a count of one takes the singular.
  value = value.replace(/(^|[^\d.,])1 (source files|findings|records|subjects|items|files|tables|rows|days|weeks|hours|times|fields)\b/g,
    (match, before, noun) => `${before}1 ${noun === 'source files' ? 'source file' : noun.slice(0, -1)}`);
  return value.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1');
}

function i18nSkipped(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return !element || Boolean(element.closest?.(I18N_SKIP));
}

// A text box or embedded frame keeps its content, but its placeholder, title and label are interface text.
function i18nAttributesSkipped(element) {
  const own = ['TEXTAREA', 'INPUT', 'IFRAME'].includes(element.tagName) ? element.parentElement : element;
  return Boolean(own?.closest?.(I18N_SKIP));
}

const i18nAttributeKey = name => `i18n${name.replace(/-./g, part => part[1].toUpperCase()).replace(/^./, c => c.toUpperCase())}`;

function translateAttributes(element) {
  if (i18nAttributesSkipped(element)) return;
  for (const name of I18N_ATTRIBUTES) {
    const key = i18nAttributeKey(name);
    const value = element.getAttribute(name);
    if (!value || !/[一-鿿]/.test(value)) continue;
    // A value this module did not write is a re-render; it becomes the new original.
    if (value !== element.dataset[`${key}En`]) element.dataset[key] = value;
    const translated = translateText(element.dataset[key]);
    element.dataset[`${key}En`] = translated;
    if (value !== translated) element.setAttribute(name, translated);
  }
}

function translateNode(node) {
  if (node.nodeType === 1) {
    translateAttributes(node);
    if (['TEXTAREA', 'INPUT', 'IFRAME'].includes(node.tagName)) return;
  }
  if (i18nSkipped(node)) return;
  if (node.nodeType === 3) {
    if (!/[一-鿿]/.test(node.nodeValue)) return;
    const original = i18nOriginal.get(node) ?? node.nodeValue;
    i18nOriginal.set(node, original);
    const translated = translateText(original);
    i18nWritten.set(node, translated);
    if (node.nodeValue !== translated) node.nodeValue = translated;
    return;
  }
  if (node.nodeType !== 1) return;
  node.childNodes.forEach(translateNode);
}

function restoreNode(node) {
  if (node.nodeType === 3) {
    if (i18nOriginal.has(node)) node.nodeValue = i18nOriginal.get(node);
    return;
  }
  if (node.nodeType !== 1) return;
  for (const name of I18N_ATTRIBUTES) {
    const key = i18nAttributeKey(name);
    if (node.dataset?.[key] && node.getAttribute(name) === node.dataset[`${key}En`]) node.setAttribute(name, node.dataset[key]);
  }
  node.childNodes.forEach(restoreNode);
}

function applyInterfaceLanguage() {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  const toggle = document.getElementById('languageToggle');
  if (toggle) {
    toggle.textContent = language === 'en' ? '中文' : 'EN';
    toggle.title = language === 'en' ? '切换到中文界面' : 'Switch to the English interface';
  }
  if (language === 'en') {
    translateNode(document.body);
    if (!i18nObserver && typeof MutationObserver === 'function') {
      i18nObserver = new MutationObserver(records => {
        if (language !== 'en') return;
        for (const record of records) {
          if (record.type === 'characterData') {
            if (record.target.nodeValue === i18nWritten.get(record.target)) continue;
            // A re-render replaced the text; its new value is the original to translate.
            i18nOriginal.delete(record.target);
            translateNode(record.target);
          } else if (record.type === 'attributes') translateAttributes(record.target);
          else record.addedNodes.forEach(translateNode);
        }
      });
      i18nObserver.observe(document.body, {childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: I18N_ATTRIBUTES});
    }
  } else {
    i18nObserver?.disconnect();
    i18nObserver = null;
    restoreNode(document.body);
  }
}

// The Workbench (Shiny) reads the language from the service each time it opens.
function shareInterfaceLanguage() {
  if (typeof api !== 'function') return;
  api('/api/interface-language', {language})
    .then(() => window.canvasHostSend?.({type: 'demo.interfaceLanguage'}))
    .catch(() => {});
}

// Switching language re-renders the page; what the user has typed or ticked but not saved stays.
// An input is matched again by its id, name or first data attribute (e.g. data-select-finding="2").
function inputKey(element) {
  const [data] = Object.entries(element.dataset || {}).filter(([name]) => !name.startsWith('i18n'));
  return element.id ? `#${element.id}` : element.name ? `name:${element.name}` : data ? `data:${data[0]}=${data[1]}` : '';
}

function captureInputs() {
  return [...document.querySelectorAll('#stepContent input, #stepContent textarea, #stepContent select')]
    .filter(inputKey)
    .map(element => ({key: inputKey(element), type: element.type, value: element.value, checked: element.checked}));
}

function restoreInputs(saved) {
  const elements = [...document.querySelectorAll('#stepContent input, #stepContent textarea, #stepContent select')];
  for (const item of saved) {
    const element = elements.find(candidate => inputKey(candidate) === item.key);
    if (!element || element.type !== item.type || element.type === 'file') continue;
    if (['checkbox', 'radio'].includes(element.type)) {
      if (element.checked !== item.checked) { element.checked = item.checked; element.dispatchEvent(new Event('change', {bubbles: true})); }
    } else if (element.value !== item.value) {
      element.value = item.value;
      element.dispatchEvent(new Event('input', {bubbles: true}));
    }
  }
}

function setInterfaceLanguage(next) {
  language = next === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(I18N_STORAGE_KEY, language); } catch {}
  shareInterfaceLanguage();
  if (typeof renderNav === 'function' && typeof snapshot !== 'undefined') {
    // A page keeps choices it has not saved yet (for example rows unticked on the screening page).
    if (typeof beforePageRerender === 'function') try { beforePageRerender(); } catch {}
    const inputs = captureInputs();
    const opened = [...document.querySelectorAll('#stepContent details')].map(detail => detail.open);
    renderNav();
    if (page !== 'home' || typeof renderHome === 'function') renderPage();
    restoreInputs(inputs);
    // The same page drawn again has the same sections; keep the ones the user had open.
    const details = [...document.querySelectorAll('#stepContent details')];
    if (details.length === opened.length) details.forEach((detail, index) => { detail.open = opened[index]; });
    // The task rail keeps its markup between polls; dates and labels follow the new language.
    if (snapshot && typeof renderRail === 'function') {
      conversationSignature = '';
      conversationProgressSignature = '';
      renderRail();
    }
  }
  applyInterfaceLanguage();
}

function initializeInterfaceLanguage() {
  try { language = localStorage.getItem(I18N_STORAGE_KEY) === 'en' ? 'en' : 'zh'; } catch {}
  const toggle = document.getElementById('languageToggle');
  if (toggle) toggle.onclick = () => setInterfaceLanguage(language === 'en' ? 'zh' : 'en');
  shareInterfaceLanguage();
  applyInterfaceLanguage();
}
