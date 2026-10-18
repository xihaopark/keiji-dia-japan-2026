/* Pure UI decisions. No API calls, scientific acceptance or durable state writes. */
const CanvasModel = (() => {
  const batchReplies = typeof module === 'undefined' ? BatchReplyModel : require('./batch-reply-model.js');
  const routes = new Set(['home','database','upload','screening','protocol','preparation','exposure','decisions','summary','template','generate','qc','tlf','pk','charts','analysis']);

  function resolveRoute(value) {
    const page = value === 'projects' ? 'home' : value === 'figures' ? 'charts' : value;
    return {page: routes.has(page) ? page : 'home'};
  }

  function landingPage(snapshot) {
    if (!snapshot) return 'home';
    return typeof productLandingPage === 'function' ? productLandingPage(snapshot) : 'database';
  }

  function prepareRequest(runId, workspace, paths) {
    const known = new Map((workspace.sources || []).map(source => [source.path, source]));
    return {
      run_id: runId,
      sources: paths.map(path => structuredClone(known.get(path) || {path})),
      exclude_subjects: [...(workspace.exclude_subjects || [])],
      reason: workspace.reason || '',
    };
  }

  function mergeExcludedRows(savedRows, visibleRows, checkedRows) {
    const merged = new Set((savedRows || []).map(Number));
    const checked = new Set((checkedRows || []).map(Number));
    for (const row of (visibleRows || []).map(Number)) {
      if (checked.has(row)) merged.delete(row);
      else merged.add(row);
    }
    return [...merged].filter(Number.isSafeInteger).filter(row => row > 0).sort((a, b) => a - b);
  }

  function sourceForTable(table, sources) {
    const sourcePath = typeof table?.source === 'string' ? table.source : '';
    return (sources || []).find(source => source?.path === sourcePath) || null;
  }

  function previewSourceRows(table) {
    const rows = table?.preview_source_rows;
    return Array.isArray(rows) ? rows.map(Number) : rows == null ? [] : [Number(rows)];
  }

  function hasStablePreviewRows(table) {
    const preview = Array.isArray(table?.preview) ? table.preview : table?.preview ? [table.preview] : [];
    const rows = previewSourceRows(table);
    return preview.length === 0 || (rows.length === preview.length
      && new Set(rows).size === rows.length
      && rows.every(row => Number.isSafeInteger(Number(row)) && Number(row) > 0));
  }

  function protocolStatus(workspace) {
    return workspace?.protocol_skipped
      ? {raw: 'skipped', text: '主动跳过'} : {raw: 'saved', text: '已保存'};
  }

  function pollTarget(page) {
    if (['summary', 'template', 'generate', 'qc', 'tlf', 'pk'].includes(page)) return 'analysis';
    if (page === 'analysis') return 'exploration';
    if (['charts', 'preparation', 'exposure', 'decisions'].includes(page)) return page;
    if (page === 'database') return 'database';
    return 'none';
  }

  function keepVersion(selected, versions) {
    return versions.some(version => version.id === selected) ? selected : versions[0]?.id || '';
  }

  function conversationState() {
    return {agentId: '', turnId: '', drafts: new Map()};
  }

  function conversationView(state, agents) {
    const agent = agents.find(value => value.id === state.agentId);
    if (!agent) return {agent: null, turn: null, draft: state.drafts.get(state.agentId) || ''};
    const turn = agent.turns?.find(value => value.id === state.turnId) || agent.turns?.at(-1) || null;
    return {agent, turn, draft: state.drafts.get(agent.id) || ''};
  }

  function analysisRequest(runId, workspace, draft, key, uploads, approval) {
    const hasTLF = draft.stages.includes('tlf');
    if (approval.allow_text !== true || approval.policy_version !== 2 || approval.allow_selected_data !== true
        || (hasTLF && !approval.allow_generated_summary) || !approval.reason?.trim()) {
      throw new Error('Analysis approval is required.');
    }
    return {
      run_id: runId,
      idempotency_key: key,
      expected_revisions: {
        data: workspace.data_revision || 0,
        selection: workspace.selection_revision || 0,
        protocol: workspace.protocol_revision || 0,
      },
      stages: ['summary', ...['tlf', 'pk'].filter(kind => draft.stages.includes(kind))],
      summary: {chapters: draft.chapters || [], template: draft.template || 'er-default',
        instruction: draft.instruction || ''},
      tlf: {uploads: hasTLF ? uploads : [], instruction: draft.instruction || ''},
      pk: {instruction: draft.instruction || ''},
      approval: {
        policy_version: 2, allow_selected_data: true,
        allow_text: Boolean(approval.allow_text),
        reason: approval.reason,
        allow_evidence: hasTLF && Boolean(approval.allow_evidence),
        allow_generated_summary: hasTLF && Boolean(approval.allow_generated_summary),
        ...(hasTLF ? {future_summary: {max_bytes: 200000, allowed_artifacts: ['report.html', 'data_summary_report.Rmd']}} : {}),
      },
    };
  }

  function waitingBatchForAgent(agent, batches) {
    return batchReplies.waitingBatchForAgent(agent, batches);
  }

  function resultStatus(result) {
    if (result.stale || result.integrity === 'stale') return '数据已更新';
    if (result.integrity && result.integrity !== 'current') return '结果需要核对';
    if (result.review === 'reviewed') return '已审查';
    if (result.review === 'needs_revision') return '需要修改';
    if (result.review === 'awaiting_user') return '等待确认';
    return result.status === 'completed' ? '待审查' : result.status;
  }

  return {resolveRoute, landingPage, prepareRequest, mergeExcludedRows, sourceForTable,
    previewSourceRows, hasStablePreviewRows, protocolStatus, pollTarget, keepVersion,
    conversationState, conversationView, analysisRequest, resultStatus, waitingBatchForAgent};
})();
if (typeof module !== 'undefined') module.exports = CanvasModel;
const selectedDataNotice = 'Claude 可通过工具读取本任务所选数据或证据的完整内容，并按需要发送给模型。';
const selectedDataApprovalText = '我确认上述内容已获准供本任务使用。';

function selectedDataPolicy(confirmed = true, reason = 'User started this task on the selected data, evidence and context.') {
  return {policy_version: 2, allow_selected_data: confirmed !== false, allow_text: confirmed !== false, reason};
}
