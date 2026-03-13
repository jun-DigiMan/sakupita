// ============================================================
// 設定ファイル - ここを編集してください
// ============================================================

const CONFIG = {

  // ----------------------------------------------------------
  // Google Calendar API 設定
  // Google Cloud Console (https://console.cloud.google.com) で取得
  // APIs & Services > Credentials > OAuth 2.0 Client IDs
  // ----------------------------------------------------------
  CLIENT_ID: '613010030367-4d78sjo8374np256eajh534hp27387jd.apps.googleusercontent.com',
  API_KEY:   'AIzaSyCGnyeJgC4jnYMQfoF-I6qwYin4HoGr6GY',

  // ----------------------------------------------------------
  // チームメンバー設定
  // calendarId: GoogleアカウントのGmailアドレス
  // color: カレンダー表示色
  // ----------------------------------------------------------
  MEMBERS: [
    { name: '野口純',   lastName: '野口', calendarId: 'j.noguchi@digi-man.com', color: '#222222', zoomPmi: '' },
    { name: '松居和輝', lastName: '松居', calendarId: 'k.matsui@digi-man.com',  color: '#e04f24', zoomPmi: '' },
  ],

  // Zoom個人ミーティングID設定方法:
  // 各メンバーの zoomPmi に Zoom PMI番号(例: '123-456-7890')を入力すると
  // Google Meetの代わりにZoom URLが使用されます
  // 空欄の場合はGoogle Meetを使用

  // ----------------------------------------------------------
  // 稼働時間設定
  // ----------------------------------------------------------
  WORKING_HOURS: { start: 9, end: 20 },  // 9:00 〜 20:00
  SLOT_MINUTES: 30,                       // 30分刻み
  LUNCH_HOUR: 12,                         // 12:00〜13:00 はランチ休憩

  // ----------------------------------------------------------
  // デモモード
  // true: モックデータで動作（Google認証不要）
  // false: 実際のGoogleカレンダーと連携
  // ----------------------------------------------------------
  DEMO_MODE: false,

  // Google API スコープ
  SCOPES: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',

  // 会議タイトルのフォーマット
  // {customer}: 顧客名, {company}: 会社名, {member}: 担当者名
  EVENT_TITLE_FORMAT: '{company} {customer}様 / {purpose}',

  // ----------------------------------------------------------
  // スプレッドシート設定
  // 空欄のままにすると自動でスプレッドシートを作成します
  // 既存のシートIDを指定する場合はここに入力
  // ----------------------------------------------------------
  SHEET_ID: '',
};
