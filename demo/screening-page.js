/* V1.4 paged manual screening. All rows and mutations come from ERAgent. */
// Unsaved row choices and the last one-sentence result survive a re-render of the same data
// version (for example a language switch).
let screeningMemory = null;

function renderSelection(root) {
  const tables = snapshot?.inventory?.tables || [];
  if (!tables.length) {
    const hasSources = Boolean(snapshot?.workspace?.sources?.length);
    root.innerHTML = hasSources
      ? '<div class="database-empty"><strong>没有需要人工筛选的数据表</strong><p>已导入文件将保留在当前项目中。</p><button class="primary-button" data-go="protocol">下一步</button></div>'
      : '<div class="database-empty"><strong>请先读取数据</strong><p>完成 1.1 数据上传后才能逐行筛选。</p><button class="primary-button" data-go="upload">连接数据</button></div>';
    wireNavigation(root);
    return;
  }
  let active = 0;
  const pageSize = 25;
  const offsets = new Map();
  const memoryKey = `${runId}:${snapshot.workspace.data_revision}:${snapshot.workspace.selection_revision}`;
  if (screeningMemory?.key !== memoryKey) {
    screeningMemory = {key: memoryKey, selection: ScreeningModel.selectionState(snapshot.workspace.sources || []),
      loadedPages: new Set(), result: null};
  }
  const {selection, loadedPages} = screeningMemory;
  const renderRunId = runId;
  let pageTable = null;
  let requestNumber = 0;
  let shinyRequestNumber = 0;
  let viewMode = 'raw';
  let smartQueryResult = null;
  let refreshBeforeRetry = false;
  let showAllColumns = false;
  root.innerHTML = `<div class="data-selection-toolbar"><div><strong>数据库数据选择</strong><span>默认纳入全部记录；取消勾选可排除记录</span></div><div class="selection-actions"><input id="dataSearchInput" type="search" aria-label="筛选当前页" placeholder="筛选当前页"><button class="primary-button" id="nextSelectionButton" type="button">下一步</button></div></div>
    <div class="data-table-tabs">${tables.map((table,index) => `<button class="database-tab ${index === 0 ? 'active' : ''}" data-table-index="${index}" type="button">${escape(table.name)}</button>`).join('')}</div>
    <section class="smart-query-panel" aria-labelledby="smartQueryTitle"><div><strong id="smartQueryTitle">用一句话筛选受试者</strong><span>Claude Code 识别涉及的数据表和字段，结果同步到 Shiny 视图；不改动数据，正式排除需另行确认。</span></div><div class="smart-query-controls"><input id="smartQueryInput" type="text" placeholder="用一句话描述要筛选的受试者" aria-label="筛选问题"><button class="primary-button" id="runSmartQuery" type="button">筛选</button></div><div class="smart-query-examples" id="smartQueryExamples"><span class="query-examples-loading"><span class="spinner" aria-hidden="true"></span>正在生成示例…</span></div><div id="smartQueryResult" class="smart-query-result" aria-live="polite"></div></section>
    <div class="data-view-modes" role="tablist" aria-label="数据查看方式"><button class="data-view-mode active" id="screeningRawMode" role="tab" aria-selected="true" type="button">逐行筛选</button><button class="data-view-mode" id="screeningShinyMode" role="tab" aria-selected="false" type="button">Shiny 数据视图</button><span>Shiny 模式用于搜索、排序和分页，只读查看不会更改当前选择。</span></div>
    <div id="screeningRawView" role="tabpanel" aria-labelledby="screeningRawMode"><div class="selection-summary"><span>当前表：<strong id="currentTableName"></strong></span><span>当前页已选择 <strong id="selectedDataCount">0</strong> 条记录</span><span>完整逐行规则已排除 <strong id="excludedDataCount">0</strong> 行</span><span id="visibleColumnCount"></span><button class="secondary-button" id="toggleScreeningColumns" type="button">显示全部字段</button></div>
      <div id="screeningState" aria-live="polite"><div class="screening-state" id="screeningLoading">正在读取当前表的原始记录…</div><div class="screening-state hidden" id="screeningEmpty">当前表没有可筛选记录。</div><div class="screening-state screening-error hidden" id="screeningError"><strong>无法读取当前表</strong><p id="screeningErrorMessage"></p><button class="secondary-button" id="retryScreeningButton" type="button">重试</button></div></div>
      <div class="selectable-data-table hidden" id="screeningTable"><table><thead id="selectableDataHead"></thead><tbody id="selectableDataBody"></tbody></table></div>
      <div class="screening-pagination" aria-label="筛选分页"><span id="screeningPageRange">0 条记录</span><div><button class="secondary-button" id="previousScreeningPage" type="button">上一页</button><button class="secondary-button" id="nextScreeningPage" type="button">下一页</button></div></div></div>
    <div id="screeningShinyView" role="tabpanel" aria-labelledby="screeningShinyMode" hidden><div class="live-actions"><button class="secondary-button" id="openShinyWorkbench" type="button">在独立页签打开 Shiny 工作台</button></div><div class="shiny-view-state" id="shinyViewState" role="status">选择 Shiny 数据视图后将在本机启动只读表格。</div><div class="shiny-view-error hidden" id="shinyViewError" role="alert"><strong>Shiny 数据视图暂时不可用</strong><p id="shinyViewErrorMessage"></p><button class="secondary-button" id="retryShinyView" type="button">重试</button></div><div id="shinyFrameHost"></div></div>`;

  const sourceForActiveTable = () => CanvasModel.sourceForTable(tables[active], snapshot.workspace.sources);
  const capturePage = () => {
    const source = sourceForActiveTable();
    if (!source || !pageTable) return false;
    selection.capture(source.path, [...root.querySelectorAll('#selectableDataBody tr')].map(row => ({
      source_row: Number(row.dataset.row),
      included: row.querySelector('input').checked,
      exclusions: row.dataset.subjectExcluded === 'true' ? ['subject'] : [],
    })));
    return true;
  };

  const updateSummary = () => {
    const source = sourceForActiveTable();
    const boxes = [...root.querySelectorAll('.data-row-checkbox')];
    $('#selectedDataCount').textContent = boxes.filter(box => box.checked && !box.disabled).length;
    $('#excludedDataCount').textContent = source ? selection.rows(source.path).length : 0;
  };

  const updateRow = (row, included) => {
    row.classList.toggle('selected-data-row', included);
    row.lastElementChild.textContent = included ? '已纳入' : '已排除';
  };

  const showState = state => {
    $('#screeningLoading').classList.toggle('hidden', state !== 'loading');
    $('#screeningEmpty').classList.toggle('hidden', state !== 'empty');
    $('#screeningError').classList.toggle('hidden', state !== 'error');
    $('#screeningTable').classList.toggle('hidden', state !== 'ready');
    $('#previousScreeningPage').disabled = state !== 'ready';
    $('#nextScreeningPage').disabled = state !== 'ready';
    $('#nextSelectionButton').disabled = state !== 'ready';
  };

  const showMode = mode => {
    viewMode = mode;
    const raw = mode === 'raw';
    $('#screeningRawView').hidden = !raw;
    $('#screeningShinyView').hidden = raw;
    $('#dataSearchInput').hidden = !raw;
    $('#screeningRawMode').classList.toggle('active', raw);
    $('#screeningRawMode').setAttribute('aria-selected', String(raw));
    $('#screeningShinyMode').classList.toggle('active', !raw);
    $('#screeningShinyMode').setAttribute('aria-selected', String(!raw));
  };

  const operatorText = {eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤', in: t('属于', 'in'), not_in: t('不属于', 'not in'), contains: t('包含', 'contains'), missing: t('缺失', 'is missing'), present: t('非缺失', 'is present')};
  const conditionText = item => `<code>${escape(item.column)}</code> ${operatorText[item.op] || escape(item.op)}${['missing', 'present'].includes(item.op) ? '' : ` <span data-i18n-skip>${escape(Array.isArray(item.value) ? item.value.join(' / ') : item.value)}</span>`}`;
  const countText = part => {
    if (part.min_rows == null && part.max_rows == null) return '';
    const range = [part.min_rows != null ? `≥ ${part.min_rows}` : '', part.max_rows != null ? `≤ ${part.max_rows}` : ''].filter(Boolean).join(t('，', ', '));
    const rows = part.rows_per_subject;
    const spread = rows?.subjects ? t(`（每人行数：最少 ${rows.min}，中位 ${rows.median}，最多 ${rows.max}）`, ` (rows per subject: min ${rows.min}, median ${rows.median}, max ${rows.max})`) : '';
    return `<p class="query-count">${t('每位受试者满足条件的行数', 'Matching rows per subject')} ${range}${spread}</p>`;
  };
  const partMarkup = part => `<li><div class="query-part-head"><strong data-i18n-skip>${escape(part.label || part.table)}</strong><span>${escape(part.table)} · ${t(`命中 ${number(part.matched_rows)} 行 · ${number(part.subjects.length)} 人`, `${number(part.matched_rows)} rows matched · ${number(part.subjects.length)} subjects`)}</span></div>
    ${(part.conditions || []).length ? `<p>${part.conditions.map(conditionText).join(t(' 且 ', ' and '))}</p>` : `<p>${t('不限条件', 'No condition')}</p>`}${part.calculation ? `<p>${t('跨表计算：', 'Cross-table calculation: ')}<code>${escape(part.calculation)}</code></p>` : ''}${countText(part)}</li>`;

  const renderSmartQuery = result => {
    const target = $('#smartQueryResult');
    if (result.status !== 'ready') {
      const unresolved = result.unresolved_semantics || [t('当前问题需要补充信息。', 'The question needs more information.')];
      target.innerHTML = `<div class="query-clarify"><strong>${t('需要你补充一点信息', 'A little more information is needed')}</strong><p data-i18n-skip>${unresolved.map(escape).join(t('；', '; '))}</p><span>${t('补充后直接在上方改写问题再筛选。', 'Rewrite the question above with the missing detail and filter again.')}</span></div>`;
      $('#smartQueryInput').focus();
      return;
    }
    const subjects = result.subjects || [];
    const hits = (result.hits || []).slice(0, 20).map(hit =>
      `<tr><td>${escape(hit.subject)}</td><td>${number(hit.last_dose_day)}</td><td>${number(hit.event_day)}</td><td>${number(hit.difference_days)}</td></tr>`).join('');
    const joiner = (result.parts || []).length > 1 ? `<p class="query-combine">${result.combine === 'any' ? t('满足任一条件即纳入', 'Included when any condition matches') : t('需同时满足以上全部条件', 'All conditions above must match')}</p>` : '';
    target.innerHTML = `<div class="query-answer"><div class="query-headline"><span class="query-count-badge">${number(subjects.length)}</span><div><strong>${subjects.length ? t(`找到 ${number(subjects.length)} 位受试者`, `Found ${number(subjects.length)} subjects`) : t('没有符合条件的受试者', 'No subject matches')}</strong><p>${t('Claude 理解为：', 'Claude read this as: ')}<span data-i18n-skip>${escape(result.summary || t('按下列条件筛选', 'Filter by the conditions below'))}</span></p></div></div>
      <ol class="query-parts">${(result.parts || []).map(partMarkup).join('')}</ol>${joiner}
      ${subjects.length ? `<details class="query-subjects"><summary>${t('查看受试者名单', 'Subject list')}</summary><p>${subjects.slice(0, 200).map(value => `<code>${escape(value)}</code>`).join(' ')}${subjects.length > 200 ? t(` 等共 ${number(subjects.length)} 人`, ` and more, ${number(subjects.length)} in total`) : ''}</p></details>` : ''}
      ${hits ? `<details><summary>${t('跨表计算明细', 'Cross-table calculation details')}</summary><div class="selectable-data-table"><table><thead><tr><th>Subject</th><th>${t('末次给药日', 'Last dose day')}</th><th>${t('事件日', 'Event day')}</th><th>${t('相差天数', 'Days between')}</th></tr></thead><tbody>${hits}</tbody></table></div></details>` : ''}
      <div class="live-actions">${subjects.length ? `<button class="primary-button" id="showQueryInShiny" type="button">${t(`在 Shiny 视图中查看这 ${number(subjects.length)} 人`, `View these ${number(subjects.length)} subjects in the Shiny view`)}</button>` : ''}<button class="secondary-button" id="clearQueryView" type="button">${t('清除视图筛选', 'Clear the view filter')}</button>${subjects.length ? `<button class="danger-button" id="proposeSubjectExclusion" type="button">${t('评估正式排除影响', 'Assess a formal exclusion')}</button>` : ''}</div></div>`;
    const showInShiny = $('#showQueryInShiny');
    if (showInShiny) showInShiny.onclick = () => { capturePage(); showMode('shiny'); loadShiny(); };
    $('#clearQueryView').onclick = () => action(async () => {
      const panel = await api(`/api/runs/${encodeURIComponent(runId)}/panel-state`);
      await api(`/api/runs/${encodeURIComponent(runId)}/panel-state`, {
        changes: {subjects: []}, base_revision: panel.revision || 0, modified_by: 'user',
      });
      target.innerHTML = '';
      notice('已清除 Shiny 视图的受试者筛选。');
    });
    const propose = $('#proposeSubjectExclusion');
    if (propose) propose.onclick = () => action(async () => {
      const reason = await ask('请填写正式排除原因', result.summary || '');
      if (!reason) return;
      propose.disabled = true;
      const proposal = await api(`/api/runs/${encodeURIComponent(runId)}/selection-proposals`, {
        subjects, reason,
      });
      const impacts = (proposal.impacts || []).map(item =>
        `<li>${escape(item.table)}：<strong>${number(item.affected_rows)}</strong> 行</li>`).join('');
      target.insertAdjacentHTML('beforeend', `<div class="selection-proposal" id="selectionProposal"><strong>正式排除影响</strong><p>${escape(proposal.reason)}</p><ul>${impacts}</ul><p>确认后将创建新的数据筛选版本；不会改写源数据。</p><button class="danger-button" id="confirmSubjectExclusion" type="button">${t(`确认排除 ${number(subjects.length)} 位受试者`, `Confirm excluding ${number(subjects.length)} subjects`)}</button></div>`);
      $('#confirmSubjectExclusion').onclick = () => action(async () => {
        $('#confirmSubjectExclusion').disabled = true;
        await api(`/api/runs/${encodeURIComponent(runId)}/selection-proposals/${encodeURIComponent(proposal.id)}/confirm`, {confirmed: true});
        notice('已按确认内容创建新的数据筛选版本。');
        await refresh(false);
        if (root.isConnected && runId === renderRunId && page === 'screening') renderSelection(root);
      });
    });
  };

  const runSmartQuery = () => action(async () => {
    const text = $('#smartQueryInput').value.trim();
    if (!text) throw new Error('请输入跨表筛选问题。');
    $('#runSmartQuery').disabled = true;
    $('#smartQueryResult').innerHTML = '<div class="query-thinking"><span class="spinner" aria-hidden="true"></span>Claude Code 正在识别涉及的数据表和字段，并逐条核对记录…</div>';
    try {
      smartQueryResult = await api(`/api/runs/${encodeURIComponent(runId)}/smart-query`, {text});
      if (screeningMemory?.key === memoryKey) screeningMemory.result = smartQueryResult;
      renderSmartQuery(smartQueryResult);
    } finally {
      if ($('#runSmartQuery')) $('#runSmartQuery').disabled = false;
    }
  });

  const loadShiny = async () => {
    const source = sourceForActiveTable();
    const request = ++shinyRequestNumber;
    $('#shinyViewState').textContent = '正在启动本地 Shiny 数据视图…';
    $('#shinyViewState').classList.remove('hidden');
    $('#shinyViewError').classList.add('hidden');
    $('#shinyFrameHost').innerHTML = '';
    try {
      if (!source) throw new Error('当前数据表缺少可核验的源文件映射。');
      // In VS Code the Workbench is its own Webview panel; nothing loads over the browser network.
      if (window.canvasHostSend) {
        window.canvasHostSend({type: 'demo.openShiny', runId, source: source.path,
          dataRevision: snapshot.workspace.data_revision, workspace: 'data'});
        $('#shinyViewState').textContent = 'Shiny 数据视图已在 VS Code 的 ERAgent Data Workbench 页签中打开。';
        return;
      }
      const target = ScreeningModel.shinyRequest(
        runId, source.path, snapshot.workspace.data_revision,
      );
      const result = await api(target.path, target.payload);
      if (request !== shinyRequestNumber || !root.isConnected || runId !== renderRunId || page !== 'screening' || viewMode !== 'shiny') return;
      if (result?.table?.source !== source.path || result.mode !== 'read_only') {
        throw new Error('Shiny 数据视图返回了无效绑定。');
      }
      const dataUrl = new URL(ScreeningModel.safeShinyUrl(result.url));
      dataUrl.searchParams.set('workspace', 'data');
      $('#shinyViewState').classList.add('hidden');
      $('#shinyFrameHost').innerHTML = `<iframe class="shiny-data-frame" src="${escape(dataUrl.toString())}" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer" title="Shiny 数据阅览与筛选"></iframe>`;
    } catch (error) {
      if (request !== shinyRequestNumber || !root.isConnected || runId !== renderRunId || page !== 'screening' || viewMode !== 'shiny') return;
      $('#shinyViewState').classList.add('hidden');
      $('#shinyViewErrorMessage').textContent = productError(error, '本地 Shiny 服务未能启动，请确认 R 环境后重试。');
      $('#shinyViewError').classList.remove('hidden');
    }
  };

  const drawPage = () => {
    const source = sourceForActiveTable();
    const columns = pageTable.columns || [];
    const priority = [
      'USUBJID', 'SUBJID', 'STUDYID', 'AESEQ', 'EXSEQ', 'PCSEQ',
      'PARAMREP', 'PARAMCD', 'PARAM', 'AVAL', 'AVALC', 'AVALU',
      'AEDECOD', 'AETOXGR', 'AESER', 'EXTRT', 'EXDOSE', 'EXDOSU',
      'CYCLE', 'AVISIT', 'ATPT', 'ADY', 'ASTDY', 'AENDY',
      'TRTP', 'TRTA', 'ARM', 'ACTARM', 'SAFFL', 'PKFL', 'TRTEMFL',
    ];
    const ordered = priority.map(name => columns.find(column => column.name.toUpperCase() === name)).filter(Boolean);
    const visibleColumns = showAllColumns
      ? columns
      : [...ordered, ...columns.filter(column => !ordered.includes(column))].slice(0, 12);
    const rows = pageTable.rows || [];
    const excludedRows = new Set(selection.rows(source.path));
    $('#visibleColumnCount').textContent = `显示 ${number(visibleColumns.length)} / ${number(columns.length)} 个字段`;
    $('#toggleScreeningColumns').textContent = showAllColumns ? '仅显示关键字段' : '显示全部字段';
    $('#selectableDataHead').innerHTML = `<tr><th>纳入</th>${visibleColumns.map(column => `<th title="${escape(column.name)}">${escape(column.name)}</th>`).join('')}<th>数据状态</th></tr>`;
    $('#selectableDataBody').innerHTML = rows.map(row => {
      const sourceRow = Number(row.source_row);
      const state = ScreeningModel.rowPresentation(row, excludedRows);
      const search = Object.values(row.values || {}).join(' ').toLowerCase();
      return `<tr data-row="${sourceRow}" data-search="${escape(search)}" data-subject-excluded="${state.subjectExcluded}" class="${state.effectivelyIncluded ? 'selected-data-row' : ''}"><td><input class="data-row-checkbox" type="checkbox" aria-label="源记录 ${sourceRow}${state.subjectExcluded ? '，受试者规则排除' : ''}" ${state.checked ? 'checked' : ''} ${state.subjectExcluded ? 'disabled' : ''}></td>${visibleColumns.map(column => { const value = escape(row.values?.[column.name] ?? '—'); return `<td title="${value}">${value}</td>`; }).join('')}<td>${state.status}</td></tr>`;
    }).join('');
    const start = pageTable.preview_count ? pageTable.offset + 1 : 0;
    const end = pageTable.offset + pageTable.preview_count;
    $('#screeningPageRange').textContent = pageTable.total_records ? `${start}–${end} / ${number(pageTable.total_records)} 条记录` : '0 条记录';
    $('#previousScreeningPage').disabled = pageTable.offset === 0;
    $('#nextScreeningPage').disabled = end >= pageTable.total_records;
    root.querySelectorAll('.data-row-checkbox').forEach(box => { box.onchange = () => {
      updateRow(box.closest('tr'), box.checked);
      capturePage();
      updateSummary();
    }; });
    updateSummary();
  };

  const loadPage = async () => {
    const table = tables[active];
    const source = sourceForActiveTable();
    const offset = offsets.get(source?.path) || 0;
    const request = ++requestNumber;
    pageTable = null;
    $('#currentTableName').textContent = table.name;
    $('#dataSearchInput').value = '';
    $('#screeningPageRange').textContent = '正在读取…';
    root.querySelectorAll('[data-table-index]').forEach(button => button.classList.toggle('active', Number(button.dataset.tableIndex) === active));
    showState('loading');
    try {
      if (!source) throw new Error('当前数据表缺少可核验的源文件映射。');
      const result = await api(ScreeningModel.requestPath(
        runId, source.path, offset, pageSize, snapshot.workspace.data_revision,
      ));
      if (request !== requestNumber || !root.isConnected || runId !== renderRunId || page !== 'screening') return;
      if (!result?.table || result.table.source !== source.path || !Array.isArray(result.table.rows)) {
        throw new Error('筛选接口返回了无效数据。');
      }
      refreshBeforeRetry = false;
      pageTable = result.table;
      offsets.set(source.path, pageTable.offset);
      const pageKey = `${source.path}:${pageTable.offset}`;
      if (!loadedPages.has(pageKey)) {
        selection.ingest(source.path, pageTable.rows);
        loadedPages.add(pageKey);
      }
      if (!pageTable.preview_count) {
        $('#screeningPageRange').textContent = '0 条记录';
        showState('empty');
        return;
      }
      showState('ready');
      drawPage();
    } catch (error) {
      if (request !== requestNumber || !root.isConnected || runId !== renderRunId || page !== 'screening') return;
      refreshBeforeRetry = error.httpStatus === 409;
      $('#screeningErrorMessage').textContent = productError(error, '当前表暂时无法读取，请重试。');
      $('#screeningPageRange').textContent = '读取失败';
      showState('error');
    }
  };

  root.querySelectorAll('[data-table-index]').forEach(button => { button.onclick = () => {
    capturePage();
    active = Number(button.dataset.tableIndex);
    showAllColumns = false;
    loadPage();
    if (viewMode === 'shiny') loadShiny();
  }; });
  $('#screeningRawMode').onclick = () => showMode('raw');
  $('#screeningShinyMode').onclick = () => {
    capturePage();
    showMode('shiny');
    loadShiny();
  };
  $('#retryShinyView').onclick = loadShiny;
  $('#runSmartQuery').onclick = runSmartQuery;
  $('#smartQueryInput').onkeydown = event => {
    if (event.key === 'Enter' && !event.isComposing) runSmartQuery();
  };
  loadQueryExamples(root, runSmartQuery);
  $('#openShinyWorkbench').onclick = () => {
    const source = sourceForActiveTable();
    if (!source) return notice('当前数据表缺少可核验的源文件映射。');
    if (!window.canvasHostSend) return notice('独立工作台需要在 VS Code 中打开。');
    window.canvasHostSend({
      type: 'demo.openShiny', runId, source: source.path,
      dataRevision: snapshot.workspace.data_revision,
    });
  };
  $('#dataSearchInput').oninput = event => root.querySelectorAll('#selectableDataBody tr').forEach(row => { row.hidden = !row.dataset.search.includes(event.target.value.toLowerCase()); });
  $('#toggleScreeningColumns').onclick = () => {
    if (!pageTable) return;
    showAllColumns = !showAllColumns;
    drawPage();
  };
  $('#previousScreeningPage').onclick = () => {
    const source = sourceForActiveTable();
    if (!source || !capturePage()) return;
    offsets.set(source.path, Math.max(0, pageTable.offset - pageTable.limit));
    loadPage();
  };
  $('#nextScreeningPage').onclick = () => {
    const source = sourceForActiveTable();
    if (!source || !capturePage()) return;
    offsets.set(source.path, pageTable.offset + pageTable.limit);
    loadPage();
  };
  $('#retryScreeningButton').onclick = async () => {
    if (!refreshBeforeRetry) return loadPage();
    showState('loading');
    try {
      await refresh(false);
      if (root.isConnected && runId === renderRunId && page === 'screening') renderSelection(root);
    } catch (error) {
      $('#screeningErrorMessage').textContent = productError(error, '筛选结果未能保存，请重试。');
      showState('error');
    }
  };
  const saveRevision = async (sources, reason, excludeSubjects) => {
    try {
      await api(`/api/runs/${encodeURIComponent(runId)}/selection-revisions`, {
        run_id: runId, sources, reason, exclude_subjects: excludeSubjects,
        expected_data_revision: snapshot.workspace.data_revision,
        expected_selection_revision: snapshot.workspace.selection_revision,
      });
    } catch (error) {
      if (error.httpStatus !== 409) throw error;
      notice('筛选草稿未保存；数据版本已变更，正在刷新当前版本…');
      try {
        await refresh(false);
      } catch (refreshError) {
        throw new Error('筛选内容已经更新，但页面暂时无法刷新。请稍后重试。');
      }
      if (root.isConnected && runId === renderRunId && page === 'screening') renderSelection(root);
      notice('筛选草稿未保存；已刷新到当前版本，请重新确认后保存。');
      return false;
    }
    await refresh(false);
    return true;
  };
  $('#nextSelectionButton').onclick = () => action(async () => {
    if (!capturePage()) throw new Error('请先成功读取当前数据页，再保存筛选。');
    const sources = selection.buildSources(snapshot.workspace.sources);
    const hasExclusions = sources.some(source => source.exclude_rows.length);
    let reason = snapshot.workspace.reason || '';
    if (hasExclusions && !reason) reason = await ask('请填写排除原因');
    if (hasExclusions && !reason) return;
    if (await saveRevision(sources, reason, snapshot.workspace.exclude_subjects || [])) navigate('protocol');
  });
  beforePageRerender = () => { capturePage(); };
  if (screeningMemory.result) { smartQueryResult = screeningMemory.result; renderSmartQuery(smartQueryResult); }
  loadPage();
}

// Example questions come from Claude reading this study's tables, never from fixed strings.
async function loadQueryExamples(root, run) {
  const host = root.querySelector('#smartQueryExamples'), viewRun = runId;
  if (!host) return;
  try {
    const {questions} = await api(`/api/runs/${encodeURIComponent(viewRun)}/smart-query-suggestions`, {});
    if (runId !== viewRun || !host.isConnected) return;
    host.innerHTML = `<span class="query-examples-label">示例：</span>${questions.map(text => `<button type="button" class="query-example" data-i18n-skip data-query="${escape(text)}">${escape(text)}</button>`).join('')}`;
    host.querySelectorAll('[data-query]').forEach(button => { button.onclick = () => {
      $('#smartQueryInput').value = button.dataset.query;
      run();
    }; });
  } catch (error) {
    // Say why there are no examples (for example an expired Claude login) instead of going blank.
    if (host.isConnected) host.innerHTML = `<span class="query-examples-label">${escape(productError(error, '示例暂时无法生成。'))}</span>`;
  }
}
