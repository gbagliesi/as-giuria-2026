#!/usr/bin/env python3
"""
Genera data/opere.json dall'Excel opere-pisa-classifica.xlsx
Eseguire dalla directory voting-site/:
    python3 scripts/generate_opere.py
"""
import json
import os
import glob

EXCEL_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'opere-pisa-classifica.xlsx')
PHOTOS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'Photos')
OUT_PATH   = os.path.join(os.path.dirname(__file__), '..', 'data', 'opere.json')

try:
    import openpyxl
except ImportError:
    print("Installa openpyxl: pip3 install openpyxl")
    raise

def find_photo(n):
    """Cerca il file foto con prefisso NN nella directory Photos."""
    prefix = f"{n:02d}_"
    matches = glob.glob(os.path.join(PHOTOS_DIR, prefix + '*'))
    if matches:
        return os.path.basename(matches[0])
    return None

wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
ws = wb.active
rows = list(ws.iter_rows(values_only=True))[1:]  # salta header

opere = []
current = None

for row in rows:
    if row[0] is not None:
        # Nuova opera
        if current:
            opere.append(current)
        members = []
        if row[3] is not None and row[4] is not None:
            members.append({'nome': row[3], 'punteggio': float(row[4]) if row[4] else 0})
        current = {
            'n':          int(row[0]),
            'titolo':     row[1] or '',
            'descrizione': row[2] or '',
            'autori':     members,
            'scuola':     row[5] or '',
        }
    elif current and row[3] is not None:
        current['autori'].append({
            'nome':       row[3],
            'punteggio':  float(row[4]) if row[4] else 0
        })

if current:
    opere.append(current)

# Calcola campionato_max e photo
for op in opere:
    scores = [m['punteggio'] for m in op['autori'] if m['punteggio'] and m['punteggio'] > 0]
    op['campionato_max']  = max(scores) if scores else 0
    op['nomi_autori']     = [m['nome'] for m in op['autori']]
    # Rimuovi il dict dettagliato (non serve nel JSON del sito)
    del op['autori']
    op['photo'] = find_photo(op['n'])

# Ordina per numero opera
opere.sort(key=lambda x: x['n'])

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(opere, f, ensure_ascii=False, indent=2)

print(f"Scritte {len(opere)} opere in {OUT_PATH}")
for op in opere:
    foto = op['photo'] or 'MANCANTE'
    print(f"  Opera {op['n']:2d}: {op['titolo'][:40]:40s}  foto={foto}")
