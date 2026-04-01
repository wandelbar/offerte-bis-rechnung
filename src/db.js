/**
 * db.js — IndexedDB layer (ersetzt SQLite + Express API Routes)
 * Gleiche Datenstruktur wie database.js, gleiche Default-Einstellungen.
 * Promise-based via idb library.
 */

import { openDB } from 'idb';

const DB_NAME = 'projektverwaltung';
const DB_VERSION = 1;

let _db = null;

async function getDb() {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // settings: key/value store (analog zu SQLite settings Tabelle)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }

      // projects (analog zu SQLite projects Tabelle)
      if (!db.objectStoreNames.contains('projects')) {
        const ps = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        ps.createIndex('created_at', 'created_at');
      }

      // documents (analog zu SQLite documents Tabelle)
      if (!db.objectStoreNames.contains('documents')) {
        const ds = db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
        ds.createIndex('project_id', 'project_id');
        ds.createIndex('base_number_type', ['base_number', 'type']);
      }

      // positions (analog zu SQLite positions Tabelle)
      if (!db.objectStoreNames.contains('positions')) {
        const pos = db.createObjectStore('positions', { keyPath: 'id', autoIncrement: true });
        pos.createIndex('document_id', 'document_id');
      }
    }
  });

  // Sicherstellen dass Default-Settings vorhanden sind
  await initDefaultSettings(_db);
  return _db;
}

const DEFAULTS = {
  next_doc_number: '9700001',
  firma_name: '',
  firma_titel: '',
  firma_adresse: '',
  firma_plz: '',
  firma_ort: '',
  firma_land: 'Schweiz',
  firma_uid: '',
  firma_iban: '',
  firma_bank: '',
  firma_email: '',
  firma_telefon: '',
  firma_website: '',
  logo_data: ''   // base64 data-URL statt Dateipfad
};

async function initDefaultSettings(db) {
  const tx = db.transaction('settings', 'readwrite');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const existing = await tx.store.get(key);
    if (existing === undefined) {
      await tx.store.put(value, key);
    }
  }
  await tx.done;
}

// ── SETTINGS ─────────────────────────────────────────────────────────────────

export async function getSettings() {
  const db = await getDb();
  const keys = await db.getAllKeys('settings');
  const result = {};
  for (const key of keys) {
    result[key] = await db.get('settings', key);
  }
  return result;
}

export async function saveSettings(data) {
  const db = await getDb();
  const tx = db.transaction('settings', 'readwrite');
  for (const [key, value] of Object.entries(data)) {
    await tx.store.put(value === undefined || value === null ? '' : String(value), key);
  }
  await tx.done;
}

export async function getNextDocNumber() {
  const db = await getDb();
  const current = await db.get('settings', 'next_doc_number');
  const num = parseInt(current || '9700001', 10);
  await db.put('settings', String(num + 1), 'next_doc_number');
  return String(num);
}

// ── PROJECTS ──────────────────────────────────────────────────────────────────

export async function getProjects() {
  const db = await getDb();
  const projects = await db.getAll('projects');
  // Sortiert nach created_at DESC
  return projects.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function createProject(data) {
  const db = await getDb();
  const now = new Date().toISOString();
  const project = {
    name: data.name || '',
    description: data.description || null,
    customer_name: data.customer_name || null,
    customer_company: data.customer_company || null,
    customer_address: data.customer_address || null,
    customer_plz: data.customer_plz || null,
    customer_ort: data.customer_ort || null,
    customer_land: data.customer_land || 'Schweiz',
    customer_number: data.customer_number || null,
    contact_person: data.contact_person || null,
    created_at: now,
    updated_at: now
  };
  const id = await db.add('projects', project);
  return { ...project, id };
}

export async function getProject(id) {
  const db = await getDb();
  return db.get('projects', id);
}

export async function updateProject(id, data) {
  const db = await getDb();
  const existing = await db.get('projects', id);
  if (!existing) throw new Error('Project not found');
  const updated = {
    ...existing,
    name: data.name ?? existing.name,
    description: data.description ?? existing.description,
    customer_name: data.customer_name ?? existing.customer_name,
    customer_company: data.customer_company ?? existing.customer_company,
    customer_address: data.customer_address ?? existing.customer_address,
    customer_plz: data.customer_plz ?? existing.customer_plz,
    customer_ort: data.customer_ort ?? existing.customer_ort,
    customer_land: data.customer_land ?? existing.customer_land,
    customer_number: data.customer_number ?? existing.customer_number,
    contact_person: data.contact_person ?? existing.contact_person,
    updated_at: new Date().toISOString()
  };
  await db.put('projects', updated);
  return updated;
}

export async function deleteProject(id) {
  const db = await getDb();
  // Dokumente und Positionen des Projekts löschen
  const docs = await db.getAllFromIndex('documents', 'project_id', id);
  for (const doc of docs) {
    await deleteDocumentPositions(db, doc.id);
    await db.delete('documents', doc.id);
  }
  await db.delete('projects', id);
}

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────

export async function getProjectDocuments(projectId) {
  const db = await getDb();
  const docs = await db.getAllFromIndex('documents', 'project_id', projectId);
  // Positionen zählen pro Dokument
  const result = [];
  for (const doc of docs) {
    const positions = await db.getAllFromIndex('positions', 'document_id', doc.id);
    result.push({ ...doc, position_count: positions.length });
  }
  return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function createDocument(projectId, data) {
  const db = await getDb();
  const base_number = await getNextDocNumber();
  const now = new Date().toISOString();
  const doc = {
    project_id: projectId,
    type: data.type,
    base_number,
    version: 0,
    date: data.date || new Date().toISOString().slice(0,10),
    reference: data.reference || null,
    notes: data.notes || null,
    payment_terms: data.payment_terms || null,
    vat_rate: data.vat_rate ?? 8.1,
    vat_included: data.vat_included !== false ? 1 : 0,
    status: 'entwurf',
    parent_id: data.parent_id || null,
    delivery_date: data.delivery_date || 'gemass_absprache',
    created_at: now,
    updated_at: now
  };
  const id = await db.add('documents', doc);
  return { ...doc, id };
}

export async function getDocument(id) {
  const db = await getDb();
  const doc = await db.get('documents', id);
  if (!doc) return null;
  const project = await db.get('projects', doc.project_id);
  const positions = await db.getAllFromIndex('positions', 'document_id', id);
  positions.sort((a, b) => a.pos_nr - b.pos_nr);

  // Alle Versionen mit gleichem base_number + type
  const allDocs = await db.getAll('documents');
  const versions = allDocs
    .filter(d => d.base_number === doc.base_number && d.type === doc.type)
    .sort((a, b) => a.version - b.version)
    .map(d => ({ id: d.id, version: d.version, type: d.type, base_number: d.base_number, date: d.date, status: d.status, created_at: d.created_at }));

  return { ...doc, project, positions, versions };
}

export async function updateDocument(id, data) {
  const db = await getDb();
  const existing = await db.get('documents', id);
  if (!existing) throw new Error('Document not found');

  const updated = {
    ...existing,
    date: data.date ?? existing.date,
    reference: data.reference !== undefined ? data.reference : existing.reference,
    notes: data.notes !== undefined ? data.notes : existing.notes,
    payment_terms: data.payment_terms !== undefined ? data.payment_terms : existing.payment_terms,
    vat_rate: data.vat_rate ?? existing.vat_rate,
    vat_included: data.vat_included !== false ? 1 : 0,
    status: data.status ?? existing.status,
    delivery_date: data.delivery_date || existing.delivery_date || 'gemass_absprache',
    updated_at: new Date().toISOString()
  };
  await db.put('documents', updated);

  // Positionen aktualisieren
  if (data.positions !== undefined) {
    await deleteDocumentPositions(db, id);
    const tx = db.transaction('positions', 'readwrite');
    for (let i = 0; i < data.positions.length; i++) {
      const p = data.positions[i];
      await tx.store.add({
        document_id: id,
        pos_nr: i + 1,
        bezeichnung: p.bezeichnung || '',
        beschreibung: p.beschreibung || null,
        menge: p.menge ?? null,
        einheit: p.einheit || 'h',
        einzelpreis: p.einzelpreis ?? null,
        gesamtpreis: p.gesamtpreis ?? 0
      });
    }
    await tx.done;
  }
  return updated;
}

export async function deleteDocument(id) {
  const db = await getDb();
  await deleteDocumentPositions(db, id);
  await db.delete('documents', id);
}

async function deleteDocumentPositions(db, documentId) {
  const positions = await db.getAllFromIndex('positions', 'document_id', documentId);
  const tx = db.transaction('positions', 'readwrite');
  for (const p of positions) {
    await tx.store.delete(p.id);
  }
  await tx.done;
}

export async function newDocumentVersion(id) {
  const db = await getDb();
  const orig = await db.get('documents', id);
  if (!orig) throw new Error('Document not found');

  const now = new Date().toISOString();
  const newDoc = {
    ...orig,
    id: undefined,  // autoIncrement
    version: orig.version + 1,
    status: 'entwurf',
    parent_id: orig.id,
    created_at: now,
    updated_at: now
  };
  delete newDoc.id;
  const newId = await db.add('documents', newDoc);

  // Positionen kopieren
  const origPositions = await db.getAllFromIndex('positions', 'document_id', id);
  const tx = db.transaction('positions', 'readwrite');
  for (const p of origPositions) {
    await tx.store.add({
      document_id: newId,
      pos_nr: p.pos_nr,
      bezeichnung: p.bezeichnung,
      beschreibung: p.beschreibung || null,
      menge: p.menge,
      einheit: p.einheit,
      einzelpreis: p.einzelpreis,
      gesamtpreis: p.gesamtpreis
    });
  }
  await tx.done;
  return { ...newDoc, id: newId };
}

export async function convertDocument(fromId, newType) {
  const db = await getDb();
  const orig = await db.get('documents', fromId);
  if (!orig) throw new Error('Document not found');

  const base_number = await getNextDocNumber();
  const now = new Date().toISOString();
  const newDoc = {
    project_id: orig.project_id,
    type: newType,
    base_number,
    version: 0,
    date: now.slice(0,10),
    reference: orig.reference,
    notes: orig.notes,
    payment_terms: orig.payment_terms,
    vat_rate: orig.vat_rate,
    vat_included: orig.vat_included,
    status: 'entwurf',
    parent_id: orig.id,
    delivery_date: orig.delivery_date || 'gemass_absprache',
    created_at: now,
    updated_at: now
  };
  const newId = await db.add('documents', newDoc);

  // Positionen kopieren
  const origPositions = await db.getAllFromIndex('positions', 'document_id', fromId);
  const tx = db.transaction('positions', 'readwrite');
  for (const p of origPositions) {
    await tx.store.add({
      document_id: newId,
      pos_nr: p.pos_nr,
      bezeichnung: p.bezeichnung,
      beschreibung: p.beschreibung || null,
      menge: p.menge,
      einheit: p.einheit,
      einzelpreis: p.einzelpreis,
      gesamtpreis: p.gesamtpreis
    });
  }
  await tx.done;
  return { ...newDoc, id: newId };
}
