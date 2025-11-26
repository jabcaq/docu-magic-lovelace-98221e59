# Dokumentacja systemu DocuMagic

## Rodzaje dokumentów realizowane przez tłumacza.pl

### Dokumenty samochodowe

- Faktury zakupu pojazdu (umowy kupna-sprzedaży, faktury VAT, rachunki)
- Dowody rejestracyjne pojazdów z zagranicy (np. niemieckie Fahrzeugbrief, Fahrzeugsschein)
- Karty pojazdu
- Certyfikaty zgodności (COC)
- Upoważnienia do użytkowania pojazdu za granicą
- Ubezpieczenia OC, Zielone Karty
- Dokumenty celne i wywozowe (np. Ausfuhrbescheinigung)

### Dokumenty urzędowe

- Akty urodzenia, małżeństwa, zgonu
- Zaświadczenia o zameldowaniu, niekaralności

### Dokumenty firmowe i prawne

- Umowy cywilnoprawne, pełnomocnictwa
- Wyciągi z rejestrów handlowych
- Statuty, regulaminy firmowe

### Dokumenty identyfikacyjne

- Dowody osobiste, paszporty, prawo jazdy zagraniczne

### Dokumenty edukacyjne

- Dyplomy, świadectwa ukończenia szkoły
- Suplementy i zaświadczenia o przebiegu nauki

### Inne

- Dokumentacja medyczna
- Wyciągi bankowe, zaświadczenia finansowe
- Listy referencyjne, rekomendacje

---

## System generowania szablonów DOCX

### Główna funkcja: `process-docx-template`

Funkcja Edge w Supabase odpowiedzialna za:
1. Pobranie oryginalnego pliku DOCX z storage
2. Ekstrakcję tekstu z tagów `<w:t>` w XML
3. Analizę AI do identyfikacji zmiennych
4. Podmianę tekstu na placeholdery `{{nazwaZmiennej}}`
5. **Zachowanie pełnego formatowania** (tabele, style, obrazki)
6. Zwrócenie gotowego szablonu DOCX

### Obsługiwane zmienne (przykłady)

| Typ danych | Przykładowe tagi |
|------------|-----------------|
| Dane osobowe | `{{ownerName}}`, `{{buyerName}}`, `{{driverName}}` |
| Adresy | `{{ownerAddress}}`, `{{companyAddress}}`, `{{streetAddress}}` |
| Pojazd | `{{vinNumber}}`, `{{plateNumber}}`, `{{vehicleMake}}`, `{{vehicleModel}}` |
| Daty | `{{issueDate}}`, `{{expiryDate}}`, `{{birthDate}}` |
| Kwoty | `{{totalAmount}}`, `{{taxAmount}}`, `{{netPrice}}`, `{{grossPrice}}` |
| Numery dokumentów | `{{invoiceNumber}}`, `{{policyNumber}}`, `{{mrnNumber}}` |
| Lokalizacja | `{{city}}`, `{{country}}`, `{{postalCode}}` |
| Dane techniczne | `{{engineCapacity}}`, `{{enginePower}}`, `{{vehicleWeight}}` |

### Providery AI

System wspiera dwa providery AI:

1. **Lovable AI** (domyślny)
   - Endpoint: `https://ai.gateway.lovable.dev/v1/chat/completions`
   - Model: `google/gemini-2.5-flash`
   - Zmienna środowiskowa: `LOVABLE_API_KEY`

2. **OpenRouter**
   - Endpoint: `https://openrouter.ai/api/v1/chat/completions`
   - Model: `google/gemini-2.0-flash-001`
   - Zmienna środowiskowa: `OPEN_ROUTER_API_KEY`

### Flow przetwarzania dokumentu

```
1. Upload DOCX → Storage
       ↓
2. Ekstrakcja document.xml z ZIP
       ↓
3. Parsowanie tagów <w:t> (teksty)
       ↓
4. Analiza AI → identyfikacja zmiennych
       ↓
5. Podmiana tekstów na {{tagi}}
       ↓
6. Aktualizacja document.xml w ZIP
       ↓
7. Generowanie nowego DOCX
```

### Kluczowe zalety

- ✅ **Zachowanie formatowania** - tabele, style, obrazki, nagłówki/stopki
- ✅ **Podmiana w miejscu** - modyfikacja tylko `<w:t>` bez niszczenia struktury
- ✅ **Wsparcie dla OpenRouter** - alternatywa dla Lovable AI
- ✅ **Automatyczna identyfikacja** - AI rozpoznaje typy danych
- ✅ **Pobieranie szablonu** - gotowy DOCX do użycia

### Struktura bazy danych

```sql
-- Dokumenty
documents (
  id, user_id, name, type, storage_path,
  xml_content,      -- Przetworzony XML z {{tags}}
  runs_metadata,    -- Metadane runów z formatowaniem
  status, analysis_approach
)

-- Pola dokumentu (zmienne)
document_fields (
  id, document_id, field_name, field_tag,
  field_value,      -- Oryginalna wartość
  position_in_html, run_formatting
)

-- Szablony
templates (
  id, user_id, name, storage_path,
  original_document_id, tag_metadata
)
```

---

## Obsługiwane języki

Najczęściej: niemiecki, angielski, francuski, holenderski, włoski, hiszpański.
Inne języki dostępne na zapytanie.

Wszystkie tłumaczenia mogą być realizowane jako:
- **Tłumaczenia przysięgłe** - oficjalnie uznane przez urzędy w Polsce
- **Tłumaczenia zwykłe** - na użytek własny, biznesowy
