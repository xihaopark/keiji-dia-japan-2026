/* Pure rendering for persistent task conversations. */
const ConversationPresenter = (() => {
  function shell() {
    return ConversationControls.shell();
  }

  function conciseTurnError(value) {
    const text = String(value || '');
    const location = text.match(/(?:Analysis\.R[^\n]*:)?(\d+):(\d+):\s*(unexpected[^\n]*)/i);
    if (location) return '分析未能完成，请检查分析要求后重试。';
    if (/oauth|authenticat|not logged in|please run \/login/i.test(text)) return 'Claude 登录已过期：请在终端运行 claude /login 重新登录后重试。';
    return text ? '任务未能完成，请重试。' : '';
  }

  function agentList(agents, activeId) {
    if (!agents.length) return '<p class="task-empty">暂无分析任务</p>';
    return agents.map(agent => `<button type="button" role="tab" aria-selected="${agent.id === activeId}" class="agent-conversation-item ${agent.id === activeId ? 'is-active' : ''}" data-agent-id="${escape(agent.id)}">
      <strong>${escape(agent.title || taskName(agent.kind))}</strong><span>${escape(subagentStatus(agent))}</span><time>${escape(prettyDate(agent.updated_at || agent.created_at))}</time>
    </button>`).join('');
  }

  function agentHeader(agent, title, selectedTurn = null) {
    if (!agent) return '<p>选择一个分析任务查看详情</p>';
    return `<div><strong>${escape(title)}</strong><small>${escape(headerStatus(agent, selectedTurn))}</small></div><details class="agent-overflow"><summary aria-label="任务操作">•••</summary><button id="rerunAgent" type="button">应用修复并重新校验</button><button id="cancelAgent" type="button">取消当前任务</button><button id="archiveAgent" type="button">归档任务</button></details>`;
  }

  function headerStatus(agent, selectedTurn = null) {
    const viewed = selectedTurn ? {...agent, turns: [selectedTurn]} : agent;
    const turn = selectedTurn || latestTurn(agent);
    const route = turn?.model_route || agent.model_route || {};
    const model = route.resolved_model ? ` · ${route.resolved_model}` : '';
    return subagentStatus(viewed) + model;
  }

  function latestTurn(agent) { return agent?.turns?.at(-1) || null; }

  function subagentStatus(agent) {
    const turn = latestTurn(agent);
    return subagentTurnStatus(turn, agent);
  }

  function recentSummary(agent, selectedTurn = null, limit = 420) {
    const turn = selectedTurn || latestTurn(agent);
    if (!turn) return '任务尚未开始。';
    const result = turn.result || {};
    if (['needs_input', 'waiting_input', 'interrupted'].includes(turn.status)) {
      const questions = Array.isArray(result.questions) ? result.questions : [];
      if (questions.length) return questions.join('；').slice(0, limit);
      if (turn.error) return '任务尚未完成，请查看详情中的未完成原因后继续。';
      return String(result.message || '需要补充信息后继续。').slice(0, limit);
    }
    if (turn.error) return conciseTurnError(turn.error);
    if (result.message || result.summary || result.questions?.[0]) {
      return ConversationHistoryPresenter.readableMessage(result.message || result.summary || result.questions[0]).slice(0, limit);
    }
    if (['queued', 'running'].includes(turn.status)) return '';
    return '暂无结果摘要。';
  }

  function summaryMarkup(agent, selectedTurn = null) {
    if (!agent) return '';
    const text = recentSummary(agent, selectedTurn, 421);
    return markdownBody(text.slice(0, 420)) + (text.length > 420
      ? `<small>${t('…已省略后续内容；完整回复请展开“详情与历史记录”。', '… the rest is omitted; open "Details and history" for the full reply.')}</small>` : '');
  }

  function progressSteps(agent, selectedTurn = null) {
    return AgentProgressPresenter.render(agent, latestTurn, selectedTurn);
  }

  function revisions(agent, workspace = {}, selectedTurn = null) {
    const turn = selectedTurn || latestTurn(agent);
    const bound = turn?.parameters?.revisions || agent?.parameters?.revisions || {};
    return `数据版本 V${bound.data ?? turn?.data_revision ?? workspace.data_revision ?? 0} · 筛选版本 V${bound.selection ?? turn?.selection_revision ?? workspace.selection_revision ?? 0} · 研究背景版本 V${bound.protocol ?? turn?.protocol_revision ?? workspace.protocol_revision ?? 0}`;
  }

  function turnHistory(agent, title, selectedTurnId = '') {
    return ConversationHistoryPresenter.render(
      agent, title, selectedTurnId, subagentStatus, conciseTurnError,
    );
  }

  return {agentHeader, agentList, headerStatus, conciseTurnError, progressSteps, recentSummary, summaryMarkup, revisions, shell, subagentStatus, turnHistory};
})();
if (typeof module !== 'undefined') module.exports = ConversationPresenter;
