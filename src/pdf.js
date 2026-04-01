/**
 * pdf.js — PDF-Generierung direkt im Browser
 *
 * Layout 1:1 nach generator.js (Vorlagesoftware/src/pdf/generator.js) portiert.
 * Alle Texte, Masse und Formatierungen exakt übernommen.
 *
 * Unterschiede zu generator.js:
 * - Puppeteer → pdf-lib (direkte Koordinaten statt HTML+CSS)
 * - Logo kommt aus settings.logo_data (base64) statt Dateipfad
 * - Swiss Cross via Canvas-API statt SVG-Embed
 * - "Ich freue mich" → "Wir freuen uns" (Kundenwunsch)
 *
 * Koordinatensystem: pdf-lib = Y von UNTEN
 * A4: 210mm × 297mm = 595.28pt × 841.89pt
 * 1mm = 2.8346pt
 */

import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import QRCode from 'qrcode';

// ── KONSTANTEN ────────────────────────────────────────────────────────────────

const WATERMARK_TEXT = 'ArjensProjectTool v1.0.0';

const TYPE_LABELS = {
  angebot: 'Angebot',
  auftragsbestaetigung: 'Auftragsbestätigung',
  lieferschein: 'Lieferschein',
  rechnung: 'Rechnung'
};

const MM = 2.8346;      // 1mm in PDF-Punkten
const A4_H = 841.89;    // 297mm
const A4_W = 595.28;    // 210mm

// Seitenränder (25mm links/rechts, wie original @page padding)
const LEFT   = 25 * MM;
const RIGHT  = A4_W - 25 * MM;
const CWIDTH = RIGHT - LEFT;   // 160mm nutzbar

/** mm → PDF-Punkte (horizontal) */
function mm(v) { return v * MM; }

/** mm vom oberen Rand → PDF Y-Koordinate (von unten) */
function fromTop(mmFromTop) { return A4_H - mmFromTop * MM; }

// ── FORMATIERUNG ──────────────────────────────────────────────────────────────

function fmtCHF(n) {
  const v = parseFloat(n) || 0;
  return `CHF ${v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDelivery(val) {
  if (!val || val === 'gemass_absprache') return 'gemäss Absprache';
  if (val === 'freibleibend') return 'freibleibend';
  const d = new Date(val);
  return isNaN(d) ? (val || 'gemäss Absprache') : fmtDate(val);
}

function formatIban(iban) {
  const clean = (iban || '').replace(/\s/g, '').toUpperCase();
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

function s(v) { return String(v || ''); }

// ── TEXT-WRAPPING ─────────────────────────────────────────────────────────────

function wrapText(text, font, size, maxWidthPt) {
  if (!text) return [];
  const lines = [];
  // Zuerst nach echten Zeilenumbrüchen aufteilen
  const paras = text.split('\n');
  for (const para of paras) {
    if (!para.trim()) { lines.push(''); continue; }
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) > maxWidthPt && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// ── QR-PAYLOAD ────────────────────────────────────────────────────────────────
// Exakt 1:1 aus generator.js portiert

function buildQrPayload({ doc, project, settings, total }) {
  const LAND_ISO = { 'Schweiz': 'CH', 'Deutschland': 'DE', 'Österreich': 'AT' };
  const t = (str, max) => String(str || '').trim().slice(0, max);

  const iban = (settings.firma_iban || '').replace(/\s/g, '').toUpperCase();
  const debtorName = t(project.customer_company || project.customer_name || '', 70);
  const debtorCountry = LAND_ISO[project.customer_land] || 'CH';
  const amtStr = total > 0 ? total.toFixed(2) : '';
  const docNum = `${doc.base_number}-${String(doc.version).padStart(2, '0')}`;
  const msgText = t(`Rechnung Nr. ${docNum}`, 140);

  const hasValidDebtor = !!(debtorName &&
    t(project.customer_plz, 16) &&
    t(project.customer_ort, 35));

  return [
    'SPC', '0200', '1',
    t(iban, 34),
    'S',
    t(settings.firma_name, 70),
    t(settings.firma_adresse, 70),
    '',
    t(settings.firma_plz, 16),
    t(settings.firma_ort, 35),
    'CH',
    '', '', '', '', '', '', '',
    amtStr,
    'CHF',
    ...(hasValidDebtor ? [
      'S', debtorName,
      t(project.customer_address, 70), '',
      t(project.customer_plz, 16),
      t(project.customer_ort, 35),
      debtorCountry
    ] : ['', '', '', '', '', '', '']),
    'NON', '',
    msgText,
    'EPD', ''
  ].join('\n');
}

// ── SWISS CROSS via Canvas ────────────────────────────────────────────────────

async function generateSwissCrossPng() {
  const size = 140; // px
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, size, size);

  const border = Math.round(size * 2 / 36);
  ctx.fillStyle = 'black';
  ctx.fillRect(border, border, size - 2*border, size - 2*border);

  // Weisses Kreuz ausgestanzt (Pfad: m15 8h6v7h7v6h-7v7h-6v-7h-7v-6h7z)
  const sc = size / 36;
  ctx.fillStyle = 'white';
  ctx.fillRect(8*sc, 15*sc, 20*sc, 6*sc);   // Horizontalbalken
  ctx.fillRect(15*sc, 8*sc,  6*sc, 20*sc);   // Vertikalbalken

  return canvas.toDataURL('image/png');
}

// ── SCHEREN-SYMBOL via Canvas ─────────────────────────────────────────────────
// Exakte Nachbildung des SIX-Standard SVG aus generator.js (viewBox 0 0 12 12).
// Das Original-SVG zeichnet Griffe links, Klingen rechts, dann rotate(-180 6 6)
// = Griffe rechts, Klingen/Spitzen zeigen nach links (Richtung Perforationslinie).
// rotated=true: rotate(-90 6 6) für die vertikale Linie.

async function generateScissorPng(rotated = false) {
  // Render 12×12 viewBox at 8× = 96px für Schärfe
  const SCALE = 8;
  const S = 12 * SCALE; // 96px
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  // Koordianten-Transformation entsprechend Original-SVG:
  // scissorH → rotate(-180 6 6): Drehung um 180° um Mittelpunkt (6,6)
  // scissorV → rotate(-90 6 6):  Drehung um 90° um Mittelpunkt (6,6)
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(rotated ? (Math.PI / 2) : Math.PI); // -90° oder -180°
  ctx.translate(-S / 2, -S / 2);
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.3; // in viewBox-Einheiten

  // ── Oberer Griff + obere Klinge (Pfad 1 vor Rotation) ────────────────────
  // M3 1  a2 2 0 0 1 1.72 3  L6 5.3  L9.65 1.65 ... A2 2 0 1 1 3 1
  // Vereinfacht: Kreis bei (3,3) r≈2 + Klinge zu (9.65,1.65)
  ctx.beginPath();
  ctx.arc(3, 3, 1.9, 0, Math.PI * 2);
  ctx.stroke();

  // Obere Klinge: vom Griff (ca. 4.5,4.5) zum Punkt (9.65,1.65)
  ctx.beginPath();
  ctx.moveTo(4.3, 4.3);
  ctx.lineTo(9.65, 1.65);
  ctx.stroke();

  // ── Unterer Griff + untere Klinge (Pfad 2 vor Rotation) ──────────────────
  // M3 11  a2 2 0 0 0 1.72-3  ... A2 2 0 1 0 3 11
  // Vereinfacht: Kreis bei (3,9) r≈2 + Klinge zu (9.65,10.35)
  ctx.beginPath();
  ctx.arc(3, 9, 1.9, 0, Math.PI * 2);
  ctx.stroke();

  // Untere Klinge: vom Griff (ca. 4.5,7.5) zum Punkt (9.65,10.35)
  ctx.beginPath();
  ctx.moveTo(4.3, 7.7);
  ctx.lineTo(9.65, 10.35);
  ctx.stroke();

  // Kleines Pivotloch in der Mitte (6,6)
  ctx.beginPath();
  ctx.arc(6, 6, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  return canvas.toDataURL('image/png');
}

// ── DATA-URL → Uint8Array ─────────────────────────────────────────────────────

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const b = atob(base64);
  const arr = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
  return arr;
}

// ── SEITE 1: DOKUMENT ─────────────────────────────────────────────────────────
/**
 * Baut Seite 1 auf — exakt dem HTML-Layout aus generator.js nachempfunden:
 *
 * @page: margin top=20mm bottom=18mm left/right=0 (→ .page hat padding 25mm)
 * .page: padding 5mm 25mm 10mm 25mm
 * Logo: abs top=5mm right=0 (innerhalb .page)
 * .header-grid: margin-top=15mm → ab 20+5+15=40mm vom Rand
 * .invoice-title: margin-top=25mm → ab 40+Adressblock+25mm
 *
 * Wir rechnen:
 *   Seitenrand oben (Puppeteer @page margin): 20mm
 *   .page padding-top: 5mm
 *   .logo-container top: 5mm → Logo bei 20+5=25mm vom Blattrand
 *   .header-grid margin-top: 15mm → Header-Start bei 20+5+15=40mm (approximiert)
 */
// ─────────────────────────────────────────────────────────────────────────────
// Zeichnet Kopfzeile auf einer FOLGESEITE (kompakter als Seite 1)
// ─────────────────────────────────────────────────────────────────────────────
async function drawContinuationHeader(pdfDoc, { doc, project, settings, logoDataUrl, pageNum, totalPages }) {
  const page   = pdfDoc.addPage([A4_W, A4_H]);
  const fReg   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const type    = doc.type;
  const label   = TYPE_LABELS[type] || type;
  const docNum  = `${doc.base_number}-${String(doc.version).padStart(2, '0')}`;
  const BLACK   = rgb(0, 0, 0);
  const GRAY666_HDR = rgb(0.4, 0.4, 0.4);
  const EAEAEA  = rgb(0.918, 0.918, 0.918);
  const GRAY333 = rgb(0.2, 0.2, 0.2);
  const GRAY444 = rgb(0.267, 0.267, 0.267);

  const HDR_SIZE = 7.5;
  const HDR_Y    = A4_H - mm(12);

  // Kopfzeile: Firmenname links, Typ+Nummer rechts
  const hdrLeft  = settings.firma_name || '';
  page.drawText(hdrLeft, { x: LEFT, y: HDR_Y, size: HDR_SIZE, font: fReg, color: GRAY666_HDR });
  const hdrRight  = `${label} ${docNum}`;
  const hdrRightW = fReg.widthOfTextAtSize(hdrRight, HDR_SIZE);
  page.drawText(hdrRight, { x: RIGHT - hdrRightW, y: HDR_Y, size: HDR_SIZE, font: fReg, color: GRAY666_HDR });

  // Wasserzeichen
  const WM_SIZE  = 6;
  const WM_COLOR = rgb(0.75, 0.75, 0.75);
  const wmW      = fReg.widthOfTextAtSize(WATERMARK_TEXT, WM_SIZE);
  page.drawText(WATERMARK_TEXT, {
    x: A4_W - mm(4), y: (A4_H / 2) - (wmW / 2),
    size: WM_SIZE, font: fReg, color: WM_COLOR, rotate: degrees(90)
  });

  // Footer
  const FOOTER_Y    = mm(8.5);
  const FOOTER_SIZE = 7.5;
  const footerLeft = [
    settings.firma_name,
    settings.firma_adresse,
    [settings.firma_plz, settings.firma_ort].filter(Boolean).join(' '),
    settings.firma_land || 'Schweiz'
  ].filter(Boolean).join(', ');
  const footerMid = [
    settings.firma_uid,
    settings.firma_iban ? `IBAN ${settings.firma_iban}` : '',
    settings.firma_bank
  ].filter(Boolean).join(' · ');
  const pageStr = `Seite ${pageNum} von ${totalPages || 1}`;
  const midW    = footerMid ? fReg.widthOfTextAtSize(footerMid, FOOTER_SIZE) : 0;
  const rightW  = fReg.widthOfTextAtSize(pageStr, FOOTER_SIZE);
  const MIN_GAP = mm(4);
  let fLeftText = footerLeft;
  const maxLeftW = CWIDTH - midW - rightW - MIN_GAP * 2;
  while (fLeftText.length > 5 && fReg.widthOfTextAtSize(fLeftText, FOOTER_SIZE) > maxLeftW) {
    fLeftText = fLeftText.slice(0, -4) + '…';
  }
  const leftW = fReg.widthOfTextAtSize(fLeftText, FOOTER_SIZE);
  const gap   = Math.max(MIN_GAP, (CWIDTH - leftW - midW - rightW) / 2);
  if (fLeftText) page.drawText(fLeftText, { x: LEFT, y: FOOTER_Y, size: FOOTER_SIZE, font: fReg, color: GRAY444 });
  if (footerMid) page.drawText(footerMid, { x: LEFT + leftW + gap, y: FOOTER_Y, size: FOOTER_SIZE, font: fReg, color: GRAY444 });
  page.drawText(pageStr, { x: RIGHT - rightW, y: FOOTER_Y, size: FOOTER_SIZE, font: fReg, color: GRAY444 });

  return page;
}

async function drawInvoicePage(pdfDoc, { doc, project, positions, settings, logoDataUrl, totalPages }) {
  const page = pdfDoc.addPage([A4_W, A4_H]);
  const fReg   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fItal  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique); // für Beschreibungs-Kursivtext

  const BLACK = rgb(0, 0, 0);
  const GRAY333 = rgb(0.2, 0.2, 0.2);
  const GRAY555 = rgb(0.333, 0.333, 0.333);
  const GRAY666 = rgb(0.4, 0.4, 0.4);
  const EAEAEA = rgb(0.918, 0.918, 0.918);

  const type = doc.type;
  const isLS = type === 'lieferschein';
  const vatRate = parseFloat(doc.vat_rate) || 0;
  const vatIncluded = doc.vat_included !== 0 && doc.vat_included !== false;
  const subtotal = positions.reduce((s, p) => s + (parseFloat(p.gesamtpreis) || 0), 0);
  const vatAmount = (!isLS && vatIncluded) ? subtotal * (vatRate / 100) : 0;
  const total = subtotal + vatAmount;
  const label = TYPE_LABELS[type] || type;
  const docNum = `${doc.base_number}-${String(doc.version).padStart(2, '0')}`;

  // Seitenränder (links/rechts: 25mm)

  // ── KOPFZEILE (headerTemplate aus Puppeteer) ────────────────────────────────
  // Original: <span>Firma</span> ... <span>Label DocNum</span>
  // padding: 0 25mm 3pt 25mm; align-items: flex-end; font-size: 7.5pt; color: #666
  const HDR_Y       = fromTop(10);   // 10mm vom oberen Rand
  const HDR_SIZE    = 7.5;
  const GRAY666_HDR = rgb(0.4, 0.4, 0.4); // #666

  // Links: Firmenname
  const firmaShort = s(settings.firma_name);
  if (firmaShort) {
    page.drawText(firmaShort, { x: LEFT, y: HDR_Y, size: HDR_SIZE, font: fReg, color: GRAY666_HDR });
  }
  // Rechts: Dokumenttyp + Nummer
  const hdrRight = `${label} ${docNum}`;
  const hdrRightW = fReg.widthOfTextAtSize(hdrRight, HDR_SIZE);
  page.drawText(hdrRight, { x: RIGHT - hdrRightW, y: HDR_Y, size: HDR_SIZE, font: fReg, color: GRAY666_HDR });

  // Keine Trennlinie unter Kopfzeile (user: "entferne die Linie")
  // ── LOGO (top=25mm vom Blattrand, rechtsbündig) ──────────────────────────
  const LOGO_TOP = 25; // mm
  if (logoDataUrl) {
    try {
      const bytes = dataUrlToBytes(logoDataUrl);
      const mime = logoDataUrl.split(';')[0].split(':')[1];
      const img = mime === 'image/jpeg'
        ? await pdfDoc.embedJpg(bytes)
        : await pdfDoc.embedPng(bytes);
      const { width: iw, height: ih } = img.size();
      const maxW = mm(60), maxH = mm(20);
      const scale = Math.min(maxW / iw, maxH / ih, 1);
      const dw = iw * scale, dh = ih * scale;
      page.drawImage(img, {
        x: RIGHT - dw,
        y: fromTop(LOGO_TOP) - dh + mm(5),
        width: dw, height: dh
      });
    } catch(e) {
      // Fallback: Firmenname fettgedruckt
      const nm = s(settings.firma_name);
      page.drawText(nm, {
        x: RIGHT - fBold.widthOfTextAtSize(nm, 24),
        y: fromTop(LOGO_TOP),
        size: 24, font: fBold, color: BLACK
      });
    }
  } else {
    const nm = s(settings.firma_name);
    if (nm) {
      page.drawText(nm, {
        x: RIGHT - fBold.widthOfTextAtSize(nm, 24),
        y: fromTop(LOGO_TOP),
        size: 24, font: fBold, color: BLACK
      });
    }
  }

  // ── HEADER-GRID (ab 40mm vom Blattrand) ──────────────────────────────────
  const HEADER_TOP = 40; // mm (entspricht 20mm @page margin + 5mm .page padding + 15mm margin-top)

  // Absender-Kurzzeile (7.5pt, #333, format: Name, Strasse, PLZ Ort)
  // Original: [firma_name, firma_adresse, plz+ort].join(', ') — OHNE Land
  const absenderParts = [
    settings.firma_name,
    settings.firma_adresse,
    [settings.firma_plz, settings.firma_ort].filter(Boolean).join(' ')
  ].filter(Boolean);
  const absenderStr = absenderParts.join(', ');

  const ABS_SIZE = 7.5;
  page.drawText(absenderStr, {
    x: LEFT,
    y: fromTop(HEADER_TOP),
    size: ABS_SIZE, font: fReg, color: GRAY333  // #333 wie .sender-small
  });

  // Empfänger-Block (10pt, ab 5mm unter Absender)
  const RECIP_TOP = HEADER_TOP + 6; // mm
  const recipLines = [
    project.customer_company ? { text: s(project.customer_company), bold: true } : null,
    project.customer_name ? { text: s(project.customer_name), bold: false } : null,
    project.customer_address ? { text: s(project.customer_address), bold: false } : null,
    [project.customer_plz, project.customer_ort].filter(Boolean).length > 0
      ? { text: [project.customer_plz, project.customer_ort].filter(Boolean).join(' '), bold: false }
      : null,
    (project.customer_land && project.customer_land !== 'Schweiz')
      ? { text: s(project.customer_land), bold: false }
      : null
  ].filter(Boolean);

  const RECIP_LINE_H = 5.0; // mm pro Zeile (entspricht line-height:1.4 bei 10pt)
  let recipY = fromTop(RECIP_TOP);
  for (const line of recipLines) {
    page.drawText(line.text, {
      x: LEFT, y: recipY,
      size: 10, font: line.bold ? fBold : fReg, color: BLACK
    });
    recipY -= mm(RECIP_LINE_H);
  }

  // Meta-Tabelle rechts (.meta-right: width=75mm, margin-top=10mm von Header-Top)
  // meta-right table: font-size 9pt, td:first-child color #555
  const META_LEFT = LEFT + mm(85);  // ab 85mm von links (.address-left = 85mm)
  // Zeige meta ab HEADER_TOP + 10mm
  const META_TOP = HEADER_TOP + 10;

  const metaRows = [];
  if (type === 'angebot') {
    metaRows.push([`${label} Nr.`, docNum]);
    metaRows.push([`${label}datum`, fmtDate(doc.date)]);
    metaRows.push(['Lieferdatum', fmtDelivery(doc.delivery_date)]);
  } else if (type === 'auftragsbestaetigung') {
    metaRows.push(['Datum', fmtDate(doc.date)]);
    if (doc.reference) metaRows.push(['Bestellung / Auftrag vom', s(doc.reference)]);
  } else if (type === 'rechnung') {
    metaRows.push(['Rechnung Nr.', docNum]);
    metaRows.push(['Rechnungsdatum', fmtDate(doc.date)]);
    metaRows.push(['Lieferdatum', fmtDelivery(doc.delivery_date)]);
  } else if (type === 'lieferschein') {
    metaRows.push(['Lieferschein Nr.', docNum]);
    metaRows.push(['Datum', fmtDate(doc.date)]);
  }
  if (project.customer_number) metaRows.push(['Ihre Kundennummer', s(project.customer_number)]);
  if (project.contact_person)  metaRows.push(['Ihr Ansprechpartner', s(project.contact_person)]);

  // Meta-Tabelle: font-size 9pt
  // Original CSS: td:first-child { color: #555 } (Label grau)
  //               td:last-child  { font-weight: 500 } (Wert — medium, d.h. in pdf-lib fReg da kein 500-weight)
  // -> Werte sind NICHT fettgedruckt (Bold), sondern nur font-weight:500 ≈ regular+
  // In pdf-lib: verwende fReg für Werte (da Helvetica 500 = regular)
  // Die Spalte layout: erste Spalte 50% der 75mm = 37.5mm, zweite Spalte 37.5mm
  const META_COL2 = META_LEFT + mm(37.5); // 50% von 75mm
  let metaY = fromTop(META_TOP);
  const META_LINE_H = 4.2; // mm (entspricht padding: 2px 0 bei 9pt = ~4.2mm pro Zeile)
  for (const [lbl, val] of metaRows) {
    page.drawText(lbl, { x: META_LEFT, y: metaY, size: 9, font: fReg, color: GRAY555 });
    // Original CSS: font-weight:500 → Helvetica hat keinen 500-weight, rendert als Regular
    page.drawText(val, { x: META_COL2, y: metaY, size: 9, font: fReg, color: BLACK });
    metaY -= mm(META_LINE_H);
  }

  // ── DOKUMENTTITEL — .invoice-title: font-size=14pt, margin-top=25mm ────────
  // Der Titel beginnt nach dem Empfänger-Block, mindestens 25mm unter Header-Top
  const recipBlockHeight = recipLines.length * RECIP_LINE_H;
  const TITLE_TOP = Math.max(HEADER_TOP + recipBlockHeight + 20, HEADER_TOP + 42);

  const titleMap = {
    angebot:             `Angebot Nr. ${docNum}`,
    auftragsbestaetigung: 'Auftragsbestätigung',
    lieferschein:        `Lieferschein Nr. ${docNum}`,
    rechnung:            `Rechnung Nr. ${docNum}`
  };
  const docTitle = titleMap[type] || label;

  page.drawText(docTitle, {
    x: LEFT, y: fromTop(TITLE_TOP),
    size: 14, font: fBold, color: BLACK
  });

  // ── ANREDE + EINLEITUNG ──────────────────────────────────────────────────
  // Aus generator.js CSS:
  //   .invoice-title  margin-bottom: 8mm
  //   .salutation     margin-bottom: 8mm
  //   .intro-text     margin-bottom: 6mm
  // 14pt = ~4.9mm Zeilenhöhe → Titel nimmt ~5mm ein, dann 8mm Abstand
  const SALUT_TOP = TITLE_TOP + 13; // 5mm Titeltext + 8mm margin-bottom
  page.drawText('Sehr geehrte Damen und Herren', {
    x: LEFT, y: fromTop(SALUT_TOP),
    size: 10, font: fReg, color: BLACK
  });

  // Intro-Text (exakt aus generator.js, "Wir" statt "Ich" gemäss Kundenwunsch)
  const introMap = {
    angebot: 'Vielen Dank für Ihre Anfrage. Wir freuen uns, Ihnen die folgende Offerte unterbreiten zu können.',
    auftragsbestaetigung: `Vielen Dank für Ihren Auftrag. Gemäss unserem Angebot erbringen wir im Einzelnen die folgenden Leistungen zum Gesamtpreis von ${fmtCHF(total)}.`,
    lieferschein: 'Wir liefern Ihnen gemäss Vereinbarung folgende Artikel:',
    rechnung: 'Vielen Dank für das Vertrauen. Wir stellen Ihnen hiermit folgende Leistung in Rechnung:'
  };
  const intro = introMap[type] || '';

  // Anrede: 10pt = ~3.5mm, dann 8mm margin-bottom → intro startet 11.5mm später
  const INTRO_START = SALUT_TOP + 12; // 3.5mm text + 8mm margin-bottom
  let introEndMm = INTRO_START;
  if (intro) {
    const introLines = wrapText(intro, fReg, 10, CWIDTH);
    let introY = fromTop(INTRO_START);
    for (const line of introLines) {
      page.drawText(line, { x: LEFT, y: introY, size: 10, font: fReg, color: BLACK });
      introY -= mm(5.3);
      introEndMm += 5.3;
    }
    introEndMm += 6; // .intro-text margin-bottom: 6mm
  }

  // ── POSITIONEN-TABELLE ────────────────────────────────────────────────────
  // table.positions: font-size=9pt (th+td), th hat background #eaeaea
  // Spaltenbreiten entsprechend generator.js (in % von 160mm nutzbar):
  // Nicht-LS: Pos 8%, Bez 40%, Menge 10%, Einheit 10%, Einzel 15%, Gesamt 17%
  // LS:       Pos 10%, Bez 55%, Menge 15%, Einheit 20%

  const TABLE_TOP = introEndMm + 2;
  const COL_WIDTHS = isLS
    ? [mm(16), mm(88), mm(24), mm(32)]                           // 10+55+15+20 × 1.6
    : [mm(12.8), mm(64), mm(16), mm(16), mm(24), mm(27.2)];     // 8+40+10+10+15+17 × 1.6

  const TH_SIZE = 9;
  const TD_SIZE = 9;
  const TH_H = mm(7);   // Header-Zeile Höhe
  const TD_H = mm(6.5); // Daten-Zeile Grundhöhe

  let curY = fromTop(TABLE_TOP);

  // Thead-Hintergrund
  page.drawRectangle({ x: LEFT, y: curY - TH_H, width: CWIDTH, height: TH_H, color: EAEAEA });

  // Trennlinie unter Thead
  page.drawLine({ start: { x: LEFT, y: curY - TH_H }, end: { x: RIGHT, y: curY - TH_H }, thickness: 0.75, color: BLACK });

  // Spaltenüberschriften
  const headers = isLS
    ? ['Pos.', 'Bezeichnung', 'Menge', 'Einheit']
    : ['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', 'Gesamtpreis'];
  const rightAlign = isLS ? [false, false, true, false] : [false, false, true, false, true, true];

  // Original: th { font-weight: normal } → fReg; text-align: left (Menge/Preis rechts)
  // padding: 4px ≈ 1.4mm
  let hx = LEFT;
  for (let i = 0; i < headers.length; i++) {
    const tw = fReg.widthOfTextAtSize(headers[i], TH_SIZE);
    const dx = rightAlign[i]
      ? hx + COL_WIDTHS[i] - tw - mm(1.4)
      : hx + mm(1.4);
    // Thead-Textfarbe: original CSS th hat keine explizite Farbe → erbt body color (#333 = GRAY333)
    // font-weight: normal → fReg
    page.drawText(headers[i], { x: dx, y: curY - TH_H + mm(2), size: TH_SIZE, font: fReg, color: GRAY333 });
    hx += COL_WIDTHS[i];
  }

  curY -= TH_H;

  // ── Y-Grenze: unter dieser Linie alles nur im Footer ─────────────────────
  // Footer belegt mm(8.5), plus Puffer mm(10) → safe bottom mm(20) vom Rand
  const SAFE_BOTTOM = mm(22);
  let currentPage = page; // Referenz auf aktive Seite
  let pageCount   = 1;   // Seite 1 ist schon erstellt

  // Helper: neue Seite beginnen (mit Kopf + Tabellenheader-Wiederholung)
  const newPage = async () => {
    pageCount++;
    currentPage = await drawContinuationHeader(pdfDoc, {
      doc, project, settings, logoDataUrl,
      pageNum: pageCount, totalPages
    });
    // Tabellenheader wiederholen
    const startY = A4_H - mm(22); // nach Kopfzeile
    currentPage.drawRectangle({ x: LEFT, y: startY - TH_H, width: CWIDTH, height: TH_H, color: EAEAEA });
    currentPage.drawLine({ start: { x: LEFT, y: startY - TH_H }, end: { x: RIGHT, y: startY - TH_H }, thickness: 0.75, color: BLACK });
    let hx2 = LEFT;
    for (let i = 0; i < headers.length; i++) {
      const tw2 = fReg.widthOfTextAtSize(headers[i], TH_SIZE);
      const dx2 = rightAlign[i]
        ? hx2 + COL_WIDTHS[i] - tw2 - mm(1.4)
        : hx2 + mm(1.4);
      currentPage.drawText(headers[i], { x: dx2, y: startY - TH_H + mm(2), size: TH_SIZE, font: fReg, color: GRAY333 });
      hx2 += COL_WIDTHS[i];
    }
    curY = startY - TH_H;
  };

  // Original CSS: table.positions tbody tr — KEINE Trennlinien zwischen Zeilen!
  for (const pos of positions) {
    const gesamtpreis = parseFloat(pos.gesamtpreis) || 0;
    const hasDesc = !!(pos.beschreibung && pos.beschreibung.trim());
    const descLines = hasDesc ? wrapText(pos.beschreibung, fItal, 8, COL_WIDTHS[1] - mm(2)) : [];
    const rowHeight = TD_H + (descLines.length > 0 ? mm(4.5) + mm(3.5 * (descLines.length - 1)) : 0);

    // Seitenumbruch wenn Zeile nicht mehr passt
    if (curY - rowHeight < SAFE_BOTTOM) {
      await newPage();
    }

    const tdY = curY - mm(5);
    let tx = LEFT;

    currentPage.drawText(s(pos.pos_nr), { x: tx + mm(1.4), y: tdY, size: TD_SIZE, font: fReg, color: BLACK });
    tx += COL_WIDTHS[0];

    currentPage.drawText(s(pos.bezeichnung), { x: tx + mm(1.4), y: tdY, size: TD_SIZE, font: fReg, color: BLACK });
    if (descLines.length > 0) {
      let dy = tdY - mm(4.5);
      for (const dl of descLines) {
        currentPage.drawText(dl, { x: tx + mm(1.4), y: dy, size: 8, font: fItal, color: GRAY666 });
        dy -= mm(3.5);
      }
    }
    tx += COL_WIDTHS[1];

    if (pos.menge != null) {
      const mStr = s(pos.menge);
      currentPage.drawText(mStr, {
        x: tx + COL_WIDTHS[2] - fReg.widthOfTextAtSize(mStr, TD_SIZE) - mm(1),
        y: tdY, size: TD_SIZE, font: fReg, color: BLACK
      });
    }
    tx += COL_WIDTHS[2];

    currentPage.drawText(s(pos.einheit || 'h'), { x: tx + mm(1), y: tdY, size: TD_SIZE, font: fReg, color: BLACK });
    tx += COL_WIDTHS[3];

    if (!isLS) {
      if (pos.einzelpreis != null) {
        const ep = fmtCHF(pos.einzelpreis);
        currentPage.drawText(ep, {
          x: tx + COL_WIDTHS[4] - fReg.widthOfTextAtSize(ep, TD_SIZE) - mm(1),
          y: tdY, size: TD_SIZE, font: fReg, color: BLACK
        });
      }
      tx += COL_WIDTHS[4];

      const gp = fmtCHF(gesamtpreis);
      const gpColor = gesamtpreis < 0 ? rgb(0.8, 0, 0) : BLACK;
      currentPage.drawText(gp, {
        x: tx + COL_WIDTHS[5] - fReg.widthOfTextAtSize(gp, TD_SIZE) - mm(1),
        y: tdY, size: TD_SIZE, font: fReg, color: gpColor
      });
    }

    curY -= rowHeight;
  }

  // ── TOTALS-TABELLE (nur wenn nicht Lieferschein) ──────────────────────────
  if (!isLS) {
    const TOT_SIZE = 9.5;
    const TOT_ROW_H = mm(6);
    const numTotRows = 3;
    const totHeight = numTotRows * TOT_ROW_H + mm(2);

    if (curY - totHeight < SAFE_BOTTOM) {
      await newPage();
    }

    currentPage.drawRectangle({ x: LEFT, y: curY - totHeight, width: CWIDTH, height: totHeight, color: EAEAEA });

    let ty = curY - mm(2);
    const subStr = fmtCHF(subtotal);
    currentPage.drawText('Summe Positionen ohne Mehrwertsteuer', { x: LEFT + mm(2), y: ty - mm(4), size: TOT_SIZE, font: fReg, color: BLACK });
    currentPage.drawText(subStr, { x: RIGHT - fReg.widthOfTextAtSize(subStr, TOT_SIZE) - mm(2), y: ty - mm(4), size: TOT_SIZE, font: fReg, color: BLACK });
    ty -= TOT_ROW_H;

    if (vatIncluded && vatRate > 0) {
      const vatStr = fmtCHF(vatAmount);
      const vatLbl = `zzgl. ${vatRate}% Mehrwertsteuer`;
      currentPage.drawText(vatLbl, { x: LEFT + mm(2), y: ty - mm(4), size: TOT_SIZE, font: fReg, color: BLACK });
      currentPage.drawText(vatStr, { x: RIGHT - fReg.widthOfTextAtSize(vatStr, TOT_SIZE) - mm(2), y: ty - mm(4), size: TOT_SIZE, font: fReg, color: BLACK });
    } else {
      currentPage.drawText('ohne Mehrwertsteuer', { x: LEFT + mm(2), y: ty - mm(4), size: TOT_SIZE, font: fReg, color: BLACK });
    }
    ty -= TOT_ROW_H;

    currentPage.drawLine({ start: { x: LEFT, y: ty + mm(1) }, end: { x: RIGHT, y: ty + mm(1) }, thickness: 0.75, color: BLACK });

    const totStr = fmtCHF(total);
    currentPage.drawText('Rechnungsbetrag', { x: LEFT + mm(2), y: ty - mm(4), size: TOT_SIZE, font: fBold, color: BLACK });
    currentPage.drawText(totStr, { x: RIGHT - fBold.widthOfTextAtSize(totStr, TOT_SIZE) - mm(2), y: ty - mm(4), size: TOT_SIZE, font: fBold, color: BLACK });

    curY = curY - totHeight - mm(8);
  }

  // ── SIGN-OFF (Zahlungsbedingungen, Notizen, Schlusstext, Gruss) ──────────
  const signOffMap = {
    angebot: 'Wir freuen uns, wenn diese Offerte Ihre Zustimmung findet. Bei Rückfragen stehen wir selbstverständlich jederzeit gerne zur Verfügung.',
    auftragsbestaetigung: 'Bei Rückfragen stehen wir selbstverständlich gerne zur Verfügung.',
    lieferschein: '',
    rechnung: ''
  };

  const writeLines = async (lines, size, font, color) => {
    for (const line of lines) {
      if (curY - mm(5.5) < SAFE_BOTTOM) { await newPage(); curY -= mm(3); }
      currentPage.drawText(line, { x: LEFT, y: curY, size, font, color });
      curY -= mm(5.5);
    }
  };

  if (doc.payment_terms) {
    await writeLines(wrapText('Zahlungsbedingungen: ' + doc.payment_terms, fReg, 10, CWIDTH), 10, fReg, BLACK);
    curY -= mm(3);
  }
  if (doc.notes) {
    await writeLines(wrapText(doc.notes, fReg, 10, CWIDTH), 10, fReg, BLACK);
    curY -= mm(3);
  }
  const signOffText = signOffMap[type] || '';
  if (signOffText) {
    await writeLines(wrapText(signOffText, fReg, 10, CWIDTH), 10, fReg, BLACK);
    curY -= mm(3);
  }

  if (curY - mm(16) < SAFE_BOTTOM) { await newPage(); curY -= mm(3); }
  currentPage.drawText('Mit freundlichen Grüssen', { x: LEFT, y: curY, size: 10, font: fReg, color: BLACK });
  curY -= mm(11);
  const signName = s(project.contact_person || settings.firma_name || '');
  currentPage.drawText(signName, { x: LEFT, y: curY, size: 10, font: fReg, color: BLACK });

  // ── FOOTER ───────────────────────────────────────────────────────────────
  // Originalvorlage: drei Spalten justify-content:space-between; padding 0 25mm
  // Links: Firmenname, Adresse, PLZ Ort, Land
  // Mitte: [UID ·] IBAN ... · Bankname
  // Rechts: "Seite X von Y"
  // KEINE Trennlinie (user: "die linie entfernen aus der Fusszeile")
  //
  // Feste Zonen:
  //   Links:  LEFT  .. LEFT+mm(70)
  //   Mitte:  zentriert in LEFT+mm(74) .. RIGHT-mm(22)
  //   Rechts: RIGHT-mm(20) .. RIGHT

  const FOOTER_Y    = mm(8.5);
  const FOOTER_SIZE = 7.5;
  const GRAY444     = rgb(0.267, 0.267, 0.267); // #444

  // ── Footer: echtes justify-content:space-between ───────────────────────
  const footerLeft = [
    settings.firma_name,
    settings.firma_adresse,
    [settings.firma_plz, settings.firma_ort].filter(Boolean).join(' '),
    settings.firma_land || 'Schweiz'
  ].filter(Boolean).join(', ');

  const footerMid = [
    settings.firma_uid,
    settings.firma_iban ? `IBAN ${settings.firma_iban}` : '',
    settings.firma_bank
  ].filter(Boolean).join(' · ');

  const pageStr  = `Seite 1 von ${totalPages || 1}`;
  const midW     = footerMid ? fReg.widthOfTextAtSize(footerMid, FOOTER_SIZE) : 0;
  const rightW   = fReg.widthOfTextAtSize(pageStr, FOOTER_SIZE);
  const MIN_GAP  = mm(4); // Mindestabstand zwischen den Spalten

  // Linken Text kürzen bis er mit Mitte und Rechts passt
  let fLeftText = footerLeft;
  const maxLeftW = CWIDTH - midW - rightW - MIN_GAP * 2;
  while (fLeftText.length > 5 && fReg.widthOfTextAtSize(fLeftText, FOOTER_SIZE) > maxLeftW) {
    fLeftText = fLeftText.slice(0, -4) + '…';
  }
  const leftW = fReg.widthOfTextAtSize(fLeftText, FOOTER_SIZE);

  // Verbleibender Platz aufteilen (2 Lücken zwischen 3 Texten)
  const totalUsed = leftW + midW + rightW;
  const gap       = Math.max(MIN_GAP, (CWIDTH - totalUsed) / 2);

  if (fLeftText) {
    page.drawText(fLeftText, { x: LEFT, y: FOOTER_Y, size: FOOTER_SIZE, font: fReg, color: GRAY444 });
  }
  if (footerMid) {
    page.drawText(footerMid, { x: LEFT + leftW + gap, y: FOOTER_Y, size: FOOTER_SIZE, font: fReg, color: GRAY444 });
  }
  page.drawText(pageStr, { x: RIGHT - rightW, y: FOOTER_Y, size: FOOTER_SIZE, font: fReg, color: GRAY444 });

  // ── WASSERZEICHEN (rechter Seitenrand, 6pt, gedreht 90°) ─────────────────
  // Text: "ArjensProjectTool v1.0.0" — identifiziert Nutzer des Tools
  // Position: rechter Rand (Marge), vertikal zentriert, sehr helles Grau
  const WM_SIZE  = 6;
  const WM_COLOR = rgb(0.75, 0.75, 0.75); // #bbb — subtil aber lesbar
  const wmW      = fReg.widthOfTextAtSize(WATERMARK_TEXT, WM_SIZE);
  page.drawText(WATERMARK_TEXT, {
    x:      A4_W - mm(4),               // 4mm vom rechten Seitenrand
    y:      (A4_H / 2) - (wmW / 2),    // vertikal mittig auf der Seite
    size:   WM_SIZE,
    font:   fReg,
    color:  WM_COLOR,
    rotate: degrees(90),                 // 90° gegen Uhrzeigersinn = von unten nach oben
  });

  return total;


}

// ── SEITE 2: SWISS QR-ZAHLTEIL ────────────────────────────────────────────────
/**
 * Exakt nach buildQrSlipHtml() aus generator.js:
 *
 * Horizontale Perforation: top=192mm (von Blattrand)
 * Vertikale Perforation:   left=62mm
 *
 * Empfangsschein: left=5mm, top=197mm, width=52mm, height=95mm
 * Zahlteil:       left=67mm, top=197mm, width=138mm, height=95mm
 *
 * CSS-Klassen → pdf-lib Koordinaten:
 *   .ef-konto-lbl top=9mm    → 197+9=206mm
 *   .ef-konto-val top=12mm   → 197+12=209mm
 *   .ef-w-lbl top=66mm       → 197+66=263mm
 *   .ef-w-val top=70mm       → 197+70=267mm
 *   .ef-annahme top=80mm     → 197+80=277mm
 *   .zt-qr top=12mm          → 197+12=209mm
 *   .zt-w-lbl top=66mm       → 263mm
 *   .zt-w-val top=70mm       → 267mm
 */
async function drawQrSlipPage(pdfDoc, { doc, project, settings, total }) {
  const page = pdfDoc.addPage([A4_W, A4_H]);
  const fReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const BLACK = rgb(0, 0, 0);

  const ibanFormatted = formatIban(settings.firma_iban);
  const creditorLines = [
    ibanFormatted,
    settings.firma_name,
    settings.firma_adresse,
    [settings.firma_plz, settings.firma_ort].filter(Boolean).join(' ')
  ].filter(Boolean);

  const debtorName = project.customer_company || project.customer_name || '';
  const debtorLines = debtorName ? [
    debtorName,
    project.customer_address,
    [project.customer_plz, project.customer_ort].filter(Boolean).join(' ')
  ].filter(Boolean) : [];

  // Betrag-Format gem. Swiss QR-Standard: Leerzeichen als Tausendertrennzeichen
  const amtDisplay = total > 0
    ? total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    : '';

  const docNum = `${doc.base_number}-${String(doc.version).padStart(2, '0')}`;
  const msgText = `Rechnung Nr. ${docNum}`;

  // QR-Code als PNG DataURL generieren
  const payload = buildQrPayload({ doc, project, settings, total });
  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 300,
    color: { dark: '#000000', light: '#ffffff' }
  });
  const qrBytes  = dataUrlToBytes(qrDataUrl);
  const qrImage  = await pdfDoc.embedPng(qrBytes);

  // Swiss Cross
  const crossDataUrl  = await generateSwissCrossPng();
  const crossBytes    = dataUrlToBytes(crossDataUrl);
  const crossImage    = await pdfDoc.embedPng(crossBytes);

  // ── PERFORATIONSLINIEN ────────────────────────────────────────────────────
  // .hl-l: top=192mm, left=0, width=202.5mm
  // .hl-r: top=192mm, left=204.8mm, width=5.2mm
  // .vl-t: left=62mm, top=192mm, height=102mm

  const PERF_H_Y = fromTop(192);  // Y der horizontalen Linie
  const PERF_V_X = mm(62);        // X der vertikalen Linie

  page.drawLine({ start: { x: 0, y: PERF_H_Y }, end: { x: mm(202.5), y: PERF_H_Y }, thickness: 0.3, color: BLACK });
  page.drawLine({ start: { x: mm(204.8), y: PERF_H_Y }, end: { x: mm(210), y: PERF_H_Y }, thickness: 0.3, color: BLACK });
  page.drawLine({ start: { x: PERF_V_X, y: PERF_H_Y }, end: { x: PERF_V_X, y: 0 }, thickness: 0.3, color: BLACK });

  // Scheren-Symbol horizontal — als PNG eingebettet (3mm × 1.5mm)
  const scissorHDataUrl = await generateScissorPng(false);
  const scissorHBytes   = dataUrlToBytes(scissorHDataUrl);
  const scissorHImage   = await pdfDoc.embedPng(scissorHBytes);
  page.drawImage(scissorHImage, {
    x: mm(201.5), y: PERF_H_Y - mm(1.5),
    width: mm(3), height: mm(1.5)
  });

  // Scheren-Symbol vertikal — gedreht (1.5mm × 3mm)
  const scissorVDataUrl = await generateScissorPng(true);
  const scissorVBytes   = dataUrlToBytes(scissorVDataUrl);
  const scissorVImage   = await pdfDoc.embedPng(scissorVBytes);
  page.drawImage(scissorVImage, {
    x: PERF_V_X - mm(0.75), y: mm(3.5),
    width: mm(1.5), height: mm(3)
  });

  // ── EMPFANGSSCHEIN (EF) ───────────────────────────────────────────────────
  // .ef: left=5mm, top=197mm (absolute from page top)

  const EF_LEFT = mm(5);
  const EF_TOP_MM = 197; // mm von Blattrand oben

  // .ef-title: font-size=11pt, font-weight=bold, top=0 rel. zu ef → 197mm abs.
  page.drawText('Empfangsschein', {
    x: EF_LEFT, y: fromTop(EF_TOP_MM),
    size: 11, font: fBold, color: BLACK
  });

  // .ef-konto-lbl: font-size=6pt, top=9mm rel → 206mm abs
  page.drawText('Konto / Zahlbar an', {
    x: EF_LEFT, y: fromTop(EF_TOP_MM + 9),
    size: 6, font: fBold, color: BLACK
  });

  // .ef-konto-val: font-size=8pt, line-height=9pt, top=12mm rel → 209mm abs
  // width=52mm
  {
    let ly = fromTop(EF_TOP_MM + 12);
    for (const line of creditorLines) {
      page.drawText(s(line), { x: EF_LEFT, y: ly, size: 8, font: fReg, color: BLACK, maxWidth: mm(52) });
      ly -= mm(3.5); // ~9pt in mm
    }
  }

  // .ef-debtor: dynamisch ab (12 + (1+creditorLines.length)*4.5 + 5)mm rel
  const efDebtorTopRel = 12 + (1 + creditorLines.length) * 4.5 + 5;
  if (debtorLines.length > 0) {
    page.drawText('Zahlbar durch', {
      x: EF_LEFT, y: fromTop(EF_TOP_MM + efDebtorTopRel),
      size: 6, font: fBold, color: BLACK
    });
    let dy = fromTop(EF_TOP_MM + efDebtorTopRel + 4);
    for (const line of debtorLines) {
      page.drawText(s(line), { x: EF_LEFT, y: dy, size: 8, font: fReg, color: BLACK, maxWidth: mm(52) });
      dy -= mm(3.5);
    }
  }

  // .ef-w-lbl: top=66mm → 263mm, .ef-w-val: top=70mm → 267mm
  page.drawText('Währung', { x: EF_LEFT, y: fromTop(EF_TOP_MM + 66), size: 6, font: fBold, color: BLACK });
  page.drawText('CHF',     { x: EF_LEFT, y: fromTop(EF_TOP_MM + 70), size: 8, font: fReg, color: BLACK });

  // .ef-b-lbl: top=66mm left=22mm, .ef-b-val: top=70mm left=22mm
  page.drawText('Betrag', { x: EF_LEFT + mm(22), y: fromTop(EF_TOP_MM + 66), size: 6, font: fBold, color: BLACK });
  if (amtDisplay) {
    page.drawText(amtDisplay, { x: EF_LEFT + mm(22), y: fromTop(EF_TOP_MM + 70), size: 8, font: fReg, color: BLACK });
  }

  // .ef-annahme: top=80mm right=0 rel zu ef-right-edge (5+52=57mm)
  const annText = 'Annahmestelle';
  page.drawText(annText, {
    x: mm(57) - fBold.widthOfTextAtSize(annText, 6),
    y: fromTop(EF_TOP_MM + 80),
    size: 6, font: fBold, color: BLACK
  });

  // ── ZAHLTEIL (ZT) ─────────────────────────────────────────────────────────
  // .zt: left=67mm, top=197mm

  const ZT_LEFT = mm(67);
  const ZT_TOP_MM = 197;

  // .zt-title: font-size=11pt, top=0 rel → 197mm abs
  page.drawText('Zahlteil', {
    x: ZT_LEFT, y: fromTop(ZT_TOP_MM),
    size: 11, font: fBold, color: BLACK
  });

  // .zt-qr: top=12mm, left=0 rel → left=67mm, top=209mm abs, width=46mm height=46mm
  const QR_SIZE = mm(46);
  const QR_Y_TOP = ZT_TOP_MM + 12; // mm

  page.drawImage(qrImage, {
    x: ZT_LEFT,
    y: fromTop(QR_Y_TOP + 46), // fromTop gibt den unteren Rand an
    width: QR_SIZE, height: QR_SIZE
  });

  // Swiss Cross: zentriert über QR-Code, 7mm × 7mm
  const CROSS_SIZE = mm(7);
  page.drawImage(crossImage, {
    x: ZT_LEFT + (QR_SIZE - CROSS_SIZE) / 2,
    y: fromTop(QR_Y_TOP + 46) + (QR_SIZE - CROSS_SIZE) / 2,
    width: CROSS_SIZE, height: CROSS_SIZE
  });

  // .zt-w-lbl top=66mm, .zt-w-val top=70mm (8pt/10pt)
  page.drawText('Währung', { x: ZT_LEFT, y: fromTop(ZT_TOP_MM + 66), size: 8, font: fBold, color: BLACK });
  page.drawText('CHF',     { x: ZT_LEFT, y: fromTop(ZT_TOP_MM + 70), size: 10, font: fReg, color: BLACK });

  page.drawText('Betrag', { x: ZT_LEFT + mm(22), y: fromTop(ZT_TOP_MM + 66), size: 8, font: fBold, color: BLACK });
  if (amtDisplay) {
    page.drawText(amtDisplay, { x: ZT_LEFT + mm(22), y: fromTop(ZT_TOP_MM + 70), size: 10, font: fReg, color: BLACK });
  }

  // ── ZT-INFO SPALTE (rechts im Zahlteil) ──────────────────────────────────
  // .zt-info: left=51mm rel zu zt → left=67+51=118mm, top=0 rel → 197mm abs
  // .zt-info-lbl: 8pt bold, margin-top=7.5mm (außer .first: margin-top=0)
  // .zt-info-val: 10pt, line-height=11pt, margin-top=1mm

  const INFO_LEFT = ZT_LEFT + mm(51);   // 118mm abs
  let infoY = fromTop(ZT_TOP_MM);        // Start bei 197mm abs

  // Konto / Zahlbar an (first, kein margin-top)
  page.drawText('Konto / Zahlbar an', { x: INFO_LEFT, y: infoY, size: 8, font: fBold, color: BLACK });
  infoY -= mm(4); // margin-top=1mm + line-height
  for (const line of creditorLines) {
    page.drawText(s(line), { x: INFO_LEFT, y: infoY, size: 10, font: fReg, color: BLACK, maxWidth: mm(87) });
    infoY -= mm(4.5); // line-height ~11pt ≈ 3.9mm + Abstand
  }

  // Zusätzliche Informationen (margin-top=7.5mm)
  infoY -= mm(3.5);
  page.drawText('Zusätzliche Informationen', { x: INFO_LEFT, y: infoY, size: 8, font: fBold, color: BLACK });
  infoY -= mm(4);
  page.drawText(s(msgText), { x: INFO_LEFT, y: infoY, size: 10, font: fReg, color: BLACK, maxWidth: mm(87) });
  infoY -= mm(4.5);

  // Zahlbar durch (margin-top=7.5mm)
  if (debtorLines.length > 0) {
    infoY -= mm(3.5);
    page.drawText('Zahlbar durch', { x: INFO_LEFT, y: infoY, size: 8, font: fBold, color: BLACK });
    infoY -= mm(4);
    for (const line of debtorLines) {
      page.drawText(s(line), { x: INFO_LEFT, y: infoY, size: 10, font: fReg, color: BLACK, maxWidth: mm(87) });
      infoY -= mm(4.5);
    }
  }
}

// ── HAUPTFUNKTIONEN ───────────────────────────────────────────────────────────

export async function generatePdf({ doc, project, positions, settings }) {
  const pdfDoc = await PDFDocument.create();

  const logoDataUrl  = settings.logo_data || null;
  const totalPages   = doc.type === 'rechnung' ? 2 : 1;
  const total = await drawInvoicePage(pdfDoc, { doc, project, positions, settings, logoDataUrl, totalPages });

  if (doc.type === 'rechnung') {
    await drawQrSlipPage(pdfDoc, { doc, project, settings, total });
  }

  return await pdfDoc.save();
}

export async function downloadPdf({ doc, project, positions, settings }) {
  const pdfBytes = await generatePdf({ doc, project, positions, settings });

  // PDF in neuem Tab öffnen (wie die Vorlagesoftware mit /api/documents/id/pdf)
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Speicher nach 60s freigeben (Nutzer hat dann Zeit das PDF zu speichern)
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
