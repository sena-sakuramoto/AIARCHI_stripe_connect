/**
 * AI FES. 用 Zoom会議を4つ作成するスクリプト
 */

const ZOOM_CONFIG = {
  ACCOUNT_ID: '8IAf9hpYQkS-OEqHMK0NZw',
  CLIENT_ID: '5Xx9uv_DR8mszXlIi9NuQ',
  CLIENT_SECRET: 'Rw9qaAiVB3qz0RAQ6Xxbn7YWw4Jz2X6g'
};

// 作成する4つの会議
const MEETINGS_TO_CREATE = [
  {
    key: 'COMMON',
    topic: 'AI FES. 共通（AI News / 製品デモ / フィナーレ）',
    start_time: '2026-01-25T10:00:00',
    duration: 720, // 12時間（10:00-22:00）
    timezone: 'Asia/Tokyo'
  },
  {
    key: 'PRACTICAL',
    topic: '第２回実務で使えるAI×建築セミナー',
    start_time: '2026-01-25T13:35:00',
    duration: 145, // 13:35-16:00
    timezone: 'Asia/Tokyo'
  },
  {
    key: 'IMAGE_GEN',
    topic: '第２回今使える画像生成AIセミナー',
    start_time: '2026-01-25T16:00:00',
    duration: 90, // 16:00-17:30
    timezone: 'Asia/Tokyo'
  },
  {
    key: 'GAS_HP',
    topic: 'GAS＆無料HPセミナー（午前GAS / 夜HP）',
    start_time: '2026-01-25T11:45:00',
    duration: 555, // 11:45-21:00 (カバー用に長めに)
    timezone: 'Asia/Tokyo'
  }
];

async function getZoomAccessToken() {
  const credentials = Buffer.from(`${ZOOM_CONFIG.CLIENT_ID}:${ZOOM_CONFIG.CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `grant_type=account_credentials&account_id=${ZOOM_CONFIG.ACCOUNT_ID}`
  });

  if (!response.ok) {
    throw new Error(`Token error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function createZoomMeeting(accessToken, meetingConfig) {
  const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topic: meetingConfig.topic,
      type: 2, // Scheduled meeting
      start_time: meetingConfig.start_time,
      duration: meetingConfig.duration,
      timezone: meetingConfig.timezone,
      settings: {
        approval_type: 0, // 自動承認
        registration_type: 1, // 登録必須
        registrants_email_notification: false, // Zoom側からのメールは送らない
        meeting_authentication: false,
        waiting_room: false,
        join_before_host: true,
        mute_upon_entry: true
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Meeting creation error: ${response.status} ${errorText}`);
  }

  return await response.json();
}

async function main() {
  console.log('=== AI FES. Zoom会議作成 ===\n');

  try {
    // アクセストークン取得
    console.log('Zoomアクセストークン取得中...');
    const accessToken = await getZoomAccessToken();
    console.log('トークン取得成功\n');

    const results = [];

    // 4つの会議を作成
    for (const meeting of MEETINGS_TO_CREATE) {
      console.log(`作成中: ${meeting.topic}`);

      const result = await createZoomMeeting(accessToken, meeting);

      results.push({
        key: meeting.key,
        name: meeting.topic,
        meeting_id: String(result.id),
        registration_url: result.registration_url,
        join_url: result.join_url
      });

      console.log(`  会議ID: ${result.id}`);
      console.log(`  登録URL: ${result.registration_url}`);
      console.log('');
    }

    // GAS用のコード出力
    console.log('\n=== GAS用 ZOOM_MEETINGS 設定 ===\n');
    console.log('const ZOOM_MEETINGS = {');
    results.forEach(r => {
      console.log(`  '${r.key}': {`);
      console.log(`    name: '${r.name}',`);
      console.log(`    meeting_id: '${r.meeting_id}',`);
      console.log(`    registration_url: '${r.registration_url}'`);
      console.log('  },');
    });
    console.log('};');

    console.log('\n=== 完了 ===');

  } catch (error) {
    console.error('エラー:', error.message);
  }
}

main();
