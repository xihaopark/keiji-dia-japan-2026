/* Data page: subjects through the data steps as a Sankey, from the /database subject_flow counts.
   Real counts only; a stage the project has not produced is left out, and a zero branch is not
   drawn. Endpoint groups overlap (one subject can have several events), so they are not a split. */
const FLOW_W = 900, FLOW_H = 280, FLOW_NODE = 8, FLOW_GAP = 16, FLOW_TOP = 30, FLOW_LABEL = 190;

function subjectFlowGraph(flow) {
  const columns = [], links = [];
  const column = (title, nodes) => columns.push({title, nodes: nodes.filter(node => node.value > 0)});
  const link = (source, target, value, kind = '') => { if (value > 0) links.push({source, target, value, kind}); };
  column(t('源数据', 'Source'), [{id: 'source', label: t('受试者', 'Subjects'), value: flow.source}]);
  column(t('人工筛选', 'Screening'), [{id: 'selected', label: t('纳入', 'Included'), value: flow.selected},
    {id: 'screened_out', label: t('筛选排除', 'Excluded'), value: flow.screened_out, kind: 'out'}]);
  link('source', 'selected', flow.selected);
  link('source', 'screened_out', flow.screened_out, 'out');
  if (flow.analysis == null) return {columns, links};
  column('Analysis Data', [{id: 'analysis', label: t('分析受试者', 'Analysis subjects'), value: flow.analysis},
    {id: 'not_analysis', label: t('未纳入', 'Not included'), value: flow.not_analysis, kind: 'out'}]);
  link('selected', 'analysis', flow.analysis);
  link('selected', 'not_analysis', flow.not_analysis, 'out');
  if (flow.exposure == null) return {columns, links};
  column(t('暴露数据集', 'Exposure dataset'), [{id: 'exposure', label: t('有暴露指标', 'With exposure'), value: flow.exposure},
    {id: 'not_exposure', label: t('无暴露指标', 'No exposure'), value: flow.not_exposure, kind: 'out'}]);
  link('analysis', 'exposure', flow.exposure);
  link('analysis', 'not_exposure', flow.not_exposure, 'out');
  const groups = flow.groups || [];
  column(t('剂量组', 'Dose group'), groups.map((group, index) => ({id: `g${index}`, label: group.label, value: group.value, kind: `c${index % 5}`})));
  groups.forEach((group, index) => link('exposure', `g${index}`, group.value, `c${index % 5}`));
  const endpoints = flow.endpoints || [];
  if (endpoints.length) {
    column(t('终点事件（可重叠）', 'Endpoint events (overlap)'), endpoints.map((item, index) => ({id: `e${index}`, label: item.label, value: item.value})));
    endpoints.forEach((item, index) => groups.forEach((group, gi) => link(`g${gi}`, `e${index}`, item.by_group?.[group.label] || 0, `c${gi % 5}`)));
  }
  return {columns, links};
}

function subjectFlowLayout(graph) {
  const nodes = {}, step = (FLOW_W - FLOW_LABEL - FLOW_NODE) / Math.max(1, graph.columns.length - 1);
  const room = FLOW_H - FLOW_TOP - 6, last = graph.columns.length - 1;
  const scale = Math.min(...graph.columns.map(item => (room - FLOW_GAP * (item.nodes.length - 1)) / Math.max(1, item.nodes.reduce((sum, node) => sum + node.value, 0))));
  graph.columns.forEach((item, index) => {
    let y = FLOW_TOP;
    item.nodes.forEach(node => {
      nodes[node.id] = {...node, x: index * step, y, h: Math.max(2, node.value * scale), out: 0, in: 0, last: index === last};
      y += nodes[node.id].h + FLOW_GAP;
    });
  });
  const links = graph.links.filter(item => nodes[item.source] && nodes[item.target]);
  // Overlapping groups send out more than the node holds; squeeze them on the source side only.
  const sent = {};
  links.forEach(item => { sent[item.source] = (sent[item.source] || 0) + item.value; });
  const ribbons = links.map(item => {
    const source = nodes[item.source], target = nodes[item.target], h1 = item.value * scale;
    const h0 = h1 * Math.min(1, source.value / sent[item.source]);
    const x0 = source.x + FLOW_NODE, x1 = target.x, xm = (x0 + x1) / 2;
    const y0 = source.y + source.out, y1 = target.y + target.in;
    source.out += h0; target.in += h1;
    return {...item, d: `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h1} C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0} Z`,
      title: `${source.label} → ${target.label}：${item.value}`};
  });
  return {nodes: Object.values(nodes), ribbons, step};
}

function subjectFlowSvg(flow) {
  const graph = subjectFlowGraph(flow), layout = subjectFlowLayout(graph);
  const short = text => String(text).length > 26 ? `${String(text).slice(0, 25)}…` : String(text);
  const heads = graph.columns.map((item, index) => `<text class="flow-head" x="${index * layout.step}" y="14">${escape(item.title)}</text>`).join('');
  const ribbons = layout.ribbons.map(item => `<path class="flow-link ${item.kind}" d="${item.d}"><title>${escape(item.title)}</title></path>`).join('');
  const nodes = layout.nodes.map(node => `<g class="flow-node ${node.kind || ''}"><rect x="${node.x}" y="${node.y}" width="${FLOW_NODE}" height="${node.h}" rx="3"><title>${escape(`${node.label}：${node.value}`)}</title></rect>
    <text x="${node.x + FLOW_NODE + 6}" y="${node.last ? node.y + node.h / 2 + 4 : node.y + 13}"><tspan class="flow-label" data-i18n-skip>${escape(short(node.label))}</tspan><tspan class="flow-value" dx="6">${number(node.value)}</tspan></text></g>`).join('');
  return `<svg class="subject-flow" viewBox="0 0 ${FLOW_W} ${FLOW_H}" role="img" aria-label="${t('受试者流向', 'Subject flow')}">${heads}${ribbons}${nodes}</svg>`;
}

function subjectFlowMarkup(flow) {
  if (!flow) return '';
  if (flow.error) return `<p class="info-note warning" data-i18n-skip>${escape(flow.error)}</p>`;
  if (!flow.source) return `<p class="info-note">${t('确认数据路径后显示受试者流向。', 'The subject flow appears once a data folder is confirmed.')}</p>`;
  const stats = [[t('源数据受试者', 'Source subjects'), flow.source], [t('筛选排除', 'Screened out'), flow.screened_out],
    flow.analysis != null ? [t('分析受试者', 'Analysis subjects'), flow.analysis] : null,
    flow.exposure != null ? [t('暴露数据集', 'Exposure dataset'), flow.exposure] : null].filter(Boolean);
  const unreadable = (flow.unreadable || []).length ? `<p class="info-note warning">${t(`${flow.unreadable.length} 张表找不到受试者列，未计入。`, `${flow.unreadable.length} tables have no subject column and are not counted.`)}</p>` : '';
  return `<dl class="run-header">${stats.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${number(value)}</dd></div>`).join('')}</dl>
    <div class="subject-flow-wrap">${subjectFlowSvg(flow)}</div>${unreadable}
    <p class="model-footnote">${t('单位为受试者。每一步只计入上一步保留下来的受试者；终点按有事件的受试者计数，一名受试者可以出现在多个终点里。', 'Counts are subjects. Each step counts only subjects kept by the step before; endpoints count subjects with the event, and one subject can appear under several endpoints.')}</p>`;
}

// Each step's latest finished report, in workflow order, read on the data page beside the flow.
const STAGE_REPORTS = () => [
  {kind: 'summary', label: 'Data Summary', page: 'summary', needs: []},
  {kind: 'erqc', label: t('数据质量 QC', 'Data quality QC'), page: 'qc', needs: [0]},
  {kind: 'analysis-data', label: 'Analysis Data', page: 'preparation', noReport: true, needs: [0, 1]},
  {kind: 'exposure-response', phase: 'metrics', label: t('暴露指标', 'Exposure metrics'), page: 'exposure', needs: [2]},
  {kind: 'exposure-response', phase: 'er', label: t('暴露–效应解读', 'Exposure-response interpretation'), page: 'exposure', needs: [3]},
  {kind: 'exposure-response', phase: 'modeling', label: t('统计建模', 'Statistical modeling'), page: 'exposure', needs: [3]},
  {kind: 'exposure-response', phase: 'report', label: t('评审报告', 'Review report'), page: 'exposure', needs: [3, 4, 5]},
];
let stageReportOpen = '';

function stageReportTask(stage) {
  return (typeof currentTasks === 'function' ? currentTasks(stage.kind) : [])
    .filter(task => task.status === 'completed' && (!stage.phase || task.parameters?.phase === stage.phase))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
}

function stageReportsMarkup() {
  const finished = task => String(task?.completed_at || task?.created_at || '');
  const rows = STAGE_REPORTS().map((stage, index) => ({stage, index, task: stageReportTask(stage)}));
  // A report built before the latest result of a step it reads rests on the older result.
  rows.forEach(row => { row.behind = row.task && row.stage.needs.some(index => rows[index].task && finished(rows[index].task) > finished(row.task)); });
  if (!rows.some(row => row.task)) return '';
  const open = rows.find(row => row.task && !row.stage.noReport && row.task.id === stageReportOpen);
  return `<section class="stage-reports"><h4 class="database-section-title">${t('各环节报告', 'Reports by step')}</h4>
    <table class="stage-report-table"><tbody>${rows.map(({stage, index, task}) => `<tr class="${open && open.index === index ? 'selected' : ''}">
      <td>${escape(stage.label)}</td>
      <td>${task ? `${escape(prettyDate(task.completed_at || task.created_at))}${task.stale ? ` · <span class="stale">${t('数据已更新', 'Data changed')}</span>` : ''}${rows[index].behind ? ` · <span class="stale">${t('早于所依据步骤的最新结果', 'Older than the latest result it depends on')}</span>` : ''}` : `<span class="muted">${t('尚未完成', 'Not finished')}</span>`}</td>
      <td class="actions">${task && !stage.noReport ? `<button type="button" class="table-button" data-stage-report="${escape(task.id)}">${open && open.index === index ? t('收起', 'Close') : t('查看', 'View')}</button>` : ''}<button type="button" class="table-button" data-stage-page="${stage.page}">${t('打开步骤', 'Open step')}</button></td></tr>`).join('')}</tbody></table>
    ${open ? `<iframe class="preview stage-report-frame" id="stageReportFrame" sandbox="allow-same-origin" title="${escape(open.stage.label)}"></iframe>` : ''}</section>`;
}

function wireStageReports(root, rerender) {
  root.querySelectorAll('[data-stage-report]').forEach(button => {
    button.onclick = () => { stageReportOpen = stageReportOpen === button.dataset.stageReport ? '' : button.dataset.stageReport; rerender(); };
  });
  root.querySelectorAll('[data-stage-page]').forEach(button => { button.onclick = () => navigate(button.dataset.stagePage); });
  const frame = root.querySelector('#stageReportFrame');
  if (frame && typeof showReport === 'function') showReport(stageReportOpen, frame);
}
