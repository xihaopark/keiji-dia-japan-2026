const chartTypes = [
  'swimming plots', 'multi-panel hccprofile', 'PK concentration-time profile',
  'single metric comparison', 'single multi-indicator composite',
];
function chartPendingMessage(task) {
  if (task.status === 'needs_input') {
    const result = task.result || {};
    return String(result.questions?.[0] || result.message || '需要补充信息后继续。').slice(0, 420);
  }
  return ConversationPresenter.conciseTurnError(task.error || '');
}

function renderCharts(root) {
  const tables = snapshot.inventory.tables || [];
  const draft = uiDrafts.get(`charts:${runId}`) || {};
  const plotTasks = currentTasks('charts');
  const analysisData = snapshot.analysis_data || {status: 'needs_input', message: 'Analysis Data 尚未准备。'};
  const analysisTask = currentTasks('analysis-data')[0];
  const presentation = analysisDataPresentation(analysisData, analysisTask);
  const workbenchBinding = JSON.stringify([runId, snapshot.workspace.data_revision,
    snapshot.workspace.selection_revision, snapshot.workspace.protocol_revision, analysisData.mapping_sha256]);
  const existingWorkbench = root.querySelector('#analysisWorkbenchHost .shiny-data-frame');
  if (existingWorkbench && (existingWorkbench.dataset.binding !== workbenchBinding || analysisData.status !== 'ready')) existingWorkbench.remove();
  if (!root.querySelector('#chartControlsHost')) root.innerHTML = '<div id="chartControlsHost"></div>';

  root.querySelector('#chartControlsHost').innerHTML = `<div class="chart-workspace">
    <section class="analysis-data-module ${presentation.state === 'ready' ? 'is-ready' : ''}">
      <div><strong>Analysis Data</strong><span class="status-badge">${escape(statusText(presentation.state))}</span><p>${escape(presentation.state==='ready'?`${presentation.detail} · V${presentation.version}`:'请先在独立的 Analysis Data 步骤完成准备。')}</p></div>
      <button type="button" class="secondary-button" id="openAnalysisDataPreparation">${presentation.state==='ready'?'查看或重新准备':'前往准备'}</button>
    </section>
    <section class="chart-config-module">
      <div class="module-heading"><div><strong>图片配置</strong></div></div>
      <form class="chart-field-grid" id="chartsForm">
        <label class="wide">图片名称<input id="plotName" name="title" value="${escape(draft.title || '')}" placeholder="例如：PK 浓度-时间曲线"></label>
        <label>数据表<select name="table" required>${options(tables.map(table => table.name), draft.table)}</select></label>
        <label>图片模板<select name="template">${chartTypes.map((value, index) => `<option value="${escape(value)}" ${value === (draft.template || chartTypes[0]) ? 'selected' : ''}>${escape(['泳道图','多面板曲线','PK 浓度-时间曲线','单指标比较','多指标综合图'][index])}</option>`).join('')}</select></label>
        <details class="chart-advanced wide">
          <summary>字段与显示选项</summary>
          <div class="chart-advanced-grid">
            <label>分析维度<select name="dimension">${options(['individual', 'pooled'], draft.dimension)}</select></label>
            <label>Subject ID<select name="subject"><option value="">选择字段</option></select></label>
            <label>横坐标<select name="x" required><option value="">选择字段</option></select></label>
            <label>纵坐标（左）<select name="y" required><option value="">选择字段</option></select></label>
            <label>纵坐标（右）<select name="y2"><option value="">不使用</option></select></label>
            <label>分组字段<select name="group"><option value="">不分组</option></select></label>
            <label class="free-y"><input name="free_y" type="checkbox" ${draft.free_y ? 'checked' : ''}> 各分面独立纵轴</label>
          </div>
        </details>
        <label class="wide">补充要求<textarea name="instruction" required placeholder="请说明指标、单位、时间起点和展示要求。">${escape(draft.instruction || '')}</textarea></label>
        <input type="hidden" name="plot_id" value="${escape(draft.plot_id || crypto.randomUUID())}">
        <input type="hidden" name="parent_task_id" value="${escape(draft.parent_task_id || '')}">
        <button class="primary-button chart-generate-button" id="generateFigure" ${tables.length ? '' : 'disabled'}>确认生成图片 →</button>
      </form>
    </section>
    <section class="chart-generated-module">
      <div class="module-heading"><div><strong>已生成图片</strong></div></div>
      <div class="generated-gallery"><nav class="generated-types"><button id="allPlots" class="active" type="button">全部图片</button><button id="savedPlots" type="button">已保存</button></nav><div class="generated-previews" id="chartGallery"></div></div>
    </section>
  </div>`;

  if (!root.querySelector('#analysisWorkbenchHost')) root.insertAdjacentHTML('afterbegin', `<section class="surface"><h3>Shiny · 分析与绘图</h3>
    <p>使用已准备的 Analysis Data 选择受试者、调整图表并导出。原始数据阅览和筛选在数据库步骤完成。</p>
    <button type="button" class="primary-button" id="openAnalysisWorkbench" ${analysisData.status === 'ready' ? '' : 'disabled'}>打开绘图工作台</button>
    <div id="analysisWorkbenchHost"></div></section>`);
  $('#openAnalysisWorkbench').disabled = analysisData.status !== 'ready';
  $('#openAnalysisWorkbench').onclick = () => action(async () => {
    const source = CanvasModel.sourceForTable(tables[0], snapshot.workspace.sources);
    if (!source) throw new Error('当前 Run 缺少可核验的数据源。');
    if (window.canvasHostSend) {
      window.canvasHostSend({type:'demo.openShiny', runId, source:source.path,
        dataRevision:snapshot.workspace.data_revision, workspace:'analysis'});
      return;
    }
    const viewRun = runId;
    const target = ScreeningModel.shinyRequest(runId, source.path, snapshot.workspace.data_revision);
    const result = await api(target.path, target.payload);
    if (page !== 'charts' || runId !== viewRun || !root.isConnected) return;
    const currentBinding = JSON.stringify([runId, snapshot.workspace.data_revision,
      snapshot.workspace.selection_revision, snapshot.workspace.protocol_revision, snapshot.analysis_data?.mapping_sha256]);
    if (snapshot.analysis_data?.status !== 'ready' || currentBinding !== workbenchBinding) {
      throw new Error('数据版本已更新，请重新打开绘图工作台。');
    }
    const url = new URL(ScreeningModel.safeShinyUrl(result.url));
    url.searchParams.set('workspace', 'analysis');
    $('#analysisWorkbenchHost').innerHTML = `<iframe class="shiny-data-frame" src="${escape(url.toString())}" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" title="Shiny 分析与绘图"></iframe>`;
    $('#analysisWorkbenchHost iframe').dataset.binding = workbenchBinding;
  });

  const form = $('#chartsForm');
  $('#openAnalysisDataPreparation').onclick = () => navigate('preparation');
  const saveDraft = () => uiDrafts.set(`charts:${runId}`, {...Object.fromEntries(new FormData(form))});
  const mapFields = () => {
    const table = tables.find(value => value.name === form.elements.table.value);
    for (const key of ['subject', 'x', 'y', 'y2', 'group']) {
      const field = form.elements[key];
      const value = field.value || draft[key] || '';
      field.innerHTML = `<option value="">${key === 'y2' ? '不使用' : key === 'group' ? '不分组' : '选择字段'}</option>` + options((table?.columns || []).map(column => column.name), value);
    }
    saveDraft();
    const governed = ['swimming plots', 'multi-panel hccprofile', 'PK concentration-time profile']
      .includes(form.elements.template.value);
    form.elements.x.required = !governed;
    form.elements.y.required = !governed;
    $('#generateFigure').disabled = !tables.length || (governed && analysisData.status !== 'ready');
    $('#generateFigure').title = governed && analysisData.status !== 'ready'
      ? '请先完成 Analysis Data 准备' : '';
  };
  form.elements.table.onchange = mapFields;
  form.oninput = saveDraft;
  form.onchange = saveDraft;
  form.elements.template.onchange = () => { saveDraft(); mapFields(); };
  form.addEventListener('invalid', event => event.target.closest('details')?.setAttribute('open', ''), true);
  mapFields();

  form.onsubmit = event => {
    event.preventDefault();
    action(async () => {
      const requestedRun = runId;
      const parameters = {...Object.fromEntries(new FormData(form))};
      parameters.title = String(parameters.title || '').trim() || '未命名图片';
      if (['swimming plots', 'multi-panel hccprofile', 'PK concentration-time profile'].includes(parameters.template)) {
        for (const key of ['table', 'subject', 'x', 'y', 'y2', 'group']) delete parameters[key];
      }
      const cloud_policy = selectedDataPolicy();
      await startAgent('charts', {title: parameters.title, message: parameters.instruction, cloud_policy, parameters},
        'Generate this figure with R and preserve the exact used data and mapping.');
      if (runId !== requestedRun) return;
      uiDrafts.delete(`charts:${requestedRun}`);
      await refresh();
      if (runId !== requestedRun) return;
      showConversations();
    });
  };

  const drawGallery = async (savedOnly = false) => {
    const gallery = $('#chartGallery');
    gallery.innerHTML = '';
    const figures = plotTasks.filter(task => !savedOnly || task.figure_saved);
    if (!figures.length) {
      gallery.innerHTML = `<div class="gallery-empty">${savedOnly ? '暂无已保存图片。' : '确认生成后，图片会显示在这里。'}</div>`;
      return;
    }
    for (const task of figures) {
      const isCompleted = task.status === 'completed';
      const isCurrent = !task.stale && (!task.integrity || task.integrity === 'current');
      const lineage = task.parameters.plot_id || task.id;
      const versions = plotTasks.filter(item => (item.parameters.plot_id || item.id) === lineage).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const version = versions.findIndex(item => item.id === task.id) + 1;
      const title = task.figure_title || task.parameters.title || '未命名图片';
      const card = document.createElement('article');
      card.className = 'figure-result';
      card.innerHTML = `<div class="plot-thumbnail">${isCompleted ? `<button class="plot-open" aria-label="查看 ${escape(title)}"><img class="image-preview" alt="${escape(title)}"></button>` : `<div class="plot-pending"><strong>${escape(statusText(task.status))}</strong><small>${escape(chartPendingMessage(task))}</small></div>`}</div><div class="result-heading"><strong>${escape(title)}</strong><span>${isCurrent ? `V${version}` : '数据已更新'}</span></div><p>${prettyDate(task.created_at)}</p><div class="plot-card-actions"><button class="primary-button" data-save ${!isCompleted || !isCurrent || task.figure_saved ? 'disabled' : ''}>${task.figure_saved ? '已保存' : '保存图片'}</button><button class="secondary-button" data-revise ${!isCompleted || !isCurrent ? 'disabled' : ''}>生成新版本</button></div>`;
      gallery.append(card);
      card.querySelector('[data-save]').onclick = () => action(async () => { await api('/api/figure/save', {run_id: runId, task_id: task.id, title}); await refresh(); });
      card.querySelector('[data-revise]').onclick = () => {
        uiDrafts.set(`charts:${runId}`, {...task.parameters, plot_id: lineage, parent_task_id: task.id, title});
        renderCharts(root);
      };
      if (isCompleted) try {
        const url = await fileUrl(task.id, 'figure.png');
        if (!card.isConnected) continue;
        card.querySelector('img').src = url;
        card.querySelector('.plot-open').onclick = () => {
          const dialog = document.createElement('dialog');
          dialog.className = 'live-dialog plot-preview-dialog';
          dialog.innerHTML = `<div class="result-heading"><h3>${escape(title)} · V${version}</h3><button class="secondary-button" data-close>关闭</button></div><img src="${url}" alt="${escape(title)}" class="image-preview">`;
          document.body.append(dialog);
          dialog.querySelector('[data-close]').onclick = () => dialog.close();
          dialog.onclose = () => dialog.remove();
          dialog.showModal();
        };
      } catch (error) {
        if (card.isConnected) card.querySelector('.plot-thumbnail').textContent = productError(error, '图片暂时无法读取。');
      }
    }
  };
  $('#allPlots').onclick = () => { $('#allPlots').classList.add('active'); $('#savedPlots').classList.remove('active'); drawGallery(); };
  $('#savedPlots').onclick = () => { $('#savedPlots').classList.add('active'); $('#allPlots').classList.remove('active'); drawGallery(true); };
  drawGallery();
}
