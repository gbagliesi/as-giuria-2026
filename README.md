# Art & Science — Sito votazione giuria

Sito statico per la votazione online della giuria di una mostra Art & Science.  
Ogni giurato riceve un link personale; i voti vengono salvati su Google Sheets tramite Apps Script.  
Una pagina separata (URL segreto) mostra la classifica in tempo reale.

---

## Requisiti

- Account **GitHub** con GitHub Pages abilitato (piano free su repo pubblico)
- Account **Google** per Google Sheets + Apps Script
- Python 3 con `openpyxl` (`pip3 install openpyxl`)
- ImageMagick (`brew install imagemagick` su macOS)

---

## Struttura del progetto

```
index.html      ← pagina di voto (accesso tramite URL personale ?j=TOKEN)
results-*.html  ← classifica live (URL comunicato privatamente)
data/
  opere.json    ← opere da votare (generato da scripts/generate_opere.py)
  config.json   ← criteri di voto, pesi, formula — modificabile senza toccare il codice
photos/         ← foto delle opere ridimensionate per il web
js/
  voting.js     ← logica pagina di voto
  results.js    ← logica classifica con ordinamento per colonna
css/style.css
appscript/
  Code.gs       ← Google Apps Script (NON committare con i token reali)
scripts/
  generate_opere.py   ← genera data/opere.json dall'Excel
  generate_tokens.py  ← genera i token personali per i giurati
  resize_photos.sh    ← ridimensiona le foto per il web
```

---

## Setup (passo per passo)

### 1. Prepara i dati delle opere

Il file Excel sorgente deve avere queste colonne:  
`N. | Titolo | Descrizione | Autore | Punteggio campionato | Scuola`  
(una riga per autore; N./Titolo/Descrizione/Scuola solo sulla prima riga dell'opera)

Modifica il percorso del file in `scripts/generate_opere.py`, poi esegui:

```bash
python3 scripts/generate_opere.py
```

Questo genera `data/opere.json`.

### 2. Ridimensiona le foto

Le foto devono essere nominate `NN_*.jpg` (es. `01_foto.jpg`, `23_foto.jpg`).  
Mettile in una cartella `Photos/` al livello superiore, poi:

```bash
bash scripts/resize_photos.sh
```

Genera le immagini ottimizzate in `photos/`.

### 3. Google Sheets + Apps Script

1. Crea un nuovo Google Spreadsheet
2. Apri **Extensions → Apps Script**
3. Incolla il contenuto di `appscript/Code.gs`
4. Esegui la funzione **`setupSheets`** una sola volta (crea i fogli "Voti" e "Config")
5. **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copia l'URL della web app

### 4. Genera i token dei giurati

Modifica l'elenco dei giurati in `scripts/generate_tokens.py`, poi:

```bash
python3 scripts/generate_tokens.py
```

L'output mostra:
- Il blocco `const TOKENS = { ... }` → incollalo in `Code.gs` (sezione TOKENS) e rideploya lo script
- Gli URL personali da inviare per email a ciascun giurato

### 5. Configura l'URL Apps Script

In `js/voting.js` e `js/results.js`, riga 1, sostituisci:
```js
const APPS_SCRIPT_URL = 'REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL';
```
con l'URL ottenuto al passo 3.

### 6. Pubblica su GitHub Pages

```bash
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/TUO_USERNAME/NOME_REPO.git
git push -u origin main
```

Su GitHub: **Settings → Pages → Source: main / root → Save**

Il sito sarà disponibile su `https://TUO_USERNAME.github.io/NOME_REPO/`

---

## Gestione votazioni

| Operazione | Come |
|---|---|
| Chiudere le votazioni | Google Sheet "Config" → cella B1 → `FALSE` |
| Cancellare voti di test | Google Sheet "Voti" → elimina tutte le righe tranne la prima (header) |
| Modificare criteri/pesi | Edita `data/config.json` + aggiorna `SCORING_CONFIG` in `Code.gs` e rideploya |
| Rigenera opere.json | `python3 scripts/generate_opere.py` |

---

## Formula di calcolo del punteggio

Configurabile in `data/config.json` (e `SCORING_CONFIG` in `Code.gs`):

1. Per ogni criterio: media dei voti > 0 (voto 0 = astenuto, escluso dalla media)
2. Media ponderata dei criteri (i pesi sono in `config.json`)
3. Bonus campionato: `max_punteggio_membro / divisore × peso`
4. Punteggio finale = media criteri + bonus campionato

---

## Sicurezza

- Ogni giurato ha un token opaco nell'URL (es. `?j=a1b2c3d4e5f6`) — non indovinabile
- I token sono salvati solo nell'Apps Script (non nel repo pubblico)
- La pagina classifica ha un URL con suffisso casuale — comunicato solo a chi deve vederla
- Il repo può essere pubblico: non contiene dati sensibili
