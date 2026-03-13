// ============================================================
// サクピタ リマインダー送信スクリプト（Google Apps Script）
// ============================================================
// 設定方法:
// 1. https://script.google.com で新規プロジェクト作成
// 2. このコードを貼り付け
// 3. SHEET_ID を予約スプレッドシートのIDに設定
// 4. 「トリガー」から毎日8:50〜9:00に sendReminders を実行するよう設定
// ============================================================

const REMINDER_SHEET_ID = 'ここにスプレッドシートIDを入力';
const REMINDER_DAYS_BEFORE = 2; // 何日前に送るか

function sendReminders() {
  const ss = SpreadsheetApp.openById(REMINDER_SHEET_ID);
  const sheet = ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return; // ヘッダーのみ

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + REMINDER_DAYS_BEFORE);

  let sentCount = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // 列インデックス（ヘッダー順）:
    // 0:企業名 1:顧客名 2:部署 3:役職 4:電話 5:メール
    // 6:送信日 7:商談日 8:コメント 9:担当者名 10:担当者メール
    // 11:予約ID 12:イベントID 13:開始ISO 14:種別

    const companyName   = row[0] || '';
    const customerName  = row[1] || '';
    const customerEmail = row[5] || '';
    const meetingDateRaw = row[7] || '';
    const memberName    = row[9] || '';
    const memberEmail   = row[10] || '';
    const startISO      = row[13] || '';

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
    const diff = Math.round((meetingDate - targetDate) / (1000 * 60 * 60 * 24));

    if (diff !== 0) continue; // 2日後でなければスキップ

    // リマインダーメール送信
    const subject = `【明後日のご予定】${companyName ? companyName + ' ' : ''}${customerName}様 お打ち合わせのご確認`;
    const body = buildReminderEmail({ customerName, companyName, memberName, meetingDate: meetingDateRaw });

    try {
      GmailApp.sendEmail(customerEmail, subject, '', { htmlBody: body, name: 'サクピタ' });
      if (memberEmail) {
        const memberSubject = `【リマインダー】明後日 ${customerName}様 お打ち合わせ`;
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
    明後日にお打ち合わせのご予定をいただいております。念のためご確認のご連絡をさせていただきます。</p>

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
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + REMINDER_DAYS_BEFORE);

  Logger.log(`確認対象日: ${targetDate.toLocaleDateString('ja-JP')}`);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const customerName = row[1] || '';
    const meetingDateRaw = row[7] || '';
    const startISO = row[13] || '';
    if (!meetingDateRaw) continue;
    let meetingDate = startISO ? new Date(startISO) : new Date(meetingDateRaw.toString().split(' ')[0].replace(/\//g,'-'));
    if (isNaN(meetingDate.getTime())) continue;
    meetingDate.setHours(0,0,0,0);
    const diff = Math.round((meetingDate - targetDate) / (1000*60*60*24));
    if (diff === 0) Logger.log(`対象: ${customerName} - ${meetingDateRaw}`);
  }
}
