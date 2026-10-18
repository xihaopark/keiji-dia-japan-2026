/* Pure rendering for persistent task conversation history. */
const subagentTurnStatus = (turn, agent) => {
  const status = turn?.status || agent?.status || 'queued';
  if (turn?.interaction_mode === 'conversation') {
    if (status === 'queued') return '排队中';
    if (status === 'running') return turn?.transmission_status === 'started' ? 'Claude 处理中' : '准备中';
    if (['needs_input', 'waiting_input', 'interrupted'].includes(status)) return '等待输入';
    if (status === 'completed') return '已回复';
    if (status === 'cancelled') return '已取消·可继续';
    if (status === 'failed') return '回复失败·可继续';
  }
  if ((turn?.kind || agent?.kind) === 'summary' && turn?.parameters?.report_target) {
    const outcome = turn.result?.report_edit_outcome;
    if (status === 'needs_input' && outcome === 'unfulfilled') return '修改未完成·可继续';
    if (status === 'completed' && turn.result?.report_changed === false) {
      if (outcome === 'answer_only') return '已回复·报告未修改';
      if (outcome === 'already_satisfied') return '报告未修改·Agent认为已满足';
    }
  }
  if (status === 'running') return '运行中';
  if (['needs_input', 'waiting_input', 'interrupted'].includes(status)) return '等待输入';
  if (status === 'completed') return ['reviewed', 'accepted'].includes(turn ? turn.review : agent?.review) ? '已审查' : '已完成·待审查';
  if (status === 'cancelled') return '已取消·可继续';
  if (status === 'failed') return '失败·可继续';
  return '排队中';
};
// Fixed activity labels the executor derives from known tables and outputs (demo_executor.py).
const KNOWN_ACTIVITY_LABELS = ['正在读取受试者表', '正在读取 PK 浓度数据', '正在读取给药记录', '正在读取不良事件', '正在读取时间-事件数据', '正在读取疗效应答', '正在读取模型输出', '正在读取预扫描结果', '正在写出暴露数据集', '正在写出暴露指标说明', '正在写出模型结果', '正在写出 AE 时间', '正在记录 QC 调查', '正在写出报告章节', '正在生成报告', '正在编写分析代码', '正在绘图', '正在运行确定性预扫描', '正在运行分析代码', '正在用 PKNCA 计算 NCA', '正在生成研究概况（R，确定性）', 'Agent 正在确定研究口径映射', 'Agent 正在修正口径映射', '正在生成报告草稿', '部分章节需要专门处理，Agent 正在为这些章节编写 R 代码', 'Agent 编写的章节代码未通过安全校验，这些章节在报告中标记为未能计算', 'Agent 正在根据计算结果撰写各章结论', '正在生成最终报告'];

const ConversationHistoryPresenter = (() => {
  function activityState(turn, nowMs = Date.now()) {
    if (!['queued', 'running'].includes(turn?.status)) return null;
    const startedAt = Date.parse(turn.started_at || turn.created_at);
    const seconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((nowMs - startedAt) / 1000)) : null;
    const elapsed = seconds === null ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (turn.status === 'queued') return {state: 'queued', label: '排队中', detail: '尚未调用 Claude', elapsed};
    if (turn.transmission_status !== 'started') {
      return {state: 'preparing', label: '准备中…', detail: '尚未调用 Claude', elapsed};
    }
    const steps = Array.isArray(turn.progress_steps) ? turn.progress_steps : [];
    const lastActivity = Math.max(0, ...steps.map(step => Date.parse(step.last_activity_at) || 0));
    const lastSignal = lastActivity || Date.parse(turn.started_at);
    if (Number.isFinite(lastSignal) && nowMs - lastSignal >= 120000) {
      return {state: 'quiet', label: '暂未收到新活动', detail: '已超过 2 分钟，任务可能仍在处理', elapsed};
    }
    const active = steps.find(step => step.id === turn.progress_current) ||
      steps.find(step => step.status === 'running');
    // Only categories emitted by real tool events, never the step's plan prose.
    const toolDetails = ['正在读取分析输入', '正在更新分析结果', '正在启动分析流程',
      '正在执行数据处理', '正在查找分析资料', ...KNOWN_ACTIVITY_LABELS];
    const detail = toolDetails.includes(active?.detail) ? `最近活动：${active.detail.slice(2)}` :
      lastActivity ? '' : '等待首个响应';
    return {state: 'running', label: '正在处理…', detail, elapsed};
  }

  function activityText(turn, nowMs = Date.now()) {
    const activity = activityState(turn, nowMs);
    return activity ? [activity.label, activity.detail].filter(Boolean).join(' · ') : '';
  }

  function activityMarkup(turn, nowMs = Date.now()) {
    const activity = activityState(turn, nowMs);
    if (!activity) return '';
    const id = escape(turn.id || '');
    return `<div class="conversation-activity" aria-live="off">
      <span class="conversation-activity-indicator" aria-hidden="true">✳</span>
      <div class="conversation-activity-copy"><div class="conversation-activity-line">
        <span class="conversation-activity-label" data-live-turn-id="${id}" data-activity-state="${activity.state}" role="status" aria-live="polite">${escape(activity.label)}</span>
        <span class="conversation-activity-time" data-live-activity-time="${id}" aria-hidden="true" title="本轮等待时长">${escape(activity.elapsed)}</span>
      </div><small class="conversation-activity-detail" data-live-activity-detail="${id}">${escape(activity.detail)}</small></div>
    </div>`;
  }
  function readableMessage(value) {
    const text = String(value || '');
    const candidate = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      const reply = JSON.parse(candidate);
      if (reply && typeof reply.message === 'string') {
        return (reply.r_code ? '尚未重新运行检查，请在分析页面重新启动。\n' : '') + reply.message;
      }
    } catch { /* Ordinary prose is already readable. */ }
    return text;
  }
  function render(agent, title, selectedTurnId, subagentStatus, conciseTurnError) {
    return (agent?.turns || []).map(turn => `<article class="agent-turn">
      <button type="button" class="turn-select" data-turn-id="${escape(turn.id || '')}" aria-current="${turn.id === selectedTurnId ? 'true' : 'false'}">${escape(prettyDate(turn.created_at))} · ${escape(subagentStatus({...agent, turns: [turn]}))}</button>
      <div class="turn-message user-turn"><strong>任务要求</strong><p>${escape(turn.prompt || '')}</p></div>
      ${turn.result?.message ? `<div class="turn-message agent-turn-message"><strong>${escape(title)}</strong><div class="conversation-markdown">${markdownBody(readableMessage(turn.result.message))}</div></div>` : ''}
      ${['needs_input', 'waiting_input', 'interrupted'].includes(turn.status) && Array.isArray(turn.result?.questions) && turn.result.questions.length ? `<div class="turn-message agent-turn-message"><strong>需要补充信息</strong><ul>${turn.result.questions.map(question => `<li>${escape(question)}</li>`).join('')}</ul>${typeof answerOptionsMarkup === 'function' ? answerOptionsMarkup(turn.result.answer_options) : ''}</div>` : ''}
      ${activityMarkup(turn)}
      ${turn.error ? `<div class="turn-error" role="alert"><strong>${['needs_input', 'waiting_input', 'interrupted'].includes(turn.status) ? '未完成原因' : '任务未完成'}</strong><p>${escape(conciseTurnError(turn.error))}</p><details><summary>查看原因</summary><pre>${escape(turn.error)}</pre></details><small>可在下方补充要求后继续。</small></div>` : ''}
    </article>`).join('');
  }

  return {render, readableMessage, activityText, activityState, activityMarkup};
})();
if (typeof module !== 'undefined') module.exports = ConversationHistoryPresenter;
