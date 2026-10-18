/* Core 5 results on the page: the modeling Agent's structured results as a TLF table with an inline
   log-scale forest plot. Reads only turn.result.sections (results, skipped, diagnostics); the R report
   stays available below. Colour marks a state: an interval is blue only when it excludes 1. */
const FOREST_LO = 0.05, FOREST_HI = 50, FOREST_W = 150;
const MODEL_DOMAINS = () => [['efficacy', t('疗效', 'Efficacy')], ['safety', t('安全性', 'Safety')], ['', t('其他终点', 'Other endpoints')]];
const KM_SPLITS = () => [['median', t('中位数分组', 'Median split')], ['quartile', t('四分位', 'Quartiles')], ['dose', t('剂量组', 'Dose group')]];

function modelResultsDraft() {
  const key = `model-results:${runId}`;
  if (!uiDrafts.has(key)) uiDrafts.set(key, {metric: '', view: 'continuous', selected: ''});
  return uiDrafts.get(key);
}

// Three significant figures; p values to three decimals, or "<0.001".
const sig3 = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value), digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(number) || 1)));
  return number.toFixed(Math.min(digits, 4));
};
const pText = value => value == null ? '—' : Number(value) < 0.001 ? '<0.001' : Number(value).toFixed(3);
const ciText = model => model && model.estimate != null ? `${sig3(model.estimate)} (${sig3(model.lower)}–${sig3(model.upper)})` : '—';
const forestX = value => {
  const clamped = Math.min(FOREST_HI, Math.max(FOREST_LO, Number(value)));
  return (Math.log(clamped) - Math.log(FOREST_LO)) / (Math.log(FOREST_HI) - Math.log(FOREST_LO)) * FOREST_W;
};

function forestSvg(model, adjusted) {
  const one = forestX(1), grid = [0.1, 0.5, 2, 10].map(value => `<line class="grid" x1="${forestX(value)}" x2="${forestX(value)}" y1="2" y2="26"/>`).join('');
  const interval = (item, y, hollow) => {
    if (!item || item.estimate == null) return '';
    const excludes = Number(item.lower) > 1 || Number(item.upper) < 1;
    return `<g class="${excludes ? 'excludes' : ''}${hollow ? ' adjusted' : ''}"><line x1="${forestX(item.lower)}" x2="${forestX(item.upper)}" y1="${y}" y2="${y}"/>`
      + `<circle cx="${forestX(item.estimate)}" cy="${y}" r="${hollow ? 3 : 3.5}"/></g>`;
  };
  return `<svg class="forest" viewBox="0 0 ${FOREST_W} 28" width="${FOREST_W}" height="28" aria-hidden="true">${grid}<line class="one" x1="${one}" x2="${one}" y1="0" y2="28"/>${interval(model, adjusted ? 11 : 14, false)}${interval(adjusted, 19, true)}</svg>`;
}

function forestAxis() {
  return `<svg class="forest axis" viewBox="0 0 ${FOREST_W} 14" width="${FOREST_W}" height="14" aria-hidden="true">${[0.1, 0.5, 1, 2, 10].map(value =>
    `<text x="${forestX(value)}" y="11">${value}</text>`).join('')}</svg>`;
}

// One model table whatever the run produced: the validated model_rows when present, otherwise the
// results section (a list of endpoints, or {by_endpoint, arm_adjusted_logistic}) of older runs.
function modelTable(sections) {
  if (Array.isArray(sections.model_rows)) {
    const endpoints = new Map();
    sections.model_rows.forEach(row => {
      if (!endpoints.has(row.endpoint)) endpoints.set(row.endpoint, {endpoint: row.endpoint, domain: row.domain, endpoint_type: row.endpoint_type, models: []});
      if (row.status === 'fitted') endpoints.get(row.endpoint).models.push(row);
    });
    return {endpoints: [...endpoints.values()], skipped: sections.model_rows.filter(row => row.status === 'skipped'), armAdjusted: []};
  }
  const results = sections.results;
  return {endpoints: Array.isArray(results) ? results : results?.by_endpoint || [], skipped: sections.skipped || [],
    armAdjusted: Array.isArray(results) ? [] : results?.arm_adjusted_logistic || []};
}

// Continuous-exposure models of one metric, with the matching adjusted estimate.
function continuousRows(sections, metric) {
  const table = modelTable(sections);
  return table.endpoints.map(endpoint => {
    const models = endpoint.models || [];
    const base = models.find(item => item.metric === metric && item.split === 'continuous' && ['logistic', 'cox'].includes(item.model));
    if (!base) return null;
    const adjustedModel = models.find(item => item.metric === metric && ['cox_dose_adjusted', 'logistic_dose_adjusted'].includes(item.model));
    const arm = table.armAdjusted.find(item => item.endpoint === endpoint.endpoint && item.metric === metric);
    const adjusted = adjustedModel || (arm && arm.converged !== false ? {estimate: arm.or_iqr, lower: arm.lower, upper: arm.upper, p_value: arm.p_value} : null);
    return {endpoint, base, adjusted, key: `${endpoint.endpoint}|${metric}`};
  }).filter(Boolean);
}

function continuousTable(sections, metric, draft) {
  const rows = continuousRows(sections, metric);
  if (!rows.length) return `<p class="info-note">${t('这个指标没有连续暴露模型。', 'No continuous-exposure model for this metric.')}</p>`;
  const body = MODEL_DOMAINS().map(([domain, label]) => {
    const group = rows.filter(row => (['efficacy', 'safety'].includes(row.endpoint.domain) ? row.endpoint.domain : '') === domain);
    if (!group.length) return '';
    const unit = group.some(row => row.base.model === 'cox') && group.some(row => row.base.model === 'logistic')
      ? t('每 IQR 的 OR 或 HR', 'OR or HR per IQR') : group[0].base.model === 'cox' ? t('每 IQR 的 HR', 'HR per IQR') : t('每 IQR 的 OR', 'OR per IQR');
    return `<tr class="group"><th colspan="6">${escape(label)} · ${unit}</th></tr>${group.map(row => `
      <tr class="model-row${row.key === draft.selected ? ' selected' : ''}" data-model-row="${escape(row.key)}" tabindex="0">
        <td><strong data-i18n-skip>${escape(row.endpoint.endpoint)}</strong><small>${row.base.model === 'cox' ? 'HR · Cox' : 'OR · logistic'}</small></td>
        <td class="num">${row.base.n} / ${row.base.events}</td>
        <td class="num"><b>${sig3(row.base.estimate)}</b> (${sig3(row.base.lower)}–${sig3(row.base.upper)})</td>
        <td class="plot">${forestSvg(row.base, row.adjusted)}</td>
        <td class="num">${pText(row.base.p_value)}</td>
        <td class="num">${ciText(row.adjusted)}</td></tr>`).join('')}`;
  }).join('');
  const scale = rows[0].base.scale ? escape(String(rows[0].base.scale).split(';')[0]) : '';
  return `<table class="model-table forest-table"><colgroup><col><col class="c-n"><col class="c-est"><col style="width:${FOREST_W + 16}px"><col class="c-p"><col class="c-adj"></colgroup>
    <thead><tr><th>${t('终点', 'Endpoint')}</th><th class="num">n / ${t('事件', 'events')}</th><th class="num">${t('估计 (95% CI)', 'Estimate (95% CI)')}</th>
      <th class="plot">${forestAxis()}<span class="legend"><i class="solid"></i>${t('未校正', 'Unadjusted')}<i class="hollow"></i>${t('校正剂量组', 'Dose-group adjusted')}</span></th>
      <th class="num">p</th><th class="num">${t('校正剂量组后', 'Adjusted')}</th></tr></thead><tbody>${body}</tbody></table>
    <p class="model-footnote">${t(`每 IQR 暴露的效应量（${scale}）。实心点为未校正估计，置信区间不含 1 时为蓝色；空心点为校正剂量组后的估计。p 值仅作描述。`, `Effect per IQR of exposure (${scale}). Solid points are unadjusted, blue when the 95% CI excludes 1; hollow points are adjusted for dose group. p values are descriptive.`)}</p>`;
}

// Kaplan-Meier comparisons have no estimate, only a log-rank p per split.
function groupedTable(sections, metric) {
  const endpoints = modelTable(sections).endpoints.filter(endpoint => endpoint.endpoint_type === 'time_to_event');
  const cell = (endpoint, split) => {
    const model = (endpoint.models || []).find(item => item.model === 'km_logrank' && item.split === split && (split === 'dose' || item.metric === metric));
    return `<td class="num${model && Number(model.p_value) < 0.05 ? ' signal' : ''}">${model ? pText(model.p_value) : '—'}</td>`;
  };
  if (!endpoints.length) return `<p class="info-note">${t('没有时间-事件终点。', 'No time-to-event endpoints.')}</p>`;
  return `<table class="model-table grouped"><thead><tr><th>${t('终点', 'Endpoint')}</th>${KM_SPLITS().map(([, label]) => `<th class="num">${escape(label)}</th>`).join('')}</tr></thead>
    <tbody>${endpoints.map(endpoint => `<tr><td><strong data-i18n-skip>${escape(endpoint.endpoint)}</strong><small>KM · log-rank p</small></td>${KM_SPLITS().map(([split]) => cell(endpoint, split)).join('')}</tr>`).join('')}</tbody></table>
    <p class="model-footnote">${t('Kaplan-Meier 分组比较的 log-rank p 值；剂量组比较与暴露指标无关。', 'Log-rank p values of Kaplan-Meier group comparisons; the dose-group comparison does not depend on the metric.')}</p>`;
}

function selectedModelDetail(sections, metric, draft) {
  const row = continuousRows(sections, metric).find(item => item.key === draft.selected);
  if (!row) return '';
  // Diagnostics are a list in some runs and an object of lists in others.
  const list = Array.isArray(sections.diagnostics) ? sections.diagnostics : Object.values(sections.diagnostics || {}).flat();
  const diagnostics = list.filter(item => item && item.endpoint === row.endpoint.endpoint && item.metric === metric);
  const facts = [[t('模型', 'Model'), row.base.model === 'cox' ? 'Cox' : t('逻辑回归', 'Logistic')], [t('尺度', 'Scale'), row.base.scale],
    [t('一致性 C', 'Concordance'), sig3(row.base.concordance)], row.base.ph_p != null ? [t('比例风险检验 p', 'PH test p'), pText(row.base.ph_p)] : null]
    .filter(item => item && item[1] != null);
  const influence = diagnostics.filter(item => item.type === 'influence').map(item =>
    t(`影响最大的受试者 ${item.top_subject}（Cook 距离 ${sig3(item.max_cook)}）；去掉后估计 ${sig3(item.or_without_top)}，全部数据 ${sig3(item.or_full)}`,
      `Most influential subject ${item.top_subject} (Cook's distance ${sig3(item.max_cook)}); estimate ${sig3(item.or_without_top)} without it, ${sig3(item.or_full)} with all data`));
  return `<div class="model-detail"><h5 data-i18n-skip>${escape(row.endpoint.endpoint)} × ${escape(metric)}</h5>
    <dl>${facts.map(([key, value]) => `<dt>${escape(key)}</dt><dd data-i18n-skip>${escape(value)}</dd>`).join('')}</dl>
    ${influence.map(text => `<p data-i18n-skip>${escape(text)}</p>`).join('')}</div>`;
}

function skippedMarkup(sections) {
  const skipped = modelTable(sections).skipped;
  if (!skipped.length) return '';
  const reasons = {};
  skipped.forEach(item => { (reasons[item.reason] ||= []).push(item); });
  return `<details class="model-skipped"><summary>${t(`跳过的 ${skipped.length} 个模型`, `${skipped.length} skipped models`)}</summary>
    <ul>${Object.entries(reasons).sort((a, b) => b[1].length - a[1].length).map(([reason, items]) =>
      `<li><span class="num">${items.length}</span><span data-i18n-skip>${escape(reason)}</span></li>`).join('')}</ul></details>`;
}

function modelResultsMarkup(turn) {
  const sections = turn?.result?.sections || {};
  const table = modelTable(sections), endpoints = table.endpoints;
  if (!endpoints.length) return '';
  const draft = modelResultsDraft();
  const fitted = endpoints.reduce((sum, endpoint) => sum + (endpoint.models || []).length, 0);
  const metrics = [...new Set(endpoints.flatMap(endpoint => (endpoint.models || []).filter(item => item.split === 'continuous').map(item => item.metric)))];
  if (!metrics.includes(draft.metric)) draft.metric = metrics[0] || '';
  const subjects = Math.max(...endpoints.flatMap(endpoint => (endpoint.models || []).map(item => Number(item.n) || 0)));
  const header = [[t('模型', 'Models'), fitted + table.skipped.length], [t('已拟合', 'Fitted'), fitted],
    [t('跳过（写明原因）', 'Skipped (with reason)'), table.skipped.length], [t('受试者', 'Subjects'), subjects]];
  const views = [['continuous', t('连续暴露', 'Continuous exposure')], ['grouped', t('分组比较', 'Group comparison')]];
  return `<div class="model-results">
    <dl class="run-header">${header.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
    <div class="model-controls"><select class="metric-picker" data-model-metric aria-label="${t('暴露指标', 'Exposure metric')}" data-i18n-skip>${metrics.map(metric =>
      `<option value="${escape(metric)}" ${metric === draft.metric ? 'selected' : ''}>${escape(metric)}</option>`).join('')}</select>
      <span class="segmented-control" role="tablist">${views.map(([id, label]) => `<button type="button" role="tab" aria-selected="${draft.view === id}" class="${draft.view === id ? 'active' : ''}" data-model-view="${id}">${label}</button>`).join('')}</span></div>
    ${draft.view === 'grouped' ? groupedTable(sections, draft.metric) : `${continuousTable(sections, draft.metric, draft)}${selectedModelDetail(sections, draft.metric, draft)}`}
    ${skippedMarkup(sections)}</div>`;
}

function wireModelResults(root, rerender) {
  const draft = modelResultsDraft();
  const picker = root.querySelector('[data-model-metric]');
  if (picker) picker.onchange = () => { draft.metric = picker.value; draft.selected = ''; rerender(); };
  root.querySelectorAll('[data-model-view]').forEach(button => { button.onclick = () => { draft.view = button.dataset.modelView; rerender(); }; });
  root.querySelectorAll('[data-model-row]').forEach(row => {
    const select = () => { draft.selected = draft.selected === row.dataset.modelRow ? '' : row.dataset.modelRow; rerender(); };
    row.onclick = select;
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } };
  });
}
