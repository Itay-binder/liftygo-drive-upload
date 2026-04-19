# moving-wizard-fixed

דוגמה מצומצמת לטופס **הובלה קטנה** עם העלאה ל־Cloud Run (`create-folder-and-upload`).

## למה זה שונה מהקוד הישן

1. **המדיה נשמרת על אובייקט השורה** (`row._lwMedia`) ברגע בחירת הקובץ — לא מסתמכים רק על `img.src` בשליחה (פחות תקלות מסנכרון / דפדפן).
2. **הודעת שגיאה מהשרת** — אם Drive מחזיר `upload_errors`, הן מוצגות ב־`#lwAlert`.
3. **הסוד** — ב־`index.html` ברירת המחדל ל־`LIFTYGO_UPLOAD_SECRET` ריקה. בוורדפרס הוסיפו לפני `wizard.js`:

```html
<script>
  window.LIFTYGO_UPLOAD_SECRET = 'הסוד_שלך';
</script>
```

## שרת Cloud Run

יש לפרוס מחדש את [liftygo-drive-upload](../liftygo-drive-upload) אחרי עדכון `server.mjs` (מדיה דרך `Readable.from(buf)` + שמות קבצים מסוננים + base64 עמיד יותר).

## בדיקה מקומית

פתחו את `index.html` דרך שרת סטטי (לא `file://` אם CORS חוסם), למשל:

```powershell
cd moving-wizard-fixed
npx --yes serve .
```

או העלו את שלושת הקבצים לוורדפרס (מדיה בפריט מותאם אישית / בלוק HTML).
