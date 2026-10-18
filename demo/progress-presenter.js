/* Compact projection of durable executor checkpoints. */
const AgentProgressPresenter = (() => {
  function statusText(status) {
    return ({completed: '已完成', running: '进行中', waiting: '等待输入', failed: '未完成',
      cancelled: '已取消', pending: '未开始'})[status] || '未开始';
  }

  function render(agent, latestTurn, selectedTurn = null) {
    const turn = selectedTurn || latestTurn(agent);
    const storedSteps = Array.isArray(turn?.progress_steps) ? turn.progress_steps : [];
    const steps = storedSteps.flatMap(step => step.id === 'run_skill' && Array.isArray(step.substeps)
      && step.substeps.length ? step.substeps : [step]);
    if (!steps.length) return '';
    const current = steps.find(step => step.id === turn.progress_current)
      || steps.find(step => ['running', 'waiting', 'failed', 'cancelled'].includes(step.status))
      || [...steps].reverse().find(step => step.status === 'completed') || steps[0];
    const artifacts = Array.isArray(turn.result?.artifacts) ? turn.result.artifacts
      : Array.isArray(turn.artifact_manifest) ? turn.artifact_manifest : [];
    const updated = current?.updated_at || turn.updated_at || turn.completed_at || turn.started_at || turn.created_at;
    const meta = [`${t('当前：', 'Current: ')}${current?.label || t('等待开始', 'Waiting to start')}`];
    if (artifacts.length) meta.push(t(`产物 ${artifacts.length}`, `${artifacts.length} outputs`));
    if (updated) meta.push(t(`更新 ${prettyDate(updated)}`, `updated ${prettyDate(updated)}`));
    return `<div class="progress-meta">${escape(meta.join(' · '))}</div><ol>${steps.map(step => {
      const updates = Array.isArray(step.updates) ? step.updates : [];
      const detail = updates.length
        ? `<ul class="progress-updates">${updates.map(update => `<li><span>${escape(update.detail || '')}</span>${update.updated_at ? `<time>${escape(prettyDate(update.updated_at))}</time>` : ''}</li>`).join('')}</ul>`
        : `<p>${escape(step.detail || '')}</p>`;
      return `<li class="is-${escape(step.status || 'pending')}"><details data-progress-step="${escape(step.id || '')}" ${step.status === 'running' ? 'open' : ''}>
      <summary><span class="progress-light" aria-hidden="true"></span><strong>${escape(step.label || '')}</strong><small>${escape(statusText(step.status))}</small></summary>
      ${detail}
    </details></li>`; }).join('')}</ol>`;
  }

  function replace(root, markup) {
    const expanded = new Set([...root.querySelectorAll?.('details[open][data-progress-step]') || []]
      .map(detail => detail.dataset.progressStep));
    root.innerHTML = markup;
    root.querySelectorAll?.('details[data-progress-step]').forEach(detail => {
      if (expanded.has(detail.dataset.progressStep)) detail.open = true;
    });
  }

  return {render, replace, statusText};
})();
if (typeof module !== 'undefined') module.exports = AgentProgressPresenter;
