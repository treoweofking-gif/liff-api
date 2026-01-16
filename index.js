const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const line = require("@line/bot-sdk");

const app = express();
app.use(cors());

// =====================
// LINE Webhook 設定
// =====================
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.Client(lineConfig);

// ★Webhookは express.json() を付けない（署名検証のため）
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).send("OK");
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    res.status(500).end();
  }
});

// Webhookイベント処理
async function handleEvent(event) {
  // 1) LIFFが送る「住所変更を申請します」を受けたら案内
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text;

    if (text === "住所変更を申請します") {
      return lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: "住所変更となった運転免許証または住民票の写真を送ってください。",
      });
    }

    return null;
  }

  // 2) 画像が来たらお礼（まずはMVP：状態判定なしで返信）
  if (event.type === "message" && event.message.type === "image") {
    return lineClient.replyMessage(event.replyToken, {
      type: "text",
      text: "ご連絡ありがとうございます。社内の名簿を更新いたします。",
    });
  }

  return null;
}

// =====================
// API（JSON）設定
// =====================
app.use(express.json());

// RenderではPORT必須
const PORT = process.env.PORT || 3000;

// =====================
// DB（Render PostgreSQL）
// =====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 動作確認
app.get("/", (req, res) => {
  res.send("LIFF API is running");
});

// 社員判定API
app.get("/api/me", async (req, res) => {
  const lineUserId = req.query.line_user_id;

  if (!lineUserId) {
    return res.status(400).json({ error: "line_user_id is required" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM employees WHERE line_user_id = $1 AND is_active = true",
      [lineUserId]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    return res.json({
      exists: true,
      employee: result.rows[0],
    });
  } catch (err) {
    console.error("DB ERROR:", err);
    return res.status(500).json({ error: "db error" });
  }
});

// サーバ起動
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
