# Liftygo Drive Upload – Cloud Run

שירות קטן שמחליף את נקודת ה־WordPress `create-folder-and-upload` כש־**Cloudflare / האחסון** חותכים גוף JSON גדול או גורמים ל־timeout.

## למה זה פותר?

- הבקשה לא עוברת דרך וורדפרס ולא דרך Cloudflare (אם משתמשים בכתובת `*.run.app` או בסאבדומיין ב־DNS only).
- timeout של Cloud Run אפשר להגדיל (למשל 300 שניות).
- גבול גוף: עד ~32MB לבקשה (מספיק לכמה תמונות מדוחסות).

## דרישות בגוגל

1. **Google Cloud Project** + הפעלת **Cloud Run API**.
2. **Service Account** עם תפקיד **Editor** על הפרויקט (או לפחות גישה לדרייב דרך scope – בפועל משתמשים ב־JSON של ה־SA).
3. **איפה יושבת תיקיית השורש (`DRIVE_ROOT_FOLDER_ID`)** — זה הקריטי ביותר:
   - **My Drive של משתמש Gmail רגיל** (תיקייה שבבעלות `...@gmail.com` ושיתפת עליה את ה־SA כעורך): יצירת תיקיית משנה לפעמים עובדת, אבל **העלאת קבצים (מדיה)** עלולה להיכשל עם  
     `403` / `storageQuotaExceeded` —  
     *"Service Accounts do not have storage quota … use shared drives or OAuth delegation"*.  
     זו מגבלה של גוגל: **ל־Service Account אין מכסת אחסון לקבצים בתוך ה־My Drive של משתמש רגיל**, גם אם שיתפת עורך.
   - **פתרון מומלץ (ארגון עם Google Workspace):** ליצור **Shared drive** (כונן משותף), להוסיף את ה־Service Account כחבר עם הרשאת **Content manager** (או מנהל), וליצור את תיקיית השורש **בתוך** אותו Shared drive. עדכן את `DRIVE_ROOT_FOLDER_ID` ל־ID של אותה תיקייה. השרת כבר שולח `supportsAllDrives: true` בקריאות Drive.
   - **פתרון בלי Shared drive (למשל Gmail חינמי):** להעלות בשם המשתמש עם **OAuth** (משתמש אנושי מאשר פעם אחת, שומרים refresh token בשרת) — דורש שינוי קוד; אי אפשר לפתור רק בשיתוף תיקייה ל־SA.
4. אם כן משתמשים בתרחיש שבו שיתוף ל־SA מספיק (למשל Shared drive): **שתף** את התיקייה / את ה־Shared drive עם מייל ה־Service Account עם הרשאה מתאימה.

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

## Service Account מול OAuth

השירות כרגע משתמש ב־**Service Account** בלבד. לפי מדיניות Drive, **אין להסתמך על שיתוף תיקייה ב־My Drive של Gmail** כדי לאפשר העלאת קבצים ב־SA — זה בדיוק המצב שבו מופיעה השגיאה על quota.  
אם אין לכם **Shared drive**, צפו להרחיב את השירות ל־**OAuth של משתמש** (אותו `liftygo.service@gmail.com` או אחר) לפעולות `files.create` עם מדיה.
