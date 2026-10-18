/* Persistent specialist conversations. The native Extension remains the reviewer. */
const conversation = CanvasModel.conversationState();
conversation.seenActiveTurns = new Set();
let conversationRun = '', conversationSignature = '', conversationProgressSignature = '';
const conversationRequests = new Map();
const conversationSelectionKey = requestedRun => `eragent:conversation:${requestedRun}`;
function loadConversationSelection(requestedRun) {
  try {
    const saved = JSON.parse(localStorage.getItem(conversationSelectionKey(requestedRun)) || 'null');
    return saved && typeof saved.agentId === 'string' && typeof saved.turnId === 'string' ? saved : {agentId: '', turnId: ''};
  } catch { return {agentId: '', turnId: ''}; }
}
function saveConversationSelection() {
  if (!conversationRun) return;
  try {
    localStorage.setItem(conversationSelectionKey(conversationRun), JSON.stringify({
      agentId: conversation.agentId || '', turnId: conversation.turnId || '',
    }));
  } catch {}
}
function showConversations() {
  $('#assistant').classList.remove('collapsed');
  document.body.classList.remove('assistant-collapsed');
  $('#assistantToggle').setAttribute('aria-expanded', 'true');
}

function closeConversations() {
  $('#assistant').classList.add('collapsed');
  document.body.classList.add('assistant-collapsed');
  $('#assistantToggle').setAttribute('aria-expanded', 'false');
}


function renderRail() {
  const agents = currentAgents();
  const active = agents.filter(agent => ['running', 'queued', 'needs_input'].includes(latestTurn(agent)?.status || agent.status));
  $('#taskCount').textContent = String(agents.filter(agent => !agent.archived).length);
  $('#assistantContext').textContent = '';
  $('.assistant-context').hidden = true;
  const rail = $('#taskRail');
  if (rail.dataset.initialized !== 'true') {
    initializeConversations();
    rail.dataset.initialized = 'true';
  }
  if (conversationRun !== runId) {
    conversationSelectionRevision += 1;
    conversationRun = runId;
    const restored = loadConversationSelection(runId);
    conversation.agentId = restored.agentId;
    conversation.turnId = restored.turnId;
    conversationSignature = '';
    conversationProgressSignature = '';
    conversation.seenActiveTurns.clear();
    $('#agentMessage textarea').value = '';
  }
  const available = agents.filter(agent => !agent.archived);
  if (agents.length && !available.some(agent => agent.id === conversation.agentId)) {
    const preferred = active[0] || available[0];
    conversation.agentId = preferred?.id || '';
    conversation.turnId = latestTurn(preferred)?.id || '';
    conversationFollowTurn = conversation.turnId;
    conversationSignature = '';
    conversationProgressSignature = '';
    saveConversationSelection();
  }
  // A newly started task takes the focus so its progress is visible.
  const activeTurns = active.map(agent => `${agent.id}:${agent.last_turn_id || ''}`);
  const fresh = active[activeTurns.findIndex(key => !conversation.seenActiveTurns.has(key))];
  const unseenActiveTurn = Boolean(fresh);
  // Within the same Agent, followConversationSubmission follows the submitted turn.
  if (fresh && fresh.id !== conversation.agentId) { conversation.agentId = fresh.id; conversation.turnId = conversationFollowTurn = latestTurn(fresh)?.id || ''; }
  activeTurns.forEach(key => conversation.seenActiveTurns.add(key));
  const list = $('#agentList');
  retainConversationMarkup(list, ConversationPresenter.agentList(available, conversation.agentId), runId);
  list.querySelectorAll?.('[data-agent-id]').forEach(button => {
    const agent = available.find(value => value.id === button.dataset.agentId);
    const label = button.querySelector?.('span');
    if (agent && label) label.textContent = ConversationPresenter.subagentStatus(agent);
    button.onclick = () => openAgent(button.dataset.agentId);
  });
  if (unseenActiveTurn) showConversations();
  renderConversation();
}


function openAgent(agentId, turnId = '') {
  const agent = currentAgents().find(value => value.id === agentId);
  if (!agent) return;
  conversationSelectionRevision += 1;
  const changed = conversation.agentId !== agentId;
  conversation.agentId = agentId;
  conversation.turnId = turnId || latestTurn(agent)?.id || '';
  conversationFollowTurn = turnId ? '' : conversation.turnId;
  saveConversationSelection();
  if (changed) {
    $('#agentMessage textarea').value = conversation.drafts.get(agentId) || '';
    conversationSignature = '';
    conversationProgressSignature = '';
  }
  renderConversation();
  showConversations();
  $('#agentMessage textarea').focus();
}

function refreshConversationActivity(history, turns, nowMs = Date.now()) {
  const byId = new Map(turns.map(turn => [turn.id, ConversationHistoryPresenter.activityState(turn, nowMs)]));
  const fields = [
    ['[data-live-turn-id]', 'liveTurnId', 'label'],
    ['[data-live-activity-time]', 'liveActivityTime', 'elapsed'],
    ['[data-live-activity-detail]', 'liveActivityDetail', 'detail'],
  ];
  fields.forEach(([selector, key, field]) => {
    history?.querySelectorAll?.(selector).forEach(node => {
      const activity = byId.get(node.dataset[key]);
      const text = activity?.[field] || '';
      if (node.textContent !== text) node.textContent = text;
      if (field === 'label') node.dataset.activityState = activity?.state || 'idle';
    });
  });
}
// Keep elapsed/quiet text moving even when a backend poll stalls.
setInterval(() => {
  const agent = currentAgents().find(item => item.id === conversation.agentId);
  refreshConversationActivity($('#conversationTurns'), agent?.turns || []);
}, 1000);

// A panel that landed on the newest turn by itself follows the next one; a turn picked on purpose stays.
let conversationFollowTurn = '';
function renderConversation() {
  const newest = latestTurn(currentAgents().find(item => item.id === conversation.agentId))?.id || '';
  if (conversationFollowTurn && conversation.turnId === conversationFollowTurn && newest) conversation.turnId = conversationFollowTurn = newest;
  const view = CanvasModel.conversationView(conversation, currentAgents());
  const {agent, turn} = view;
  const form = $('#agentMessage');
  $('#agentDetail').hidden = !agent;
  const latestStatus = latestTurn(agent)?.status || agent?.status;
  const busy = agent && ['running', 'queued'].includes(latestStatus);
  form.hidden = !agent;
  const title = agent ? agent.title || taskName(agent.kind) : '分析任务';
  retainConversationMarkup($('#activeAgentHeader'),
    agent ? ConversationPresenter.agentHeader(agent, title, turn) : '', `${runId}:${agent?.id || ''}`);
  const headerStatus = $('#activeAgentHeader small');
  if (agent && headerStatus) headerStatus.textContent = ConversationPresenter.headerStatus(agent, turn);
  ConversationControls.updateSummary(agent, turn);
  const progressSignature = JSON.stringify([agent?.id, turn?.id, turn?.progress_steps,
    turn?.progress_current, turn?.artifact_manifest, turn?.result?.artifacts, turn?.updated_at]);
  if (progressSignature !== conversationProgressSignature) {
    AgentProgressPresenter.replace(
      $('#agentProgress'), agent ? ConversationPresenter.progressSteps(agent, turn) : '',
    );
    conversationProgressSignature = progressSignature;
  }
  $('#agentRevisions').textContent = agent ? ConversationPresenter.revisions(agent, snapshot?.workspace, turn) : '';
  $('#sendMessage').disabled = !agent || busy || form.dataset.sending === 'true';
  (form.elements.message || $('#agentMessage textarea')).disabled = !agent || busy || Boolean(agent?.archived);
  ConversationControls.updateMode($('#agentMessageMode'), agent, snapshot?.analysis_batches,
    `${runId}:${agent?.id || ''}`, !agent || busy || form.dataset.sending === 'true');
  $('#sendMessage').textContent = '发送 ↑';
  if ($('#cancelAgent')) {
    $('#cancelAgent').hidden = !busy;
    $('#cancelAgent').onclick = () => openAgentAction('cancel');
    const failedAnalysis = latestAnalysisTurn(agent);
    const rerunnable = !busy && ['failed', 'cancelled', 'interrupted', 'needs_input', 'waiting_input']
      .includes(failedAnalysis?.status);
    $('#rerunAgent').hidden = !rerunnable;
    $('#rerunAgent').disabled = !rerunnable || form.dataset.rerunning === 'true';
    $('#rerunAgent').onclick = rerunAgentAnalysis;
    $('#archiveAgent').disabled = !agent || busy || Boolean(agent.archived);
    $('#archiveAgent').onclick = () => openAgentAction('archive');
  }
  const turns = agent?.turns || [];
  conversation.turnId = turn?.id || '';
  const history = $('#conversationTurns');
  const signature = JSON.stringify([agent?.id, conversation.turnId, turns]);
  const selectedText = window.getSelection?.();
  if (signature === conversationSignature || (selectedText?.toString() && history.contains(selectedText.anchorNode))) {
    refreshConversationActivity(history, turns);
    return;
  }
  const top = history.scrollTop;
  const atBottom = history.scrollHeight - history.clientHeight - top < 40;
  history.innerHTML = ConversationPresenter.turnHistory(agent, title, conversation.turnId);
  history?.querySelectorAll?.('[data-turn-id]').forEach(button => {
    button.onclick = () => openAgent(agent.id, button.dataset.turnId);
  });
  refreshConversationActivity(history, turns);
  history.scrollTop = atBottom ? history.scrollHeight : top;
  conversationSignature = signature;
}

async function sendConversationMessage(event) {
  event.preventDefault();
  const form = event.target;
  if (form.dataset.sending === 'true') return;
  const agentId = conversation.agentId;
  const requestedRun = runId;
  const selection = captureConversationSelection();
  const message = form.elements.message.value;
  const interactionMode = $('#agentMessageMode').value || 'conversation';
  if (!message.trim() || !agentId) return;
  form.dataset.sending = 'true';
  $('#sendMessage').disabled = true;
  $('#agentMessageMode').disabled = true;
  $('#messageError').textContent = '';
  try {
    if (!ConversationControls.alignSummaryTask(agentId, interactionMode, message)) return;
    const reportTarget = ConversationControls.reportTarget(agentId, interactionMode);
    if (runId !== requestedRun || conversation.agentId !== agentId || form.elements.message.value !== message) return;
    ConversationControls.assertTarget(agentId, interactionMode, reportTarget);
    const {requestKey, request} = ConversationControls.messageRequest(
      agentId, interactionMode, reportTarget, requestedRun, message);
    const result = await api(request.path, request.body);
    conversationRequests.delete(requestKey);
    // A request may finish after the user switches Agent or keeps typing.
    if (conversation.drafts.get(agentId) === request.message) conversation.drafts.delete(agentId);
    if (runId === requestedRun && conversation.agentId === agentId && form.elements.message.value === request.message) {
      form.elements.message.value = '';
    }
    await followConversationSubmission(selection, result, request.body.stage);
  } catch (error) {
    if (error.httpStatus >= 400 && error.httpStatus < 500) conversationRequests.delete(`${requestedRun}:${agentId}`);
    $('#messageError').textContent = productError(error, '消息未能发送，请重试。');
  } finally {
    form.dataset.sending = 'false';
    renderConversation();
  }
}
