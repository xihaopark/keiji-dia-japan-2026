/* Conversation controls and stable DOM updates. No task or scientific state ownership. */
const ConversationControls = (() => {
  function shell() {
    return `<div class="agent-scroll"><div id="agentList" class="agent-conversation-list" role="tablist" aria-label="分析任务列表"></div>
      <section id="agentDetail" class="agent-detail" aria-live="polite">
        <header id="activeAgentHeader" class="active-agent-header"></header>
        <div id="agentSummary" class="agent-summary conversation-markdown"></div>
        <div id="agentProgress" class="agent-progress" aria-label="任务步骤"></div>
        <details class="agent-history"><summary>详情与历史记录</summary><p id="agentRevisions" class="agent-revisions"></p><div id="conversationTurns" class="conversation-turns" tabindex="0" aria-label="历史记录"></div></details>
      </section></div>
      <form id="agentMessage" class="chat-composer">
        <label class="conversation-mode">本次操作 <select id="agentMessageMode" aria-label="本次对话操作">
          <option value="conversation">讨论 / 解释（不修改结果）</option>
          <option value="analysis">执行 / 修改（按任务设置）</option>
          <option value="batch_continue" hidden>回答并继续暂停批次（不修改所选报告）</option>
        </select></label>
        <small id="agentMessageScope" class="conversation-scope"></small>
        <textarea name="message" rows="3" required maxlength="100000" aria-label="继续当前分析任务" placeholder="继续当前分析任务…"></textarea>
        <div class="composer-bottom"><span id="messageError" class="error" role="alert"></span><button id="sendMessage" class="send-button">发送 ↑</button></div>
      </form>`;
  }

  function updateMode(select, agent, batches, identity, disabled) {
    const batchReply = Boolean(CanvasModel.waitingBatchForAgent(agent, batches));
    const status = agent?.turns?.at(-1)?.status || agent?.status;
    const preparationReply = ['summary', 'erqc', 'analysis-data', 'exposure-response'].includes(agent?.kind)
      && ['needs_input', 'waiting_input'].includes(status);
    const selected = selectedSummary();
    const editable = agent?.kind === 'summary' && selected?.agent_id === agent.id;
    const version = isSummaryPage() && currentTasks('summary').find(item => item.id === selectedReport);
    const separateBatch = batchReply && isReportVersion(version) && version.agent_id === agent?.id;
    const modeIdentity = `${identity}:${batchReply}:${preparationReply}:${separateBatch ? version.id : editable ? selected.id : ''}:${separateBatch}`;
    if (select.dataset.modeIdentity !== modeIdentity) {
      select.value = separateBatch ? 'batch_continue' : batchReply || preparationReply || editable ? 'analysis' : 'conversation';
      select.dataset.modeIdentity = modeIdentity;
    }
    if (select.options?.[1]) select.options[1].textContent = editable
      ? '修改当前报告（保存到所选版本）' : '执行 / 修改（按任务设置）';
    if (select.options?.[2]) select.options[2].hidden = !separateBatch;
    const scope = $('#agentMessageScope');
    if (scope) scope.textContent = batchReply && (!separateBatch || select.value === 'batch_continue')
      ? '本次回复继续暂停批次，不修改所选报告；修改报告请选择“修改当前报告（保存到所选版本）”。'
      : editable
      ? (select.value === 'conversation'
        ? `当前讨论：${prettyDate(selected.created_at)} · 已绑定所选版本，只读讨论，不修改报告。`
        : `当前目标：${prettyDate(selected.created_at)} · 修改保存到所选版本，不新增报告版本；执行记录保留。`)
      : agent?.kind === 'summary' ? summaryScope(agent.id)
        : '沿用当前任务的最新上下文；执行结果仍需审查。';
    if (scope && editable && selected.draft && select.value !== 'batch_continue') {
      scope.textContent += t(` 保留${statusText(selected.status)}状态，不自动用于下游分析。`, ` Kept as ${statusText(selected.status)}; not used downstream automatically.`);
    }
    select.disabled = disabled || (batchReply && !separateBatch);
    select.title = batchReply ? '继续暂停批次沿用原批次授权；编辑所选报告是独立操作。' : '';
  }

  function isSummaryPage() {
    return ['summary', 'generate'].includes(page) || (page === 'analysis' && analysisSection === 'summary');
  }

  function hasSummaryReport(agentId) {
    return currentTasks('summary').some(item => isReportVersion(item) && item.agent_id === agentId);
  }

  function isReportVersion(report) {
    return report?.status === 'completed' || (['cancelled', 'failed', 'needs_input', 'interrupted'].includes(report?.status)
      && Boolean(report.draft || report.report_binding_error || report.live_artifacts?.['report.html']
        || report.live_artifacts?.['data_summary_report.Rmd']));
  }

  function summaryScope(agentId) {
    if (!isSummaryPage()) return '讨论任务上下文，未绑定当前报告；修改报告需返回 Data Summary 页选择并加载。';
    const version = currentTasks('summary').find(item => item.id === selectedReport);
    if (version?.report_binding_error) return '所选报告不可校验或缺少可用副本；不会继续生成或修改，请先恢复原副本或选择可验证报告。';
    const selected = selectedSummary();
    if (selected && selected.agent_id !== agentId) return '当前报告属于另一任务；发送时会先切换到报告所属任务并保留输入，不自动发送。';
    if (!hasSummaryReport(agentId)) return '当前任务尚无可编辑报告；本次回复继续此任务，不修改其他任务的报告。';
    return '请在 Data Summary 页选择报告并等待加载；讨论与修改均绑定所选报告。';
  }

  function selectedSummary() {
    const report = currentTasks('summary').find(item => item.id === selectedReport);
    const frame = $('#reportFrame');
    return isSummaryPage() && isReportVersion(report) && !report.report_binding_error && report.agent_id
      && /^[a-f0-9]{64}$/.test(report.result_sha256 || '') && frame?.isConnected && !frame.hidden
      && frame.dataset.displayedResult === report.id
      && frame.dataset.displayedResultSha256 === report.result_sha256 ? report : null;
  }

  function reportTarget(agentId, mode) {
    const agent = currentAgents().find(item => item.id === agentId);
    if (agent?.kind !== 'summary') return null;
    if (mode === 'batch_continue') {
      if (!CanvasModel.waitingBatchForAgent(agent, snapshot?.analysis_batches)) throw new Error('暂停批次已改变，请重新选择本次操作。');
      return null;
    }
    const report = selectedSummary();
    const selected = isSummaryPage() && currentTasks('summary').find(item => item.id === selectedReport);
    if (selected?.report_binding_error) throw new Error('所选报告不可校验或缺少可用副本；消息未发送，请恢复原副本或选择可验证报告。');
    if (isReportVersion(selected) && !report) throw new Error('请等待所选报告加载并校验完成后再发送；消息未发送。');
    if (report && report.agent_id !== agentId) throw new Error('当前报告属于其他任务，请先切换到报告所属任务再发送。');
    if ((!report && CanvasModel.waitingBatchForAgent(agent, snapshot?.analysis_batches))
        || !hasSummaryReport(agentId)
        || (mode === 'conversation' && !isSummaryPage())) return null;
    if (!report) throw new Error('请先在 Data Summary 页面选择报告，并等待报告加载完成。');
    return {turn_id: report.id, result_sha256: report.result_sha256};
  }

  function alignSummaryTask(agentId, mode, message) {
    const agent = currentAgents().find(item => item.id === agentId);
    const report = selectedSummary();
    if (agent?.kind !== 'summary' || !report || report.agent_id === agentId) return true;
    const owner = currentAgents().find(item => item.id === report.agent_id && !item.archived && item.kind === 'summary');
    if (!owner) throw new Error('当前报告所属任务不可用；消息未发送，请重新选择有效报告。');
    const draft = conversation.drafts.get(owner.id);
    if (draft && draft !== message) throw new Error('报告所属任务已有未发送草稿；本次输入已保留，请先处理该草稿后再切换。');
    conversation.drafts.set(agentId, message);
    conversation.drafts.set(owner.id, message);
    openAgent(owner.id, report.id);
    $('#agentList').querySelectorAll('[data-agent-id]').forEach(button => {
      const active = button.dataset.agentId === owner.id;
      button.setAttribute('aria-selected', String(active));
      button.classList.toggle('is-active', active);
    });
    $('#agentMessageMode').value = mode === 'batch_continue' ? 'analysis' : mode;
    renderConversation();
    $('#messageError').textContent = '已切换到当前报告所属任务，输入已保留但未发送；请核对后再次点击发送。';
    return false;
  }

  // Build one explicit user intent; retry an uncertain batch reply with its original key.
  function messageRequest(agentId, interactionMode, reportTarget, requestedRun, message) {
    const agent = currentAgents().find(value => value.id === agentId);
    const waiting = reportTarget ? null : CanvasModel.waitingBatchForAgent(agent, snapshot?.analysis_batches);
    const requestKey = `${requestedRun}:${agentId}`;
    let request = conversationRequests.get(requestKey);
    if (request && !waiting) throw new Error('上次批次回复的发送结果尚未确认；请先重试原批次回复，再修改报告。');
    if (!request) {
      if (waiting && !waiting.batch.plan?.approval) throw new Error('当前任务缺少必要确认，请重新开始分析。');
      const policy = selectedDataPolicy(true);
      request = waiting ? {
        path: `/api/analysis-batches/${waiting.batch.id}/continue`, message,
        body: {run_id: requestedRun, stage: waiting.kind, idempotency_key: crypto.randomUUID(), message,
          approval: {...waiting.batch.plan.approval, ...policy}},
      } : {
        path: `/api/agents/${encodeURIComponent(agentId)}/messages`, message,
        body: {run_id: requestedRun, message, cloud_policy: policy, interaction_mode: interactionMode,
          ...(reportTarget ? {report_target: reportTarget} : {})},
      };
      if (waiting) conversationRequests.set(requestKey, request);
    }
    return {requestKey, request};
  }

  function assertTarget(agentId, mode, target) {
    if (!target) return;
    const report = selectedSummary();
    if (!['analysis', 'conversation'].includes(mode) || report?.agent_id !== agentId || report?.id !== target.turn_id
        || report?.result_sha256 !== target.result_sha256) {
      throw new Error('所选报告或报告内容已经改变，请核对后重新发送。');
    }
  }

  async function loadSummaryReport(report, frame, signature) {
    delete frame.dataset.displayedResultSha256;
    const hash = report.result_sha256;
    await showReport(report.id, frame);
    if (frame.isConnected && frame.dataset.displayedResult === report.id
        && frame.dataset.artifactSignature === signature) {
      frame.dataset.displayedResultSha256 = hash || '';
      renderConversation();
    }
  }

  function updateSummary(agent, turn) {
    const element = $('#agentSummary');
    const identity = `${runId}:${agent?.id || ''}:${turn?.id || ''}`;
    const selection = window.getSelection?.();
    if (element.dataset.identity === identity && selection?.toString()
        && element.contains(selection.anchorNode)) return;
    retainConversationMarkup(element, ConversationPresenter.summaryMarkup(agent, turn), identity);
    element.dataset.identity = identity;
  }

  return {shell, updateMode, reportTarget, alignSummaryTask, messageRequest, assertTarget, loadSummaryReport, updateSummary};
})();

// Explicit navigation invalidates pending auto-follow, even after switching back.
let conversationSelectionRevision = 0;
function captureConversationSelection() {
  return {run: runId, agent: conversation.agentId, turn: conversation.turnId,
    revision: conversationSelectionRevision};
}

async function followConversationSubmission(selection, result, stage) {
  await refresh(false);
  if (runId !== selection.run || conversation.agentId !== selection.agent
      || conversation.turnId !== selection.turn
      || conversationSelectionRevision !== selection.revision) return;
  const record = stage ? result?.stages?.[stage] : result;
  const turnId = stage ? record?.turn_id : record?.id;
  const agent = currentAgents().find(item => item.id === selection.agent);
  if (record?.agent_id === selection.agent && (!result.run_id || result.run_id === selection.run)
      && agent?.turns?.some(turn => turn.id === turnId)) {
    conversation.turnId = conversationFollowTurn = turnId;
    saveConversationSelection();
    renderConversation();
  }
  showConversations();
}

// A step whose Agent run failed: a plain message, the raw reason on request, and a retry that
// continues the same Agent (it keeps its earlier analysis) through the governed rerun route.
const RETRYABLE_STATUSES = ['failed', 'interrupted', 'cancelled'];
function stepRetryMarkup(turn, agentId, extra = '') {
  if (!turn || !agentId || !RETRYABLE_STATUSES.includes(turn.status)) return '';
  const reason = String(turn.error || turn.result?.message || '');
  const login = /oauth|authenticat|not logged in|\/login/i.test(reason);
  return `<div class="preparation-failure"><p><strong>${t('这一步没有完成。', 'This step did not finish.')}</strong> ${login
    ? escape(ConversationPresenter.conciseTurnError(reason))
    : t('可以在原任务中重试（Agent 保留之前的分析），或在任务对话中说明要怎么改。', 'Retry in the same task (the Agent keeps its earlier analysis), or say in the task conversation what to change.')}</p>${reason
    ? `<details><summary>${t('查看原因', 'Show the reason')}</summary><pre data-i18n-skip>${escape(reason)}</pre></details>` : ''}<div class="live-actions"><button type="button" class="primary-button" data-retry-agent="${escape(agentId)}">${t('在原任务中重试', 'Retry in the same task')}</button>${extra}</div></div>`;
}

function wireStepRetry(root) {
  root.querySelectorAll('[data-retry-agent]').forEach(button => { button.onclick = () => action(async () => {
    button.disabled = true;
    try {
      await api(`/api/agents/${encodeURIComponent(button.dataset.retryAgent)}/rerun`, {run_id: runId, cloud_policy: selectedDataPolicy(true)});
    } finally {
      await refresh();
    }
  }); });
}

async function rerunAgentAnalysis() {
  const form = $('#agentMessage');
  if (form.dataset.rerunning === 'true' || !conversation.agentId) return;
  const requestedRun = runId;
  const agentId = conversation.agentId;
  const selection = captureConversationSelection();
  form.dataset.rerunning = 'true';
  $('#messageError').textContent = '';
  try {
    if (runId !== requestedRun || conversation.agentId !== agentId) return;
    if (!ConversationControls.alignSummaryTask(agentId, 'analysis', form.elements.message.value)) return;
    const reportTarget = ConversationControls.reportTarget(agentId, 'analysis');
    ConversationControls.assertTarget(agentId, 'analysis', reportTarget);
    const result = await api(`/api/agents/${encodeURIComponent(agentId)}/rerun`, {
      run_id: requestedRun, cloud_policy: selectedDataPolicy(true),
      ...(reportTarget ? {report_target: reportTarget} : {}),
    });
    await followConversationSubmission(selection, result);
  } catch (error) {
    $('#messageError').textContent = productError(error, '重新校验未能启动，请重试。');
  } finally {
    form.dataset.rerunning = 'false';
    renderConversation();
  }
}

let pendingAgentAction = null;
function openAgentAction(kind) {
  pendingAgentAction = {kind, runId, agentId: conversation.agentId};
  $('#agentActionTitle').textContent = kind === 'cancel' ? '取消当前任务？' : '归档当前任务？';
  $('#agentActionDescription').textContent = kind === 'cancel'
    ? '当前运行将停止，之后仍可继续此任务。' : '任务将从当前列表移入归档。';
  $('#agentActionModal').classList.remove('hidden');
}

function initializeConversations() {
  $('#taskRail').innerHTML = ConversationPresenter.shell();
  $('#agentMessage textarea').oninput = event => {
    conversation.drafts.set(conversation.agentId, event.target.value);
  };
  $('#agentMessage').onsubmit = sendConversationMessage;
  $('#cancelAgentAction').onclick = () => { pendingAgentAction = null; $('#agentActionModal').classList.add('hidden'); };
  $('#confirmAgentAction').onclick = () => action(async () => {
    if (!pendingAgentAction) return;
    const target = pendingAgentAction;
    pendingAgentAction = null;
    $('#agentActionModal').classList.add('hidden');
    await api(`/api/agents/${encodeURIComponent(target.agentId)}/${target.kind}`, {run_id: target.runId});
    await refresh(false);
  });
}

function retainConversationMarkup(element, markup, identity) {
  if (element.dataset.markup === markup) return;
  const same = element.dataset.identity === identity;
  if (same && (element.contains(document.activeElement) || element.querySelector?.('details[open]'))) return;
  element.innerHTML = markup;
  element.dataset.markup = markup;
  element.dataset.identity = identity;
}

// Answers an Agent offers with its question: one click fills the reply box, the user still sends it.
function answerOptionsMarkup(options, target = '#agentMessage textarea') {
  if (!(options || []).length) return '';
  return `<div class="suggestion-chips answer-options"><span>可选：</span>${options.map(option => `<button type="button" class="decision-chip" data-i18n-skip data-answer-target="${escape(target)}" data-answer-option="${escape(option)}">${escape(option)}</button>`).join('')}</div>`;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-answer-option]');
  if (!button) return;
  if (button.dataset.answerTarget === '#agentMessage textarea' && typeof showConversations === 'function') showConversations();
  const box = document.querySelector(button.dataset.answerTarget);
  if (!box) return;
  box.value = button.dataset.answerOption;
  box.dispatchEvent(new Event('input', {bubbles: true}));
  box.focus();
});
