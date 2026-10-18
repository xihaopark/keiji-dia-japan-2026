/* Study decision panel: remembered values, Agent recommendations and inline edits. */
// Choices are stored decision values, so they are English like every stored definition.
const DECISION_PRESETS = {
  cutoff: ['All available data (no cutoff)', 'Database lock date'],
  time_origin: ['First dose (C1D1)', 'Dose of each cycle', 'Randomization date'],
  time_unit: ['Hours', 'Days', 'Weeks'],
  treatment_group: ['Planned treatment arm', 'Actual treatment arm', 'Dose level'],
  responder: ['Confirmed CR or PR (RECIST 1.1)', 'CR or PR at any visit', 'Best overall response CR or PR'],
  ae_scope: ['Grade 3 or higher treatment-emergent AEs', 'Serious AEs', 'All treatment-emergent AEs', 'Study-drug-related AEs'],
  exposure_metric: ['Observed Cmax', 'Observed steady-state pre-dose trough', 'Mean observed concentration in window'],
  exposure_window: ['Cycle 1 Day 1 (first dose)', 'Cycle 2 Day 1 pre-dose (steady state)', 'Whole treatment period'],
  blq_handling: ['BLQ as 0', 'BLQ as LLOQ/2', 'BLQ excluded'],
};

// How the data implement a decision: one click away, never in the way of the definition.
function basisMarkup(basis, label = '依据') {
  return basis ? `<details class="decision-basis"><summary>${escape(label)}</summary><p data-i18n-skip>${escape(basis)}</p></details>` : '';
}
const PREPARATION_PANEL = {scope: 'preparation', title: '研究口径',
  intro: '确认后的口径会记住，之后的准备、Summary、QC 和绘图任务都会沿用。推荐基于 Summary 和数据结构；执行时 Agent 会用真实数据再核对，有冲突会停下来问你。'};
const CONFIDENCE_TEXT = {high: '高', medium: '中', low: '低'};

// Remembered decisions of this study override the generic Agent-recommendation default.
function applyRememberedDecisions(draft, remembered) {
  for (const [id, item] of Object.entries(remembered || {})) {
    if (!item?.value) continue;
    Object.assign(draft, {[id]: item.value, [`${id}_source`]: item.basis || DEFAULT_DECISION_SOURCE,
      [`${id}_origin`]: 'memory', [`${id}_memory`]: {confirmed_at: item.confirmed_at, count: item.confirmation_count || 1}});
  }
}

// Values changed in the study decision hub reach drafts whose value still comes from memory
// or is undecided; a value the user edited or took from a recommendation on the page wins.
function syncRememberedDecisions(draft, remembered, ids) {
  const signature = JSON.stringify(remembered || {});
  if (draft.memorySignature === signature) return;
  draft.memorySignature = signature;
  for (const id of ids) {
    const origin = decisionOrigin(draft, id);
    if (!['memory', 'delegated'].includes(origin)) continue;
    if (remembered?.[id]?.value) applyRememberedDecisions(draft, {[id]: remembered[id]});
    else if (origin === 'memory') Object.assign(draft, {[id]: AGENT_RECOMMENDED_DECISION, [`${id}_origin`]: ''});
  }
}

function decisionOrigin(draft, id) {
  if (draft[id] === AGENT_RECOMMENDED_DECISION) return 'delegated';
  return draft[`${id}_origin`] || 'user';
}

function decisionBadge(draft, id) {
  const origin = decisionOrigin(draft, id);
  if (origin === 'memory') {
    const memory = draft[`${id}_memory`] || {};
    return `沿用已确认 · ${escape(prettyDate(memory.confirmed_at))}${memory.count > 1 ? ` · 已确认 ${memory.count} 次` : ''}`;
  }
  if (origin === 'agent') return t(`Agent 推荐 · 置信度${CONFIDENCE_TEXT[draft[`${id}_confidence`]] || '中'}`, `Agent recommendation · ${({high: 'high', medium: 'medium', low: 'low'})[draft[`${id}_confidence`]] || 'medium'} confidence`);
  if (origin !== 'delegated') return '手动设定';
  return draft.decideBeforeRun ? '待确定 · 请推荐或填写' : '待定 · 执行时由 Agent 推荐';
}

function decisionChoices(draft, id) {
  const values = [...(draft[`${id}_options`] || []), ...(DECISION_PRESETS[id] || [])];
  return [...new Set(values.filter(value => value && value !== draft[id]))].slice(0, 6);
}

function decisionCardMarkup(draft, [id, label, hint]) {
  const origin = decisionOrigin(draft, id), open = draft.editingDecision === id;
  const value = origin === 'delegated' ? '尚未确定' : draft[id];
  return `<article class="decision-card origin-${origin}${open ? ' is-editing' : ''}" data-decision="${id}">
    <header><span class="decision-label">${escape(label)}</span><span class="decision-badge">${decisionBadge(draft, id)}</span></header>
    <p class="decision-value">${escape(value)}</p>
    ${origin !== 'delegated' ? basisMarkup(draft[`${id}_source`]) : ''}
    <div class="decision-actions"><button type="button" class="link-button" data-edit-decision="${id}">${open ? '收起' : '修改'}</button>${origin === 'memory' ? `<button type="button" class="link-button muted" data-forget-decision="${id}">不再沿用</button>` : ''}</div>
    <div class="decision-editor"${open ? '' : ' hidden'}>
      <div class="decision-chips">${decisionChoices(draft, id).map(choice => `<button type="button" class="decision-chip" data-choose-decision="${id}" data-value="${escape(choice)}">${escape(choice)}</button>`).join('')}${draft.decideBeforeRun ? '' : `<button type="button" class="decision-chip ghost" data-choose-decision="${id}" data-value="${escape(AGENT_RECOMMENDED_DECISION)}">执行时由 Agent 推荐</button>`}</div>
      <label>${escape(hint)}<textarea name="${id}" maxlength="4000" rows="2" required>${escape(draft[id] || '')}</textarea></label>
      <label>依据（可选）<input name="${id}_source" maxlength="4000" value="${escape(draft[`${id}_source`] || '')}"></label>
    </div></article>`;
}

// panel: {scope, title, intro, fields}; the Analysis Data panel is the default.
function decisionPanelMarkup(draft, prerequisites, panel = PREPARATION_PANEL) {
  const busy = draft.recommending, fields = panel.fields || preparationDecisionFields(draft);
  return `<section class="decision-panel"><div class="decision-panel-head"><div><h5>${escape(panel.title)}</h5><p>${escape(panel.intro)}</p></div>
    <button type="button" class="secondary-button accent" data-recommend="${escape(panel.scope)}" ${busy || !prerequisites?.upstream?.summary ? 'disabled' : ''}>${busy ? '<span class="spinner" aria-hidden="true"></span> Agent 正在阅读 Summary 与 QC…' : '✦ 让 Agent 根据 Summary 和 QC 推荐'}</button></div>
    ${draft.recommendationNotes ? `<p class="decision-notes">${escape(draft.recommendationNotes)}</p>` : ''}
    <div class="decision-grid">${fields.map(field => decisionCardMarkup(draft, field)).join('')}</div></section>`;
}

// keepDecided: an automatic draft fills the goal and open decisions only; decisions the analyst
// already confirmed (remembered for this study) stay as they are.
function applyRecommendations(draft, result, keepDecided = false) {
  for (const item of result.recommendations || []) {
    if (keepDecided && decisionOrigin(draft, item.id) !== 'delegated') continue;
    Object.assign(draft, {[item.id]: item.value, [`${item.id}_source`]: item.basis || DEFAULT_DECISION_SOURCE,
      [`${item.id}_origin`]: 'agent', [`${item.id}_options`]: item.options || [], [`${item.id}_confidence`]: item.confidence});
  }
  draft.recommendationNotes = result.notes || '';
  Object.assign(draft, {goal_options: result.goal_options || [], requirement_options: result.requirement_options || []});
  // The Agent drafts the goal too; a goal the user wrote stays theirs.
  if (result.analysis_goal && (!String(draft.analysis_goal || '').trim() || draft.analysis_goal_origin === 'agent'))
    Object.assign(draft, {analysis_goal: result.analysis_goal, analysis_goal_origin: 'agent'});
}

// While the Agent drafts, say so where the user is looking: at the top of the step.
function draftingNotice(draft, text) {
  return draft.recommending ? `<p class="info-note drafting-note" role="status"><span class="spinner" aria-hidden="true"></span>${escape(text)}</p>` : '';
}

// Agent-drafted alternatives for a free-text field: one click fills (or adds to) the field.
function suggestionMarkup(options, field, mode, label) {
  if (!(options || []).length) return '';
  return `<div class="suggestion-chips"><span>${escape(label)}</span>${options.map(option => `<button type="button" class="decision-chip" data-i18n-skip data-suggest="${escape(field)}" data-mode="${mode}" data-value="${escape(option)}">${mode === 'append' ? '+ ' : ''}${escape(option)}</button>`).join('')}</div>`;
}

function wireSuggestions(root, draft, rerender) {
  root.querySelectorAll('[data-suggest]').forEach(button => { button.onclick = () => {
    const field = button.dataset.suggest, value = button.dataset.value, current = String(draft[field] || '').trim();
    if (button.dataset.mode === 'append') draft[field] = current.includes(value) ? current : [current, value].filter(Boolean).join('\n');
    else Object.assign(draft, {[field]: value, [`${field}_origin`]: 'agent'});
    rerender();
  }; });
}

// A new study starts with every decision delegated: ask once for the Agent's draft so the user
// reviews proposals instead of starting from blank fields.
function autoRecommend(root, draft, ids) {
  const button = root.querySelector('[data-recommend]');
  // One automatic retry after a failed draft; after that the user asks with the button.
  const allDelegated = ids.every(id => decisionOrigin(draft, id) === 'delegated');
  const goalMissing = 'analysis_goal' in draft && !String(draft.analysis_goal || '').trim();
  if (!button || button.disabled || draft.recommending || (draft.autoAttempts || 0) >= 2
      || !(allDelegated || goalMissing)) return;
  draft.autoAttempts = (draft.autoAttempts || 0) + 1;
  // Remembered decisions stay when the draft is only needed for the goal or open decisions.
  draft.keepDecided = !allDelegated;
  button.click();
}

function wireDecisionPanel(root, draft, rerender) {
  const bind = (selector, handler) => root.querySelectorAll(selector).forEach(element => { element.onclick = () => handler(element); });
  bind('[data-edit-decision]', button => {
    draft.editingDecision = draft.editingDecision === button.dataset.editDecision ? '' : button.dataset.editDecision;
    rerender();
  });
  bind('[data-choose-decision]', button => {
    const id = button.dataset.chooseDecision;
    const fromAgent = (draft[`${id}_options`] || []).includes(button.dataset.value);
    Object.assign(draft, {[id]: button.dataset.value, [`${id}_origin`]: fromAgent ? 'agent' : 'user'});
    rerender();
  });
  bind('[data-forget-decision]', button => action(async () => {
    const id = button.dataset.forgetDecision;
    await api(`/api/runs/${encodeURIComponent(runId)}/study-decisions`, {forget: id});
    Object.assign(draft, {[id]: AGENT_RECOMMENDED_DECISION, [`${id}_source`]: DEFAULT_DECISION_SOURCE, [`${id}_origin`]: ''});
    rerender();
  }));
  root.querySelectorAll('.decision-editor [name]').forEach(control => control.addEventListener('input', () => {
    draft[`${control.name.replace(/_source$/, '')}_origin`] = 'user';
  }));
  const recommend = root.querySelector('[data-recommend]');
  if (recommend) recommend.onclick = () => action(async () => {
    draft.recommending = true;
    rerender();
    try {
      applyRecommendations(draft, await api(`/api/runs/${encodeURIComponent(runId)}/study-decision-recommendations`,
        {scope: recommend.dataset.recommend}), Boolean(draft.keepDecided));
    } finally {
      draft.keepDecided = false;
      draft.recommending = false;
      rerender();
    }
  });
}

// Remember the explicit (non-delegated) decisions the user proceeds with.
function rememberDecisions(decisions, origin = 'user') {
  const explicit = decisions.filter(item => item.value && item.value !== AGENT_RECOMMENDED_DECISION);
  if (!explicit.length) return Promise.resolve();
  return api(`/api/runs/${encodeURIComponent(runId)}/study-decisions`, {
    decisions: explicit.map(item => ({id: item.id, value: item.value, basis: item.source || item.basis || ''})), origin,
  });
}
