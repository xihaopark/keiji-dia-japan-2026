/* Checklist configuration and immutable results are separate product states. */
function renderProductQC(root) {
  const results = currentTasks('erqc').filter(task => task.status === 'completed');
  const chosen = results.find(task => task.id === analysisDraft().versions.erqc) || results[0];
  const active = currentTasks('erqc')[0];
  const busy = ['queued','running'].includes(active?.status);
  const draft = analysisDraft();
  const checklist = chosen && !busy
    ? `<section class="surface qc-completed-checklist"><div class="result-toolbar"><details class="qc-completed-rules"><summary>本次检查清单 · ${(chosen.parameters?.qc_rules || defaultQCRules()).length} 项 · 只读</summary>${qcChecklistMarkup(chosen,false,false)}</details><button type="button" class="secondary-button" id="manageQCRules">管理下次检查清单</button></div></section>`
    : qcChecklistMarkup(busy ? active : chosen || active, !chosen && !busy);
  const summaryReady = currentTasks('summary').some(task => task.status === 'completed' && !task.stale);
  const setupMarkup = `<details class="surface qc-setup" ${chosen||busy?'':'open'}><summary>${chosen?'启动新一轮检查':'配置并启动检查'}</summary><form class="live-form" id="qcForm">${summaryReady?'':'<p class="info-note">Data Summary 尚未完成。建议先完成 Summary：QC 会参考其中的研究设计（例如多周期给药），减少误报。</p>'}<p>${t(`下一次检查使用已保存的清单草稿，共 ${qcRulesForSubmission().length} 项；已完成结果和原始数据不会被改写。`, `The next check uses the saved checklist draft (${qcRulesForSubmission().length} items); completed results and source data are not rewritten.`)}</p><details><summary>核对下次执行清单</summary><ul>${qcRulesForSubmission().map(rule=>`<li>${escape(qcRuleText(rule,'name'))}${qcRuleCondition(rule)?` · ${escape(qcRuleCondition(rule))}`:''}</li>`).join('')}</ul></details><label>补充说明<textarea name="instruction" maxlength="12000" placeholder="需要特别关注的研究背景或人工审阅事项。">${escape(draft.qcInstruction||'')}</textarea></label><button class="primary-button" ${busy?'disabled':''}>${busy?'检查进行中':'开始检查'}</button></form></details>`;
  const findingsMarkup = '<section class="surface"><h4>发现与处理</h4><div id="findings"></div></section>';
  const reportMarkupQC = '<details class="surface"><summary>查看完整 QC 报告</summary><iframe class="preview" id="qcFrame" sandbox="allow-same-origin" title="QC report"></iframe></details>';
  // A finished result needs no heading or status line; the version picker and the findings carry it.
  const settled = chosen && !busy && active?.status === 'completed';
  root.innerHTML = `<section class="surface qc-head">${settled ? '' : `<div class="section-heading"><div><h4>检查结果</h4><p>${busy?'检查正在执行，完成后结果会自动更新。':chosen?'查看发现、记录处理依据，再继续准备分析数据。':'按下方检查清单运行；可以直接开始。'}</p></div><span class="status-badge">${escape(statusText(active?.status))}</span></div>`}
    ${results.length?`<div class="result-toolbar"><label>历史结果<select id="qcResultVersion">${results.map(task=>`<option value="${escape(task.id)}" ${task.id===chosen.id?'selected':''}>${escape(prettyDate(task.created_at))}${task.stale?' · 旧数据版本':''}${versionChangeNote(task)?` · ${escape(versionChangeNote(task))}`:''}</option>`).join('')}</select></label>${chosen.stale&&!busy?'<button type="button" class="secondary-button" id="regenerateQC">用最新数据重新检查</button>':''}<button type="button" class="primary-button" data-go="preparation">准备 Analysis Data →</button></div>`:''}
    ${busy?`<p role="status">${escape((active.progress_steps||[]).find(item=>item.id===active.progress_current)?.detail || '正在按本次清单执行检查。')}</p>`:''}
    ${typeof stepRetryMarkup==='function'&&stepRetryMarkup(active,active?.agent_id,'<button type="button" class="secondary-button" id="qcTaskDetails">查看本次任务</button>')||(['failed','needs_input','interrupted'].includes(active?.status)?`<p class="info-note">${escape(active.result?.message||ConversationPresenter.conciseTurnError(active.error)||'检查尚未完成。请查看任务记录。')}</p>${!active.result?.message&&active.error?`<details class="error-details"><summary>查看原因</summary><pre>${escape(active.error)}</pre></details>`:''}<button type="button" class="secondary-button" id="qcTaskDetails">查看本次任务</button>`:'')}</section>
    ${chosen?findingsMarkup:setupMarkup}${checklist}${qcHistoryMarkup(chosen)}${chosen?setupMarkup+reportMarkupQC:''}
`;
  wireNavigation(root);
  wireQCRules(root, () => renderProductQC(root));
  if ($('#qcResultVersion')) $('#qcResultVersion').onchange=event=>{draft.versions.erqc=event.target.value;renderProductQC(root);};
  if ($('#qcTaskDetails')) $('#qcTaskDetails').onclick=()=>openAgent(active.agent_id,active.id);
  if (typeof wireStepRetry === 'function') wireStepRetry(root);
  if ($('#regenerateQC')) $('#regenerateQC').onclick=()=>regenerateWithLatestData(chosen);
  const form = root.querySelector('#qcForm');
  form.elements.instruction.oninput=event=>{draft.qcInstruction=event.target.value;};
  form.onsubmit=event=>{event.preventDefault();action(async()=>{
    const data = new FormData(form), viewRun = runId;
    const parameters = {instruction:String(data.get('instruction')||''),qc_rules:qcRulesForSubmission()};
    form.querySelector('button').disabled=true;
    try {
      await startAgent('erqc',{title:'Data Quality QC',parameters,message:parameters.instruction,
        cloud_policy:selectedDataPolicy()},
      'Execute the frozen QC checklist and preserve per-rule execution evidence.');
      if(runId===viewRun) {
        await refresh(false);
        if(runId===viewRun && page==='qc') renderProductQC(root);
      }
    } finally {if(form.isConnected) form.querySelector('button').disabled=false;}
  });};
  if(chosen) {showReport(chosen.id,$('#qcFrame'));renderFindings(chosen);}
}
