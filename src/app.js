/**
 * app.js — Projektverwaltung Browser-App
 * Portiert aus Vorlagesoftware/public/app.js
 * 
 * Änderungen:
 * - api() fetch-Funktion entfernt → direkte db.*() Calls
 * - exportPdf() → downloadPdf() aus pdf.js
 * - uploadLogo() → base64 in IndexedDB statt Datei-Upload
 * - Logo-Anzeige aus settings.logo_data statt /uploads/ URL
 * - Notion-Integration komplett entfernt
 * - Alle anderen UI-Funktionen 1:1 beibehalten
 */

import {
  getSettings, saveSettings as dbSaveSettings,
  getProjects, createProject, getProject, updateProject, deleteProject as dbDeleteProject,
  getProjectDocuments, createDocument, getDocument, updateDocument, deleteDocument,
  newDocumentVersion, convertDocument, getNextDocNumber
} from './db.js';
import { downloadPdf } from './pdf.js';

// ── State ─────────────────────────────────────────────────────────────
let currentProject = null;
let currentTab = 'angebot';
let settings = {};
let isDirty = false;

const TYPE_LABELS = {
  angebot: 'Offerte',
  auftragsbestaetigung: 'Auftragsbestätigung',
  lieferschein: 'Lieferschein',
  rechnung: 'Rechnung'
};
const TYPE_ICONS = {
  angebot: '◈', auftragsbestaetigung: '◉', lieferschein: '◎', rechnung: '◆'
};
const TYPE_SHORT = { angebot: 'OFF', auftragsbestaetigung: 'AB', lieferschein: 'LS', rechnung: 'RE' };
const CONVERT_MAP = {
  angebot: ['auftragsbestaetigung', 'rechnung'],
  auftragsbestaetigung: ['lieferschein', 'rechnung'],
  lieferschein: [], rechnung: []
};

// ── Navigation ───────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const el = document.getElementById(`view-${name}`);
  if (el) { el.classList.remove('hidden'); el.scrollTop = 0; }
}

function navigate(view) {
  if (view === 'projects') {
    currentProject = null;
    setBreadcrumb([]);
    loadProjectList();
    showView('projects');
  } else if (view === 'settings') {
    loadSettingsView();
    setBreadcrumb([{ label: 'Einstellungen' }]);
    showView('settings');
  }
}

function setBreadcrumb(parts) {
  const el = document.getElementById('breadcrumb');
  if (!parts || parts.length === 0) { el.innerHTML = ''; return; }
  const html = [];
  parts.forEach((p, i) => {
    if (p.onclick) html.push(`<span class="bc-link" onclick="${p.onclick}">${p.label}</span>`);
    else html.push(`<span class="bc-current">${p.label}</span>`);
    if (i < parts.length - 1) html.push(`<span class="bc-sep">›</span>`);
  });
  el.innerHTML = html.join('');
}

// ── Init ─────────────────────────────────────────────────────────────
async function init() {
  try {
    settings = await getSettings();
    updateTopbarLogo();
    navigate('projects');
  } catch (err) {
    console.error('Init error:', err);
    toast('Fehler beim Laden: ' + err.message, 'error');
  }
}

function updateTopbarLogo() {
  const el = document.getElementById('logoDisplay');
  if (settings.logo_data) {
    el.innerHTML = `<img src="${settings.logo_data}" alt="${settings.firma_name || ''}" style="max-height:28px;max-width:110px;object-fit:contain;vertical-align:middle;">`;
  } else {
    el.textContent = settings.firma_name || 'Projektverwaltung';
    el.style.fontWeight = '700';
    el.style.fontSize = '14px';
  }
}

// ── PROJECT LIST ─────────────────────────────────────────────────────
let allProjects = [];

async function loadProjectList() {
  allProjects = await getProjects();
  renderProjectGrid(allProjects);
}

function renderProjectGrid(projects) {
  const grid = document.getElementById('projectGrid');
  const countEl = document.getElementById('projectCount');
  countEl.textContent = `${projects.length} Projekt${projects.length !== 1 ? 'e' : ''}`;

  if (projects.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">◈</div>
        <p>Noch keine Projekte vorhanden.</p>
        <button class="btn-primary" onclick="showProjectModal()">Erstes Projekt erstellen</button>
      </div>`;
    return;
  }

  grid.innerHTML = projects.map(p => {
    const pills = Object.entries(TYPE_LABELS).map(([type, label]) => {
      const has = !!(p._docStatus?.[type]);
      return `<span class="pill ${has ? 'pill-active' : 'pill-inactive'}">${TYPE_SHORT[type]}</span>`;
    }).join('');
    const addrParts = [p.customer_plz, p.customer_ort].filter(Boolean).join(' ');
    return `
      <div class="project-card" onclick="openProject(${p.id})">
        <div class="pc-top">
          <div class="pc-name">${esc(p.name)}</div>
        </div>
        ${p.customer_company ? `<div class="pc-company">${esc(p.customer_company)}${p.customer_name ? ' · ' + esc(p.customer_name) : ''}</div>` : ''}
        <div class="pc-pills">${pills}</div>
        <div class="pc-foot">
          <span>${formatDate(p.created_at)}</span>
          <span>${esc(addrParts || p.customer_land || '')}</span>
        </div>
      </div>`;
  }).join('');
}

function filterProjects(q) {
  if (!q) { renderProjectGrid(allProjects); return; }
  const lq = q.toLowerCase();
  renderProjectGrid(allProjects.filter(p =>
    p.name.toLowerCase().includes(lq) ||
    (p.customer_company || '').toLowerCase().includes(lq) ||
    (p.customer_name || '').toLowerCase().includes(lq)
  ));
}

// ── PROJECT MODAL ─────────────────────────────────────────────────────
function showProjectModal() {
  document.getElementById('modal-name').value = '';
  document.getElementById('modal-desc').value = '';
  document.getElementById('modal-contact').value = '';
  document.getElementById('modal-editId').value = '';
  document.getElementById('modalTitle').textContent = 'Neues Projekt';
  document.getElementById('modalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-name').focus(), 50);
}

async function saveNewProject() {
  const name = document.getElementById('modal-name').value.trim();
  if (!name) { toast('Name erforderlich', 'error'); return; }
  const body = {
    name,
    description: document.getElementById('modal-desc').value,
    contact_person: document.getElementById('modal-contact').value
  };
  const proj = await createProject(body);
  closeAllModals();
  await openProject(proj.id);
}

// ── PROJECT DETAIL ────────────────────────────────────────────────────
async function openProject(id) {
  currentProject = await getProject(id);
  setBreadcrumb([
    { label: 'Projekte', onclick: "navigate('projects')" },
    { label: currentProject.name }
  ]);
  fillProjectSidebar();
  await loadDocTab(currentTab);
  await updateTabBadges();
  showView('project');
}

function fillProjectSidebar() {
  const p = currentProject;
  document.getElementById('pf-name').value = p.name || '';
  document.getElementById('pf-description').value = p.description || '';
  document.getElementById('pf-contact').value = p.contact_person || '';
  document.getElementById('pf-customerNumber').value = p.customer_number || '';
  document.getElementById('pf-company').value = p.customer_company || '';
  document.getElementById('pf-clientContact').value = p.customer_name || '';
  document.getElementById('pf-address').value = p.customer_address || '';
  document.getElementById('pf-plz').value = p.customer_plz || '';
  document.getElementById('pf-ort').value = p.customer_ort || '';
  document.getElementById('pf-land').value = p.customer_land || 'Schweiz';
  isDirty = false;
  hideSaveButtons();
}

function dirtyProject() {
  isDirty = true;
  document.getElementById('btnSaveProject').style.display = 'block';
  document.getElementById('btnSaveClient').style.display = 'block';
}

function hideSaveButtons() {
  document.getElementById('btnSaveProject').style.display = 'none';
  document.getElementById('btnSaveClient').style.display = 'none';
}

async function saveProjectSidebar() {
  const body = {
    name: document.getElementById('pf-name').value,
    description: document.getElementById('pf-description').value,
    contact_person: document.getElementById('pf-contact').value,
    customer_number: document.getElementById('pf-customerNumber').value,
    customer_company: document.getElementById('pf-company').value,
    customer_name: document.getElementById('pf-clientContact').value,
    customer_address: document.getElementById('pf-address').value,
    customer_plz: document.getElementById('pf-plz').value,
    customer_ort: document.getElementById('pf-ort').value,
    customer_land: document.getElementById('pf-land').value
  };
  currentProject = await updateProject(currentProject.id, body);
  setBreadcrumb([
    { label: 'Projekte', onclick: "navigate('projects')" },
    { label: currentProject.name }
  ]);
  isDirty = false;
  hideSaveButtons();
  toast('Projekt gespeichert', 'success');
}

async function deleteProjectAction() {
  if (!confirm('Projekt und alle Dokumente löschen?')) return;
  await dbDeleteProject(currentProject.id);
  navigate('projects');
  toast('Projekt gelöscht');
}

// ── TAB MANAGEMENT ────────────────────────────────────────────────────
async function switchTab(type) {
  currentTab = type;
  document.querySelectorAll('.doc-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.type === type);
  });
  await loadDocTab(type);
}

async function updateTabBadges() {
  const docs = await getProjectDocuments(currentProject.id);
  const docMap = {};
  docs.forEach(d => {
    if (!docMap[d.type] || d.version > docMap[d.type].version) docMap[d.type] = d;
  });
  Object.keys(TYPE_LABELS).forEach(type => {
    const badge = document.getElementById(`badge-${type}`);
    if (!badge) return;
    const d = docMap[type];
    if (d) {
      badge.textContent = `${d.base_number}-${String(d.version).padStart(2,'0')}`;
    } else {
      badge.textContent = '';
    }
  });
}

async function loadDocTab(type) {
  const panel = document.getElementById('docPanel');
  const docs = await getProjectDocuments(currentProject.id);
  const ofType = docs.filter(d => d.type === type);
  if (ofType.length === 0) {
    renderEmptyDoc(type, panel);
    return;
  }
  const latest = ofType.reduce((a, b) => b.version > a.version ? b : a);
  const data = await getDocument(latest.id);
  renderDocEditor(data, panel);
}

// ── DOC EDITOR RENDER ─────────────────────────────────────────────────
function renderEmptyDoc(type, panel) {
  const prevTypes = ['angebot', 'auftragsbestaetigung', 'lieferschein', 'rechnung'];
  const prevType = prevTypes[prevTypes.indexOf(type) - 1];
  const canGen = type === 'angebot' || prevType;
  panel.innerHTML = `
    <div class="doc-empty">
      <div class="doc-empty-icon">&#9633;</div>
      <p>Kein ${TYPE_LABELS[type]} vorhanden.</p>
      ${canGen ? `<button class="btn-primary" onclick="createDocumentAction('${type}')">
        ${prevType ? `${TYPE_LABELS[type]} aus ${TYPE_LABELS[prevType]} erstellen` : `${TYPE_LABELS[type]} erstellen`}
      </button>` : ''}
    </div>`;
}

function renderDocEditor(data, panel) {
  const isLS = data.type === 'lieferschein';
  const numStr = `${data.base_number}-${String(data.version).padStart(2,'0')}`;
  const versions = data.versions || [];
  const convertOptions = CONVERT_MAP[data.type] || [];

  let versionBar = '';
  if (versions.length > 0) {
    const chips = versions.map((v, i) =>
      `<span class="version-chip">v${i} · ${formatDate(v.date)} · ${v.base_number}-${String(v.version).padStart(2,'0')}</span>`
    ).join('');
    versionBar = `<div class="version-bar"><span class="version-bar-lbl">VERSIONEN</span>${chips}</div>`;
  }

  const vatOptions = [0, 8.1, 2.6].map(r =>
    `<option value="${r}" ${parseFloat(data.vat_rate) === r ? 'selected' : ''}>${r === 0 ? '0% (ohne MWST)' : r + '%'}</option>`
  ).join('');

  const posRows = (data.positions || []).map(p => renderPosRow(p, isLS)).join('');
  const totalsHtml = isLS ? '' : renderTotalsHtml(data.positions, data.vat_rate, data.vat_included !== false);

  const convertBtns = convertOptions.map(t =>
    `<button class="btn-secondary" onclick="convertDocumentAction('${t}', ${data.id})">→ ${TYPE_LABELS[t]}</button>`
  ).join('');

  const verOptions = versions.map((v, i) =>
    `<option value="${v.id}" ${v.id === data.id ? 'selected' : ''}>v${i} – ${formatDate(v.date)}</option>`
  ).join('');
  const verSelect = versions.length > 1
    ? `<select class="version-select" onchange="loadVersionById(this.value)">${verOptions}</select>`
    : '';

  panel.innerHTML = `
    <div id="docEditorContent" data-docid="${data.id}" data-type="${data.type}">
      ${versionBar}
      <div class="doc-meta">
        <div class="form-group">
          <label class="field-label">Dokument-Nr.</label>
          <input class="field-input" id="de-number" value="${esc(numStr)}" readonly style="background:#fafafa;color:var(--sub);font-family:monospace">
        </div>
        <div class="form-group">
          <label class="field-label">Datum</label>
          <input type="date" class="field-input" id="de-date" value="${data.date || ''}">
        </div>
      </div>
      ${(data.type === 'angebot' || data.type === 'rechnung') ? `
      <div class="doc-meta">
        <div class="form-group" style="grid-column:1/-1">
          <label class="field-label">Lieferdatum</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="field-input" id="de-delivery-mode" style="width:auto;min-width:180px"
              onchange="(function(s){
                const dp=document.getElementById('de-delivery-date');
                dp.style.display=s.value==='datum'?'block':'none';
                if(s.value!=='datum') dp.value='';
              })(this)">
              <option value="gemass_absprache" ${(!data.delivery_date||data.delivery_date==='gemass_absprache')?'selected':''}>gemäss Absprache</option>
              <option value="freibleibend" ${data.delivery_date==='freibleibend'?'selected':''}>freibleibend</option>
              <option value="datum" ${(data.delivery_date&&data.delivery_date!=='gemass_absprache'&&data.delivery_date!=='freibleibend')?'selected':''}>Datum wählen</option>
            </select>
            <input type="date" class="field-input" id="de-delivery-date" style="width:auto;display:${(data.delivery_date&&data.delivery_date!=='gemass_absprache'&&data.delivery_date!=='freibleibend')?'block':'none'}"
              value="${(data.delivery_date&&data.delivery_date!=='gemass_absprache'&&data.delivery_date!=='freibleibend')?data.delivery_date:''}">
          </div>
        </div>
      </div>` : ''}
      <div class="doc-meta">
        ${data.type === 'auftragsbestaetigung' ? `
        <div class="form-group">
          <label class="field-label">Referenz (Bestellung vom)</label>
          <input type="text" class="field-input" id="de-reference" value="${esc(data.reference)}" placeholder="z.B. 30.11.2025">
        </div>` : ''}
        <div class="form-group" ${data.type !== 'auftragsbestaetigung' ? 'style="grid-column:1/-1"' : ''}>
          <label class="field-label">MWST</label>
          <select class="field-input" id="de-vat" onchange="recalcTotals()" ${isLS ? 'disabled' : ''}>${vatOptions}</select>
        </div>
      </div>

      <!-- Positions -->
      <div class="form-group">
        <label class="field-label">Positionen</label>
        <div class="pos-table-wrap">
          <table class="pos-table" id="posTable">
            <thead>
              <tr>
                <th style="width:45px">Pos.</th>
                <th>Bezeichnung</th>
                <th class="right" style="width:70px">Menge</th>
                <th style="width:75px">Einheit</th>
                ${!isLS ? '<th class="right" style="width:105px">Einz.-Preis CHF</th>' : ''}
                ${!isLS ? '<th class="right" style="width:105px">Gesamt CHF</th>' : ''}
                <th style="width:32px"></th>
              </tr>
            </thead>
            <tbody id="posBody">${posRows}</tbody>
          </table>
        </div>
        <button class="btn-add-pos" onclick="addPosRow(${isLS})">+ Position hinzufügen</button>
      </div>

      ${totalsHtml}

      <div class="form-group" style="margin-top:14px">
        <label class="field-label">Zahlungsbedingungen</label>
        <textarea class="field-input" id="de-payment" rows="2">${esc(data.payment_terms)}</textarea>
      </div>
      <div class="form-group">
        <label class="field-label">Notizen / Zusatztext</label>
        <textarea class="field-input" id="de-notes" rows="3">${esc(data.notes)}</textarea>
      </div>

      <div class="doc-actions">
        <button class="btn-pdf" onclick="exportPdf(${data.id})">PDF exportieren</button>
        <button class="btn-primary" onclick="saveDoc(${data.id})">Speichern</button>
        <button class="btn-secondary" onclick="saveNewVersion(${data.id})">Neue Version</button>
        ${convertBtns}
        ${verSelect}
        <div class="doc-actions-right">
          <button class="btn-secondary" style="color:#ef4444;border-color:#fecaca" onclick="deleteDoc(${data.id}, '${data.type}')">Löschen</button>
        </div>
      </div>
    </div>`;
}

const EINHEIT_OPTIONS = ['h','Stk','Tag','Woche','Monat','Pauschal','m','m²','m³','kg','l','%'];
function einheitSelect(val) {
  return `<select class="cell-input cell-einheit">${EINHEIT_OPTIONS.map(u =>
    `<option value="${u}" ${(val||'h')===u?'selected':''}>${u}</option>`).join('')}</select>`;
}

function renderPosRow(p, isLS) {
  const total = (parseFloat(p.menge) || 0) * (parseFloat(p.einzelpreis) || 0);
  const totalStyle = total < 0 ? 'color:#ef4444' : '';
  const colCount = isLS ? 4 : 6;
  return `<tr class="pos-main-row">
    <td><input class="cell-input" style="width:38px;text-align:center" value="${p.pos_nr || ''}" readonly></td>
    <td><input class="cell-input" style="min-width:160px" placeholder="Bezeichnung…" value="${esc(p.bezeichnung)}" oninput=""></td>
    <td><input class="cell-input right" type="number" step="0.01" style="width:60px" value="${p.menge ?? ''}" oninput="calcRow(this)"></td>
    <td>${einheitSelect(p.einheit)}</td>
    ${!isLS ? `<td><input class="cell-input right" type="number" step="0.01" style="width:90px" value="${p.einzelpreis ?? ''}" oninput="calcRow(this)"></td>` : ''}
    ${!isLS ? `<td class="cell-total" style="${totalStyle}">${fmtCHF(p.gesamtpreis)}</td>` : ''}
    <td class="cell-del"><button class="btn-del" onclick="delRow(this)">×</button></td>
  </tr>
  <tr class="pos-desc-row">
    <td></td>
    <td colspan="${colCount - 1}" style="padding-bottom:6px">
      <textarea class="cell-desc" placeholder="Beschreibung / Details (optional, mehrzeilig)…" rows="1" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'">${esc(p.beschreibung || '')}</textarea>
    </td>
  </tr>`;
}

function renderTotalsHtml(positions, vatRate, vatIncluded) {
  const sub = (positions || []).reduce((s, p) => s + (parseFloat(p.gesamtpreis) || 0), 0);
  const vr = parseFloat(vatRate) || 0;
  const vat = vatIncluded ? sub * (vr / 100) : 0;
  const total = sub + vat;
  return `
    <div class="totals-wrap">
      <div class="totals-box">
        <div class="tot-row"><span>Summe Positionen</span><span class="tot-val" id="summe-display">CHF ${fmtCHF(sub)}</span></div>
        <div class="tot-vat">
          <label class="vat-label">
            <input type="checkbox" id="de-vatIncluded" ${vatIncluded !== false ? 'checked' : ''} onchange="recalcTotals()">
            MwSt ${vr}%
          </label>
          <span class="tot-val" id="vat-display">${vatIncluded !== false ? 'CHF ' + fmtCHF(vat) : '—'}</span>
        </div>
        <div class="tot-final"><span>Rechnungsbetrag</span><span class="tot-final-val" id="total-display">CHF ${fmtCHF(total)}</span></div>
      </div>
    </div>`;
}

// ── POSITIONS ─────────────────────────────────────────────────────────
function addPosRow(isLS) {
  const tbody = document.getElementById('posBody');
  const posNr = tbody.querySelectorAll('tr.pos-main-row').length + 1;
  const colCount = isLS ? 4 : 6;
  const tr = document.createElement('tbody');
  tr.innerHTML = `
    <tr class="pos-main-row">
      <td><input class="cell-input" style="width:38px;text-align:center" value="${posNr}" readonly></td>
      <td><input class="cell-input" style="min-width:160px" placeholder="Bezeichnung…" value=""></td>
      <td><input class="cell-input right" type="number" step="0.01" style="width:60px" value="" oninput="calcRow(this)"></td>
      <td>${einheitSelect('')}</td>
      ${!isLS ? `<td><input class="cell-input right" type="number" step="0.01" style="width:90px" value="" oninput="calcRow(this)"></td>` : ''}
      ${!isLS ? `<td class="cell-total">—</td>` : ''}
      <td class="cell-del"><button class="btn-del" onclick="delRow(this)">×</button></td>
    </tr>
    <tr class="pos-desc-row">
      <td></td>
      <td colspan="${colCount - 1}" style="padding-bottom:6px">
        <textarea class="cell-desc" placeholder="Beschreibung / Details (optional, mehrzeilig)…" rows="1" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
      </td>
    </tr>`;
  Array.from(tr.children).forEach(row => tbody.appendChild(row));
}

function calcRow(input) {
  const tr = input.closest('tr');
  const numInputs = tr.querySelectorAll('input[type="number"]');
  const menge = parseFloat(numInputs[0]?.value) || 0;
  const einzelpreis = parseFloat(numInputs[1]?.value) || 0;
  const total = menge * einzelpreis;
  const cell = tr.querySelector('.cell-total');
  if (cell) {
    cell.textContent = fmtCHF(total);
    cell.style.color = total < 0 ? '#ef4444' : '';
  }
  recalcTotals();
}

function delRow(btn) {
  const mainRow = btn.closest('tr.pos-main-row');
  const descRow = mainRow?.nextElementSibling;
  if (descRow?.classList.contains('pos-desc-row')) descRow.remove();
  mainRow?.remove();
  renumberRows();
  recalcTotals();
}

function renumberRows() {
  document.querySelectorAll('#posBody tr.pos-main-row').forEach((tr, i) => {
    tr.querySelector('input').value = i + 1;
  });
}

function recalcTotals() {
  const rows = document.querySelectorAll('#posBody tr.pos-main-row');
  let sub = 0;
  rows.forEach(tr => {
    // Use type="number" inputs to reliably get menge and einzelpreis
    // (avoids confusion with the Einheit select between them)
    const numInputs = tr.querySelectorAll('input[type="number"]');
    const menge = parseFloat(numInputs[0]?.value) || 0;
    const preis = parseFloat(numInputs[1]?.value) || 0;
    sub += menge * preis;
    const cell = tr.querySelector('.cell-total');
    if (cell) { cell.textContent = fmtCHF(menge * preis); cell.style.color = menge * preis < 0 ? '#ef4444' : ''; }
  });
  const vatIncluded = document.getElementById('de-vatIncluded')?.checked !== false;
  const vr = parseFloat(document.getElementById('de-vat')?.value) || 0;
  const vat = vatIncluded ? sub * (vr / 100) : 0;
  const total = sub + vat;
  const summeDisp = document.getElementById('summe-display');
  const vatDisp = document.getElementById('vat-display');
  const totDisp = document.getElementById('total-display');
  if (summeDisp) summeDisp.textContent = 'CHF ' + fmtCHF(sub);
  if (vatDisp) vatDisp.textContent = vatIncluded ? 'CHF ' + fmtCHF(vat) : '—';
  if (totDisp) totDisp.textContent = 'CHF ' + fmtCHF(total);
}

function getPositions(isLS) {
  const mainRows = document.querySelectorAll('#posBody tr.pos-main-row');
  return Array.from(mainRows).map((tr, i) => {
    const descRow = tr.nextElementSibling;
    const allInputs = tr.querySelectorAll('input');
    const numInputs = tr.querySelectorAll('input[type="number"]');
    const select = tr.querySelector('select.cell-einheit');
    // allInputs[0]=pos_nr(readonly), allInputs[1]=bezeichnung(text), then number inputs
    const bezeichnungInput = tr.querySelector('input:not([type="number"])');
    const menge = parseFloat(numInputs[0]?.value) || null;
    const einzelpreis = isLS ? null : (parseFloat(numInputs[1]?.value) ?? null);
    const beschreibung = descRow?.querySelector('textarea')?.value?.trim() || null;
    return {
      pos_nr: i + 1,
      bezeichnung: allInputs[1]?.value || '',
      beschreibung,
      menge,
      einheit: select?.value || 'h',
      einzelpreis,
      gesamtpreis: isLS ? 0 : ((menge || 0) * (einzelpreis || 0))
    };
  });
}

// ── DOCUMENT ACTIONS ──────────────────────────────────────────────────
async function createDocumentAction(type) {
  const typeOrder = ['angebot', 'auftragsbestaetigung', 'lieferschein', 'rechnung'];
  const idx = typeOrder.indexOf(type);
  let fromDocId = null;
  const docs = await getProjectDocuments(currentProject.id);
  for (let i = idx - 1; i >= 0; i--) {
    const prev = docs.filter(d => d.type === typeOrder[i]);
    if (prev.length > 0) {
      fromDocId = prev.reduce((a, b) => b.version > a.version ? b : a).id;
      break;
    }
  }
  let doc;
  if (fromDocId) {
    doc = await convertDocument(fromDocId, type);
  } else {
    doc = await createDocument(currentProject.id, {
      type, date: new Date().toISOString().slice(0, 10), vat_rate: 8.1
    });
  }
  currentTab = type;
  await switchTab(type);
  await updateTabBadges();
  toast(`${TYPE_LABELS[type]} erstellt`, 'success');
}

async function convertDocumentAction(type, fromId) {
  const doc = await convertDocument(fromId, type);
  currentTab = type;
  await switchTab(type);
  await updateTabBadges();
  toast(`${TYPE_LABELS[type]} erstellt`, 'success');
}

async function saveDoc(id) {
  const type = document.querySelector('#docEditorContent')?.dataset.type;
  const isLS = type === 'lieferschein';
  const deliveryMode = document.getElementById('de-delivery-mode')?.value;
  const deliveryDate = deliveryMode === 'datum'
    ? (document.getElementById('de-delivery-date')?.value || 'gemass_absprache')
    : (deliveryMode || 'gemass_absprache');
  const body = {
    date: document.getElementById('de-date')?.value,
    reference: document.getElementById('de-reference')?.value || null,
    notes: document.getElementById('de-notes')?.value,
    payment_terms: document.getElementById('de-payment')?.value,
    vat_rate: parseFloat(document.getElementById('de-vat')?.value) || 0,
    vat_included: document.getElementById('de-vatIncluded')?.checked !== false,
    delivery_date: deliveryDate,
    positions: getPositions(isLS)
  };
  await updateDocument(id, body);
  await updateTabBadges();
  toast('Gespeichert', 'success');
}

async function saveNewVersion(id) {
  await saveDoc(id);
  const newDoc = await newDocumentVersion(id);
  const data = await getDocument(newDoc.id);
  renderDocEditor(data, document.getElementById('docPanel'));
  await updateTabBadges();
  toast('Neue Version erstellt', 'success');
}

async function loadVersionById(id) {
  const data = await getDocument(Number(id));
  renderDocEditor(data, document.getElementById('docPanel'));
}

async function deleteDoc(id, type) {
  if (!confirm(`${TYPE_LABELS[type]} wirklich löschen?`)) return;
  await deleteDocument(id);
  renderEmptyDoc(type, document.getElementById('docPanel'));
  await updateTabBadges();
  toast('Dokument gelöscht');
}

async function exportPdf(id) {
  // Zuerst speichern
  await saveDoc(id);
  toast('PDF wird generiert…', 'success');
  try {
    const data = await getDocument(id);
    const s = await getSettings();
    await downloadPdf({
      doc: data,
      project: data.project,
      positions: data.positions,
      settings: s
    });
  } catch (err) {
    console.error('PDF error:', err);
    toast('PDF-Fehler: ' + err.message, 'error');
  }
}

// ── SETTINGS ──────────────────────────────────────────────────────────
async function loadSettingsView() {
  settings = await getSettings();
  const keys = ['firma_name','firma_titel','firma_adresse','firma_plz','firma_ort','firma_land',
    'firma_uid','firma_email','firma_telefon','firma_website','firma_iban','firma_bank',
    'next_doc_number'];
  keys.forEach(k => {
    const el = document.getElementById(`s-${k}`);
    if (el) el.value = settings[k] || '';
  });
  if (settings.logo_data) {
    document.getElementById('logoPreview').src = settings.logo_data;
    document.getElementById('logoPreview').style.display = 'block';
    document.getElementById('logoPlaceholder').style.display = 'none';
  } else {
    document.getElementById('logoPreview').style.display = 'none';
    document.getElementById('logoPlaceholder').style.display = 'flex';
  }
}

async function saveSettingsAction() {
  const keys = ['firma_name','firma_titel','firma_adresse','firma_plz','firma_ort','firma_land',
    'firma_uid','firma_email','firma_telefon','firma_website','firma_iban','firma_bank',
    'next_doc_number'];
  const body = {};
  keys.forEach(k => { const el = document.getElementById(`s-${k}`); if (el) body[k] = el.value; });
  await dbSaveSettings(body);
  settings = await getSettings();
  updateTopbarLogo();
  toast('Einstellungen gespeichert', 'success');
}

async function uploadLogo(input) {
  if (!input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    await dbSaveSettings({ logo_data: dataUrl });
    settings.logo_data = dataUrl;
    document.getElementById('logoPreview').src = dataUrl;
    document.getElementById('logoPreview').style.display = 'block';
    document.getElementById('logoPlaceholder').style.display = 'none';
    updateTopbarLogo();
    toast('Logo hochgeladen', 'success');
  };
  reader.readAsDataURL(file);
}

// ── UTILS ─────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  void el.offsetWidth;
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtCHF(n) {
  return (parseFloat(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeAllModals();
}
function closeAllModals() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
document.getElementById('brandLink').addEventListener('click', () => navigate('projects'));

// ── Global expose (für onclick="..." in HTML — da Vite-Module nicht global sind) ──
window.navigate = navigate;
window.showProjectModal = showProjectModal;
window.saveNewProject = saveNewProject;
window.openProject = openProject;
window.dirtyProject = dirtyProject;
window.saveProjectSidebar = saveProjectSidebar;
window.deleteProject = deleteProjectAction;
window.switchTab = switchTab;
window.createDocumentAction = createDocumentAction;
window.convertDocumentAction = convertDocumentAction;
window.saveDoc = saveDoc;
window.saveNewVersion = saveNewVersion;
window.loadVersionById = loadVersionById;
window.deleteDoc = deleteDoc;
window.exportPdf = exportPdf;
window.saveSettings = saveSettingsAction;
window.uploadLogo = uploadLogo;
window.filterProjects = filterProjects;
window.addPosRow = addPosRow;
window.calcRow = calcRow;
window.delRow = delRow;
window.recalcTotals = recalcTotals;
window.closeModal = closeModal;
window.closeAllModals = closeAllModals;

// ── Start ─────────────────────────────────────────────────────────────
init();
