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
   - **פתרון בלי Shared drive (Gmail פרטי):** להגדיר ב־Cloud Run את משתני **OAuth משתמש** (ראו למטה). השרת ישתמש ב־refresh token של חשבון ה־Gmail — ההעלאות יורדו ממכסת הדרייב של אותו משתמש.
4. אם כן משתמשים בתרחיש שבו שיתוף ל־SA מספיק (למשל Shared drive): **שתף** את התיקייה / את ה־Shared drive עם מייל ה־Service Account עם הרשאה מתאימה.

## משתני סביבה (Cloud Run)

| משתנה | חובה | הסבר |
|--------|------|------|
| `DRIVE_ROOT_FOLDER_ID` | כן | מזהה תיקיית האב בדרייב (אצל Gmail: תיקייה ב־My Drive של אותו משתמש שאישר OAuth) |
| `UPLOAD_SECRET` | מומלץ | מחרוזת סודית; הדפדפן חייב כותרת `X-Liftygo-Upload-Secret` |
| **אחת משתי קבוצות אימות** | | |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | אופציונלי* | JSON של Service Account — מתאים בעיקר ל־**Shared drive** |
| `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` + `GOOGLE_OAUTH_REFRESH_TOKEN` | אופציונלי* | **Gmail / My Drive** — שלושתם יחד; כשהם מוגדרים השרת **מעדיף OAuth** ולא משתמש ב־SA |

\* חובה **או** SA **או** שלושת משתני ה־OAuth (לא חייבים את שני הסוגים).

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

## Gmail פרטי — OAuth (refresh token)

1. ב־**Google Cloud Console** (אותו פרויקט או פרויקט חדש): **APIs & Services → OAuth consent screen** — הגדרו (External מספיק לבדיקות; הוסיפו את כתובת ה־Gmail כ־Test user אם האפליקציה ב־Testing).
2. **Credentials → Create credentials → OAuth client ID** — סוג **Web application** (או Desktop).  
   אם משתמשים ב־[OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) כדי להוציא refresh token: ב־**Authorized redirect URIs** של ה־OAuth client הוסיפו בדיוק:  
   `https://developers.google.com/oauthplayground/redirect`
3. הפעילו **Google Drive API** לפרויקט.
4. ב־Playground: ⚙️ → *Use your own OAuth credentials* → הדביקו Client ID ו־Client Secret → בחרו scope:  
   `https://www.googleapis.com/auth/drive`  
   → *Authorize APIs* → התחברו עם ה־Gmail הרצוי → *Exchange authorization code for tokens* → העתיקו את **Refresh token**.
5. ב־Cloud Run הוסיפו משתני סביבה (עדיף Secret Manager):  
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`.  
   אפשר **להסיר** או להשאיר ריק את `GOOGLE_SERVICE_ACCOUNT_JSON` אם לא רוצים SA — כששלושת משתני ה־OAuth מלאים, השרת משתמש רק ב־OAuth.
6. `DRIVE_ROOT_FOLDER_ID` — מזהה תיקייה ב־**My Drive של אותו Gmail** (למשל תיקיית "תמונות מהזמנות").

בהפעלה, בלוגים יופיע: `Drive auth: Gmail user OAuth`.

## Service Account מול OAuth

**SA** בלי Shared drive **לא** יכול להעלות קבצים ל־My Drive של Gmail (שגיאת quota). **OAuth משתמש** פותר את זה לגבי Gmail פרטי; **Shared drive** פותר לעסקים עם Workspace בלי לחשוף refresh token של משתמש.
