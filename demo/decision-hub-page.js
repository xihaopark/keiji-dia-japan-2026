/* Study decision hub: every confirmed decision of this study in one place, editable here. */
stages.decisions = ['研究口径', 'Study decisions'];
pageNotes.decisions = ['本研究已确认的口径集中在这里。各步骤和所有子 Agent 都按这里的口径工作；在这里修改，后续任务沿用新值。', 'Confirmed study decisions.'];

const DECISION_GROUPS = [
  {title: '分析数据口径', uses: 'Analysis Data 准备 · Summary、QC 等所有子 Agent 的研究前提', page: 'preparation',
    ids: [['cutoff', '数据截止口径'], ['time_origin', '时间起点'], ['time_unit', '时间单位'], ['treatment_group', '分组方式'],
      ['responder', 'Responder 定义'], ['ae_scope', 'AE 范围']]},
  {title: '暴露指标', uses: '暴露–效应分析 · 分析工作台', page: 'exposure', ids: [['exposure_metrics', '已采纳的暴露指标']]},
];
const ORIGIN_TEXT = {user: '用户确认', agent_confirmed: 'Agent 推荐 · 用户确认'};
// Exposure metric candidates are decided on the exposure page, not as decision corrections here.
const HUB_KINDS = {'analysis-data': 'preparation'};

function hubDraft() {
  const key = `decision-hub:${runId}`;
  if (!uiDrafts.has(key)) uiDrafts.set(key, {editing: '', saving: false});
  return uiDrafts.get(key);
}

function knownDecisionLabel(id) {
  return DECISION_GROUPS.flatMap(group => group.ids).find(([known]) => known === id)?.[1] || '';
}

// Decisions an Agent proposed while stopped, still waiting on their own page.
function pendingProposals() {
  return Object.entries(HUB_KINDS).flatMap(([kind, target]) => currentAgents(kind).flatMap(agent => {
    const turn = latestAnalysisTurn(agent);
    if (!['needs_input', 'waiting_input'].includes(turn?.status)) return [];
    return (turn.result?.proposals || []).map(item => ({...item, target}));
  }));
}

function hubCardMarkup(id, label, item, draft) {
  if (!item) return `<article class="hub-card is-missing"><header><strong>${escape(label)}</strong><span class="hub-origin">尚未确认</span></header></article>`;
  const editing = draft.editing === id;
  const history = (item.history || []).map(old => `<li><span>${escape(prettyDate(old.confirmed_at))}</span>${escape(old.value)}</li>`).join('');
  return `<article class="hub-card"><header><strong>${escape(label || id)}</strong><span class="hub-origin">${escape(ORIGIN_TEXT[item.origin] || '已确认')} · ${escape(prettyDate(item.confirmed_at))}${item.confirmation_count > 1 ? ` · 已确认 ${item.confirmation_count} 次` : ''}</span></header>
    ${editing ? `<form class="hub-editor" data-hub-form="${escape(id)}"><label>口径<textarea name="value" rows="2" maxlength="4000" required>${escape(item.value)}</textarea></label><label>依据<input name="basis" maxlength="4000" value="${escape(item.basis || '')}"></label><div class="hub-actions"><button class="primary-button" ${draft.saving ? 'disabled' : ''}>保存</button><button type="button" class="link-button" data-hub-cancel>取消</button></div></form>`
      : `<p class="hub-value">${escape(item.value)}</p>${basisMarkup(item.basis)}
    <div class="hub-actions"><button type="button" class="link-button" data-hub-edit="${escape(id)}">修改</button><button type="button" class="link-button muted" data-hub-forget="${escape(id)}">不再沿用</button></div>`}
    ${history ? `<details class="hub-history"><summary>之前的口径（${item.history.length}）</summary><ul>${history}</ul></details>` : ''}</article>`;
}

function hubGroupMarkup(group, decisions, draft) {
  const confirmed = group.ids.filter(([id]) => decisions[id]).length;
  return `<section class="surface hub-group"><div class="hub-group-head"><div><h4>${escape(group.title)}</h4><p>使用于：${escape(group.uses)}</p></div>
    <div class="hub-group-side"><span>${confirmed}/${group.ids.length} 已确认</span>${confirmed < group.ids.length ? `<button type="button" class="secondary-button" data-go="${group.page}">去确认 →</button>` : ''}</div></div>
    <div class="hub-grid">${group.ids.map(([id, label]) => hubCardMarkup(id, label, decisions[id], draft)).join('')}</div></section>`;
}

function renderDecisionHub(root) {
  const draft = hubDraft();
  const memory = snapshot?.study_decisions || {};
  const decisions = memory.decisions || {};
  const known = new Set(DECISION_GROUPS.flatMap(group => group.ids.map(([id]) => id)));
  const others = Object.keys(decisions).filter(id => !known.has(id)).sort();
  const proposals = pendingProposals();
  root.innerHTML = `<div class="decision-hub">
    <section class="hub-summary"><div><span class="eyebrow">STUDY</span><strong>${escape(String(memory.study_key || '').replace(/^study:/, '') || '当前数据')}</strong></div><p>共 ${Object.keys(decisions).length} 项已确认口径。新任务开始时会带上这些口径，已完成的结果不会被改写。</p></section>
    ${proposals.length ? `<section class="surface hub-proposals"><h4>Agent 提出的口径修改（待你确认）</h4>${proposals.map(item => `<div class="proposal-item"><span>${escape(knownDecisionLabel(item.id) || item.id)}</span><strong>${escape(item.value)}</strong>${basisMarkup(item.basis)}<button type="button" class="link-button" data-go="${item.target}">去确认 →</button></div>`).join('')}</section>` : ''}
    ${DECISION_GROUPS.map(group => hubGroupMarkup(group, decisions, draft)).join('')}
    ${others.length ? `<section class="surface hub-group"><div class="hub-group-head"><div><h4>数据映射细则</h4><p>Agent 在准备分析数据时确认的映射与处理规则。</p></div></div><div class="hub-grid">${others.map(id => hubCardMarkup(id, '', decisions[id], draft)).join('')}</div></section>` : ''}
  </div>`;
  wireDecisionHub(root, draft);
}

function wireDecisionHub(root, draft) {
  const rerender = () => renderDecisionHub(root);
  root.querySelectorAll('[data-go]').forEach(button => { button.onclick = () => navigate(button.dataset.go); });
  root.querySelectorAll('[data-hub-edit]').forEach(button => { button.onclick = () => { draft.editing = button.dataset.hubEdit; rerender(); }; });
  root.querySelectorAll('[data-hub-cancel]').forEach(button => { button.onclick = () => { draft.editing = ''; rerender(); }; });
  root.querySelectorAll('[data-hub-forget]').forEach(button => {
    button.onclick = () => action(() => saveHubDecision(draft, {forget: button.dataset.hubForget}));
  });
  root.querySelectorAll('[data-hub-form]').forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      action(() => saveHubDecision(draft, {origin: 'user', decisions: [{
        id: form.dataset.hubForm, value: String(values.value).trim(), basis: String(values.basis || '').trim()}]}));
    };
  });
}

async function saveHubDecision(draft, body) {
  if (draft.saving) return;
  draft.saving = true;
  try {
    await api(`/api/runs/${encodeURIComponent(runId)}/study-decisions`, body);
    draft.editing = '';
    await refresh();
  } finally {
    draft.saving = false;
  }
}
