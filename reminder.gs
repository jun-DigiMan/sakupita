// ============================================================
// サクピタ リマインダー送信スクリプト（Google Apps Script）
// ============================================================
// 設定方法:
// 1. https://script.google.com で新規プロジェクト作成
// 2. このコードを貼り付け
// 3. 「トリガー」から毎日9:00〜10:00に sendReminders を実行するよう設定
// ============================================================

const REMINDER_SHEET_ID = '1il4Zv8LSIsqGYMrBrxW3WG9w3NXEsh14FjzJ9R6Aj_o';
const REMINDER_BDAYS_BEFORE = 2; // 何営業日前に送るか（土日祝除く）

// 日本の祝日をGoogle Calendarから取得（指定年 + 翌年分）
function getJpHolidays(year) {
  const holidays = new Set();
  try {
    const cal = CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com');
    [year, year + 1].forEach(y => {
      const events = cal.getEvents(new Date(y, 0, 1), new Date(y, 11, 31, 23, 59));
      events.forEach(e => {
        const d = e.getStartTime();
        holidays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      });
    });
  } catch(e) {
    Logger.log('祝日取得失敗: ' + e.message);
  }
  return holidays;
}

function isBusinessDay(date, holidays) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false; // 日・土
  return !holidays.has(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
}

// 指定日からN営業日前の日付を返す
function subtractBusinessDays(date, n, holidays) {
  const d = new Date(date);
  let count = 0;
  while (count < n) {
    d.setDate(d.getDate() - 1);
    if (isBusinessDay(d, holidays)) count++;
  }
  return d;
}

function sendReminders() {
  const ss = SpreadsheetApp.openById(REMINDER_SHEET_ID);
  const sheet = ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return; // ヘッダーのみ

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const holidays = getJpHolidays(today.getFullYear());

  let sentCount = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // 列インデックス（ヘッダー順）:
    // 0:企業名 1:顧客名 2:部署 3:役職 4:電話 5:メール
    // 6:送信日 7:商談日 8:コメント 9:担当者名 10:担当者メール
    // 11:予約ID 12:イベントID 13:開始ISO 14:種別

    const companyName    = row[0] || '';
    const customerName   = row[1] || '';
    const customerEmail  = row[5] || '';
    const meetingDateRaw = row[7] || '';
    const memberName     = row[9] || '';
    const memberEmail    = row[10] || '';
    const startISO       = row[13] || '';

    if (!customerEmail || !meetingDateRaw) continue;

    // 商談日の解析（例: "2026/3/16 09:00〜10:00"）
    let meetingDate;
    if (startISO) {
      meetingDate = new Date(startISO);
    } else {
      const dateStr = meetingDateRaw.toString().split(' ')[0].replace(/\//g, '-');
      meetingDate = new Date(dateStr);
    }
    if (isNaN(meetingDate.getTime())) continue;

    meetingDate.setHours(0, 0, 0, 0);

    // 商談日の2営業日前を計算
    const reminderDate = subtractBusinessDays(meetingDate, REMINDER_BDAYS_BEFORE, holidays);
    reminderDate.setHours(0, 0, 0, 0);

    const diff = Math.round((reminderDate - today) / (1000 * 60 * 60 * 24));
    if (diff !== 0) continue; // 今日がリマインダー送信日でなければスキップ

    // リマインダーメール送信
    const subject = `【お打ち合わせのご確認】${companyName ? companyName + ' ' : ''}${customerName}様`;
    const body = buildReminderEmail({ customerName, companyName, memberName, meetingDate: meetingDateRaw });

    try {
      GmailApp.sendEmail(customerEmail, subject, '', { htmlBody: body, name: 'サクピタ' });
      if (memberEmail) {
        const memberSubject = `【リマインダー】${customerName}様 お打ち合わせ（${meetingDateRaw}）`;
        GmailApp.sendEmail(memberEmail, memberSubject, '', { htmlBody: body, name: 'サクピタ' });
      }
      Logger.log(`リマインダー送信: ${customerName} (${customerEmail}) - ${meetingDateRaw}`);
      sentCount++;
    } catch(e) {
      Logger.log(`送信失敗: ${customerEmail} - ${e.message}`);
    }
  }

  Logger.log(`完了: ${sentCount}件送信`);
}

function buildReminderEmail({ customerName, companyName, memberName, meetingDate }) {
  return `
<div style="font-family:'Noto Sans JP',sans-serif;font-size:15px;line-height:1.8;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <div style="background:#1a2744;padding:16px 24px;border-radius:8px 8px 0 0;">
    <span style="color:white;font-size:18px;font-weight:700;">📅 サクピタ</span>
  </div>
  <div style="background:#fff;padding:32px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 8px 8px;">
    <p>${customerName} 様</p>
    <p>いつもお世話になっております。<br>
    近日中にお打ち合わせのご予定をいただいております。念のためご確認のご連絡をさせていただきます。</p>

    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr>
        <td style="padding:10px 14px;background:#f5f5f5;border:1px solid #e0e0e0;width:30%;font-weight:600;">担当者</td>
        <td style="padding:10px 14px;border:1px solid #e0e0e0;">${memberName}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#f5f5f5;border:1px solid #e0e0e0;font-weight:600;">会社名</td>
        <td style="padding:10px 14px;border:1px solid #e0e0e0;">${companyName || '—'}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#f5f5f5;border:1px solid #e0e0e0;font-weight:600;">日時</td>
        <td style="padding:10px 14px;border:1px solid #e0e0e0;">${meetingDate}</td>
      </tr>
    </table>

    <p>ご都合が変わった場合は、お早めに担当者までご連絡ください。<br>
    どうぞよろしくお願いいたします。</p>

    <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;">
    <p style="font-size:12px;color:#999;">株式会社DigiMan　|　サクピタ 自動リマインダー</p>
  </div>
</div>`;
}

// テスト用: 今すぐリマインダー対象を確認（メール送信なし）
function checkReminders() {
  const ss = SpreadsheetApp.openById(REMINDER_SHEET_ID);
  const sheet = ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  const today = new Date(); today.setHours(0,0,0,0);
  const holidays = getJpHolidays(today.getFullYear());

  Logger.log(`今日: ${today.toLocaleDateString('ja-JP')}`);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const customerName   = row[1] || '';
    const meetingDateRaw = row[7] || '';
    const startISO       = row[13] || '';
    if (!meetingDateRaw) continue;
    let meetingDate = startISO ? new Date(startISO) : new Date(meetingDateRaw.toString().split(' ')[0].replace(/\//g,'-'));
    if (isNaN(meetingDate.getTime())) continue;
    meetingDate.setHours(0,0,0,0);
    const reminderDate = subtractBusinessDays(meetingDate, REMINDER_BDAYS_BEFORE, holidays);
    reminderDate.setHours(0,0,0,0);
    const diff = Math.round((reminderDate - today) / (1000*60*60*24));
    Logger.log(`${customerName} - 商談: ${meetingDateRaw} / リマインダー送信予定日: ${reminderDate.toLocaleDateString('ja-JP')} (diff: ${diff}日)`);
    if (diff === 0) Logger.log(`  → 本日送信対象`);
  }
}
