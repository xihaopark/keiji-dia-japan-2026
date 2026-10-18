/* Host file selection and authenticated artifact URLs. */
function chooseDataFiles() {
  if (!window.canvasHostSend && window.parent === window) {
    return Promise.reject(new Error('请在应用中选择本地数据文件夹。'));
  }
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
    const receive = event => {
      const fromHost = window.canvasHostSend
        ? canvasHostMessage(event)
        : event.source === window.parent;
      if (!fromHost || event.data?.type !== 'demo.dataPicked' || event.data.requestId !== requestId) return;
      cleanup();
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('选择文件超时，请重试。'));
    }, 300000);
    window.addEventListener('message', receive);
    const message = {type: 'demo.pickData', requestId};
    try {
      if (window.canvasHostSend) window.canvasHostSend(message);
      else window.parent.postMessage(message, '*');
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
function showPickedFiles(target, paths) {
  target.innerHTML = paths.length ? paths.map(file => `<div class="source-row"><span class="file-format">${escape(file.split('.').pop().toUpperCase())}</span><strong title="${escape(file)}">${escape(file.split('/').pop())}</strong></div>`).join('') : '<p class="info-note">尚未选择数据文件。</p>';
}

// A typed or pasted folder skips the host picker (browser development, code-server without a picker).
async function browseDataFolder(target, onSelection, typedDirectory = '', keepFiles = null) {
  const picked = typedDirectory ? {directory: typedDirectory} : await chooseDataFiles();
  if (!picked) return;
  const discovery = await api('/api/discover', {path: picked.directory});
  const selected = new Set();
  target.innerHTML = `<div class="folder-selection"><div class="section-heading"><h4>选择数据文件</h4><p>${escape(discovery.root)}</p><p>${discovery.files.length} 个文件${discovery.truncated ? ' · 文件较多，请选择更具体的文件夹' : ''}</p></div><div class="browser-toolbar"><input type="search" placeholder="筛选文件…" aria-label="筛选文件"><button type="button" class="secondary-button" data-all>选择全部文件</button><button type="button" class="secondary-button" data-clear>清空</button></div><div class="discovered-files">${discovery.files.map((file, index) => `<label class="discovered-file"><input type="checkbox" data-file="${index}" ${file.selectable === false ? 'disabled' : ''}><span><strong>${escape(file.relative_path)}</strong><small>${escape(file.format || '未知格式')} · ${Math.ceil(file.size / 1024).toLocaleString()} KB</small></span></label>`).join('') || '<p>此文件夹中没有文件。</p>'}</div><p class="info-note" data-count>已选择 0 个文件</p></div>`;
  const update = () => {
    target.querySelector('[data-count]').textContent = `已选择 ${selected.size} 个文件`;
    onSelection({directory: discovery.root, files: [...selected], paths: [...selected].map(file => `${discovery.root.replace(/\/$/, '')}/${file}`)});
  };
  target.querySelectorAll('[data-file]').forEach(box => {
    box.onchange = () => {
      const file = discovery.files[Number(box.dataset.file)].relative_path;
      box.checked ? selected.add(file) : selected.delete(file);
      update();
    };
  });
  target.querySelector('[data-all]').onclick = () => {
    target.querySelectorAll('[data-file]:not(:disabled)').forEach(box => {
      box.checked = true;
      selected.add(discovery.files[Number(box.dataset.file)].relative_path);
    });
    update();
  };
  target.querySelector('[data-clear]').onclick = () => {
    selected.clear();
    target.querySelectorAll('[data-file]').forEach(box => { box.checked = false; });
    update();
  };
  target.querySelector('input[type="search"]').oninput = event => {
    target.querySelectorAll('.discovered-file').forEach(row => {
      row.hidden = !row.textContent.toLowerCase().includes(event.target.value.toLowerCase());
    });
  };
  // A study folder is usually used whole: start with every readable file selected.
  if (!keepFiles) { target.querySelector('[data-all]').onclick(); return; }
  target.querySelectorAll('[data-file]').forEach(box => {
    const file = discovery.files[Number(box.dataset.file)].relative_path;
    box.checked = keepFiles.includes(file);
    if (box.checked) selected.add(file);
  });
  update();
}

async function fileUrl(taskId, name) {
  const requestedRun = runId;
  const query = new URLSearchParams({run_id: requestedRun, task_id: taskId, name});
  const response = await canvasFetch(`/api/file?${query}`);
  if (!response.ok) throw new Error((await response.json()).error);
  const url = URL.createObjectURL(await response.blob());
  previewUrls.push(url);
  return url;
}
