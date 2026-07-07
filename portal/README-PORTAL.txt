Lumian Services Portal v3
=========================

URL after upload:
https://www.lumianservices.ch/portal/

Important:
- This portal is hidden from Google with noindex and robots.txt Disallow.
- It is a static GitHub Pages tool. Passwords are local browser protection, not bank-level security.
- For real access control later, use Cloudflare Access, Firebase Auth, Supabase Auth, or another backend login.

Simple workflow
---------------
1) Login as Noah or Timo.
   First login: choose your own password.

2) Add Lead.
   A Lead is only an inquiry. When saved, the system automatically creates a Lumian number, for example LM1001.

3) Convert Lead to Job.
   In the Leads list, tap "In Job umwandeln".
   A Job is a planned/confirmed cleaning appointment.

4) Complete Job.
   When the job is completed, tap "Erledigt".
   The person becomes an active customer.
   If the customer came through a referral and the order value is at least the configured minimum, the referrer gets a bonus entry.

5) Send referral message.
   Open Customers.
   Tap "Empfehlung senden".
   WhatsApp opens with the configured message and referral link.

Referral logic
--------------
- The customer's Lumian number is also their referral code.
- Example: LM1001
- Default referral link:
  https://www.lumianservices.ch/?ref=LM1001#booking
- The public booking form reads ?ref=LM1001 and fills the Danke-Code field automatically.

Google Sheets + Drive setup
---------------------------
1) Create a Google Sheet named "Lumian Portal".
2) Open Extensions -> Apps Script.
3) Paste the content of /portal/GOOGLE-APPS-SCRIPT.gs.
4) Deploy -> New deployment -> Web app.
   Execute as: Me
   Who has access: Anyone with the link
5) Copy the Web App URL.
6) Open Lumian Portal -> Setup -> paste the Web App URL.
7) Optional for photos:
   Create a Google Drive folder for Lumian job photos.
   Copy the folder ID from the URL.
   Paste it into Setup -> Google Drive Folder ID.

Two phones
----------
- Each phone should use the same Apps Script Web App URL.
- After changes, tap "Sync senden".
- On the other phone, tap "Cloud laden".
- This is a simple mini-cloud workflow, not a complex live multi-user database.

Photos
------
- Before/after photos are compressed in the browser before saving.
- If a Google Drive Folder ID is set and Sync is sent, the Apps Script uploads photos into Google Drive and writes the links into Google Sheets.

Calendar
--------
- Every job with a date has a Kalender button.
- It downloads an .ics calendar file that can be opened on iPhone/Android/desktop.
- WhatsApp reminder text can be changed under Setup.

Exports
-------
- Excel Export creates a CSV file that opens in Excel/Numbers.
- JSON Backup exports the full local portal data.

Do not add portal to sitemap.
It is intentionally not in sitemap.xml.
