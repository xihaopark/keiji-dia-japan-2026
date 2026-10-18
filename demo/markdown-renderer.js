/* Safe, dependency-free Markdown subset for governed local reports. */
function inlineMarkdown(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function markdownBody(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let paragraph = [], list = '', code = [], fenced = false, rCode = false;
  const flushParagraph = () => { if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`); paragraph = []; };
  const closeList = () => { if (list) output.push(`</${list}>`); list = ''; };
  const flushCode = () => {
    const block = `<pre><code>${escape(code.join('\n'))}</code></pre>`;
    output.push(rCode ? `<details class="report-code"><summary>R code</summary>${block}</details>` : block);
    code = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line)) {
      flushParagraph(); closeList();
      if (fenced) flushCode();
      else rCode = /^```\s*(?:\{r(?:[\s,}]|$)|r\s*$)/i.test(line);
      fenced = !fenced; continue;
    }
    if (fenced) { code.push(line); continue; }
    const tableDivider = lines[index + 1] && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]);
    if (line.includes('|') && tableDivider) {
      flushParagraph(); closeList();
      const header = line.replace(/^\||\|$/g, '').split('|').map(value => value.trim());
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|')) {
        rows.push(lines[index].replace(/^\||\|$/g, '').split('|').map(value => value.trim())); index += 1;
      }
      index -= 1;
      output.push(`<table><thead><tr>${header.map(value => `<th>${inlineMarkdown(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${header.map((_, cell) => `<td>${inlineMarkdown(row[cell] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); output.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`); continue; }
    const item = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
    if (item) {
      flushParagraph(); const nextList = /\d/.test(item[1][0]) ? 'ol' : 'ul';
      if (list !== nextList) { closeList(); list = nextList; output.push(`<${list}>`); }
      output.push(`<li>${inlineMarkdown(item[2])}</li>`); continue;
    }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    paragraph.push(line.trim());
  }
  if (fenced) flushCode();
  flushParagraph(); closeList();
  return output.join('\n');
}

function foldReportCode(text) {
  // Report scripts stay blocked. Native disclosures work inside the existing
  // sandbox and adapt historical HTML without modifying the saved artifact.
  if (!/<(?:pre|code)\b/i.test(text)) return text;
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const sources = [...doc.querySelectorAll('pre')].filter(pre =>
    pre.matches('.r, .language-r') || pre.querySelector('code.r, code.language-r'));
  for (const pre of sources) {
    const oldCollapse = pre.closest('.r-code-collapse');
    if (oldCollapse) {
      oldCollapse.classList.remove('collapse', 'collapsing', 'in', 'show');
      oldCollapse.removeAttribute('hidden');
      for (const property of ['display', 'height', 'max-height', 'visibility']) oldCollapse.style.removeProperty(property);
    }
    const existing = pre.closest('details');
    const codeOnly = existing && [...existing.children].every(child =>
      child.tagName === 'SUMMARY' || child === pre ||
      child.matches('div.sourceCode, div.r-code-collapse') && child.textContent.trim() === pre.textContent.trim());
    if (codeOnly) {
      existing.removeAttribute('open');
      existing.classList.add('report-code');
      continue;
    }
    const details = doc.createElement('details');
    details.className = 'report-code';
    const summary = doc.createElement('summary');
    summary.textContent = 'R code';
    pre.replaceWith(details);
    details.append(summary, pre);
  }
  doc.querySelectorAll('.code-folding-btn, #rmd-show-all-code, #rmd-hide-all-code').forEach(control => control.remove());
  const style = doc.createElement('style');
  style.textContent = '.report-code{margin:12px 0;border:1px solid #dbe2ea;border-radius:6px;padding:8px 12px}.report-code>summary{cursor:pointer;color:#334155;font:600 13px/1.6 system-ui}.report-code>summary:focus-visible{outline:2px solid #1769aa;outline-offset:3px}.report-code pre{margin:10px 0 0;max-width:100%;overflow:auto}';
  doc.head.append(style);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

// A live Rmd draft shows its prose only: no YAML header, template comments or R chunks.
function rmdDraftText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const prose = [];
  let fence = null;
  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (!fence.rCode) prose.push(line);
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length
          && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) {
      fence = {char: marker[1][0], length: marker[1].length,
        rCode: /^\s*(?:\{r(?:[\s,}]|$)|r\s*$)/i.test(marker[2])};
      if (fence.rCode) continue;
    }
    prose.push(line);
  }
  return prose.join('\n').replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/^(#{1,6} .*?)\s*\{[.#][^}]*\}\s*$/gm, '$1');
}

// A report without its own page margin would touch the frame edge; its own CSS still wins.
const REPORT_BASE_STYLE = '<style>body{margin:0;padding:20px 24px}</style>';
function withReportMargin(html) {
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => match + REPORT_BASE_STYLE)
    : /^\s*<!doctype/i.test(html) ? html : REPORT_BASE_STYLE + html;
}

function reportMarkup(name, text) {
  if (!['data_summary_report.Rmd', 'data_quality_summary.md'].includes(name)) return withReportMargin(foldReportCode(text));
  if (name === 'data_summary_report.Rmd') text = `${typeof language !== 'undefined' && language === 'en'
    ? '**Draft**: the parts written so far, with code hidden. Progress is shown above the page; the final report appears when it finishes.'
    : '**草稿**：以下是已写好的部分，代码已隐藏；生成状态见页面上方，完成后显示正式报告。'}\n\n${rmdDraftText(text)}`;
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:15px/1.65 system-ui;padding:28px;color:#243247;max-width:980px;margin:auto}h1,h2,h3{line-height:1.25;margin:1.4em 0 .55em}p,li{overflow-wrap:anywhere}code{background:#f2f4f7;border-radius:4px;padding:2px 5px}pre{white-space:pre-wrap;background:#f6f8fa;border:1px solid #dbe2ea;border-radius:8px;padding:14px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #dbe2ea;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f2f5f8}a{color:#1769aa}</style>${markdownBody(text)}`;
}
