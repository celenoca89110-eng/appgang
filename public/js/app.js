(function () {
  const FIXED_CAT_COLORS = {
    'armes blanches': '#7C8996',
    'armes a feu': '#C1443A',
    'armes à feu': '#C1443A',
    drogues: '#5B8C5A',
    autre: '#8B6FB0',
  };
  const PALETTE = ['#D9A63E', '#C1443A', '#7C8996', '#5B8C5A', '#8B6FB0'];

  let state = { gangs: [] };
  let currentUser = null;
  let selectedGangId = null;
  let sortMode = 'none';
  let searchTerm = '';
  let searchResults = [];
  let editingItems = new Set();
  let socket = null;

  // -------- Helpers de rôle --------
  function canEdit() {
    return currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff');
  }
  function isAdmin() {
    return currentUser && currentUser.role === 'admin';
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }
  function catColor(name) {
    const key = (name || '').trim().toLowerCase();
    if (FIXED_CAT_COLORS[key]) return FIXED_CAT_COLORS[key];
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }
  function initials(name) {
    return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }
  function fmtPrice(p) {
    const n = Number(p) || 0;
    return '$' + n.toLocaleString('fr-FR');
  }
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function getGang(id) {
    return state.gangs.find((g) => g.id === id);
  }
  function sortItems(items) {
    const arr = [...items];
    if (sortMode === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    else if (sortMode === 'price_asc') arr.sort((a, b) => a.price - b.price);
    else if (sortMode === 'price_desc') arr.sort((a, b) => b.price - a.price);
    return arr;
  }
  function toast(message, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  function fmtDate(iso) {
    try {
      return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('fr-FR');
    } catch (e) {
      return iso;
    }
  }

  // ================= AUTH =================

  async function tryAutoLogin() {
    const token = Api.getToken();
    if (!token) return showLogin();
    try {
      const { user } = await Api.get('/auth/me');
      currentUser = user;
      await enterApp();
    } catch (e) {
      Api.clearToken();
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appRoot').style.display = 'none';
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
      const data = await Api.post('/auth/login', { username, password });
      Api.setToken(data.token);
      currentUser = data.user;
      await enterApp();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    Api.clearToken();
    if (socket) socket.disconnect();
    currentUser = null;
    document.getElementById('loginPassword').value = '';
    showLogin();
  });

  async function enterApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appRoot').style.display = 'flex';
    renderMeInfo();
    connectSocket();
    await loadGangs();
    render();
  }

  function renderMeInfo() {
    document.getElementById('meInfo').innerHTML = `
      <div><b>${escapeHtml(currentUser.username)}</b></div>
      <div class="role-tag">${escapeHtml(currentUser.role)}</div>
    `;
    document.getElementById('addGangForm').style.display = canEdit() ? 'flex' : 'none';
    document.getElementById('usersBtn').style.display = isAdmin() ? 'flex' : 'none';
  }

  // ================= SOCKET.IO =================

  function connectSocket() {
    socket = io({ auth: { token: Api.getToken() } });

    socket.on('connect', () => setConnStatus(true));
    socket.on('disconnect', () => setConnStatus(false));
    socket.on('connect_error', () => setConnStatus(false));

    socket.on('gang:created', (gang) => {
      if (!getGang(gang.id)) {
        state.gangs.push(gang);
        render();
        toast(`Nouveau gang ajouté : ${gang.name}`);
      }
    });

    socket.on('gang:updated', (gang) => {
      const idx = state.gangs.findIndex((g) => g.id === gang.id);
      if (idx >= 0) state.gangs[idx] = gang;
      else state.gangs.push(gang);
      render();
    });

    socket.on('gang:deleted', ({ id }) => {
      state.gangs = state.gangs.filter((g) => g.id !== id);
      if (selectedGangId === id) selectedGangId = state.gangs[0]?.id || null;
      render();
      toast('Un gang a été supprimé.');
    });
  }

  function setConnStatus(online) {
    const el = document.getElementById('connStatus');
    const label = document.getElementById('connLabel');
    el.classList.toggle('online', online);
    label.textContent = online ? 'Synchronisé en temps réel' : 'Hors ligne';
  }

  // ================= DATA LOADING =================

  async function loadGangs() {
    state.gangs = await Api.get('/gangs');
    if (!selectedGangId && state.gangs.length) selectedGangId = state.gangs[0].id;
  }

  // ================= RENDER =================

  function render() {
    renderSidebar();
    renderContent();
  }

 function renderSidebar() {
  const list = document.getElementById('gangList');

  if (!state.gangs.length) {
    list.innerHTML = `<div class="sidebar-empty">Aucun gang enregistré.${canEdit() ? '<br>Créez le premier dossier ci-dessous.' : ''}</div>`;
    return;
  }

  list.innerHTML = state.gangs
    .map((g) => {
      const itemCount = g.categories.reduce((s, c) => s + c.items.length, 0);
      const active = g.id === selectedGangId ? 'active' : '';

      return `
        <div class="gang-card ${active}" data-gang="${g.id}">
          <div class="gang-badge">${escapeHtml(initials(g.name))}</div>

          <div class="gang-card-info">
            <div class="gang-card-name">${escapeHtml(g.name)}</div>
            <div class="gang-card-meta">
              ${g.categories.length} catégorie(s) · ${itemCount} item(s)
            </div>
          </div>

          ${isAdmin() ? `
            <div class="gang-actions">

              <!-- ✏️ RENOMMER -->
              <button class="icon-btn" data-edit-gang="${g.id}" title="Renommer">
                ✏️
              </button>

              <!-- 🗑 SUPPRIMER -->
              <button class="icon-btn" data-remove-gang="${g.id}" title="Supprimer ce gang">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M3 6h18"/>
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </button>

            </div>
          ` : ''}

        </div>
      `;
    })
    .join('');
}

  function renderContent() {
    const content = document.getElementById('content');

    if (searchTerm.trim()) return renderSearchResults(content);

    if (!selectedGangId || !getGang(selectedGangId)) {
      content.innerHTML = `<div class="content-empty"><span class="big">Aucun dossier ouvert</span>Sélectionnez un gang à gauche${canEdit() ? ', ou créez-en un nouveau pour commencer.' : '.'}</div>`;
      return;
    }

    const gang = getGang(selectedGangId);
    const totalItems = gang.categories.reduce((s, c) => s + c.items.length, 0);
    const totalValue = gang.categories.reduce((s, c) => s + c.items.reduce((s2, i) => s2 + Number(i.price || 0), 0), 0);

    let html = `<div class="fade-in">
      <div class="gang-header"><div class="gang-title"><span class="dot"></span>${escapeHtml(gang.name)}</div></div>
      <div class="gang-stats">
        <span><b>${gang.categories.length}</b> catégorie(s)</span>
        <span><b>${totalItems}</b> item(s)</span>
        <span><b>${fmtPrice(totalValue)}</b> valeur cumulée</span>
      </div>`;

    if (!canEdit()) {
      html += `<div class="readonly-banner">Mode lecture seule — votre rôle (${escapeHtml(currentUser.role)}) ne permet pas de modifier ce registre.</div>`;
    } else {
      html += `<div class="add-cat-row">
          <input type="text" id="newCatName" placeholder="Nouvelle catégorie..." maxlength="30">
          <button class="btn small" id="addCatBtn">+ Catégorie</button>
          ${['Armes blanches', 'Armes à feu', 'Drogues', 'Autre'].map((p) => `<div class="preset-chip" data-preset-cat="${escapeHtml(p)}">+ ${p}</div>`).join('')}
        </div>`;
    }

    if (!gang.categories.length) {
      html += `<div class="content-empty"><span class="big">Aucune catégorie</span>${canEdit() ? 'Ajoutez une catégorie ci-dessus pour commencer à lister des items.' : 'Ce gang n\'a pas encore de catégories.'}</div>`;
    } else {
      gang.categories.forEach((cat) => (html += renderCategoryBlock(gang, cat)));
    }

    html += `</div>`;
    content.innerHTML = html;
  }

  function renderCategoryBlock(gang, cat) {
    const color = catColor(cat.name);
    const items = sortItems(cat.items);
    let rows = !items.length
      ? `<tr><td colspan="4" class="empty-cat">Aucun item dans cette catégorie.</td></tr>`
      : items.map((it) => renderItemRow(gang, cat, it)).join('');

    return `<div class="category">
        <div class="category-header" style="--cat-color:${color}">
          <h3>${escapeHtml(cat.name)}</h3>
          <span class="category-count">${cat.items.length} item(s)</span>
          ${canEdit() ? `<button class="icon-btn" data-remove-cat="${gang.id}|${cat.id}" title="Supprimer cette catégorie">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>` : ''}
        </div>
        <table>
          <thead><tr><th>Nom</th><th>Description</th><th class="th-price">Prix</th>${canEdit() ? '<th class="th-actions">Actions</th>' : ''}</tr></thead>
          <tbody>
            ${rows}
            ${canEdit() ? `<tr class="add-item-row"><td colspan="4">
                <form class="add-item-form" data-add-item="${gang.id}|${cat.id}">
                  <input type="text" name="iname" placeholder="Nom de l'item" required maxlength="50">
                  <input type="text" name="idesc" placeholder="Description (facultatif)" maxlength="120">
                  <input type="number" name="iprice" placeholder="Prix" required min="0" step="1">
                  <button type="submit" class="btn small">+ Item</button>
                </form>
              </td></tr>` : ''}
          </tbody>
        </table>
      </div>`;
  }

  function renderItemRow(gang, cat, it) {
    if (canEdit() && editingItems.has(it.id)) {
      return `<tr><td colspan="4">
          <form class="add-item-form" data-edit-item="${gang.id}|${cat.id}|${it.id}">
            <input type="text" name="iname" value="${escapeHtml(it.name)}" required maxlength="50">
            <input type="text" name="idesc" value="${escapeHtml(it.description || '')}" placeholder="Description" maxlength="120">
            <input type="number" name="iprice" value="${it.price}" required min="0" step="1">
            <button type="submit" class="btn small">Enregistrer</button>
            <button type="button" class="btn ghost small" data-cancel-edit="${it.id}">Annuler</button>
          </form>
        </td></tr>`;
    }
    return `<tr>
        <td class="item-name">${escapeHtml(it.name)}</td>
        <td class="item-desc">${escapeHtml(it.description || '—')}</td>
        <td class="item-price">${fmtPrice(it.price)}</td>
        ${canEdit() ? `<td class="item-actions">
          <button class="icon-btn subtle" data-edit-item-btn="${it.id}" title="Modifier">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" data-remove-item="${gang.id}|${cat.id}|${it.id}" title="Supprimer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </td>` : ''}
      </tr>`;
  }

  function renderSearchResults(content) {
    let html = `<div class="fade-in"><div class="search-results-label">${searchResults.length} résultat(s) pour « ${escapeHtml(searchTerm)} »</div>`;
    if (!searchResults.length) {
      html += `<div class="content-empty"><span class="big">Aucun résultat</span>Essayez un autre terme de recherche.</div>`;
    } else {
      let lastKey = null;
      let buffer = [];
      const flush = () => {
        if (!buffer.length) return;
        html += `<div class="category"><table><tbody>${buffer.join('')}</tbody></table></div>`;
        buffer = [];
      };
      searchResults.forEach((r) => {
        const key = r.gang_id + '|' + r.category_id;
        if (key !== lastKey) {
          flush();
          html += `<div class="search-group-title">${escapeHtml(r.gang_name)} — ${escapeHtml(r.category_name)}</div>`;
          lastKey = key;
        }
        buffer.push(`<tr>
          <td class="item-name">${escapeHtml(r.item_name)}</td>
          <td class="item-desc">${escapeHtml(r.description || '—')}</td>
          <td class="item-price">${fmtPrice(r.price)}</td>
        </tr>`);
      });
      flush();
    }
    html += `</div>`;
    content.innerHTML = html;
  }

  // ================= EVENTS: sidebar / toolbar =================

  document.getElementById('addGangForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('newGangName');
    const name = input.value.trim();
    if (!name) return;
    try {
      await Api.post('/gangs', { name });
      input.value = '';
      // La mise a jour arrive aussi via socket, mais on rafraichit par securite
      await loadGangs();
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });

  let searchDebounce = null;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    clearTimeout(searchDebounce);
    if (!searchTerm.trim()) {
      searchResults = [];
      renderContent();
      return;
    }
    searchDebounce = setTimeout(async () => {
      try {
        searchResults = await Api.get(`/search?q=${encodeURIComponent(searchTerm.trim())}`);
      } catch (err) {
        searchResults = [];
      }
      renderContent();
    }, 250);
  });

  document.getElementById('sortSelect').addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderContent();
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      const data = await Api.get('/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gangs-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ================= EVENTS: delegated clicks =================

  document.body.addEventListener('click', async (e) => {
    const gangCard = e.target.closest('[data-gang]');
    const removeGangBtn = e.target.closest('[data-remove-gang]');
    const removeCatBtn = e.target.closest('[data-remove-cat]');
    const removeItemBtn = e.target.closest('[data-remove-item]');
    const editItemBtn = e.target.closest('[data-edit-item-btn]');
    const cancelEditBtn = e.target.closest('[data-cancel-edit]');
    const presetCat = e.target.closest('[data-preset-cat]');
    const addCatBtn = e.target.closest('#addCatBtn');

    try {
      if (removeGangBtn) {
        e.stopPropagation();
        const id = removeGangBtn.getAttribute('data-remove-gang');
        const g = getGang(id);
        if (g && confirm(`Supprimer le gang « ${g.name} » et tous ses items ?`)) {
          await Api.del(`/gangs/${id}`);
          await loadGangs();
          render();
        }
        return;
      }

      if (gangCard) {
        selectedGangId = gangCard.getAttribute('data-gang');
        searchTerm = '';
        document.getElementById('searchInput').value = '';
        render();
        return;
      }

      if (removeCatBtn) {
        const [gangId, catId] = removeCatBtn.getAttribute('data-remove-cat').split('|');
        const g = getGang(gangId);
        const c = g && g.categories.find((x) => x.id === catId);
        if (c && confirm(`Supprimer la catégorie « ${c.name} » et ses items ?`)) {
          await Api.del(`/gangs/${gangId}/categories/${catId}`);
          await loadGangs();
          render();
        }
        return;
      }

      if (removeItemBtn) {
        const [gangId, catId, itemId] = removeItemBtn.getAttribute('data-remove-item').split('|');
        await Api.del(`/gangs/${gangId}/categories/${catId}/items/${itemId}`);
        await loadGangs();
        render();
        return;
      }

      if (editItemBtn) {
        editingItems.add(editItemBtn.getAttribute('data-edit-item-btn'));
        renderContent();
        return;
      }

      if (cancelEditBtn) {
        editingItems.delete(cancelEditBtn.getAttribute('data-cancel-edit'));
        renderContent();
        return;
      }

      if (presetCat) {
        if (!selectedGangId) return;
        const name = presetCat.getAttribute('data-preset-cat');
        await Api.post(`/gangs/${selectedGangId}/categories`, { name });
        await loadGangs();
        render();
        return;
      }

      if (addCatBtn) {
        if (!selectedGangId) return;
        const input = document.getElementById('newCatName');
        const name = input.value.trim();
        if (!name) return;
        await Api.post(`/gangs/${selectedGangId}/categories`, { name });
        input.value = '';
        await loadGangs();
        render();
        return;
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ================= EVENTS: delegated submits (items) =================

  document.body.addEventListener('submit', async (e) => {
    const addForm = e.target.closest('[data-add-item]');
    const editForm = e.target.closest('[data-edit-item]');

    try {
      if (addForm) {
        e.preventDefault();
        const [gangId, catId] = addForm.getAttribute('data-add-item').split('|');
        const fd = new FormData(addForm);
        const name = (fd.get('iname') || '').toString().trim();
        const description = (fd.get('idesc') || '').toString().trim();
        const price = Number(fd.get('iprice'));
        if (!name || isNaN(price)) return;
        await Api.post(`/gangs/${gangId}/categories/${catId}/items`, { name, price, description });
        await loadGangs();
        render();
        return;
      }

      if (editForm) {
        e.preventDefault();
        const [gangId, catId, itemId] = editForm.getAttribute('data-edit-item').split('|');
        const fd = new FormData(editForm);
        const name = (fd.get('iname') || '').toString().trim();
        const description = (fd.get('idesc') || '').toString().trim();
        const price = Number(fd.get('iprice'));
        if (!name || isNaN(price)) return;
        await Api.put(`/gangs/${gangId}/categories/${catId}/items/${itemId}`, { name, price, description });
        editingItems.delete(itemId);
        await loadGangs();
        render();
        return;
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ================= AUDIT LOG MODAL =================

  document.getElementById('auditBtn').addEventListener('click', async () => {
    document.getElementById('auditModal').style.display = 'flex';
    const body = document.getElementById('auditBody');
    body.innerHTML = '<p style="color:var(--subtext);font-size:13px;">Chargement...</p>';
    try {
      const logs = await Api.get('/audit-log?limit=200');
      if (!logs.length) {
        body.innerHTML = '<p style="color:var(--subtext);font-size:13px;">Aucune activité enregistrée pour le moment.</p>';
        return;
      }
      const actionLabels = { create: 'a créé', update: 'a modifié', delete: 'a supprimé', login: "s'est connecté" };
      const entityLabels = { gang: 'le gang', category: 'la catégorie', item: "l'item", user: "l'utilisateur", auth: '' };
      body.innerHTML = logs
        .map(
          (l) => `<div class="audit-row">
            <span class="when">${fmtDate(l.created_at)}</span>
            <span class="who">${escapeHtml(l.username)}</span>
            <span class="what"> ${actionLabels[l.action] || l.action} ${entityLabels[l.entity_type] || l.entity_type} <b>${escapeHtml(l.entity_label || '')}</b></span>
          </div>`
        )
        .join('');
    } catch (err) {
      body.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(err.message)}</p>`;
    }
  });
  document.getElementById('closeAuditModal').addEventListener('click', () => {
    document.getElementById('auditModal').style.display = 'none';
  });

  // ================= USERS MODAL (admin) =================

  document.getElementById('usersBtn').addEventListener('click', async () => {
    document.getElementById('usersModal').style.display = 'flex';
    await loadUsersList();
  });
  document.getElementById('closeUsersModal').addEventListener('click', () => {
    document.getElementById('usersModal').style.display = 'none';
  });

  async function loadUsersList() {
    const body = document.getElementById('usersListBody');
    body.innerHTML = '<p style="color:var(--subtext);font-size:13px;">Chargement...</p>';
    try {
      const users = await Api.get('/auth/users');
      body.innerHTML = users
        .map(
          (u) => `<div class="user-row">
          <span class="uname">${escapeHtml(u.username)}</span>
          <select data-user-role="${u.id}" ${u.id === currentUser.id ? 'disabled' : ''}>
            <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
            <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
          ${u.id === currentUser.id ? '' : `<button class="icon-btn" data-remove-user="${u.id}" title="Supprimer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>`}
        </div>`
        )
        .join('');
    } catch (err) {
      body.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(err.message)}</p>`;
    }
  }

  document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;
    try {
      await Api.post('/auth/users', { username, password, role });
      document.getElementById('newUsername').value = '';
      document.getElementById('newUserPassword').value = '';
      toast(`Utilisateur "${username}" créé.`);
      await loadUsersList();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('usersListBody').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-user-role]');
    if (!sel) return;
    const id = sel.getAttribute('data-user-role');
    try {
      await Api.put(`/auth/users/${id}`, { role: sel.value });
      toast('Rôle mis à jour.');
    } catch (err) {
      toast(err.message, true);
      await loadUsersList();
    }
  });

  document.getElementById('usersListBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove-user]');
    if (!btn) return;
    const id = btn.getAttribute('data-remove-user');
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try {
      await Api.del(`/auth/users/${id}`);
      await loadUsersList();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ================= INIT =================
  tryAutoLogin();
})();
