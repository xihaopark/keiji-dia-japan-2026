/* Analysis Batch orchestration and exact result binding. */
let analysisResultSignature = '';
const stageStatusText = status => ({pending: 'Not started'})[status] || statusText(status);

function analysisDraft() {
  const key = `analysis:${runId}`;
  if (!uiDrafts.has(key)) {
    uiDrafts.set(key, {
      stages: ['summary', 'tlf', 'pk'], chapters: [...chapters], template: 'er-default',
      instruction: '', files: [], versions: {}, pending: null,
    });
  }
  return uiDrafts.get(key);
}

function latestAnalysisBatch() {
  return [...(snapshot?.analysis_batches || [])]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

function renderAnalysisResults() {
  if (!snapshot) return;
  if ($('#batchStatus')) renderBatchStatus(analysisDraft());
  const root = $('#analysisWorkspaceBody');
  if (!root) return;
  if (analysisSection === 'summary') {
    renderSummary(root);
    return;
  }
  const kind = analysisSection === 'quality' ? 'erqc' : analysisSection;
  const batch = latestAnalysisBatch();
  const tasks = currentTasks(kind);
  const results = tasks.map(task => [
    task.id, task.status, task.review, task.stale, task.result, task.finding_actions, task.live_artifacts,
  ]);
  const signature = JSON.stringify([analysisSection, batch?.stages?.[kind]?.output_turn_id || '', results]);
  if (signature === analysisResultSignature) return;
  if (document.querySelector('dialog[open]')) return;
  if (document.activeElement?.matches?.('input,textarea,select') && root.contains(document.activeElement)) return;
  if (window.getSelection?.()?.toString() && root.contains(window.getSelection().anchorNode)) return;
  analysisResultSignature = signature;
  renderAnalysisSection(root);
}

function renderBatchStatus(draft) {
  const batch = latestAnalysisBatch();
  const start = $('#startAnalysis');
  if (!start) return;
  const busy = ['queued', 'running'].includes(batch?.status);
  start.disabled = busy || Boolean(draft.sending) || !snapshot?.inventory?.tables?.length;
  start.textContent = draft.sending ? 'Starting…' : draft.pending ? 'Retry start' : busy ? 'Analysis running' : batch ? 'Start new analysis' : 'Start analysis';
  $('#batchStatus').textContent = batch ? Object.entries(batch.stages).map(([kind, stage]) =>
    `${taskName(kind)}: ${stageStatusText(stage.status)}${stage.error ? ` — ${ConversationPresenter.conciseTurnError(stage.error)}` : ''}`).join(' · ')
    : snapshot?.inventory?.tables?.length ? 'Ready to analyse the selected data.' : 'Read data before starting an analysis.';
  const actions = $('#batchActions');
  const signature = JSON.stringify(batch && [batch.id, batch.status, batch.stages]);
  if (actions.dataset.signature === signature) return;
  actions.innerHTML = '';
  if (batch) {
    const tlf = batch.stages.tlf;
    if (['needs_input', 'waiting_input'].includes(tlf?.status) && !tlf?.agent_id) {
      const add = document.createElement('button');
      add.textContent = tlf.needs_input_reason === 'sharing_scope' ? 'Review TLF sharing limit' : tlf.needs_input_reason === 'inputs_changed' ? 'Review changed inputs' : 'Add TLF screenshots';
      add.onclick = () => tlf.needs_input_reason === 'inputs_changed' ? navigate('data') : continueTLF(batch);
      actions.append(add);
    }
    for (const [kind, stage] of Object.entries(batch.stages)) {
      if (stage.agent_id && stage.needs_input_reason !== 'inputs_changed' && ['needs_input', 'failed', 'interrupted'].includes(stage.status)) {
        const open = document.createElement('button');
        open.textContent = `Continue ${taskName(kind)}`;
        open.onclick = () => openAgent(stage.agent_id, stage.turn_id);
        actions.append(open);
      }
    }
    if (['queued', 'running', 'needs_input', 'partial'].includes(batch.status)) {
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel remaining work';
      cancel.onclick = () => action(async () => {
        await api(`/api/analysis-batches/${batch.id}/cancel`, {run_id: runId});
        await refresh(false);
      });
      actions.append(cancel);
    }
  }
  actions.dataset.signature = signature;
}

async function confirmAnalysisSharing(draft, workspace, continuation = false) {
  const hasTLF = draft.stages.includes('tlf');
  const dialog = document.createElement('dialog');
  dialog.className = 'live-dialog sharing-dialog';
  dialog.innerHTML = `<form method="dialog" class="live-form"><h2>${continuation ? 'Continue TLF comparison' : 'Start this analysis'}</h2>
    <p>${selectedDataNotice}</p>
    ${hasTLF ? '<p>TLF receives the screenshots you select and the generated Summary up to 200 KB.</p>' : ''}
    <details><summary>Review exact context</summary><p>Data ${escape(workspace.data_revision)} · selection ${escape(workspace.selection_revision)} · background ${escape(workspace.protocol_revision)}</p><pre>${escape(workspace.protocol || 'No study background recorded')}</pre></details>
    ${!workspace.protocol && !workspace.protocol_skipped ? '<label class="checkbox-label"><input name="skip" type="checkbox" required> Proceed without study background and record the limitation.</label>' : ''}
    <label class="checkbox-label"><input name="approved" type="checkbox" required> ${selectedDataApprovalText}</label>
    ${hasTLF && draft.files.length ? '<label>Sharing basis<textarea name="reason" required></textarea></label>' : ''}
    <p>分析完成后，结果状态将显示在对应页面。</p>
    <div class="live-actions"><button value="confirm" class="primary-button">Confirm and start</button><button value="cancel" formnovalidate>Cancel</button></div></form>`;
  document.body.append(dialog);
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => {
    const values = new FormData(dialog.querySelector('form'));
    const result = dialog.returnValue === 'confirm' && values.get('approved') === 'on' ? {
      ...selectedDataPolicy(true, values.get('reason') || undefined),
      allow_evidence: hasTLF, allow_generated_summary: hasTLF,
      skip: values.get('skip') === 'on',
    } : null;
    dialog.remove();
    resolve(result);
  }, {once: true}));
}

async function beginAnalysis(draft) {
  if (draft.sending) return;
  const requestedRun = runId;
  if (!draft.pending) {
    const workspace = structuredClone(snapshot.workspace);
    const settings = {stages: [...draft.stages], chapters: [...draft.chapters], template: draft.template,
      instruction: draft.instruction,
      files: draft.stages.includes('tlf') ? [...draft.files] : []};
    const approval = await confirmAnalysisSharing(settings, workspace);
    if (!approval || runId !== requestedRun) return;
    draft.pending = {key: crypto.randomUUID(), workspace, settings, approval, uploads: [], request: null};
  }
  draft.sending = true;
  renderBatchStatus(draft);
  try {
    const pending = draft.pending;
    if (pending.approval.skip) {
      const result = await api('/api/protocol', {run_id: requestedRun, text: '', skipped: true});
      pending.workspace.protocol_revision = result.workspace.protocol_revision;
      pending.workspace.protocol_skipped = true;
      delete pending.approval.skip;
    }
    if (!pending.request) {
      await uploadImages(pending.settings.files, requestedRun, pending.uploads);
      pending.request = CanvasModel.analysisRequest(requestedRun, pending.workspace,
        pending.settings, pending.key, pending.uploads, pending.approval);
    }
    await api('/api/analysis-batches', pending.request);
    draft.pending = null;
    if (runId === requestedRun) await refresh(false);
  } catch (error) {
    if (error.httpStatus >= 400 && error.httpStatus < 500) draft.pending = null;
    throw error;
  } finally {
    draft.sending = false;
    if (runId === requestedRun && $('#startAnalysis')) renderBatchStatus(draft);
  }
}

function continueTLF(batch) {
  const sharingOnly = batch.stages.tlf?.needs_input_reason === 'sharing_scope';
  const dialog = document.createElement('dialog');
  dialog.className = 'live-dialog';
  dialog.innerHTML = `<div class="page-heading"><h2>${sharingOnly ? 'Review TLF sharing' : 'Add TLF screenshots'}</h2><button data-close>Close</button></div>
    <form class="live-form">${sharingOnly ? '' : '<label>Screenshots<input type="file" name="files" accept="image/png,image/jpeg" multiple required></label>'}
      <label>Instructions<textarea name="message" rows="3"></textarea></label><button class="primary-button">Continue comparison</button><p class="error" role="alert"></p></form>`;
  document.body.append(dialog);
  const requestedRun = runId;
  let pending = null;
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const submit = dialog.querySelector('.primary-button');
    submit.disabled = true;
    try {
      if (!pending) {
        const files = [...(event.target.elements.files?.files || [])];
        const message = event.target.elements.message.value;
        const settings = {stages: ['tlf'], chapters: [], instruction: message, files};
        const approval = await confirmAnalysisSharing(settings, snapshot.workspace, true);
        if (!approval) return;
        pending = {key: crypto.randomUUID(), files, message, approval, uploads: sharingOnly ? [...(batch.plan?.tlf?.uploads || [])] : []};
      }
      await uploadImages(pending.files, requestedRun, pending.uploads);
      await api(`/api/analysis-batches/${batch.id}/continue`, {run_id: requestedRun, stage: 'tlf',
        idempotency_key: pending.key, uploads: pending.uploads, message: pending.message,
        approval: {...pending.approval, future_summary: {max_bytes: 200000, allowed_artifacts: ['report.html', 'data_summary_report.Rmd']}}});
      dialog.close();
      if (runId === requestedRun) await refresh(false);
    } catch (error) {
      if (error.httpStatus >= 400 && error.httpStatus < 500) pending = null;
      dialog.querySelector('.error').textContent = productError(error);
    } finally { submit.disabled = false; }
  };
  dialog.showModal();
}
