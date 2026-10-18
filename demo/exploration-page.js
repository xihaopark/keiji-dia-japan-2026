/* Page 5: client V1.4 exploration workspace. */
function explorationDraft() {
  const key = `exploration:${runId}`;
  if (!uiDrafts.has(key)) uiDrafts.set(key, {title: '', table: '', instruction: '', selected: new Set(), sending: false, idempotencyKey: ''});
  return uiDrafts.get(key);
}

function currentExploration(task) {
  return task.status === 'completed' && !task.stale && task.integrity === 'current';
}

function reconcileExplorationSelection(tasks, draft) {
  const current = tasks.filter(currentExploration);
  const currentIds = new Set(current.map(task => task.id));
  [...draft.selected].forEach(id => { if (!currentIds.has(id)) draft.selected.delete(id); });
  return current.filter(task => draft.selected.has(task.id));
}

function renderExploration(root) {
  const tasks = (snapshot.tasks || []).filter(task => task.kind === 'exploration');
  const tables = snapshot.inventory?.tables || [];
  const draft = explorationDraft();
  reconcileExplorationSelection(tasks, draft);
  if (!tables.some(table => table.name === draft.table)) draft.table = tables[0]?.name || '';
  root.innerHTML = `<div class="exploration-workspace"><section class="exploration-config"><div class="module-heading"><div><strong>创建数据探索</strong></div></div>
    <form id="explorationForm"><div class="exploration-config-grid">
      <label class="exploration-field">数据表<select name="table" required>${options(tables.map(table => table.name), draft.table)}</select></label>
      <label class="exploration-field">探索名称<input name="title" required value="${escape(draft.title)}" placeholder="例如：PK concentration-time exploration"></label>
      <label class="exploration-field wide">探索问题<textarea name="instruction" required placeholder="例如：当前 PK 数据中，浓度随名义时间如何变化？">${escape(draft.instruction)}</textarea></label>
    </div><div class="exploration-config-footer"><button class="primary-button" id="createExplorationButton" ${tables.length && !draft.sending ? '' : 'disabled'}>${draft.sending ? '创建中…' : '创建数据探索 →'}</button></div></form>
    </section>
    <section class="exploration-results"><div class="module-heading"><div><strong>探索结果</strong></div></div>
      <div class="exploration-results-layout"><div class="exploration-list" id="explorationList">${explorationList(tasks, draft)}</div><div class="exploration-chart-area" id="explorationChartArea"></div></div></section></div>`;
  const form = root.querySelector('#explorationForm');
  form.oninput = () => Object.assign(draft, {title: form.elements.title.value, table: form.elements.table.value, instruction: form.elements.instruction.value});
  form.onsubmit = event => { event.preventDefault(); action(() => startExploration(root, form, draft)); };
  wireExplorationResults(root, tasks, draft);
}

function explorationList(tasks, draft) {
  if (!tasks.length) return '<div class="exploration-empty">暂无已创建探索</div>';
  return tasks.map(task => {
    const current = currentExploration(task);
    const error = task.error ? `<span>${escape(ConversationPresenter.conciseTurnError(task.error))}</span>` : '';
    return `<label class="exploration-list-item" data-exploration="${task.id}"><input type="checkbox" ${draft.selected.has(task.id) ? 'checked' : ''} ${current ? '' : 'disabled'}><span><strong>${escape(task.title || task.id)}</strong><span>${escape(prettyDate(task.created_at))} · ${escape(statusText(task.status))}</span>${error}</span><em class="status-badge ${task.stale ? 'stale' : escape(task.status)}">${escape(task.stale ? '数据已更新' : statusText(task.review || task.status))}</em></label>`;
  }).join('');
}

async function startExploration(root, form, draft) {
  if (draft.sending) return;
  const values = Object.fromEntries(new FormData(form));
  draft.sending = true;
  draft.idempotencyKey ||= crypto.randomUUID();
  const requestedRun = runId;
  renderExploration(root);
  try {
    await startAgent('exploration', {
      title: String(values.title).trim(), message: String(values.instruction).trim(),
      idempotency_key: draft.idempotencyKey,
      cloud_policy: selectedDataPolicy(true),
      parameters: {table: values.table, instruction: String(values.instruction).trim(), analysis_mode: 'exploratory'},
    }, values.instruction);
    if (runId !== requestedRun) return;
    uiDrafts.delete(`exploration:${requestedRun}`);
    await refresh();
    if (runId !== requestedRun) return;
    showConversations();
  } finally {
    draft.sending = false;
    if (page === 'analysis' && root.isConnected) renderExploration(root);
  }
}

function wireExplorationResults(root, tasks, draft) {
  root.querySelectorAll('[data-exploration] input').forEach(input => {
    input.onchange = () => {
      const id = input.closest('[data-exploration]').dataset.exploration;
      if (input.checked) draft.selected.add(id); else draft.selected.delete(id);
      renderExploration(root);
    };
  });
  const selected = reconcileExplorationSelection(tasks, draft);
  const area = root.querySelector('#explorationChartArea');
  if (!selected.length) area.innerHTML = '<div class="exploration-empty">选择一个或多个探索后，结果图将在这里展示。</div>';
  selected.forEach(task => loadExplorationArtifacts(area, task));
}

async function loadExplorationArtifacts(area, task) {
  const card = document.createElement('article');
  card.className = 'exploration-chart';
  card.dataset.taskId = task.id;
  card.innerHTML = `<h4>${escape(task.title || task.id)}</h4><p>正在加载结果…</p>`;
  area.append(card);
  try {
    const [report, figure] = await Promise.all([fileUrl(task.id, 'report.html'), fileUrl(task.id, 'figure.png')]);
    if (card.isConnected) card.innerHTML = `<h4>${escape(task.title || task.id)}</h4><img class="image-preview" src="${figure}" alt="${escape(task.title || '探索结果')}"><p>${escape(statusText(task.review))}</p><a class="table-button" href="${report}" target="_blank" rel="noopener">查看报告</a>`;
  } catch (error) {
    if (card.isConnected) card.textContent = productError(error, '结果暂时无法读取。');
  }
}
