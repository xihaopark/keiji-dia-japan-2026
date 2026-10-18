/* Issue ledger: every data problem the Agents found, what each node did with it, and the analyst's say. */
stages.issues = ['问题台账', 'Issue ledger'];
pageNotes.issues = ['各步骤发现的数据问题及处理：Agent 能确定的直接按规则处理，需要你判断的列为待决定。', 'Data problems found along the workflow and how each was handled.'];

const ISSUE_STATUS = {
  needs_decision: ['待你决定', 'Needs your decision'],
  open: ['未处理', 'Open'],
  to_apply: ['待应用', 'To apply'],
  applied: ['已解决', 'Resolved'],
  limitation: ['记为局限', 'Limitation'],
  dismissed: ['非问题', 'Not an issue'],
};
const ISSUE_NODES = {
  qc: ['数据质检', 'QC'], analysis_data: ['Analysis Data', 'Analysis Data'], exposure_metrics: ['暴露指标', 'Exposure metrics'],
  er: ['暴露–效应', 'Exposure-response'], modeling: ['统计建模', 'Modeling'], report: ['报告', 'Report'],
};
const ISSUE_SEVERITY = {high: ['高', 'High'], medium: ['中', 'Medium'], low: ['低', 'Low']};
const ISSUE_PAGE = {qc: 'qc', analysis_data: 'preparation', exposure_metrics: 'exposure', er: 'exposure', modeling: 'exposure', report: 'exposure'};
const issueLabel = (pair) => pair ? t(pair[0], pair[1]) : '';

function issueDraft() {
  const key = `issues:${runId}`;
  if (!uiDrafts.has(key)) uiDrafts.set(key, {selected: '', groups: {}, choice: {}, saving: '', noteFor: ''});
  return uiDrafts.get(key);
}

function issueLedger() {
  return snapshot?.issue_ledger || {issues: [], funnel: {total: {}, nodes: {}}};
}

// One line for the top of a step page: how many problems are still open, and a way to the ledger.
function issueFunnelStrip(node) {
  const ledger = issueLedger(), total = ledger.funnel?.total || {};
  if (!total.found) return '';
  const here = node ? ledger.funnel.nodes?.[node] : null;
  const parts = [['needs_decision', total.needs_decision], ['to_apply', total.to_apply], ['applied', total.applied],
    ['limitation', total.limitation], ['dismissed', total.dismissed]].filter(([, n]) => n);
  return `<div class="issue-strip ${total.needs_decision ? 'has-decisions' : ''}" role="status">
    <strong>${t(`数据问题 ${total.found} 项`, `${total.found} data problems`)}${here ? ` · ${t(`本步发现 ${here.found}`, `${here.found} found here`)}` : ''}</strong>
    <span>${parts.map(([status, n]) => `<span class="issue-pill is-${status}">${escape(issueLabel(ISSUE_STATUS[status]))} ${n}</span>`).join('')}</span>
    <button type="button" class="link-button" data-go-issues>${t('查看问题台账 →', 'Open issue ledger →')}</button></div>`;
}

function wireIssueStrip(root) {
  root.querySelectorAll('[data-go-issues]').forEach(button => { button.onclick = () => navigate('issues'); });
}

function issueFunnelMarkup(ledger) {
  const total = ledger.funnel?.total || {}, nodes = ledger.funnel?.nodes || {};
  const order = ['needs_decision', 'open', 'to_apply', 'applied', 'limitation', 'dismissed'];
  const bar = order.filter(status => total[status]).map(status =>
    `<span class="issue-bar-part is-${status}" style="flex:${total[status]}" title="${escape(issueLabel(ISSUE_STATUS[status]))} ${total[status]}"></span>`).join('');
  const steps = Object.keys(ISSUE_NODES).filter(node => nodes[node]).map(node => {
    const counts = nodes[node], closed = (counts.applied || 0) + (counts.limitation || 0) + (counts.dismissed || 0);
    return `<li><strong>${escape(issueLabel(ISSUE_NODES[node]))}</strong><span>${closed} / ${counts.found}</span></li>`;
  }).join('');
  return `<section class="issue-funnel">
    <div class="issue-funnel-head"><strong>${t(`未解决 ${total.unresolved || 0} / 共 ${total.found || 0}`, `${total.unresolved || 0} unresolved of ${total.found || 0}`)}</strong>
      ${steps ? `<ol class="issue-nodes">${steps}</ol>` : ''}</div>
    <div class="issue-bar">${bar}</div>
    ${ledger.investigation ? `<details class="issue-investigation"><summary>${t('QC 调查结论', 'QC investigation')}</summary><p data-i18n-skip>${escape(ledger.investigation)}</p></details>` : ''}
  </section>`;
}

function issueAppliedMarkup(issue) {
  const applied = (issue.applied || []).map(entry => {
    const counts = Number.isInteger(entry.before) && Number.isInteger(entry.after) ? ` · ${entry.before} → ${entry.after}` : '';
    return `<li><span>${escape(issueLabel(ISSUE_NODES[entry.node]))} · ${escape({applied: t('已应用', 'applied'), not_needed: t('无需处理', 'not needed'), deferred: t('暂缓', 'deferred')}[entry.action] || entry.action)}${counts}</span>${entry.rule || entry.note ? `<small data-i18n-skip>${escape(entry.rule || entry.note)}</small>` : ''}</li>`;
  }).join('');
  return applied ? `<div class="issue-field"><h6>${t('处理记录', 'Applied')}</h6><ul class="issue-applied">${applied}</ul></div>` : '';
}

// Options read as a radio list with the Agent's recommendation marked; deciding is one primary button.
function issueOptionsMarkup(issue, draft) {
  const choice = issue.user_action, open = issue.status === 'needs_decision';
  const options = open || choice?.action === 'choose' ? (issue.options || []) : [];
  if (!options.length) return '';
  const picked = open ? (draft.choice[issue.key] ?? options[0]) : choice.option;
  return `<div class="issue-field"><h6>${t('处理方案', 'Options')}</h6><div class="issue-options" role="radiogroup">${options.map((option, index) =>
    `<label class="issue-option${option === picked ? ' is-picked' : ''}"><input type="radio" name="issue-option" value="${escape(option)}" ${option === picked ? 'checked' : ''} ${open ? '' : 'disabled'} data-issue-pick="${escape(issue.key)}">
      <span data-i18n-skip>${escape(option)}</span>${index === 0 ? `<em>${t('推荐', 'Recommended')}</em>` : ''}</label>`).join('')}</div></div>`;
}

function issueActionsMarkup(issue, draft) {
  const key = escape(issue.key), busy = draft.saving ? 'disabled' : '';
  const status = issue.status, choice = issue.user_action;
  const quick = [];
  if (status !== 'limitation') quick.push(['limitation', t('记为局限', 'Mark as limitation')]);
  if (status !== 'dismissed') quick.push(['dismiss', t('不是问题', 'Not an issue')]);
  if (choice) quick.push(['reopen', t('撤回我的处理', 'Undo my action')]);
  const primary = status === 'needs_decision' && (issue.options || []).length
    ? `<button type="button" class="primary-button" ${busy} data-issue-choose="${key}">${t('采用所选方案', 'Use selected option')}</button>` : '';
  return `<div class="issue-actions">${quick.map(([action, text]) => `<button type="button" class="secondary-button" ${busy} data-issue-action="${action}" data-issue-key="${key}">${text}</button>`).join('')}${primary}</div>`;
}

function issueMeta(issue) {
  const severity = ISSUE_SEVERITY[issue.severity];
  const counts = Number.isInteger(issue.count) ? t(`${issue.count} 条`, `${issue.count} records`) : '';
  return [issueLabel(ISSUE_NODES[issue.node]) || issue.node, severity ? `${t('严重度', 'Severity')} ${issueLabel(severity)}` : '', counts].filter(Boolean);
}

function issueDetailMarkup(issue, draft) {
  const subjects = issue.subject_total ? t(`涉及 ${issue.subject_total} 名受试者`, `${issue.subject_total} subjects`) : '';
  const applies = issue.applies_in ? t(`在 ${issueLabel(ISSUE_NODES[issue.applies_in]) || issue.applies_in} 处理`, `handled in ${issueLabel(ISSUE_NODES[issue.applies_in]) || issue.applies_in}`) : '';
  const meta = [...issueMeta(issue).slice(0, 2), subjects, applies, issue.found_by].filter(Boolean).join(' · ');
  const field = (label, text) => text ? `<div class="issue-field"><h6>${label}</h6><p data-i18n-skip>${escape(text)}</p></div>` : '';
  return `<article class="issue-detail is-${issue.status}" data-issue="${escape(issue.key)}">
    <header><span class="issue-pill is-${issue.status}">${escape(issueLabel(ISSUE_STATUS[issue.status]))}</span><span class="issue-meta">${escape(meta)}</span></header>
    <h3 data-i18n-skip>${escape(issue.title)}</h3>
    ${field(t('证据', 'Evidence'), issue.evidence)}${field(t('处理', 'Handling'), issue.resolution)}${field(t('影响', 'Impact'), issue.impact)}
    ${issueOptionsMarkup(issue, draft)}
    ${issue.rule ? `<div class="issue-field"><h6>${t('R 规则', 'R rule')}</h6><pre class="issue-rule" data-i18n-skip>${escape(issue.rule)}</pre></div>` : ''}
    ${issueAppliedMarkup(issue)}
    ${issue.user_action ? `<p class="issue-user">${t('你的处理', 'Your action')}：${escape({accept: t('采纳建议', 'accepted'), choose: t('已选择', 'chose'), limitation: t('记为局限', 'limitation'), dismiss: t('不是问题', 'not an issue'), reopen: t('重新打开', 'reopened')}[issue.user_action.action] || '')}${issue.user_action.option ? ` · <span data-i18n-skip>${escape(issue.user_action.option)}</span>` : ''} · ${escape(prettyDate(issue.user_action.at))}</p>` : ''}
    ${issueActionsMarkup(issue, draft)}
  </article>`;
}

// Mail-style list: one group per status; resolved groups start collapsed.
const ISSUE_GROUPS = ['needs_decision', 'open', 'to_apply', 'limitation', 'applied', 'dismissed'];
const ISSUE_COLLAPSED = new Set(['applied', 'dismissed']);

function issueListMarkup(issues, draft, selected) {
  return ISSUE_GROUPS.map(status => {
    const rows = issues.filter(issue => issue.status === status);
    if (!rows.length) return '';
    const open = draft.groups[status] ?? !ISSUE_COLLAPSED.has(status);
    return `<div class="issue-group${open ? ' open' : ''}"><button type="button" class="issue-group-head" data-issue-group="${status}" aria-expanded="${open}">
      <span>${escape(issueLabel(ISSUE_STATUS[status]))}</span><span>${rows.length}</span></button>
      ${open ? rows.map(issue => `<button type="button" class="issue-row is-${issue.status}${issue.key === selected ? ' selected' : ''}" data-issue-select="${escape(issue.key)}">
        <i aria-hidden="true"></i><strong data-i18n-skip>${escape(issue.title)}</strong><small>${escape(issueMeta(issue).join(' · '))}</small></button>`).join('') : ''}</div>`;
  }).join('');
}

function renderIssueLedger(root) {
  const draft = issueDraft(), ledger = issueLedger(), issues = ledger.issues || [];
  if (ledger.error) {
    root.innerHTML = `<section class="surface"><p class="info-note warning" data-i18n-skip>${escape(ledger.error)}</p></section>`;
    return;
  }
  if (!issues.length) {
    root.innerHTML = `<section class="surface issue-empty"><h4>${t('尚无数据问题记录', 'No data problems recorded yet')}</h4><p>${t('运行数据质检后，QC Agent 会在固定检查之外主动调查数据，并把每个问题和处理建议记录在这里。', 'After QC runs, the QC Agent investigates beyond the fixed checklist and records each problem with a proposal here.')}</p><button type="button" class="secondary-button" data-go="qc">${t('去数据质检 →', 'Go to QC →')}</button></section>`;
    root.querySelectorAll('[data-go]').forEach(button => { button.onclick = () => navigate(button.dataset.go); });
    return;
  }
  const ordered = ISSUE_GROUPS.flatMap(status => issues.filter(issue => issue.status === status));
  // The detail always belongs to a row the list shows: a pick inside a collapsed group falls back.
  const visible = ordered.filter(issue => draft.groups[issue.status] ?? !ISSUE_COLLAPSED.has(issue.status));
  const selected = visible.find(issue => issue.key === draft.selected) || visible[0] || ordered[0];
  draft.selected = selected.key;
  const pending = pendingDecisions(issues).length;
  root.innerHTML = `<div class="issue-ledger">${issueFunnelMarkup(ledger)}
    <div class="issue-split"><nav class="issue-list-pane" aria-label="${t('问题列表', 'Issues')}">${issueListMarkup(issues, draft, selected.key)}</nav>
      <div class="issue-detail-pane">${issueDetailMarkup(selected, draft)}</div></div>
    ${pending > 1 ? `<div class="floating-bar"><span>${t(`${pending} 项待决定`, `${pending} to decide`)}</span><button type="button" class="primary-button" id="acceptRecommended" ${draft.saving ? 'disabled' : ''}>${t('全部采纳推荐选项', 'Accept all recommended options')}</button></div>` : ''}</div>`;
  wireIssueLedger(root, draft);
}

// Decisions still waiting, each with the option the Agent recommends first.
function pendingDecisions(issues) {
  return issues.filter(issue => issue.status === 'needs_decision' && (issue.options || []).length);
}

async function acceptRecommended(draft) {
  if (draft.saving) return;
  draft.saving = 'bulk';
  try {
    for (const issue of pendingDecisions(issueLedger().issues || [])) {
      await api(`/api/runs/${encodeURIComponent(runId)}/issues`, {key: issue.key, action: 'choose', option: issue.options[0], note: 'Accepted the recommended option in bulk.'});
    }
    await refresh();
  } finally {
    draft.saving = '';
    rerenderIssueLedger();
  }
}

function wireIssueLedger(root, draft) {
  const bulk = root.querySelector('#acceptRecommended');
  if (bulk) bulk.onclick = () => action(() => acceptRecommended(draft));
  root.querySelectorAll('[data-issue-group]').forEach(button => {
    button.onclick = () => { draft.groups[button.dataset.issueGroup] = button.getAttribute('aria-expanded') !== 'true'; renderIssueLedger(root); };
  });
  root.querySelectorAll('[data-issue-select]').forEach(button => {
    button.onclick = () => { draft.selected = button.dataset.issueSelect; renderIssueLedger(root); };
  });
  root.querySelectorAll('[data-issue-pick]').forEach(input => {
    input.onchange = () => { draft.choice[input.dataset.issuePick] = input.value; renderIssueLedger(root); };
  });
  root.querySelectorAll('[data-issue-choose]').forEach(button => {
    const key = button.dataset.issueChoose, issue = (issueLedger().issues || []).find(item => item.key === key);
    button.onclick = () => action(() => actOnIssue(draft, {key, action: 'choose', option: draft.choice[key] ?? issue?.options?.[0]}));
  });
  root.querySelectorAll('[data-issue-action]').forEach(button => {
    button.onclick = () => action(() => actOnIssue(draft, {key: button.dataset.issueKey, action: button.dataset.issueAction}));
  });
}

async function actOnIssue(draft, body) {
  if (draft.saving) return;
  draft.saving = body.key;
  try {
    await api(`/api/runs/${encodeURIComponent(runId)}/issues`, body);
    await refresh();
  } finally {
    draft.saving = '';
    rerenderIssueLedger();
  }
}

// The page drew its buttons disabled while saving; draw it again once the save is over.
function rerenderIssueLedger() {
  if (page === 'issues') renderIssueLedger($('#stepContent'));
}

function issueNavStatus() {
  const total = issueLedger().funnel?.total || {};
  if (!total.found) return null;
  if (total.needs_decision) return {raw: 'needs_input', text: t(`${total.needs_decision} 待决定`, `${total.needs_decision} to decide`)};
  if (total.unresolved) return {raw: 'running', text: t(`${total.unresolved} 未解决`, `${total.unresolved} open`)};
  return {raw: 'completed', text: t('已全部处理', 'All handled')};
}

// The step pages render their own content; the strip goes first and survives their re-renders.
function mountIssueStrip(root) {
  const node = {qc: 'qc', preparation: 'analysis_data', exposure: 'er'}[page];
  const markup = node ? issueFunnelStrip(node) : '';
  let host = root.parentElement?.querySelector(':scope > .issue-strip-host');
  if (!markup) { host?.remove(); return; }
  if (!host) {
    host = document.createElement('div');
    host.className = 'issue-strip-host';
    root.before(host);
  }
  host.innerHTML = markup;
  wireIssueStrip(host);
}
