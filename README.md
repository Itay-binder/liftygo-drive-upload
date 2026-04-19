# Liftygo Drive Upload – Cloud Run

שירות קטן שמחליף את נקודת ה־WordPress `create-folder-and-upload` כש־**Cloudflare / האחסון** חותכים גוף JSON גדול או גורמים ל־timeout.

## למה זה פותר?

- הבקשה לא עוברת דרך וורדפרס ולא דרך Cloudflare (אם משתמשים בכתובת `*.run.app` או בסאבדומיין ב־DNS only).
- timeout של Cloud Run אפשר להגדיל (למשל 300 שניות).
- גבול גוף: עד ~32MB לבקשה (מספיק לכמה תמונות מדוחסות).

## דרישות בגוגל

1. **Google Cloud Project** + הפעלת **Cloud Run API**.
2. **Service Account** עם תפקיד **Editor** על הפרויקט (או לפחות גישה לדרייב דרך scope – בפועל משתמשים ב־JSON של ה־SA).
3. בתיקיית הדרייב הראשית (אותו `folder_id` כמו ב־`LIFTYGO_DRIVE_ROOT_FOLDER_ID` ב־PHP):  
   **שתף את התיקייה** עם כתובת המייל של ה־Service Account (נראית כמו `xxx@yyy.iam.gserviceaccount.com`) עם הרשאה **עורך**.  
   בלי זה יצירת תיקייה או העלאה ייכשלו.

## משתני סביבה (Cloud Run)

| משתנה | חובה | הסבר |
|--------|------|------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | כן | מחרוזת JSON מלאה של קובץ ה־Service Account (ב־Secret Manager מומלץ) |
| `DRIVE_ROOT_FOLDER_ID` | כן | מזהה תיקיית האב בדרייב (כמו בקונסטנטה ב־PHP) |
| `UPLOAD_SECRET` | מומלץ | מחרוזת סודית; הדפדפן חייב לשלוח כותרת `X-Liftygo-Upload-Secret` עם אותו ערך |

## פריסה (דוגמה)

```bash
cd cloud-run-drive-upload

# בנייה והעלאה – מחליף PROJECT_ID ואזור
gcloud run deploy liftygo-drive-upload \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-secrets="GOOGLE_SERVICE_ACCOUNT_JSON=liftygo-sa-json:latest" \
  --set-env-vars="DRIVE_ROOT_FOLDER_ID=YOUR_FOLDER_ID,UPLOAD_SECRET=YOUR_RANDOM_SECRET"
```

אם לא משתמשים ב־Secret Manager אלא ב־env ישיר (פחות מומלץ):

```bash
--set-env-vars="GOOGLE_SERVICE_ACCOUNT_JSON=$(cat service-account.json | jq -c . | sed 's/"/\\"/g')..."
```

(נוח יותר דרך קונסולת GCP: Edit & deploy → Variables & secrets.)

## חיבור לאתר

1. אחרי הפריסה תקבל URL בסגנון:  
   `https://liftygo-drive-upload-xxxxx-ew.a.run.app`
2. ב־`script.js` של הטופס עדכן:

```js
const DRIVE_UPLOAD_API_URL = 'https://YOUR-SERVICE-xxxxx.run.app/create-folder-and-upload';
```

או הגדר בדף (לפני טעינת הסקריפט):

```html
<script>window.LIFTYGO_DRIVE_API_URL = 'https://....run.app/create-folder-and-upload';</script>
```

ואז בסקריפט (אם תוסיף תמיכה): לקרוא מ־`window.LIFTYGO_DRIVE_API_URL`.

3. אם הגדרת `UPLOAD_SECRET`, ב־`fetch` הוסף כותרת:

```js
headers: {
  'Content-Type': 'application/json',
  'X-Liftygo-Upload-Secret': 'אותו סוד כמו בשרת',
},
```

## בדיקה

```bash
curl -s https://YOUR-URL/health
```

צריך להחזיר `{"ok":true}`.

## OAuth מול Service Account

השירות הזה משתמש ב־**Service Account** בלבד. אם בעבר השתמשת ב־OAuth משתמש ב־PHP בגלל מכסה – ב־SA התיקייה חייבת להיות תחת תיקייה ששותפה ל־SA (כמו למעלה). אם צריך שוב OAuth משתמש, אפשר להרחיב את השירות בעתיד.
