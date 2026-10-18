/* Version-frozen checklists. Legacy supplemental text is read-only history. */
function qcCheckStatus(task, checkId) {
  if (!task) return t('尚未运行', 'Not run');
  if (task.stale) return t('输入已更新，请启动新版本', 'Inputs changed; start a new version');
  if (task.integrity && task.integrity !== 'current') return t('结果完整性需核对，暂不确认执行状态', 'Result integrity requires review; execution status is unconfirmed');
  if (task.status !== 'completed') return statusText(task.status) + t('（任务状态，未提供逐项进度）', ' (task status; per-check progress unavailable)');
  const execution = task.result?.qc_execution;
  if (!execution) return t('历史结果未提供逐项执行证据', 'Legacy result has no per-check execution evidence');
  const check = execution.checks?.find(item => item.rule_id === checkId);
  if (!check) return t('未执行 · 不在此版本的执行记录中', 'Not executed in this version');
  if (check.status === 'unavailable') return t('无法评估：缺少所需数据', 'Unavailable: required data missing');
  if (check.status !== 'completed') return t('尚未确认执行', 'Execution not confirmed');
  const count = check.finding_ids?.length || 0;
  return count ? t(`已执行 · ${count} 条发现`, `Executed · ${count} findings`)
    : t('已执行 · 无已报告发现', 'Executed · no reported findings');
}

// Built-in rules: [id, Chinese name, Chinese purpose, English name, English purpose]. Drafts and
// results store the English text; the Chinese interface shows the Chinese label by rule ID.
const QC_BUILTIN_CATALOG = [
  ['pk_absent_under_treatment', '治疗下缺少 PK', '检查治疗与安全性证据下的 PK 数据覆盖。', 'No PK under treatment', 'Check PK coverage for subjects with treatment and safety evidence.'],
  ['pk_records_vs_pk_flag', 'PK 记录与分析标志', '核对 PK 分析标志与实际记录是否一致。', 'PK records and analysis flag', 'Check that the PK analysis flag matches the actual records.'],
  ['predose_nonzero_baseline', '给药前非零浓度', '识别首次给药前出现的非零浓度。', 'Non-zero pre-dose concentration', 'Find non-zero concentrations before the first dose.'],
  ['pk_missing_core_fields', 'PK 核心字段', '检查受试者、分析物及周期时间字段的完整性。', 'PK core fields', 'Check subject, analyte and cycle-time fields for completeness.'],
  ['sparse_pk_profile', 'PK 采样覆盖', '识别 PK 记录数少于本次设定阈值的受试者。', 'PK sampling coverage', 'Find subjects with fewer PK records than the threshold set for this run.'],
  ['cohort_label_unparseable', '队列标签', '检查缺失或无法对应的队列标签。', 'Cohort labels', 'Check for missing or unmatched cohort labels.'],
  ['duplicate_pk_records', '重复 PK 记录', '检查周期感知的受试者、分析物、时间、值及单位组合键。', 'Duplicate PK records', 'Check the cycle-aware subject, analyte, time, value and unit key.'],
  ['paramrep_unit_mismatch', '指标与单位', '核对指标标签中的单位与数值单位。', 'Parameter and unit', 'Check the unit in the parameter label against the value unit.'],
];

function defaultQCRules() {
  return QC_BUILTIN_CATALOG.map(([id,,, name, description]) => ({id, check_id:id, name, description,
    parameters:id === 'sparse_pk_profile' ? {sparse_min_records:3} : {}}));
}

// The text shown for a rule: a built-in rule's own label in the interface language, unless the
// analyst renamed it; renamed and study rules show what was typed.
function qcRuleText(rule, field) {
  const entry = QC_BUILTIN_CATALOG.find(item => item[0] === rule.id);
  const value = rule[field] || '';
  if (!entry) return value;
  const [zh, en] = field === 'name' ? [entry[1], entry[3]] : [entry[2], entry[4]];
  return value === zh || value === en ? t(zh, en) : value;
}

function normalizeQCRules(rules) {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 18) throw new Error('检查清单至少 1 项，最多 18 项。');
  const ids = new Set(), builtins = new Set(defaultQCRules().map(rule => rule.id));
  const normalized = JSON.parse(JSON.stringify(rules));
  normalized.forEach(rule => {
    if (!rule || typeof rule !== 'object' || Object.keys(rule).sort().join() !== 'check_id,description,id,name,parameters') throw new Error('检查规则结构不完整。');
    if (typeof rule.id !== 'string' || ids.has(rule.id)) throw new Error('检查规则不能重复。');
    ids.add(rule.id);
    const entry = QC_BUILTIN_CATALOG.find(item => item[0] === rule.id);
    for (const [field,max] of [['name',120],['description',500]]) {
      if (typeof rule[field] !== 'string' || !rule[field].trim() || rule[field].trim().length > max) throw new Error(`名称和检查目的不能为空（名称最多 120 字，目的最多 500 字）。`);
      rule[field] = rule[field].trim();
      // An unchanged built-in label is stored as its English text.
      if (entry && rule[field] === entry[field === 'name' ? 1 : 2]) rule[field] = entry[field === 'name' ? 3 : 4];
    }
    const p = rule.parameters;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('检查条件不完整。');
    if (rule.check_id === 'manual') {
      if (!/^study_[A-Za-z0-9_-]{1,64}$/.test(rule.id)) throw new Error('研究检查标识无效。');
      validateQCStudyParameters(p);
    } else if (!builtins.has(rule.id) || rule.check_id !== rule.id) throw new Error('不支持此检查规则。');
    else if (rule.id === 'sparse_pk_profile') {
      if (Object.keys(p).join() !== 'sparse_min_records' || !Number.isInteger(p.sparse_min_records) || p.sparse_min_records < 1 || p.sparse_min_records > 100) throw new Error('PK 记录数阈值须为 1–100 的整数。');
    } else if (Object.keys(p).length) throw new Error('该检查没有可编辑数值条件。');
  });
  return normalized;
}

function validateQCStudyParameters(p) {
  const fields = {missing:['kind','dataset','column'], numeric_range:['kind','dataset','column','minimum','maximum'], allowed_values:['kind','dataset','column','values']};
  if (!fields[p.kind] || Object.keys(p).some(key => !fields[p.kind].includes(key))) throw new Error('请选择缺失值、数值范围或允许值检查。');
  if (!['ADSL','ADEX','ADPC','ADAE'].includes(p.dataset) || typeof p.column !== 'string' || !p.column.trim() || p.column.trim().length > 120) throw new Error('请选择数据表并填写实际字段名（最多 120 字）。');
  p.column = p.column.trim();
  if (p.kind === 'numeric_range' && (!Number.isFinite(p.minimum) || !Number.isFinite(p.maximum) || p.minimum > p.maximum)) throw new Error('数值下限和上限必须有效，且下限不能大于上限。');
  if (p.kind === 'allowed_values') {
    if (!Array.isArray(p.values) || p.values.length < 1 || p.values.length > 100 || p.values.some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 120)) throw new Error('允许值须为 1–100 个非空值，每项最多 120 字。');
    p.values = [...new Set(p.values.map(value => value.trim()))];
  }
}

function qcRulesDraft() {
  const draft = analysisDraft();
  if (!Array.isArray(draft.qc_rules)) draft.qc_rules = defaultQCRules();
  return draft.qc_rules;
}
function qcRulesForSubmission() { return normalizeQCRules(qcRulesDraft()); }

function qcRuleCondition(rule) {
  const p = rule.parameters;
  if (rule.id === 'sparse_pk_profile') return t(`少于 ${p.sparse_min_records} 条 PK 记录`, `Fewer than ${p.sparse_min_records} PK records`);
  if (rule.check_id !== 'manual') return '';
  const condition = p.kind === 'missing' ? t('检查缺失值','Missing values') : p.kind === 'numeric_range' ? `${p.minimum} ≤ ${p.column} ≤ ${p.maximum}` : `${t('允许值','Allowed values')}: ${p.values.join(', ')}`;
  return `${p.dataset} · ${p.column} · ${condition}`;
}

function qcChecklistMarkup(task, editable = true, showManagement = true) {
  const rules = editable ? qcRulesDraft() : (task?.parameters?.qc_rules || defaultQCRules());
  const sameScope = !editable || JSON.stringify(rules) === JSON.stringify(task?.parameters?.qc_rules);
  return `<section class="surface qc-checklist"><div class="section-heading"><div><h4>${t('检查清单','Checklist')}</h4><p>${editable ? t('本次规则草稿','Next-run draft') : t('所选版本 · 只读','Selected version · read-only')} · ${rules.length} ${t('项','checks')}</p></div>${showManagement ? `<button type="button" class="secondary-button" id="manageQCRules">${editable ? t('管理清单','Manage checklist') : t('管理下次检查清单','Manage next checklist')}</button>` : ''}</div>
    <p class="muted">${t('规则修改仅用于新版本。已执行不代表科学审阅通过。','Changes apply to new versions only. Execution does not imply scientific approval.')}</p>
    <ul class="qc-checklist-items">${rules.map(rule => `<li><strong>${escape(qcRuleText(rule,'name'))}</strong><small>${escape(qcRuleText(rule,'description'))}</small>${qcRuleCondition(rule) ? `<small>${escape(qcRuleCondition(rule))}</small>` : ''}<span class="status-badge">${escape(qcCheckStatus(sameScope ? task : null,rule.id))}</span></li>`).join('')}</ul></section>`;
}

function qcHistoryMarkup(task) {
  if (!task) return '';
  const checks = task.parameters?.supplemental_checks || [];
  if (!checks.length) return '';
  return `<details class="surface qc-history"><summary>${t('历史补充请求（只读）','Legacy supplemental requests (read-only)')}</summary>
    <p>${escape(prettyDate(task.created_at))}</p><ol>${checks.map(item=>`<li>${escape(item)}</li>`).join('') || `<li>${t('此版本没有研究补充检查。','This version has no supplemental checks.')}</li>`}</ol>
    <p>${t('历史文字不会自动转换成新版本的执行规则。','Legacy text is not automatically converted into executable rules.')}</p></details>`;
}

function qcRuleEditorFields(rule, index) {
  const p = rule.parameters;
  const input = (field, label, value, extra = '') => `<label>${label}<input data-qc-field="${field}" value="${escape(value)}" ${extra}></label>`;
  let condition = '';
  if (rule.id === 'sparse_pk_profile') condition = input('sparse_min_records', t('PK 记录数少于','PK records fewer than'), p.sparse_min_records, 'type="number" min="1" max="100" step="1" required');
  if (rule.check_id === 'manual') {
    const choices = [['missing','缺失值','Missing values'],['numeric_range','数值范围','Numeric range'],['allowed_values','允许值','Allowed values']];
    condition = `<label>${t('数据表','Dataset')}<select data-qc-field="dataset">${['ADSL','ADEX','ADPC','ADAE'].map(value => `<option ${value === p.dataset ? 'selected' : ''}>${value}</option>`).join('')}</select></label>`
      + input('column',t('实际字段名','Source column'),p.column,'maxlength="120" required')
      + `<label>${t('检查条件','Condition')}<select data-qc-field="kind">${choices.map(([value,zh,en]) => `<option value="${value}" ${value === p.kind ? 'selected' : ''}>${t(zh,en)}</option>`).join('')}</select></label>`;
    if (p.kind === 'numeric_range') condition += input('minimum',t('下限（含）','Minimum (inclusive)'),p.minimum,'type="number" step="any" required') + input('maximum',t('上限（含）','Maximum (inclusive)'),p.maximum,'type="number" step="any" required');
    if (p.kind === 'allowed_values') condition += `<label>${t('允许值（每行一个，区分大小写）','Allowed values (one per line, case-sensitive)')}<textarea data-qc-field="values" required>${escape(p.values.join('\n'))}</textarea></label>`;
  }
  return `<fieldset class="qc-rule-card" data-qc-index="${index}"><legend>${index + 1}. ${escape(rule.name ? qcRuleText(rule,'name') : t('新检查','New check'))}</legend><div class="qc-rule-fields">${input('name',t('检查名称','Check name'),rule.name,'maxlength="120" required')}<label>${t('检查目的','Purpose')}<textarea data-qc-field="description" maxlength="500" required>${escape(rule.description)}</textarea></label>${condition}</div><button type="button" data-qc-remove="${index}" class="text-button">${t('从下次检查移除','Remove from next check')}</button></fieldset>`;
}

function readQCRuleFields(dialog, rules) {
  dialog.querySelectorAll('[data-qc-index]').forEach(card => {
    const rule = rules[Number(card.dataset.qcIndex)], p = rule.parameters;
    card.querySelectorAll('[data-qc-field]').forEach(field => {
      const key = field.dataset.qcField;
      if (key === 'name' || key === 'description') rule[key] = field.value;
      else if (key === 'kind') return; // A change of predicate receives its own typed defaults.
      else if (['sparse_min_records','minimum','maximum'].includes(key)) p[key] = field.value === '' ? NaN : Number(field.value);
      else if (key === 'values') p.values = field.value.split('\n');
      else p[key] = field.value;
    });
  });
}

function openQCRulesDialog(rerender, trigger) {
  if (document.getElementById('qcRulesDialog')) return;
  const requestedRun = runId;
  let rules = JSON.parse(JSON.stringify(qcRulesDraft()));
  const dialog = document.createElement('dialog');
  dialog.id = 'qcRulesDialog';
  dialog.className = 'qc-rules-dialog';
  dialog.setAttribute('aria-labelledby','qcRulesTitle');
  dialog.innerHTML = `<form><h3 id="qcRulesTitle">${t('管理下次检查清单','Manage next checklist')}</h3><p>${t('这是本次数据检查规则。可添加、编辑和移除；保存后须启动新版本，当前执行和历史结果不会改变。复杂研究判断请写在补充说明中。','These are executable data checks. Add, edit or remove checks for a new version; running and historical results stay unchanged. Put complex study judgments in the additional note.')}</p><p class="muted">${t('新增检查支持缺失值、数值范围和允许值。数值范围与允许值不包含缺失值检查；需要时请另加缺失值规则。字段缺失会明确显示无法评估。','Custom checks support missing values, numeric ranges and allowed values. Range and allowed-value checks do not include missing values; add a missing-value check separately. Missing columns are reported as unavailable.')}</p><div class="qc-rule-list"></div><div class="qc-rule-actions"><button type="button" data-qc-add>${t('添加研究检查','Add study check')}</button><label>${t('恢复默认检查','Restore a default check')}<select data-qc-restore></select></label><button type="button" data-qc-restore-button>${t('添加所选检查','Add selected check')}</button></div><p role="alert" class="qc-rule-error" tabindex="-1"></p><footer><button type="button" data-qc-cancel>${t('取消','Cancel')}</button><button type="submit" class="primary-button">${t('保存下次检查清单','Save next checklist')}</button></footer></form>`;
  document.body.append(dialog);
  const render = () => {
    dialog.querySelector('.qc-rule-list').innerHTML = rules.map(qcRuleEditorFields).join('');
    const missing = defaultQCRules().filter(rule => !rules.some(item => item.id === rule.id));
    dialog.querySelector('[data-qc-restore]').innerHTML = missing.map(rule => `<option value="${rule.id}">${escape(qcRuleText(rule,'name'))}</option>`).join('') || `<option value="">${t('默认检查均已加入','All default checks are included')}</option>`;
    dialog.querySelector('[data-qc-restore-button]').disabled = !missing.length || rules.length >= 18;
    dialog.querySelector('[data-qc-add]').disabled = rules.length >= 18;
  };
  dialog.onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    readQCRuleFields(dialog,rules);
    if (button.hasAttribute('data-qc-cancel')) { dialog.close(); return; }
    if (button.hasAttribute('data-qc-remove')) rules.splice(Number(button.dataset.qcRemove),1);
    else if (button.hasAttribute('data-qc-add')) rules.push({id:`study_${crypto.randomUUID().replaceAll('-','')}`,check_id:'manual',name:t('新研究检查','New study check'),description:'',parameters:{kind:'missing',dataset:'ADSL',column:''}});
    else if (button.hasAttribute('data-qc-restore-button')) {
      const rule = defaultQCRules().find(item => item.id === dialog.querySelector('[data-qc-restore]').value);
      if (rule) rules.push(rule);
    } else return;
    render();
    dialog.querySelector('.qc-rule-list fieldset:last-child input')?.focus();
  };
  dialog.onchange = event => {
    if (event.target.dataset.qcField !== 'kind') return;
    readQCRuleFields(dialog,rules);
    const rule = rules[Number(event.target.closest('[data-qc-index]').dataset.qcIndex)];
    const {dataset,column} = rule.parameters, kind = event.target.value;
    rule.parameters = {kind,dataset,column,...(kind === 'numeric_range' ? {minimum:0,maximum:100} : kind === 'allowed_values' ? {values:['']} : {})};
    render();
  };
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    try {
      if (runId !== requestedRun) throw new Error(t('当前项目已改变，请重新打开清单。','The active project changed. Reopen the checklist.'));
      readQCRuleFields(dialog,rules);
      analysisDraft().qc_rules = normalizeQCRules(rules);
      dialog.close();
      rerender();
    } catch (error) {
      const message = dialog.querySelector('.qc-rule-error');
      message.textContent = error.message;
      message.focus();
    }
  };
  dialog.addEventListener('close',() => { dialog.remove(); if (trigger?.isConnected) trigger.focus(); });
  render();
  dialog.showModal();
  dialog.querySelector('input')?.focus();
}

function wireQCRules(root, rerender) {
  const button = root.querySelector('#manageQCRules');
  if (!button) return;
  button.onclick = () => {
    const note = root.querySelector('[name="instruction"]');
    if (note) analysisDraft().qcInstruction = note.value;
    openQCRulesDialog(rerender,button);
  };
}
