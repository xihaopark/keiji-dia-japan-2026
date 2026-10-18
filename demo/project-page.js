/* Project selection and creation entry. */
let pendingArchiveRun = '';

async function openProject(requestedRun) {
  await api('/api/select', {run_id: requestedRun});
  runId = requestedRun;
  await refresh(false);
  navigate('database');
}

function renderHome() {
  const rows = projects.map(project => `<tr>
    <td><strong>${escape(project.name || '未命名项目')}</strong></td>
    <td>${escape(projectCreatedDate(project.created_at))}</td>
    <td>${escape(project.description || '—')}</td>
    <td><button class="table-button view-project" type="button" data-project="${escape(project.id)}">查看</button></td>
    <td><button class="delete-button delete-project" type="button" data-project="${escape(project.id)}">删除</button></td>
  </tr>`).join('');
  $('#homePage').innerHTML = `<div class="page-heading"><div><span class="eyebrow">WORKSPACE OVERVIEW</span><h2>项目列表</h2><p>管理你的 Exposure-Response 分析项目与流程进展。</p></div><button class="primary-button" id="createProjectButton" type="button"><span>＋</span> 创建新项目</button></div>
    <div class="table-card"><table><thead><tr><th>项目名称</th><th>创建时间</th><th>项目描述</th><th class="action-column">查看</th><th class="action-column">删除</th></tr></thead><tbody id="projectTable">${rows || `<tr><td colspan="5" class="empty-row">${t('尚无项目。点击「创建新项目」开始。', 'No projects yet. Choose "New project" to start.')}</td></tr>`}</tbody></table></div>`;
  document.querySelectorAll('.view-project').forEach(button => {
    button.onclick = () => action(() => openProject(button.dataset.project));
  });
  $('#createProjectButton').onclick = () => {
    $('#createModal').classList.remove('hidden');
    $('#projectNameInput').focus();
  };
  document.querySelectorAll('.delete-project').forEach(button => {
    button.onclick = () => {
      pendingArchiveRun = button.dataset.project;
      $('#deleteModal').classList.remove('hidden');
    };
  });
}

$('#cancelCreate').onclick = () => $('#createModal').classList.add('hidden');
$('#cancelDelete').onclick = () => {
  pendingArchiveRun = '';
  $('#deleteModal').classList.add('hidden');
};
$('#createProjectForm').onsubmit = event => {
  event.preventDefault();
  action(async () => {
    const name = $('#projectNameInput').value.trim();
    const description = $('#projectDescriptionInput').value.trim();
    const created = await api('/api/runs', {name, description, deferred_data: true});
    $('#createModal').classList.add('hidden');
    event.target.reset();
    runId = created.run_id;
    await refreshRuns(false);
    await refresh(false);
    navigate('upload');
  });
};
$('#confirmDelete').onclick = () => action(async () => {
  if (!pendingArchiveRun) return;
  await api(`/api/runs/${encodeURIComponent(pendingArchiveRun)}/archive`, {});
  pendingArchiveRun = '';
  $('#deleteModal').classList.add('hidden');
  const data = await refreshRuns(false);
  runId = data.active || '';
  snapshot = runId ? await api(`/api/workspace?run_id=${encodeURIComponent(runId)}`) : null;
  navigate('home');
});
