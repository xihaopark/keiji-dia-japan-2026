/* Shared browser state and authenticated transport. Durable state lives in the service. */
const $ = selector => document.querySelector(selector);
const token = $('meta[name="demo-token"]').content;
let runId = '', page = 'home', snapshot = null, projects = [], runSummary = {};
let language = 'zh', selectedReport = '', selectedChart = '';
let customChapters = [];
// A page's hook to keep unsaved choices before it is rendered again.
let beforePageRerender = null;
const uiDrafts = new Map();
const previewUrls = [];
const pollSignatures = new Map();
const chapters = [
  'Study design, indications & compound modality', 'Efficacy', 'Safety',
  'Baseline Characteristics', 'Exposure & PK', 'Immunogenicity',
  'Pharmacodynamic Biomarkers', 'Dataset inventory & coverage', 'Notes and limitations',
];
const stages = {
  database:['数据库','Database'],upload:['数据上传','Data upload'],screening:['人工数据筛选','Manual screening'],
  protocol:['上传 Protocol','Protocol'],preparation:['Analysis Data 准备','Analysis Data preparation'],summary:['Data Summary','Data Summary'],template:['Summary 模板配置','Summary template'],
  generate:['Summary 预览','Summary preview'],qc:['数据基础质检','Data QC'],tlf:['TLF Consistency Checking','TLF Consistency Checking'],
  pk:['Data Quality QC','Data Quality QC'],charts:['图表配置及生成','Figures'],analysis:['数据分析及分组实验','Analysis'],
};
const t = (zh, en) => language === 'zh' ? zh : en;
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const currentTasks = kind => (snapshot?.tasks || []).filter(task => !kind || task.kind === kind);
const currentAgents = kind => (snapshot?.agents || []).filter(agent => !kind || agent.kind === kind);
const latestTurn = agent => agent?.turns?.at(-1);
const latestAnalysisTurn = agent => [...(agent?.turns || [])].reverse()
  .find(turn => turn.interaction_mode !== 'conversation');
const reports = () => currentTasks('summary').filter(task => task.status === 'completed');
const options = (values, selected = '') => values.map(value =>
  `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(value)}</option>`).join('');
const button = (id, zh, en, cls = 'primary-button') =>
  `<button type="button" class="${cls}" id="${id}">${t(zh, en)}</button>`;
const empty = (zh, en) => `<p class="empty-state">${t(zh, en)}</p>`;
const number = value => typeof value === 'number' ? value.toLocaleString() : '—';
const prettyDate = value => value ? new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-GB', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '未保存';
const taskName = kind => ({
  summary: 'Data Summary', tlf: 'TLF 一致性核对', erqc: '数据质量 QC', pk: '旧版 PK 准备度',
  charts: '图表', exploration: '数据探索', 'figure-review': '图表复核',
  'analysis-data': '分析数据准备',
})[kind] || kind;
const statusText = status => ({
  idle: '可继续', queued: '排队中', running: '运行中', completed: '已完成',
  failed: '失败', cancelled: '已取消', interrupted: '已中断',
  needs_input: '等待输入', waiting_input: '等待输入', waiting_summary: '等待 Summary',
  archived: '已归档', pending: '待审查', reviewed: '已审查',
  needs_revision: '需要修改', awaiting_user: '等待确认', partial: '部分完成',
  preparing: '准备中', ready: '已就绪', stale: '需要更新',
})[status] || status || '未启动';
const sectionHead = (title, description = '') =>
  `<div class="section-heading"><h3>${title}</h3>${description ? `<p>${description}</p>` : ''}</div>`;
const stat = (label, value, detail = '') =>
  `<div class="stat"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`;

function reportSelect(id, summaryOnly = false, includeRunning = false) {
  const list = (includeRunning ? viewableReports() : reports()).filter(report =>
    !summaryOnly || (report.kind === 'summary' && !report.stale && report.integrity !== 'corrupt'));
  return `<select id="${id}" aria-label="报告版本"><option value="">选择报告版本</option>${list.map(report =>
    `<option value="${escape(report.id)}" ${report.id === selectedReport ? 'selected' : ''}>${escape(prettyDate(report.created_at))} · ${escape(taskName(report.kind))}${report.stale ? ' · 数据已更新' : ''}</option>`).join('')}</select>`;
}

function wireNavigation(root) {
  root.querySelectorAll('[data-go]').forEach(control => {
    control.onclick = () => navigate(control.dataset.go);
  });
}

function notice(message) {
  $('#notice').textContent = message;
}

function productError(error, fallback = '操作未能完成，请重试。') {
  const message = String(error?.message || '');
  // A specific message beats the generic 409 text.
  if (/^[\u3400-\u9fff]/.test(message) && !/\/Users\/|Traceback|\.py\b|\.js\b|Analysis\.R|stack/i.test(message)) return message.slice(0, 160);
  if (error?.httpStatus === 409) return '内容已经更新，请刷新后重试。';
  return fallback;
}

async function api(path, body) {
  const response = await canvasFetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.httpStatus = response.status;
    throw error;
  }
  return data;
}

async function action(fn) {
  notice('');
  try {
    return await fn();
  } catch (error) {
    notice(productError(error));
    return undefined;
  }
}

async function refresh(render = true) {
  const requestedRun = runId;
  if (!requestedRun) return;
  const next = await pollRead(`/api/workspace?run_id=${encodeURIComponent(requestedRun)}`);
  if (runId !== requestedRun) return;
  markConnected();
  if (!render && pollUnchanged) return;
  snapshot = next;
  renderNav();
  renderRail();
  if (render) renderPage();
  else await refreshPolledPage();
}

async function refreshRuns(render = true) {
  const data = await api('/api/runs');
  projects = data.runs;
  runSummary = data.summary || {};
  if (render && page === 'home') renderHome();
  return data;
}

async function showReport(taskId, target) {
  if (!taskId || !target || target.dataset.result === taskId) return;
  target.dataset.result = taskId;
  delete target.dataset.displayedResult;
  const request = String((Number(target.dataset.reportRequest) || 0) + 1);
  target.dataset.reportRequest = request;
  const viewRun = runId;
  const current = () => target.isConnected && target.dataset.result === taskId && runId === viewRun
    && target.dataset.reportRequest === request;
  try {
    const name = reportArtifactName(taskId);
    const query = new URLSearchParams({run_id: viewRun, task_id: taskId, name});
    const response = await canvasFetch(`/api/file?${query}`);
    if (!response.ok) throw new Error((await response.json()).error);
    const html = await response.text();
    if (current()) {
      target.removeAttribute('src');
      target.srcdoc = reportMarkup(name, html);
      target.dataset.displayedResult = taskId;
    }
  } catch (error) {
    if (current()) {
      target.dataset.result = '';
      delete target.dataset.displayedResult;
      target.srcdoc = '';
      notice(productError(error, '报告暂时无法读取，请重试。'));
    }
  }
}

async function uploadImages(files, requestedRun = runId, uploads = []) {
  for (const file of files.slice(uploads.length)) {
    if (!file.size) continue;
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
    uploads.push((await api('/api/upload', {run_id: requestedRun, data})).id);
  }
  return uploads;
}

async function ask(message, initialValue = '') {
  const dialog = document.createElement('dialog');
  dialog.className = 'live-dialog';
  dialog.innerHTML = `<form method="dialog" class="live-form">
    <label>${escape(message)}<textarea name="answer" required>${escape(initialValue)}</textarea></label>
    <div class="live-actions"><button value="ok" class="primary-button">确认</button>
    <button value="cancel" formnovalidate>取消</button></div></form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('textarea').focus();
  return new Promise(resolve => dialog.addEventListener('close', () => {
    const value = dialog.returnValue === 'ok' ? dialog.querySelector('textarea').value : null;
    dialog.remove();
    resolve(value);
  }, {once: true}));
}
