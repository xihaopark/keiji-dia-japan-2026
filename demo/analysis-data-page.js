/* Product state and actions for the dedicated Analysis Data preparation step. */
// Must match demo_analysis_preparation.agent_recommended_decision(): the Agent proposes, the user confirms.
const AGENT_RECOMMENDED_DECISION = 'To be recommended by the Agent from the current Summary and QC, then confirmed by me';
const DEFAULT_DECISION_SOURCE = 'Current Data Summary and QC';
const AGENT_DRAFTED_PLAN = 'The Agent drafts the processing plan from the confirmed decisions and the current Summary and QC, and reports it with the candidate for my review.';
// Wording stored before content became English; older tasks still carry it.
const LEGACY_DELEGATION = {'由 Agent 根据当前 Summary 和 QC 推荐，经我确认后使用': AGENT_RECOMMENDED_DECISION,
  '由 Agent 根据已确认的口径和当前 Summary、QC 拟定处理方案；转换数据前先列出方案供我确认。': ''};
// The plan the user sees is only their own extra instructions; the Agent drafts the rest.
const userPlanText = description => {
  const text = LEGACY_DELEGATION[description] ?? String(description || '');
  return text.startsWith(AGENT_DRAFTED_PLAN) ? text.slice(AGENT_DRAFTED_PLAN.length).replace(/^\s*Additional instructions from the user:\s*/, '') : text;
};
function analysisDataPresentation(analysisData, analysisTask) {
  const roleNames = {subjects: 'Subjects', dose: 'Dose / Cohort', pk: 'PK Profiles', response: 'Response', event: 'Safety'};
  const roles = (analysisData?.tables || []).map(table => roleNames[table.role] || table.role);
  if (analysisData?.status === 'ready') return {
    state: 'ready', title: 'Analysis Data 已准备', message: analysisData.message || '当前数据版本可用于受治理的分析。',
    detail: roles.join(' · '), version: analysisData.schema_version || analysisData.data_revision || 'current',
  };
  if (analysisTask?.status === 'needs_input') return {
    state: 'needs_input', title: '需要研究判断',
    message: analysisTask.result?.questions?.[0] || analysisTask.result?.message || analysisData?.message || '需要补充信息后继续。',
    reason: analysisTask.result?.message || '现有证据不足以安全确定研究语义。', agentId: analysisTask.agent_id,
  };
  if (analysisData?.status === 'preparing' || ['queued', 'running'].includes(analysisTask?.status)) {
    const current = (analysisTask?.progress_steps || []).find(step => step.id === analysisTask.progress_current);
    return {state: 'preparing', title: 'Analysis Data 正在准备', message: current?.detail || analysisData?.message || '正在检查并准备数据。'};
  }
  return {state: 'not_started', title: '准备 Analysis Data', message: '系统将检查 responder 定义、AE 范围、data cutoff、时间、单位和跨表映射；仅在当前研究确有需要且证据不足时提问。'};
}

function openAnalysisDataAgent(agentId) { if (agentId) openAgent(agentId); }

async function startAnalysisDataPreparation() {
  const draft = preparationDraft(), viewRun = runId;
  const preparation = preparationPayload(draft, snapshot.analysis_data?.prerequisites);
  const override = typeof $ === 'function' ? $('#modelOverride')?.value || '' : '';
  const payload = {
    title: 'Analysis Data',
    message: 'Generate a candidate for my review with the confirmed decisions and plan; do not publish it automatically.',
    cloud_policy: selectedDataPolicy(true), parameters: {preparation,...(override?{model_override:override}:{})},
  };
  const signature = JSON.stringify(payload);
  if (draft.launchRequest?.signature !== signature) {
    draft.launchRequest = {signature,payload:{...payload,idempotency_key:crypto.randomUUID()}};
  }
  const request = draft.launchRequest;
  await startAgent('analysis-data', request.payload, 'Prepare an Analysis Data candidate for explicit user acceptance.');
  // Values taken from Agent recommendations are remembered as Agent-recommended, user-confirmed.
  const fromAgent = item => draft[`${item.id}_origin`] === 'agent';
  await rememberDecisions(preparation.decisions.filter(item => !fromAgent(item)));
  await rememberDecisions(preparation.decisions.filter(fromAgent), 'agent_confirmed');
  if (draft.launchRequest === request) delete draft.launchRequest;
  draft.editing = false; draft.cloud_confirmed = false; draft.plan_confirmed = false;
  if (runId === viewRun) await refresh();
}

function preparationDecisionFields(scope) {
  const fields = [['cutoff','数据截止口径','填写 cutoff 日期，或说明不适用的理由。'],
    ['time_origin','时间起点','例如首次给药；说明使用的字段及计算规则。'],
    ['time_unit','时间单位','明确时间轴单位和必要的换算。'],
    ['treatment_group','分组方式','图表和汇总按哪个治疗组或剂量组比较。']];
  if (scope.efficacy) fields.push(['responder','Responder 定义','说明疗效判断标准和所用字段。']);
  if (scope.safety) fields.push(['ae_scope','AE 范围','说明纳入的事件、分级、时间范围。']);
  return fields;
}

function preparationEvidenceKey(prerequisites) {
  return JSON.stringify([prerequisites?.revisions, prerequisites?.upstream]);
}

function preparationDraft() {
  const key = `preparation:${runId}`;
  if (!uiDrafts.has(key)) {
    const previous = typeof currentTasks === 'function' ? currentTasks('analysis-data')[0]?.parameters?.preparation : null;
    // Exposure-response work usually covers both; either can be switched off.
    const draft = {analysis_goal:'',efficacy:true,safety:true,plan:'',step:1,editing:false,
      decisions_confirmed:false,plan_confirmed:false,cloud_confirmed:false,answer:'',...previous?.purpose};
    for (const [id] of preparationDecisionFields({efficacy:true,safety:true})) {draft[id]=AGENT_RECOMMENDED_DECISION;draft[`${id}_source`]=DEFAULT_DECISION_SOURCE;}
    for (const item of previous?.decisions || []) {draft[item.id]=LEGACY_DELEGATION[item.value]??item.value;draft[`${item.id}_source`]=item.source;}
    draft.plan = userPlanText(previous?.plan?.description);
    if (typeof applyRememberedDecisions === 'function') applyRememberedDecisions(draft, snapshot?.study_decisions?.decisions);
    draft.evidenceKey = preparationEvidenceKey(snapshot?.analysis_data?.prerequisites);
    uiDrafts.set(key,draft);
  }
  const draft = uiDrafts.get(key), evidenceKey = preparationEvidenceKey(snapshot?.analysis_data?.prerequisites);
  if (typeof syncRememberedDecisions === 'function') syncRememberedDecisions(draft, snapshot?.study_decisions?.decisions,
    preparationDecisionFields({efficacy: true, safety: true}).map(([id]) => id));
  if (draft.evidenceKey !== evidenceKey) {
    draft.evidenceKey=evidenceKey;draft.decisions_confirmed=false;draft.plan_confirmed=false;
    draft.cloud_confirmed=false;draft.step=1;draft.evidenceChanged=true;
  }
  return draft;
}

function preparationIntake(draft, prerequisites) {
  if (!prerequisites?.ready) throw new Error('请先完成当前数据版本的 Data Summary 和 QC。');
  if (draft.evidenceKey !== preparationEvidenceKey(prerequisites)) throw new Error('依据已变化，请重新核对并确认。');
  if (!String(draft.analysis_goal || '').trim()) throw new Error('请填写分析目标，或点「让 Agent 根据 Summary 和 QC 推荐」由 Agent 起草。');
  const decisions = preparationDecisionFields(draft).map(([id,label]) => {
    const value=String(draft[id]||'').trim(), source=String(draft[`${id}_source`]||'').trim()||DEFAULT_DECISION_SOURCE;
    if (!value) throw new Error(`请填写${label}，或保留由 Agent 推荐。`);
    return {id,value,source,confirmed:true};
  });
  const upstream = Object.fromEntries(['summary','erqc'].map(kind => {
    const ref=prerequisites.upstream[kind];
    return [kind,{agent_id:ref.agent_id,turn_id:ref.turn_id,result_sha256:ref.result_sha256}];
  }));
  return {schema_version:1,upstream,purpose:{analysis_goal:draft.analysis_goal.trim(),efficacy:draft.efficacy,safety:draft.safety},decisions};
}

function preparationPayload(draft, prerequisites) {
  const intake = preparationIntake(draft,prerequisites);
  if (!draft.plan_confirmed) throw new Error('请先确认生成候选。');
  const extra=String(draft.plan||'').trim();
  return {...intake,plan:{description:extra?`${AGENT_DRAFTED_PLAN} Additional instructions from the user: ${extra}`:AGENT_DRAFTED_PLAN,confirmed:true}};
}

function preparationEvidenceMarkup(prerequisites) {
  return `<section class="surface"><h4>本次准备的依据</h4><p>仅使用当前数据版本已完成且完整性校验有效的 Summary 和 QC；不要求 TLF。报告完成不代表科学审阅通过。</p>${['summary','erqc'].map(kind=>{
    const ref=prerequisites?.upstream?.[kind], name=kind==='summary'?'Data Summary':'QC';
    return `<details ${ref?'':'open'}><summary>${name} · ${ref?'依据已就绪':'尚未就绪'}</summary>${ref?`<p>${escape(ref.summary||'请查看完整报告。')}</p><p>版本 ${escape(ref.turn_id)}</p>${(ref.findings||[]).length?`<ul>${ref.findings.map(item=>`<li>${escape(item.title||item.message||item.description||item.check_id||JSON.stringify(item))}</li>`).join('')}</ul>`:''}<button type="button" class="secondary-button" data-evidence="${kind}">查看这份报告</button>`:`<p>请先完成当前数据版本的 ${name}。</p><button type="button" class="secondary-button" data-go="${kind==='summary'?'summary':'qc'}">前往 ${name}</button>`}</details>`;
  }).join('')}</section>`;
}

function preparationIntakeMarkup(draft, prerequisites) {
  return `<section class="surface"><h4>1. 分析目标与研究口径</h4>${draftingNotice(draft,'Agent 正在起草分析目标和口径…')}${draft.evidenceChanged?'<p class="info-note">数据或报告依据已变化，已保留填写内容，请重新核对确认。</p>':''}<form class="live-form" id="preparationIntake"><label>分析目标 <span class="field-origin">${draft.analysis_goal_origin==='agent'?'Agent 起草':''}</span><textarea name="analysis_goal" maxlength="4000" required placeholder="Agent 起草，或直接填写" ${draft.analysis_goal_origin==='agent'?'data-select-on-focus':''}>${escape(draft.analysis_goal)}</textarea></label>${suggestionMarkup(draft.goal_options, 'analysis_goal', 'replace', '备选：')}<fieldset><legend>本次分析范围</legend>${[['efficacy','包含疗效分析'],['safety','包含安全性分析']].map(([id,label])=>`<label class="checkbox-label"><input type="checkbox" name="${id}" ${draft[id]?'checked':''}> ${label}</label>`).join('')}</fieldset>${decisionPanelMarkup(draft,prerequisites)}<button class="primary-button" ${prerequisites?.ready?'':'disabled'}>继续 →</button></form></section>`;
}

function preparationPlanMarkup(draft) {
  return `<section class="surface"><h4>2. 生成候选</h4><p>分析目标：<span data-i18n-skip>${escape(draft.analysis_goal)}</span></p><p>Agent 按已确认的口径起草处理方案并生成候选；方案随候选给你核对，确认前不会使用。</p><form class="live-form" id="preparationPlan"><label>补充要求（可选）<textarea name="plan" maxlength="12000" placeholder="可留空">${escape(draft.plan)}</textarea></label>${suggestionMarkup(draft.requirement_options, 'plan', 'append', 'Agent 建议：')}<div class="live-actions"><button type="button" class="secondary-button" id="preparationBack">返回修改口径</button><button class="primary-button">生成候选</button></div></form></section>`;
}

const EXTRA_DECISION_LABELS = {duplicate_policy:'重复记录处理', blq_policy:'BLQ 处理', analyte:'分析物',
  cycle_derivation_pk:'周期推导（PK）', cycle_derivation_dose:'周期推导（给药）', cycle_derivation_safety:'周期推导（安全性）',
  cycle_derivation_response:'周期推导（疗效）'};
function proposalLabel(id) {
  return preparationDecisionFields({efficacy:true,safety:true}).find(([key])=>key===id)?.[1]
    || EXTRA_DECISION_LABELS[id] || String(id).replace(/_/g, ' ');
}

function preparationProposalFields(proposals, draft) {
  return proposals.map(item=>`<fieldset><legend>${escape(proposalLabel(item.id))}</legend><label>Agent 推荐（可直接修改）<textarea name="proposal_${escape(item.id)}" maxlength="4000" required>${escape(draft[`proposal_${item.id}`] ?? item.value)}</textarea></label>${basisMarkup(item.basis)}</fieldset>`).join('');
}

function preparationQuestionMarkup(task, draft) {
  const questions=task.result?.questions || [], proposals=task.result?.proposals || [];
  return `<section class="surface"><h4>${proposals.length?'确认 Agent 推荐的研究口径':'补充研究判断'}</h4><p>${escape(task.result?.message||'现有证据不足，请补充后继续同一个任务。')}</p><ul>${questions.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>${typeof answerOptionsMarkup==='function'?answerOptionsMarkup(task.result?.answer_options,'#preparationAnswer textarea[name=answer]'):''}<form class="live-form" id="preparationAnswer">${preparationProposalFields(proposals,draft)}<label>${questions.length?'回答上面的问题':'补充说明（可选）'}<textarea name="answer" maxlength="12000" ${questions.length?'required':''}>${escape(draft.answer)}</textarea></label><button class="primary-button">${proposals.length?'确认口径并继续':'回答并继续'}</button></form></section>`;
}

// Confirmed (possibly edited) proposals are sent as an explicit answer in the same Agent session.
function preparationAnswerText(proposals, form, answer) {
  const lines=proposals.map(item=>`- ${item.id}: ${String(form.elements[`proposal_${item.id}`]?.value||'').trim()}`);
  return [lines.length?`I confirm these study decisions; proceed with them:\n${lines.join('\n')}`:'', String(answer||'').trim()].filter(Boolean).join('\n\n');
}

// The Agent's handling notes are what the user must read before adopting a candidate.
function candidateFindingsMarkup(findings) {
  if (!(findings || []).length) return '';
  // Agents word these notes freely: {topic, detail}, {id, text} or plain strings.
  const label = item => typeof item === 'string' ? '' : item?.topic || item?.id || item?.title || '';
  const text = item => typeof item === 'string' ? item : item?.detail || item?.text || item?.message || item?.description
    || Object.values(item || {}).filter(value => typeof value === 'string' && value !== label(item)).join('；');
  return `<div class="candidate-findings"><h5>Agent 的处理说明</h5><ul>${findings.map(item => `<li>${label(item) ? `<strong>${escape(label(item))}</strong>` : ''}${escape(text(item))}</li>`).join('')}</ul></div>`;
}

// The plan the Agent followed, in plain sentences, next to what the user asked for.
function candidatePlanMarkup(candidate) {
  const plan = candidate.plan || [], extra = userPlanText(candidate.preparation?.plan?.description);
  if (!plan.length && !extra && !candidate.user_response) return '';
  return `<div class="candidate-plan"><h5>处理方案（Agent 起草）</h5>${plan.length ? `<ol data-i18n-skip>${plan.map(item => `<li>${escape(item)}</li>`).join('')}</ol>` : '<p>未单独列出方案，见下方处理说明。</p>'}${extra ? `<p><strong>你的补充要求：</strong><span data-i18n-skip>${escape(extra)}</span></p>` : ''}${candidate.user_response ? `<p><strong>你的回答：</strong><span data-i18n-skip>${escape(candidate.user_response)}</span></p>` : ''}</div>`;
}

// What the candidate did with each ledger issue, and what is still open for this step, read
// before adopting: the rule, the counts before and after, and the problems the Agent found.
// Ledger issues this step still has to act on; "to_apply" ones are decided and wait for a new version.
// Issues the candidate already reconciled are settled by adopting it, not by another version.
function candidateReconciledKeys(candidate) {
  const agents = typeof currentAgents === 'function' ? currentAgents('analysis-data') : [];
  const turn = agents.flatMap(agent => agent.turns || []).find(item => item.id === candidate?.turn_id);
  return new Set((turn?.result?.reconciliation || []).map(entry => entry.key).filter(Boolean));
}

function openPreparationIssues(candidate) {
  const issues = (typeof issueLedger === 'function' ? issueLedger().issues : []) || [];
  const settled = candidateReconciledKeys(candidate);
  return issues.filter(issue => issue.applies_in === 'analysis_data' && ['to_apply', 'needs_decision', 'open'].includes(issue.status)
    && !settled.has(issue.key));
}

function candidateReconciliationMarkup(candidate) {
  const agents = typeof currentAgents === 'function' ? currentAgents('analysis-data') : [];
  const turn = agents.flatMap(agent => agent.turns || []).find(item => item.id === candidate.turn_id);
  const applied = turn?.result?.reconciliation || [], found = turn?.result?.issues || [];
  const issues = (typeof issueLedger === 'function' ? issueLedger().issues : []) || [];
  const titleOf = key => issues.find(issue => issue.key === key)?.title || key;
  const open = openPreparationIssues(candidate);
  if (!applied.length && !found.length && !open.length) return '';
  const actionText = {applied: t('已应用', 'Applied'), not_needed: t('无需处理', 'Not needed'), deferred: t('暂缓', 'Deferred')};
  const rows = applied.map(entry => `<tr><td data-i18n-skip>${escape(titleOf(entry.key))}</td><td>${escape(actionText[entry.action] || entry.action)}</td><td>${Number.isInteger(entry.before) && Number.isInteger(entry.after) ? `${entry.before} → ${entry.after}` : '—'}</td><td data-i18n-skip>${escape(entry.rule || entry.note || '')}</td></tr>`).join('');
  return `<div class="candidate-reconciliation"><h5>${t('数据问题的处理', 'How data problems were handled')}</h5>
    ${rows ? `<table class="live-table"><thead><tr><th>${t('问题', 'Problem')}</th><th>${t('处理', 'Action')}</th><th>${t('记录数 前→后', 'Records before → after')}</th><th>${t('规则', 'Rule')}</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    ${found.length ? `<p>${t(`本步新发现 ${found.length} 个问题，已记入问题台账。`, `${found.length} new problems found in this step were added to the issue ledger.`)}</p>` : ''}
    ${open.length ? `<p class="info-note warning">${t(`仍有 ${open.length} 个应在本步处理的问题未处理：`, `${open.length} problems for this step are still open: `)}<span data-i18n-skip>${open.slice(0, 5).map(issue => escape(issue.title)).join('；')}</span> <button type="button" class="link-button" data-go-issues>${t('查看问题台账 →', 'Open issue ledger →')}</button></p>` : ''}
  </div>`;
}

function preparationCandidateMarkup(candidate) {
  const decided=openPreparationIssues(candidate).some(issue=>issue.status==='to_apply');
  if(candidate.stale) return `<section class="surface"><h4>候选不可验收</h4><p class="info-note">${escape(candidate.error||'数据、报告依据或候选文件已变化。请重新准备。')}</p><button class="secondary-button" id="preparationNew">修改方案并准备新版本</button></section>`;
  return `<section class="surface"><h4>3. 验收待发布候选</h4><p>${escape(candidate.message||'候选已生成，尚未用于下游分析。')}</p><table class="live-table"><thead><tr><th>数据角色</th><th>行数</th><th>列数</th></tr></thead><tbody>${(candidate.outputs||[]).map(item=>`<tr><td>${escape(item.logical_role||item.role||item.path)}</td><td>${escape(item.shape?.rows??'未记录')}</td><td>${escape(item.shape?.columns??'未记录')}</td></tr>`).join('')}</tbody></table>${candidatePlanMarkup(candidate)}${candidateReconciliationMarkup(candidate)}${candidateFindingsMarkup(candidate.findings)}<details><summary>查看字段及映射依据</summary><pre>${escape(JSON.stringify({outputs:candidate.outputs,mapping:candidate.mapping},null,2))}</pre></details><form class="live-form" id="preparationConfirm"><div class="live-actions">${decided?'<button type="button" class="primary-button" id="preparationApplyDecisions">按台账决定生成新版本</button><button class="secondary-button">仍用此候选</button>':'<button class="primary-button">确认此候选并用于分析</button>'}<button type="button" class="secondary-button" id="preparationNew">修改方案，生成新版本</button></div></form></section>`;
}

async function answerAnalysisData(task, answer, typed = answer) {
  if (!answer.trim()) throw new Error('请填写回答或确认推荐的口径。');
  const viewRun=runId;
  const selection=captureConversationSelection();
  const result=await api(`/api/agents/${encodeURIComponent(task.agent_id)}/messages`,{
    run_id:viewRun,message:answer.trim(),interaction_mode:'analysis',cloud_policy:selectedDataPolicy(true),
  });
  if(runId===viewRun) {
    const draft=preparationDraft();
    if(draft.answer===typed) draft.answer='';
    for(const key of Object.keys(draft)) if(key.startsWith('proposal_')) delete draft[key];
    if(selection.agent===task.agent_id) await followConversationSubmission(selection,result);
    else await refresh();
  }
}

async function confirmAnalysisData(candidate, approved) {
  if(!approved || candidate.stale) throw new Error('请先验收当前有效候选并勾选确认。');
  const viewRun=runId;
  await api(`/api/agents/${encodeURIComponent(candidate.agent_id)}/confirm-analysis-data`,{run_id:viewRun,turn_id:candidate.turn_id,candidate_sha256:candidate.sha256,confirmed:true});
  if(runId===viewRun) await refresh();
}

function wirePreparationForm(root, selector, submit) {
  const form=root.querySelector(selector);
  if(!form) return;
  form.onsubmit=event=>{event.preventDefault();action(async()=>{
    const draft=preparationDraft();
    const button=form.querySelector('button[type="submit"],button:not([type])');
    if(button.disabled || draft.pending) return;
    button.disabled=true;draft.pending=true;form.dataset.sending='true';
    try {await submit(form);} finally {
      draft.pending=false;
      if(form.isConnected) {button.disabled=false;form.dataset.sending='false';}
    }
  });};
}

function wirePreparationDraft(root, draft) {
  // An unconfirmed Agent draft is a suggestion: the first click selects it, so typing replaces it
  // instead of splicing words into the middle of the draft.
  root.querySelectorAll('[data-select-on-focus]').forEach(field=>{
    field.addEventListener('mouseup',event=>event.preventDefault(),{once:true});
    field.addEventListener('focus',()=>field.select(),{once:true});
  });
  root.querySelectorAll('#preparationIntake [name],#preparationPlan [name],#preparationAnswer [name]').forEach(control=>{
    const update=()=>{
      draft[control.name]=control.type==='checkbox'?control.checked:control.value;
      if(control.name==='analysis_goal') draft.analysis_goal_origin='user';
      if(!['decisions_confirmed','plan_confirmed','cloud_confirmed','answer'].includes(control.name) && !control.name.startsWith('proposal_')) {
        draft.plan_confirmed=false;draft.cloud_confirmed=false;
        if(control.name!=='plan') draft.decisions_confirmed=false;
        for(const name of ['decisions_confirmed','plan_confirmed','cloud_confirmed']) {
          const checkbox=root.querySelector(`[name="${name}"]`);if(checkbox) checkbox.checked=Boolean(draft[name]);
        }
      }
    };
    control.oninput=update;
    if(['efficacy','safety'].includes(control.name)) control.onchange=()=>{update();renderAnalysisDataWorkspace(root);};
  });
}

function renderAnalysisDataWorkspace(root) {
  const data=snapshot.analysis_data||{}, draft=preparationDraft(), task=currentTasks('analysis-data')[0];
  const busy=['queued','running'].includes(task?.status), waiting=task?.status==='needs_input';
  const candidate=data.pending_candidate, ready=data.status==='ready';
  const editing=draft.editing||(!busy&&!waiting&&!candidate&&!ready);
  const stage=editing?draft.step:waiting||busy?2:candidate?3:4;
  const failure=['failed','interrupted'].includes(task?.status);
  const progress=(task?.progress_steps||[]).find(item=>item.id===task?.progress_current);
  let content=editing?(draft.step===2?preparationPlanMarkup(draft):preparationIntakeMarkup(draft,data.prerequisites))
    :waiting?preparationQuestionMarkup(task,draft)
    :busy?`<section class="surface"><h4>正在生成候选</h4><p role="status">${escape(progress?.detail||'正在按已确认方案检查并准备数据。')}</p><p>完成后在本页验收；当前不会自动发布。</p></section>`
    :candidate?preparationCandidateMarkup(candidate)
    :`<section class="surface"><h4>4. 已可用于分析</h4><p>${escape(analysisDataPresentation(data,task).detail)}</p><button class="primary-button" id="preparationWorkbench">打开分析工作台 →</button><button class="presets-button" id="workbenchPresets" type="button">查看预设</button><button class="secondary-button" id="preparationNew">准备新版本</button></section>`;
  if(editing && !data.prerequisites?.ready) content='<section class="surface"><h4>先了解数据并完成 QC</h4><p>完成上方缺少的报告后，再确认研究口径与处理方案。已有草稿会保留。</p></section>';
  root.innerHTML=`<div class="analysis-data-workspace"><ol class="preparation-steps" aria-label="Analysis Data 准备阶段">${['核对依据与口径','生成候选','验收候选','用于分析'].map((label,index)=>`<li ${index+1===stage?'aria-current="step"':''}>${index+1}. ${label}</li>`).join('')}</ol>${ready&&stage!==4?'<p class="info-note">已有可用版本仍保留；新候选验收成功后才会替换。</p>':''}${failure?`<div class="preparation-failure"><p><strong>本次准备没有完成。</strong>${ready?'已有可用版本未被替换。':''}可以在原任务中重试（Agent 保留之前的分析），或调整口径和方案后重新生成。</p><details><summary>查看原因</summary><p>${escape(task.result?.message||task.error||'未提供原因。')}</p></details><div class="live-actions"><button type="button" class="primary-button" id="preparationRerun">在原任务中重试</button></div></div>`:''}${preparationEvidenceMarkup(data.prerequisites)}${content}</div>`;
  wireNavigation(root);wirePreparationDraft(root,draft);
  if(root.querySelector('.decision-panel')) {
    wireDecisionPanel(root,draft,()=>renderAnalysisDataWorkspace(root));
    autoRecommend(root,draft,preparationDecisionFields(draft).map(([id])=>id));
  }
  root.querySelectorAll('[data-evidence]').forEach(button=>{button.onclick=()=>{
    const kind=button.dataset.evidence;analysisDraft().versions[kind]=data.prerequisites.upstream[kind].turn_id;navigate(kind==='summary'?'summary':'qc');
  };});
  const bind=(id,fn)=>{const button=root.querySelector(`#${id}`);if(button) button.onclick=fn;};
  wireSuggestions(root,draft,()=>renderAnalysisDataWorkspace(root));
  bind('preparationBack',()=>{draft.step=1;renderAnalysisDataWorkspace(root);});
  bind('preparationApplyDecisions',()=>{draft.editing=true;draft.step=2;renderAnalysisDataWorkspace(root);});
  bind('preparationNew',()=>{draft.editing=true;draft.step=1;draft.decisions_confirmed=false;draft.plan_confirmed=false;draft.cloud_confirmed=false;renderAnalysisDataWorkspace(root);});
  bind('preparationWorkbench',()=>action(()=>openAnalysisWorkbench()));
  bind('workbenchPresets',()=>action(()=>openStepPresets('charts')));
  bind('preparationRerun',()=>action(async()=>{
    await api(`/api/agents/${encodeURIComponent(task.agent_id)}/rerun`,{run_id:runId,cloud_policy:selectedDataPolicy()});
    await refresh();
  }));
  wirePreparationForm(root,'#preparationIntake',()=>{preparationIntake(draft,snapshot.analysis_data?.prerequisites);draft.step=2;draft.evidenceChanged=false;renderAnalysisDataWorkspace(root);});
  wirePreparationForm(root,'#preparationPlan',()=>{draft.plan_confirmed=true;return startAnalysisDataPreparation();});
  wirePreparationForm(root,'#preparationAnswer',async form=>{
    const proposals=task.result?.proposals||[];
    const confirmed=proposals.map(item=>({id:item.id,value:String(form.elements[`proposal_${item.id}`]?.value||'').trim(),basis:item.basis}));
    await answerAnalysisData(task,preparationAnswerText(proposals,form,draft.answer),draft.answer);
    await rememberDecisions(confirmed,'agent_confirmed');
  });
  wirePreparationForm(root,'#preparationConfirm',()=>confirmAnalysisData(candidate,true));
  if (typeof wireIssueStrip === 'function') wireIssueStrip(root);
}
