# Offerte bis Rechnung

> CHF 10 pro Monat hier, CHF 20 pro Monat da – und schon ist das hart verdiente Geld weg.

Es frustriert mich, dass für grundlegende administrative Aufgaben wie das Erstellen einer simplen Offerte oder QR-Rechnung oft teure Software-Abos vorausgesetzt werden. Gerade für kleine Firmen, Freelancer und Kreative summiert sich das schnell zu einer unnötigen finanziellen Belastung.

Deswegen habe ich beschlossen, eine Alternative zu entwickeln und für alle kostenlos zugänglich zu machen.

**👉 [offerte-bis-rechnung.ch](https://offerte-bis-rechnung.ch)**

---

## Was kann das Tool?

Der komplette administrative Basis-Ablauf – alles in einem:

- 📄 **Offerte** – professionelle Angebote erstellen
- ✅ **Auftragsbestätigung** – Aufträge schriftlich bestätigen
- 📦 **Lieferschein** – Lieferungen dokumentieren
- 🧾 **Rechnung** – inkl. Swiss QR-Bill nach v2.3 Standard

Alle Dokumente werden direkt als PDF generiert und sind sofort versandbereit.

---

## Die wichtigsten Eckdaten

| | |
|---|---|
| 💳 | Komplett kostenlos nutzbar |
| 🕵️ | Kein Login oder Benutzerkonto erforderlich |
| 💾 | Keine Software-Installation nötig |
| 🔐 | Voller Datenschutz: Datenverarbeitung ausschliesslich lokal im eigenen Browser |
| 🇨🇭 | Swiss QR-Bill nach offiziellem v2.3 Standard |

---

## Wie funktioniert es?

Die App läuft **vollständig im Browser**. Alle Daten (Projekte, Dokumente, Einstellungen) werden lokal in deinem Browser gespeichert (IndexedDB) – nichts wird auf externe Server übertragen. PDF-Generierung, Swiss QR-Bill und alle Berechnungen erfolgen direkt im Browser.

Kein Server. Keine monatlichen Kosten. Für alle.

---

## Technik

- **Vite** – Build-Tool
- **pdf-lib** – PDF-Generierung im Browser
- **idb** – IndexedDB Wrapper
- **qrcode** – QR-Code Generierung für Swiss QR-Bill

---

## Selbst hosten / lokal ausführen

```bash
git clone https://github.com/wandelbar/offerte-bis-rechnung.git
cd offerte-bis-rechnung
npm install
npm run dev
```

---

## Mein Ziel

Prozesse so einfach und kostengünstig wie möglich zu gestalten. Nur so wird es für kleine Unternehmen und Kreative auch in Zukunft möglich sein, wirtschaftlich zu arbeiten und am Markt zu bestehen.

Testet das Tool gerne bei eurem nächsten Auftrag. Wenn es euren Arbeitsalltag erleichtert, hat es seinen Zweck erfüllt.

---

## Support

Wenn dir das Tool nützlich ist und du die Weiterentwicklung unterstützen möchtest:

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-☕-FFDD00?style=flat&labelColor=000000)](https://buymeacoffee.com/arjenhoti)

---

## Lizenz

[MIT](LICENSE)
