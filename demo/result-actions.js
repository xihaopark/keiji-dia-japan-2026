/* User actions on completed results: finding hand-off and version labels. No scientific computation.
   Revisions go through the conversation composer's explicit mode (conversation-controls.js). */

// rerun_agent sends this fixed instruction; show it as a re-check rather than a user edit.
const RERUN_INSTRUCTION_PREFIX = 'Apply the repair discussed in this Agent conversation';

function versionChangeNote(task) {
  if (!task?.resume) return '';
  const request = String(task.parameters?.user_message || '').trim();
  if (!request) return '';
  if (request.startsWith(RERUN_INSTRUCTION_PREFIX)) return '重新校验';
  // QC hand-offs list one "- [finding_id] ..." line per selected finding.
  const handedOff = task.kind === 'erqc' ? request.split('\n').filter(line => line.startsWith('- [')).length : 0;
  if (handedOff) return `处理所选问题 ${handedOff} 项`;
  return `修改：${request.length > 24 ? `${request.slice(0, 24)}…` : request}`;
}

function resultVersionLabel(task) {
  const note = versionChangeNote(task);
  return `${prettyDate(task.created_at)} · ${statusText(task.status)}${task.stale ? ' · 数据已更新' : ''}${note ? ` · ${note}` : ''}`;
}

// A batch keeps its bound Summary, unless the same Agent later produced a revision of it.
function defaultSummaryReport(choices, batch) {
  const fallback = choices.find(report => report.status === 'completed')?.id || choices[0]?.id || '';
  if (!batch) return fallback;
  const bound = batch.stages?.summary?.output_turn_id || '';
  const boundReport = choices.find(report => report.id === bound);
  const revision = boundReport && choices.find(report => report.agent_id === boundReport.agent_id
    && report.status === 'completed' && report.resume
    && String(report.created_at) > String(boundReport.created_at));
  return revision?.id || boundReport?.id || fallback;
}

/* QC findings: readable cards, subject links, tracking and hand-off to the QC Agent. */
const findingLevelText = level => ({
  critical: t('严重','Critical'), block: t('严重','Critical'), hard: t('严重','Critical'),
  high: t('高','High'), moderate: t('中','Moderate'), medium: t('中','Moderate'),
  low: t('低','Low'), review: t('需核对','Review'), info: t('提示','Info'),
})[String(level || '').toLowerCase()] || level || '';
const findingActions = () => [
  ['recorded', t('已知晓，保留','Acknowledge'), t('此发现不影响后续准备，记录保留原因。','Keep the data as is and record why.')],
  ['awaiting_information', t('待补充信息','Needs information'), t('需要数据方或研究方线下补充后再处理。','Waiting for information from the data or study team.')],
  ['resolved', t('已解决','Resolved'), t('已处理此发现，记录解决依据。','Record how this finding was resolved.')],
];
const findingActionText = action => findingActions().find(([value]) => value === action)?.[1] || action;
const findingKey = (finding, index) => String(finding.id || index);

function latestFindingAction(task, key) {
  return (task.finding_actions || []).filter(action => action.finding_id === key).at(-1)?.action || '';
}

// Open items: High/Critical findings without any handling, and findings waiting for information.
// A finding the issue ledger already carries (proposed, decided, applied) is handled there.
function ledgerHandles(finding) {
  if (typeof issueLedger !== 'function') return false;
  const id = String(finding.id || finding.finding_id || '');
  const issue = (issueLedger().issues || []).find(item => item.finding_id === id);
  return Boolean(issue && issue.status !== 'open' && issue.status !== 'needs_decision');
}

function findingTracking(task, findings) {
  const urgent = [], waiting = [];
  findings.forEach((finding, index) => {
    const handled = latestFindingAction(task, findingKey(finding, index)) || (ledgerHandles(finding) ? 'ledger' : '');
    const level = String(finding.priority || finding.severity || '').toLowerCase();
    if (!handled && ['critical', 'high'].includes(level)) urgent.push(finding);
    if (handled === 'awaiting_information') waiting.push(finding);
  });
  return {urgent, waiting};
}

function findingTrackingMarkup(task, findings) {
  const {urgent, waiting} = findingTracking(task, findings);
  if (!urgent.length && !waiting.length) return findings.length ? `<p class="finding-tracking">${t('高或严重级别的问题均已记录处理。','Every high or critical finding has a handling record.')}</p>` : '';
  const inLedger = typeof issueLedger === 'function' && (issueLedger().issues || []).length;
  if (inLedger) return `<div class="finding-tracking info-note"><strong>${t('待跟踪','To track')}</strong><p>${t(`${urgent.length + waiting.length} 条高或严重级别的发现还在等你决定或补充信息。`, `${urgent.length + waiting.length} high or critical findings still wait for a decision or information.`)} <button type="button" class="link-button" data-go-issues>${t('在问题台账中处理 →', 'Handle in the issue ledger →')}</button></p></div>`;
  const names = items => items.map(item => escape(item.message || item.finding || item.id)).join('；');
  return `<div class="finding-tracking info-note"><strong>${t('待跟踪','To track')}</strong>${urgent.length ? `<p>${t('高或严重、尚未处理','High or critical, not yet handled')} ${urgent.length}：${names(urgent)}</p>` : ''}${waiting.length ? `<p>${t('待补充信息','Waiting for information')} ${waiting.length}：${names(waiting)}</p>` : ''}</div>`;
}

function findingScopeMarkup(finding) {
  const parts = [];
  if (finding.source_files) parts.push(`${t('数据集','Dataset')} ${escape(finding.source_files)}`);
  if (finding.variable) parts.push(`${t('字段','Field')} ${escape(finding.variable)}`);
  if (Number.isInteger(finding.affected_n)) parts.push(`${t('涉及','Affected')} ${finding.affected_n}`);
  return parts.length ? `<p class="finding-scope">${parts.join(' · ')}</p>` : '';
}

function findingCard(task, finding, index, selectable) {
  const level = findingLevelText(finding.priority || finding.severity || finding.status);
  const key = findingKey(finding, index);
  const subjects = task.kind === 'erqc' && finding.affected_n > 0
    ? `<details class="finding-subjects" data-subjects="${index}"><summary>${t('查看受试者','Show subjects')}</summary><p>${t('展开后读取…','Loads when opened…')}</p></details>` : '';
  return `<article class="finding" data-finding-index="${index}">
    ${selectable ? `<label class="finding-select"><input type="checkbox" data-select-finding="${index}"> ${t('选择','Select')}</label>` : ''}
    <strong>${level ? `<span class="status-badge finding-level">${escape(level)}</span> ` : ''}${escape(finding.message || finding.finding || finding.id)}</strong>
    ${findingScopeMarkup(finding)}<p>${escape(finding.evidence || '')}</p><p>${escape(finding.recommendation || finding.recommended_action || '')}</p>${subjects}
    <div class="live-actions">${findingActions().map(([value, label, hint]) =>
      `<button class="secondary-button" data-handle="${index}" data-action="${value}" title="${escape(hint)}">${label}</button>`).join('')}</div>
    ${(task.finding_actions || []).filter(action => action.finding_id === key).map(action =>
      `<p>${escape(findingActionText(action.action))} · ${escape(action.note)}</p>`).join('')}</article>`;
}

const FINDING_RANK = {critical: 4, high: 3, moderate: 2, medium: 2, low: 1};
const findingRank = finding => FINDING_RANK[String(finding.priority || finding.severity || '').toLowerCase()] || 0;

// Findings of one rule stay together; order groups by their most severe finding.
function findingGroups(findings) {
  const groups = new Map();
  findings.forEach((finding, index) => {
    const key = finding.check_id || finding.id || String(index);
    if (!groups.has(key)) groups.set(key, {key, indices: []});
    groups.get(key).indices.push(index);
  });
  const top = group => Math.max(...group.indices.map(index => findingRank(findings[index])));
  return [...groups.values()].sort((a, b) => top(b) - top(a) || a.indices[0] - b.indices[0]);
}

function findingGroupMarkup(task, findings, group, selectable) {
  const cards = group.indices.map(index => findingCard(task, findings[index], index, selectable)).join('');
  if (group.indices.length <= 2) return cards;
  const worst = group.indices.map(index => findings[index]).sort((a, b) => findingRank(b) - findingRank(a))[0];
  const rule = (typeof defaultQCRules === 'function' ? defaultQCRules().find(item => item.check_id === group.key)?.name : '') || group.key;
  const level = findingLevelText(worst.priority || worst.severity);
  return `<details class="finding-group"${findingRank(worst) >= 3 ? ' open' : ''}><summary>${level ? `<span class="status-badge finding-level">${escape(level)}</span> ` : ''}<strong>${escape(rule)}</strong><span>${group.indices.length} 条同类发现</span></summary>${cards}</details>`;
}

function renderFindings(task) {
  const findings = task.result?.findings || [];
  // Only the QC Agent's own current result can be handed back to it for a revision.
  const selectable = task.kind === 'erqc' && Boolean(task.agent_id) && !task.stale && findings.length > 0;
  const toolbar = selectable ? `<div class="finding-toolbar"><span id="findingSelection">${t('已选 0 项','0 selected')}</span><button type="button" class="primary-button" id="handleSelectedFindings" disabled>${t('交给 QC Agent 处理所选问题','Send selected findings to the QC Agent')}</button></div>` : '';
  $('#findings').innerHTML = findingReviewMarkup(task, findings) + findingTrackingMarkup(task, findings) + toolbar
    + (findingGroups(findings).map(group => findingGroupMarkup(task, findings, group, selectable)).join('')
      || empty('任务结果将在这里显示','Task findings will appear here'));
  wireFindingCards(task, findings);
  wireFindingReviews(task);
  if (typeof wireIssueStrip === 'function') wireIssueStrip($('#findings'));
  if (selectable) wireFindingSelection(task, findings);
}

/* After a hand-off the QC Agent returns a verdict per finding; the user adopts it in one click
   and the result goes where it belongs: a handling record, Analysis Data, or an exclusion proposal. */
const REVIEW_VERDICT = () => ({false_positive: t('误报', 'False positive'), confirmed: t('确认存在', 'Confirmed'), corrected: t('已修正', 'Corrected')});
const REVIEW_STEP = () => ({none: t('无需进一步处理', 'No further action'), analysis_data: t('在 Analysis Data 中处理', 'Handle in Analysis Data'),
  exclude_subjects: t('建议排除受试者', 'Proposes excluding subjects'), data_team: t('需数据方补充信息', 'Needs information from the data team')});
const reviewAdopted = (task, review) => (task.finding_actions || []).some(item => item.finding_id === review.id && String(item.note).startsWith('Agent re-check'));

function reviewAction(review) {
  if (review.verdict !== 'confirmed') return 'resolved';
  return review.next_step === 'data_team' ? 'awaiting_information' : 'recorded';
}

function previousQcFindings(task) {
  const agent = typeof currentAgents === 'function' ? currentAgents('erqc').find(item => item.id === task.agent_id) : null;
  const turns = (agent?.turns || []).filter(turn => turn.status === 'completed' && turn.id !== task.id && turn.created_at < task.created_at);
  return turns.at(-1)?.result?.findings || null;
}

function findingReviewMarkup(task, findings) {
  const reviews = task.result?.finding_reviews || [];
  if (!reviews.length) return '';
  const present = new Set(findings.map((finding, index) => findingKey(finding, index)));
  const previous = previousQcFindings(task);
  const gone = previous ? previous.filter(item => !present.has(String(item.id))).length : 0;
  const added = previous ? findings.filter(item => !previous.some(old => String(old.id) === String(item.id))).length : 0;
  const rows = reviews.map((review, index) => {
    const adopted = reviewAdopted(task, review);
    const button = adopted ? `<span class="review-done">✓ ${t('已采纳', 'Adopted')}</span>`
      : review.next_step === 'exclude_subjects' ? `<button type="button" class="secondary-button" data-review-exclude="${index}">${t('评估排除影响', 'Assess the exclusion')}</button>`
        : `<button type="button" class="secondary-button" data-review-adopt="${index}">${review.next_step === 'analysis_data' ? t('采纳并带到 Analysis Data', 'Adopt and carry to Analysis Data') : t('采纳', 'Adopt')}</button>`;
    return `<li class="review-item verdict-${escape(review.verdict)}"><div><span class="status-badge">${escape(REVIEW_VERDICT()[review.verdict] || review.verdict)}</span>
      <strong data-i18n-skip>${escape(review.id)}</strong>${present.has(review.id) ? '' : `<em>${t('本版已不再报告', 'No longer reported in this version')}</em>`}</div>
      <p data-i18n-skip>${escape(review.reason)}</p><div class="review-foot"><span>${escape(REVIEW_STEP()[review.next_step] || review.next_step)}</span>${button}</div></li>`;
  }).join('');
  const pending = reviews.some(review => !reviewAdopted(task, review) && review.next_step !== 'exclude_subjects');
  return `<section class="finding-reviews"><div class="review-head"><strong>${t('Agent 复核结果', 'Agent re-check')}</strong>
    ${previous ? `<span>${t(`与上一版相比：${gone} 条不再报告，${added} 条新增`, `Against the previous version: ${gone} no longer reported, ${added} new`)}</span>` : ''}
    ${pending ? `<button type="button" class="primary-button" id="adoptAllReviews">${t('全部采纳', 'Adopt all')}</button>` : ''}</div><ol>${rows}</ol></section>`;
}

async function adoptReview(task, review) {
  await api('/api/finding', {run_id: runId, task_id: task.id, finding_id: review.id, action: reviewAction(review),
    note: `Agent re-check: ${review.verdict.replace('_', ' ')}. ${review.reason}`});
  if (review.next_step === 'analysis_data' && typeof preparationDraft === 'function') {
    const draft = preparationDraft(), line = `QC ${review.id}: ${review.reason}`;
    if (!String(draft.plan || '').includes(line)) draft.plan = [String(draft.plan || '').trim(), line].filter(Boolean).join('\n');
  }
}

function wireFindingReviews(task) {
  const reviews = task.result?.finding_reviews || [];
  document.querySelectorAll('[data-review-adopt]').forEach(button => { button.onclick = () => action(async () => {
    button.disabled = true;
    await adoptReview(task, reviews[Number(button.dataset.reviewAdopt)]);
    await refresh();
  }); });
  document.querySelectorAll('#adoptAllReviews').forEach(all => { all.onclick = () => action(async () => {
    all.disabled = true;
    for (const review of reviews) if (!reviewAdopted(task, review) && review.next_step !== 'exclude_subjects') await adoptReview(task, review);
    await refresh();
  }); });
  document.querySelectorAll('[data-review-exclude]').forEach(button => { button.onclick = () => action(async () => {
    const review = reviews[Number(button.dataset.reviewExclude)];
    button.disabled = true;
    const proposal = await api(`/api/runs/${encodeURIComponent(runId)}/selection-proposals`, {subjects: review.subjects, reason: `QC ${review.id}: ${review.reason}`});
    const impacts = (proposal.impacts || []).map(item => `<li>${escape(item.table)}：<strong>${escape(item.affected_rows)}</strong></li>`).join('');
    button.insertAdjacentHTML('afterend', `<div class="selection-proposal"><strong>${t('排除影响', 'Exclusion impact')}</strong><ul>${impacts}</ul><p>${t('确认后创建新的数据筛选版本，不改写源数据；之后的报告需要按新版本重新生成。', 'Confirming creates a new selection version without changing source data; later reports then need regeneration.')}</p><button type="button" class="danger-button" data-confirm-exclusion>${t(`确认排除 ${review.subjects.length} 位受试者`, `Confirm excluding ${review.subjects.length} subjects`)}</button></div>`);
    button.parentElement.querySelector('[data-confirm-exclusion]').onclick = () => action(async () => {
      await api(`/api/runs/${encodeURIComponent(runId)}/selection-proposals/${encodeURIComponent(proposal.id)}/confirm`, {confirmed: true});
      await adoptReview(task, review);
      await refresh();
    });
  }); });
}

function wireFindingCards(task, findings) {
  document.querySelectorAll('[data-finding-index]').forEach(card => {
    card.onclick = event => {
      if (event?.target?.closest?.('input,button,summary,.finding-subjects')) return;
      const finding = findings[Number(card.dataset.findingIndex)];
      document.querySelectorAll('.finding').forEach(value => value.classList.toggle('selected', value === card));
      if (!finding.report_anchor) return;
      try {
        const anchor = $('#qcFrame').contentDocument.getElementById(finding.report_anchor);
        if (anchor) { anchor.scrollIntoView(); anchor.style.background = '#fff4c7'; }
        else notice(t('没有可定位的报告段落，请查看问题证据。','No report anchor available; inspect the finding evidence.'));
      } catch {}
    };
  });
  document.querySelectorAll('[data-handle]').forEach(control => {
    control.onclick = async event => {
      event.stopPropagation();
      const note = await ask(t('处理说明或解决依据','Handling note or resolution evidence'));
      if (!note) return;
      action(async () => {
        const finding = findings[Number(control.dataset.handle)];
        await api('/api/finding', {run_id: runId, task_id: task.id,
          finding_id: findingKey(finding, control.dataset.handle), action: control.dataset.action, note});
        await refresh();
      });
    };
  });
  document.querySelectorAll('[data-subjects]').forEach(details => {
    details.ontoggle = () => { if (details.open) showFindingSubjects(task, findings[Number(details.dataset.subjects)], details); };
  });
}

const findingSubjectCache = new Map();
async function findingSubjectRows(task) {
  if (!findingSubjectCache.has(task.id)) {
    const query = new URLSearchParams({run_id: runId, task_id: task.id, name: 'finding_subject_ids.csv'});
    findingSubjectCache.set(task.id, canvasFetch(`/api/file?${query}`).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error);
      return (await response.text()).trim().split(/\r?\n/).slice(1)
        .map(line => line.split(',').map(value => value.replace(/^"|"$/g, '')));
    }).catch(error => { findingSubjectCache.delete(task.id); throw error; }));
  }
  return findingSubjectCache.get(task.id);
}

async function showFindingSubjects(task, finding, details) {
  const target = details.querySelector('p');
  try {
    const ids = (await findingSubjectRows(task)).filter(([id]) => id === finding.id).map(([, subject]) => subject);
    const shown = ids.slice(0, 200).map(escape).join('，');
    target.textContent = '';
    target.innerHTML = ids.length ? `${shown}${ids.length > 200 ? ` ${t('等，共','… total')} ${ids.length}` : ''}` : t('没有关联的受试者。','No linked subjects.');
  } catch (error) {
    target.textContent = productError(error, t('受试者列表暂时无法读取，请重试。','Subjects could not be loaded; try again.'));
  }
}

function selectedFindingsMessage(findings) {
  return [t('请处理以下 QC 发现：先按本研究前提（例如给药周期设计）复核它们是否成立，必要时修正检查结论并重新生成 QC 结果。不要剔除受试者或修改原始数据；需要剔除或修改时请说明理由并等待确认。',
    'Handle these QC findings: first re-check them against this study\'s premises (for example the dosing-cycle design), correct the conclusions where needed and regenerate the QC result. Do not exclude subjects or change source data; if that seems necessary, explain why and wait for confirmation.'),
  ...findings.map(finding => `- [${finding.id}] ${finding.message || finding.finding || ''}${finding.evidence ? `（${t('证据','evidence')}：${finding.evidence}）` : ''}`)].join('\n');
}

function wireFindingSelection(task, findings) {
  const button = $('#handleSelectedFindings');
  const chosen = () => [...document.querySelectorAll('[data-select-finding]')].filter(input => input.checked)
    .map(input => findings[Number(input.dataset.selectFinding)]);
  document.querySelectorAll('[data-select-finding]').forEach(input => {
    input.onchange = () => {
      const count = chosen().length;
      $('#findingSelection').textContent = t(`已选 ${count} 项`, `${count} selected`);
      button.disabled = count === 0;
    };
  });
  button.onclick = () => action(async () => {
    const selected = chosen();
    if (!selected.length) return;
    button.disabled = true;
    await api(`/api/agents/${encodeURIComponent(task.agent_id)}/messages`, {run_id: runId,
      message: selectedFindingsMessage(selected), cloud_policy: selectedDataPolicy(true), interaction_mode: 'analysis'});
    await refresh(false);
    openAgent(task.agent_id);
  });
}

/* Stale results: re-create the same Summary or QC request against the current data version. */
const REGENERATION_FALLBACK = {
  summary: 'Build the selected Data Summary chapters and return version-bound evidence for main review.',
  erqc: 'Execute the frozen QC checklist and preserve per-rule execution evidence.',
};

function regenerationParameters(task) {
  const previous = task.parameters || {};
  return task.kind === 'summary'
    ? {chapters: previous.chapters || [], template: 'er-default', instruction: previous.instruction || ''}
    : {instruction: previous.instruction || '', qc_rules: previous.qc_rules};
}

function regenerateWithLatestData(task) {
  return action(async () => {
    if (!task) return;
    const parameters = regenerationParameters(task);
    await startAgent(task.kind, {title: taskName(task.kind), parameters, message: parameters.instruction,
      cloud_policy: selectedDataPolicy(true)}, REGENERATION_FALLBACK[task.kind]);
    await refresh(false);
  });
}
