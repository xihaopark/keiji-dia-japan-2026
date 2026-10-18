/* Database page: the QC record table. One row per QC finding with the Agent's re-check, the
 * analyst's handling and the subjects it names; manual exclusions keep their own rows. The
 * exported CSV keeps the stored English values. */
const QcRecords = (() => {
  const STAGES = {data_quality: '数据质量 QC', tlf: 'TLF 质检', pk: 'PK 质检',
    manual_selection: '手动排除'};
  const VERDICTS = {confirmed: '确认问题', false_positive: '误报', corrected: '已更正'};
  const NEXT_STEPS = {none: '无需处理', analysis_data: '写入 Analysis Data',
    exclude_subjects: '建议排除受试者', data_team: '交数据团队'};
  const DISPOSITIONS = {open: '待处理', recorded: '已记录', awaiting_information: '待补充信息',
    resolved: '已解决', excluded: '已排除'};
  const label = (table, value) => table[value] || value || '—';

  // Uniform rows for display and export, whatever record type they came from.
  const rows = records => (records || []).map(record => {
    if (record.type === 'manual_selection') {
      return {stage: 'manual_selection', finding_id: '', priority: '', finding: String(record.path || '').split('/').at(-1),
        verdict: '', next_step: '', review_reason: '', disposition: 'excluded', note: record.reason || '', handled_at: '',
        affected_n: (record.source_rows || []).length, subjects: [], rows: record.source_rows || []};
    }
    if (record.type === 'qc_finding') {
      return {stage: record.kind, finding_id: record.id || '', priority: record.severity || record.priority || '',
        finding: record.message || record.finding || '', verdict: '', next_step: '', review_reason: '',
        disposition: record.status || 'open', note: record.recommendation || '', handled_at: '',
        affected_n: record.affected_n ?? '', subjects: [], rows: []};
    }
    return {stage: record.stage, finding_id: record.finding_id, priority: record.priority, finding: record.finding,
      verdict: record.review?.verdict || '', next_step: record.review?.next_step || '', review_reason: record.review?.reason || '',
      disposition: record.disposition || 'open', note: record.handling?.note || '', handled_at: record.handling?.time || '',
      affected_n: record.affected_n ?? '', subjects: record.subjects || [], rows: []};
  });

  const subjectsCell = (subjects, esc) => {
    if (!subjects.length) return '—';
    const shown = subjects.slice(0, 3).map(esc).join('<br>');
    return subjects.length > 3 ? `<span title="${esc(subjects.join(', '))}">${shown}<br>${subjects.length} 位受试者</span>` : shown;
  };

  const markup = (records, esc) => {
    const list = rows(records);
    if (!list.length) return '<div class="database-panel-empty">暂无质检记录。完成数据质量 QC 后，每个问题及其处理结果会记录在这里。</div>';
    const head = ['阶段', '问题', '优先级', 'Agent 复核', '处理结果', '说明', '受试者', '影响数'];
    const body = list.map(row => `<tr class="qc-record-${esc(row.disposition)}"><td>${esc(label(STAGES, row.stage))}</td>
      <td><strong>${esc(row.finding)}</strong>${row.finding_id ? `<small>${esc(row.finding_id)}</small>` : ''}</td><td>${esc(row.priority || '—')}</td>
      <td>${row.verdict ? `${esc(label(VERDICTS, row.verdict))}<small>${esc(label(NEXT_STEPS, row.next_step))}</small>` : '—'}</td>
      <td><span class="qc-disposition">${esc(label(DISPOSITIONS, row.disposition))}</span></td>
      <td class="qc-record-note" title="${esc(row.note || row.review_reason)}"><span>${esc(row.note || row.review_reason || '—')}</span></td><td>${subjectsCell(row.subjects, esc)}</td><td>${esc(row.affected_n)}</td></tr>`).join('');
    return `<div class="qc-records-toolbar"><span>${list.length} 条记录</span><button class="table-button" type="button" data-qc-export>下载 CSV</button></div>
      <div class="qc-records-scroll"><table class="qc-records"><thead><tr>${head.map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  };

  const csvCell = value => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = records => {
    const columns = ['stage', 'finding_id', 'priority', 'finding', 'verdict', 'next_step', 'review_reason', 'disposition',
      'note', 'handled_at', 'affected_n', 'subject_ids', 'source_rows'];
    const lines = rows(records).map(row => columns.map(column => csvCell(
      column === 'subject_ids' ? row.subjects.join(';') : column === 'source_rows' ? row.rows.join(';') : row[column])).join(','));
    return [columns.join(','), ...lines].join('\r\n') + '\r\n';
  };

  return {rows, markup, csv};
})();

// Inside VS Code the Extension Host asks where to save; a plain browser downloads the file.
function saveTextFile(name, text) {
  if (window.canvasHostSend) return window.canvasHostSend({type: 'demo.saveText', name, text});
  const url = URL.createObjectURL(new Blob([text], {type: 'text/csv'}));
  Object.assign(document.createElement('a'), {href: url, download: name}).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

if (typeof module !== 'undefined') module.exports = QcRecords;
