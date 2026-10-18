/* Page 6: exposure metrics (Core 3, AZ decision tree) and exposure-response (Core 4).
   The Agent computes AE timing, finds an existing model output and proposes candidate metrics;
   the user accepts, changes or holds each one; the Agent builds the exposure dataset; the user
   adopts it, and the analysis workbench plots exposure-response with the AZ three-panel figure. */
stages.exposure = ['暴露–效应', 'Exposure-response'];
pageNotes.exposure = ['确定暴露指标并生成暴露数据集，再在工作台查看暴露与疗效、安全性终点的关系。', 'Exposure metrics and exposure-response.'];
// The AZ Core 3 decision tree: accept, change or hold each candidate metric.
const METRIC_CHOICES = () => [['accept', t('采纳', 'Accept')], ['change', t('修改', 'Change')], ['hold', t('暂缓', 'Hold')]];
const ROUTE_TEXT = {model: '已有 PopPK 模型（posthoc）', nca: 'NCA', observed: '仅观测浓度（AUC 不可得）'};
const READINESS_TEXT = {
  ready: '可进入正式建模', conditional: '有条件进入建模',
  exploration_only: '仅适合探索', not_supported: '当前数据不支持',
};

function exposureDraft() {
  const key = `exposure:${runId}`;
  if (!uiDrafts.has(key)) uiDrafts.set(key, {instruction: '', choices: {}, edits: {}});
  return uiDrafts.get(key);
}

const phaseOf = agent => agent?.parameters?.phase || latestAnalysisTurn(agent)?.parameters?.phase || 'er';
const metricsAgent = () => currentAgents('exposure-response').find(agent => phaseOf(agent) === 'metrics');
const erAgent = () => currentAgents('exposure-response').find(agent => phaseOf(agent) === 'er');
// A step run again starts a new Agent; the page shows the newest one.
const newestPhaseAgent = phase => currentAgents('exposure-response').filter(agent => phaseOf(agent) === phase)
  .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
const modelingAgent = () => newestPhaseAgent('modeling');
const reportAgent = () => newestPhaseAgent('report');
// Analysis Data roles published after this Agent started (for example time-to-event data).
const newDataRoles = agent => (snapshot?.analysis_data?.tables || []).map(table => table.role)
  .filter(role => role && !(agent?.inputs || []).some(input => String(input.path || '').includes(({tte: 'time_to_event', event: 'safety_events', response: 'response_events', ada: 'ada_immunogenicity'})[role] || role)));

// The shared failed-step block (conversation-controls.js); empty when the step did not fail.
const retryMarkup = (...args) => (typeof stepRetryMarkup === 'function' ? stepRetryMarkup(...args) : '');

// A step that stopped to ask shows its question here; an answer chip opens that task's conversation.
function waitingQuestionMarkup(agent, turn) {
  if (turn?.status !== 'needs_input' || !(turn.result?.questions || []).length) return '';
  return `<div class="agent-waiting" data-question-agent="${escape(agent.id)}">${turn.result.questions.map(question => `<p class="agent-question" data-i18n-skip>${escape(question)}</p>`).join('')}
    ${typeof answerOptionsMarkup === 'function' ? answerOptionsMarkup(turn.result.answer_options) : ''}</div>`;
}

// The task panel already lists every step's conversation, so the heading carries no button.
function agentHead(turn, title) {
  return `<div class="module-heading"><div><strong>${escape(title)}</strong><span>${escape(prettyDate(turn.created_at))} · ${escape(statusText(turn.status))}</span></div></div>`;
}

// Step 3 of the decision tree: a ticked metric is used, an unticked one is held, "修改…" changes it.
function candidateMarkup(turn, draft) {
  const proposals = turn.result?.proposals || [];
  return `<table class="metric-table"><colgroup><col style="width:44px"><col><col style="width:96px"></colgroup>
    <thead><tr><th>${t('纳入', 'Use')}</th><th>${t('指标与窗口', 'Metric and window')}</th><th></th></tr></thead><tbody>${proposals.map(item => {
    const choice = draft.choices[item.id] || 'accept', id = escape(item.id);
    const [name, ...window] = String(item.value).split(', ');
    return `<tr class="metric-candidate is-${choice}"><td><input type="checkbox" data-metric-use="${id}" ${choice === 'hold' ? '' : 'checked'} aria-label="${t('纳入', 'Use')} ${escape(name)}"></td>
      <td><strong data-i18n-skip>${escape(name)}</strong>${window.length ? `<small data-i18n-skip>${escape(window.join(', '))}</small>` : ''}${basisMarkup(item.basis)}
      ${choice === 'change' ? `<textarea data-metric-edit="${id}" rows="2" maxlength="600" placeholder="写下修改后的定义">${escape(draft.edits[item.id] ?? item.value)}</textarea>` : ''}</td>
      <td class="metric-edit"><button type="button" class="secondary-button" data-metric="${id}" data-choice="${choice === 'change' ? 'accept' : 'change'}">${choice === 'change' ? t('取消修改', 'Undo change') : t('修改…', 'Change…')}</button></td></tr>`;
  }).join('')}</tbody></table>`;
}

// The page's one decision: how many metrics go in, and the button that builds the dataset.
function metricsDecisionBar(turn, draft) {
  const proposals = turn.result?.proposals || [];
  const held = proposals.filter(item => draft.choices[item.id] === 'hold').length;
  return `<div class="floating-bar"><span>${t(`${proposals.length - held} 项纳入 · ${held} 项暂缓`, `${proposals.length - held} used · ${held} held`)}</span>
    <button type="button" class="primary-button" id="confirmMetrics" ${draft.sending || held === proposals.length ? 'disabled' : ''}>${t('生成暴露数据集', 'Build exposure dataset')}</button></div>`;
}

function metricDecisionText(turn, draft) {
  const lines = (turn.result?.proposals || []).map(item => {
    const choice = draft.choices[item.id] || 'accept';
    if (choice === 'change') return `- ${item.id}: change to "${String(draft.edits[item.id] ?? item.value).trim()}"`;
    return `- ${item.id}: ${choice === 'hold' ? 'hold (needs further investigation, do not use)' : 'accept'}`;
  });
  return `Metric decisions:\n${lines.join('\n')}\nGenerate the exposure dataset from the accepted and changed metrics only.`;
}

function metricsMarkup(agent, draft) {
  if (!agent) return `<section class="surface"><h4>1. 暴露指标</h4>
    <p>Agent 先计算每个 AE 距首剂和距最近一次给药的时间，查找已有 PopPK 模型输出，再推荐候选暴露指标；每个指标由你采纳、修改或暂缓。</p>
    <label class="exposure-instruction">补充要求（可选）<textarea name="instruction" rows="2" maxlength="2000" placeholder="可留空">${escape(draft.instruction)}</textarea></label>
    <div class="exposure-actions"><span></span><button type="button" class="primary-button" id="startMetrics" ${draft.sending ? 'disabled' : ''}>${draft.sending ? '正在启动…' : '开始 →'}</button></div></section>`;
  const turn = latestAnalysisTurn(agent);
  const head = agentHead(turn, '1. 暴露指标');
  if (['queued', 'running'].includes(turn.status)) {
    const generating = (agent.turns || []).some(item => item.status === 'needs_input');
    return `<section class="surface">${head}<p class="info-note"><span class="spinner" aria-hidden="true"></span> ${generating ? 'Agent 正在按你的决定生成暴露数据集…' : 'Agent 正在计算 AE 时间、识别模型输出并推荐指标…'}</p></section>`;
  }
  if (turn.status === 'needs_input' && (turn.result?.proposals || []).length) return `<section class="surface">${head}
    <p data-i18n-skip>${escape(turn.result?.message || '')}</p><h5>候选暴露指标</h5>${candidateMarkup(turn, draft)}
    ${metricsDecisionBar(turn, draft)}</section>`;
  const retry = retryMarkup(turn, agent.id);
  if (retry) return `<section class="surface">${head}${retry}</section>`;
  if (turn.status !== 'completed') return `<section class="surface">${head}<p class="info-note warning" data-i18n-skip>${escape(turn.error || turn.result?.message || '本次没有完成。')}</p>
    ${(turn.result?.questions || []).map(question => `<p class="agent-question" data-i18n-skip>${escape(question)}</p>`).join('')}${typeof answerOptionsMarkup === 'function' ? answerOptionsMarkup(turn.result?.answer_options) : ''}</section>`;
  const frame = snapshot?.exposure_frame;
  const adopted = frame && !frame.stale && frame.turn_id === turn.id;
  return `<section class="surface">${head}${agent.stale ? '<p class="info-note warning">数据已更新，这份暴露数据集基于旧版本，请重新生成。</p>' : ''}
    <iframe class="report-frame" id="metricsReport" title="暴露指标报告"></iframe>
    <div class="exposure-actions"><span>${adopted ? '✓ 已采用，后续分析只使用这份数据集' : '修改请在右侧对话中说明，Agent 会重新生成。'}</span>
    ${adopted ? '' : `<button type="button" class="primary-button" id="adoptFrame" data-turn="${escape(turn.id)}" data-agent="${escape(agent.id)}" ${agent.stale ? 'disabled' : ''}>采用此暴露数据集 →</button>`}</div></section>`;
}

function readinessMarkup(turn) {
  const readiness = turn?.result?.sections?.readiness;
  if (!readiness?.value) return '';
  const reasons = (readiness.reasons || []).slice(0, 4).map(reason =>
    `<li>${escape(typeof reason === 'string' ? reason : JSON.stringify(reason))}</li>`).join('');
  return `<div class="readiness-card readiness-${escape(readiness.value)}"><span class="readiness-label">建模准备度</span>
    <strong>${escape(READINESS_TEXT[readiness.value] || readiness.value)}</strong><ul>${reasons}</ul></div>`;
}

function erMarkup(frame) {
  if (!frame || frame.stale) return `<section class="surface is-locked"><h4>2. 暴露–效应</h4><p>采用暴露数据集后开始。</p></section>`;
  const agent = erAgent(), turn = latestAnalysisTurn(agent);
  const metrics = (frame.metrics || []).map(item => escape(item.name || item.column)).join('；');
  const report = !agent ? '<button type="button" class="secondary-button" id="startEr">生成 ER 解读与建模准备度</button>'
    : ['queued', 'running'].includes(turn?.status) ? '<p class="info-note"><span class="spinner" aria-hidden="true"></span> Agent 正在写 ER 解读…</p>'
      : turn?.status === 'completed' ? `${readinessMarkup(turn)}<iframe class="report-frame" id="exposureReport" title="暴露–效应报告"></iframe>`
        : retryMarkup(turn, agent.id, '<button type="button" class="secondary-button" id="startEr">重新生成 ER 解读</button>')
          || `${waitingQuestionMarkup(agent, turn)}<p class="info-note warning" data-i18n-skip>${escape(turn?.error || turn?.result?.message || '本次没有完成。')}</p><button type="button" class="secondary-button" id="startEr">重新生成 ER 解读</button>`;
  const notable = frame.notable_subjects || [];
  const notableMarkup = notable.length ? `<details class="notable-subjects"><summary>${t(`值得关注的受试者 ${notable.length} 名（不排除任何人）`, `${notable.length} notable subjects (no one is excluded)`)}</summary><ul data-i18n-skip>${notable.map(item => `<li><strong>${escape(item.subject)}</strong> · ${escape(item.metric || '')}${item.value != null ? ` = ${escape(item.value)}` : ''}${item.cohort_median != null ? ` (${escape(t('组中位', 'group median'))} ${escape(item.cohort_median)})` : ''} — ${escape(item.reason || '')}</li>`).join('')}</ul></details>` : '';
  return `<section class="surface"><h4>2. 暴露–效应</h4>
    <p>路线：${escape(ROUTE_TEXT[frame.route] || frame.route)} · 指标：<span data-i18n-skip>${metrics}</span></p>${notableMarkup}
    <div class="exposure-actions"><span>在工作台选择终点和暴露指标，查看三联图（与 PK 图同一工作台）。</span><button type="button" class="primary-button" id="openErWorkbench">打开暴露–效应图 →</button></div>
    ${report}</section>`;
}

// Core 5: the models the AZ framework names, fitted or skipped with a reason, on the adopted dataset.
function modelSummaryMarkup(turn) {
  const summary = turn?.result?.sections?.model_summary || {};
  const rows = Object.entries(summary).map(([type, counts]) => `<li><strong>${type === 'time_to_event' ? t('时间-事件终点', 'Time-to-event endpoints') : t('二分类终点', 'Binary endpoints')}</strong><span>${t(`拟合 ${counts.fitted} 个模型 · 跳过 ${counts.skipped} 个`, `${counts.fitted} models fitted · ${counts.skipped} skipped`)}</span><small data-i18n-skip>${escape((counts.endpoints || []).join(', '))}</small></li>`).join('');
  return rows ? `<ul class="model-summary">${rows}</ul>` : '';
}

function modelingMarkup(frame) {
  if (!frame || frame.stale) return `<section class="surface is-locked"><h4>${t('3. 统计建模', '3. Statistical modeling')}</h4><p>${t('采用暴露数据集后开始。', 'Starts after an exposure dataset is adopted.')}</p></section>`;
  const agent = modelingAgent(), turn = latestAnalysisTurn(agent);
  const intro = `<p>${t('二分类终点做逻辑回归（每 IQR 的 OR）；时间-事件终点做按暴露二分位、四分位和剂量分组的 KM 与 Cox 模型（每 IQR 的 HR，必要时校正剂量）。数据不足以支持的模型会跳过并写明原因。', 'Logistic regression (OR per IQR) for binary endpoints; Kaplan-Meier by exposure halves, quartiles and dose, and Cox models (HR per IQR, dose-adjusted when justified) for time-to-event endpoints. Models the data cannot support are skipped with the reason.')}</p>`;
  const body = !agent ? `<div class="exposure-actions"><span>${t('结果为探索性分析，不做确证性结论。', 'Results are exploratory, not confirmatory.')}</span><button type="button" class="primary-button" id="startModeling">${t('开始统计建模 →', 'Start modeling →')}</button></div>`
    : ['queued', 'running'].includes(turn?.status) ? `<p class="info-note"><span class="spinner" aria-hidden="true"></span> ${t('Agent 正在拟合模型并做诊断…', 'The Agent is fitting models and running diagnostics…')}</p>`
      : turn?.status === 'completed' ? `${(typeof modelResultsMarkup === 'function' && modelResultsMarkup(turn)) || modelSummaryMarkup(turn)}${newDataRoles(agent).includes('tte') ? `<p class="info-note">${t('Analysis Data 现在包含时间-事件数据，重新建模即可加入 KM 与 Cox 分析。', 'Analysis Data now includes time-to-event data; run modeling again to add Kaplan-Meier and Cox analyses.')}</p>` : ''}<details class="report-fold"><summary>${t('完整建模报告（含 KM 与森林图）', 'Full modeling report (KM and forest figures)')}</summary><iframe class="report-frame" id="modelingReport" title="${t('统计建模报告', 'Statistical modeling report')}"></iframe></details><div class="exposure-actions"><span></span><button type="button" class="secondary-button" id="startModeling">${t('重新建模', 'Run modeling again')}</button></div>`
        : retryMarkup(turn, agent.id, `<button type="button" class="secondary-button" id="startModeling">${t('重新建模', 'Run modeling again')}</button>`)
          || `${waitingQuestionMarkup(agent, turn)}<p class="info-note warning" data-i18n-skip>${escape(turn?.error || turn?.result?.message || t('本次没有完成。', 'This run did not finish.'))}</p><button type="button" class="secondary-button" id="startModeling">${t('重新建模', 'Run modeling again')}</button>`;
  return `<section class="surface">${agent && turn ? agentHead(turn, t('3. 统计建模', '3. Statistical modeling')) : `<h4>${t('3. 统计建模', '3. Statistical modeling')}</h4>`}${agent ? '' : intro}${body}</section>`;
}

// Core 6: the review report assembled from the current results; each key finding names its step.
function keyFindingsMarkup(turn) {
  const findings = turn?.result?.sections?.key_findings || [];
  if (!findings.length) return '';
  const item = finding => `<li><span class="key-finding-head" data-i18n-skip>${escape(finding.endpoint)} · ${escape(finding.metric)}</span><span data-i18n-skip>${escape(finding.finding)}</span><small>${t('证据', 'Evidence')}：<span data-i18n-skip>${escape(finding.evidence)}</span></small></li>`;
  const rest = findings.slice(4);
  return `<ol class="key-findings">${findings.slice(0, 4).map(item).join('')}</ol>${rest.length ? `<details class="key-findings-more"><summary>${t(`其余 ${rest.length} 条关键结论`, `${rest.length} more key findings`)}</summary><ol class="key-findings" start="5">${rest.map(item).join('')}</ol></details>` : ''}`;
}

function reviewReportMarkup(frame) {
  const title = t('4. 评审报告', '4. Review report');
  if (!frame || frame.stale) return `<section class="surface is-locked"><h4>${title}</h4><p>${t('采用暴露数据集后开始。', 'Starts after an exposure dataset is adopted.')}</p></section>`;
  const agent = reportAgent(), turn = latestAnalysisTurn(agent);
  const modeled = latestAnalysisTurn(modelingAgent())?.status === 'completed';
  const intro = `<p>${t('汇编前面各步骤的当前结果、问题台账和研究口径，形成给评审专家的报告；不新增任何统计结果。', 'Assembles the current results of every step, the issue ledger and the study decisions into one report for expert review; no new statistics.')}</p>`;
  const body = !agent ? `<div class="exposure-actions"><span>${modeled ? '' : t('建议先完成统计建模。', 'Finishing statistical modeling first is recommended.')}</span><button type="button" class="${modeled ? 'primary-button' : 'secondary-button'}" id="startReport">${t('生成评审报告 →', 'Build review report →')}</button></div>`
    : ['queued', 'running'].includes(turn?.status) ? `<p class="info-note"><span class="spinner" aria-hidden="true"></span> ${t('Agent 正在汇编报告…', 'The Agent is assembling the report…')}</p>`
      : turn?.status === 'completed' ? `${keyFindingsMarkup(turn)}<div class="exposure-actions"><span></span><button type="button" class="secondary-button" id="startReport">${t('用当前结果重新生成', 'Rebuild from the current results')}</button></div><iframe class="report-frame" id="reviewReport" title="${t('评审报告', 'Review report')}"></iframe>`
        : retryMarkup(turn, agent.id, `<button type="button" class="secondary-button" id="startReport">${t('重新生成', 'Build again')}</button>`)
          || `${waitingQuestionMarkup(agent, turn)}<p class="info-note warning" data-i18n-skip>${escape(turn?.error || turn?.result?.message || t('本次没有完成。', 'This run did not finish.'))}</p><button type="button" class="secondary-button" id="startReport">${t('重新生成', 'Build again')}</button>`;
  return `<section class="surface">${agent && turn ? agentHead(turn, title) : `<h4>${title}</h4>`}${agent ? '' : intro}${body}</section>`;
}

function renderExposure(root) {
  if (snapshot?.analysis_data?.status !== 'ready') {
    root.innerHTML = `<section class="surface"><h4>暴露–效应</h4><p class="info-note">这一步读取已采用的 Analysis Data。请先在 Analysis Data 确认采用数据。</p><button type="button" class="primary-button" data-go="preparation">前往 Analysis Data →</button></section>`;
    wireExposure(root, exposureDraft());
    return;
  }
  const draft = exposureDraft();
  root.innerHTML = `<div class="exposure-workspace">${metricsMarkup(metricsAgent(), draft)}${erMarkup(snapshot?.exposure_frame)}${modelingMarkup(snapshot?.exposure_frame)}${reviewReportMarkup(snapshot?.exposure_frame)}</div>`;
  wireExposure(root, draft);
}

function wireExposure(root, draft) {
  const bind = (selector, handler) => root.querySelectorAll(selector).forEach(element => { element.onclick = () => handler(element); });
  bind('[data-go]', button => navigate(button.dataset.go));
  root.querySelectorAll('[data-question-agent] [data-answer-option]').forEach(button => button.addEventListener('click', () => openAgent(button.closest('[data-question-agent]').dataset.questionAgent)));
  if (typeof wireStepRetry === 'function') wireStepRetry(root);
  const metrics = metricsAgent(), turn = latestAnalysisTurn(metrics), er = latestAnalysisTurn(erAgent());
  if (turn?.status === 'completed' && root.querySelector('#metricsReport')) showReport(turn.id, root.querySelector('#metricsReport'));
  if (er?.status === 'completed' && root.querySelector('#exposureReport')) showReport(er.id, root.querySelector('#exposureReport'));
  const modeling = latestAnalysisTurn(modelingAgent());
  if (modeling?.status === 'completed' && root.querySelector('#modelingReport')) showReport(modeling.id, root.querySelector('#modelingReport'));
  if (typeof wireModelResults === 'function') wireModelResults(root, () => renderExposure(root));
  const review = latestAnalysisTurn(reportAgent());
  if (review?.status === 'completed' && root.querySelector('#reviewReport')) showReport(review.id, root.querySelector('#reviewReport'));
  bind('[data-metric]', button => { draft.choices[button.dataset.metric] = button.dataset.choice; renderExposure(root); });
  root.querySelectorAll('[data-metric-use]').forEach(box => { box.onchange = () => { draft.choices[box.dataset.metricUse] = box.checked ? 'accept' : 'hold'; renderExposure(root); }; });
  root.querySelectorAll('[data-metric-edit]').forEach(box => { box.oninput = () => { draft.edits[box.dataset.metricEdit] = box.value; }; });
  const instruction = root.querySelector('textarea[name="instruction"]');
  if (instruction) instruction.oninput = () => { draft.instruction = instruction.value; };
  bind('#startMetrics', () => action(() => startExposurePhase(root, draft, 'metrics')));
  bind('#confirmMetrics', () => action(() => confirmMetrics(root, draft, metrics, turn)));
  bind('#adoptFrame', button => action(async () => {
    await api(`/api/runs/${encodeURIComponent(runId)}/exposure-frame`, {agent_id: button.dataset.agent, turn_id: button.dataset.turn});
    await refresh();
  }));
  bind('#startEr', () => action(() => startExposurePhase(root, draft, 'er')));
  bind('#startModeling', () => action(() => startExposurePhase(root, draft, 'modeling')));
  bind('#startReport', () => action(() => startExposurePhase(root, draft, 'report')));
  bind('#openErWorkbench', () => action(openExposureWorkbench));
  // Starting a step takes a few seconds; the pressed button says so and the others wait.
  if (draft.sending) root.querySelectorAll('#startEr, #startModeling, #startReport').forEach(button => {
    button.disabled = true;
    if (button.id === draft.starting) button.textContent = t('正在启动…', 'Starting…');
  });
}

async function startExposurePhase(root, draft, phase) {
  if (draft.sending) return;
  const viewRun = runId, metrics = phase === 'metrics';
  draft.sending = true;
  draft.starting = {er: 'startEr', modeling: 'startModeling', report: 'startReport'}[phase] || '';
  draft.idempotencyKey ||= crypto.randomUUID();
  renderExposure(root);
  try {
    const modeling = phase === 'modeling', report = phase === 'report';
    await startAgent('exposure-response', {
      title: metrics ? '暴露指标' : modeling ? '统计建模' : report ? '评审报告' : '暴露–效应解读', idempotency_key: draft.idempotencyKey, cloud_policy: selectedDataPolicy(true),
      message: metrics ? (draft.instruction.trim() || 'Compute AE timing, find existing model outputs and propose candidate exposure metrics.')
        : modeling ? 'Fit the exploratory exposure-response models for every endpoint and confirmed metric, and skip with a reason what the data cannot support.'
          : report ? 'Assemble the exposure-response review report from the current results, the issue ledger and the study decisions.'
            : 'Interpret exposure-response for the adopted exposure dataset and judge readiness for formal modeling.',
      parameters: {phase, instruction: metrics ? draft.instruction.trim() : ''},
    }, metrics ? 'Core 3 exposure metrics.' : modeling ? 'Core 5 statistical modeling.' : report ? 'Core 6 review report.' : 'Core 4 exposure-response interpretation.');
    delete draft.idempotencyKey;
  } finally {
    draft.sending = false;
    if (runId === viewRun) await refresh();
  }
}

async function confirmMetrics(root, draft, agent, turn) {
  if (draft.sending) return;
  const viewRun = runId;
  draft.sending = true;
  renderExposure(root);
  try {
    await api(`/api/agents/${encodeURIComponent(agent.id)}/messages`, {
      run_id: viewRun, message: metricDecisionText(turn, draft), interaction_mode: 'analysis', cloud_policy: selectedDataPolicy(true),
    });
    Object.assign(draft, {choices: {}, edits: {}});
  } finally {
    draft.sending = false;
    if (runId === viewRun) await refresh();
  }
}

// The workbench opens on its exposure-response tab, beside the PK figures.
async function openExposureWorkbench() {
  try {
    await api(`/api/runs/${encodeURIComponent(runId)}/panel-state`, {changes: {view: 'exposure-response'}, base_revision: snapshot?.panel_state?.revision});
  } catch {}
  return openAnalysisWorkbench();
}
