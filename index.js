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
async function getLatestReq(lineUserId) {
  const r = await pool.query(
    `SELECT * FROM public.address_change_requests
     WHERE line_user_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [lineUserId]
  );
  return r.rows[0] || null;
}

async function createReq(lineUserId) {
  const r = await pool.query(
    `INSERT INTO public.address_change_requests (line_user_id, status)
     VALUES ($1, 'waiting_address')
     RETURNING *`,
    [lineUserId]
  );
  return r.rows[0];
}

async function updateReq(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = keys.map((k) => fields[k]);

  const r = await pool.query(
    `UPDATE public.address_change_requests
     SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values]
  );
  return r.rows[0];
}

function yesNoQuickReply() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "はい", text: "はい" } },
      { type: "action", action: { type: "message", label: "いいえ", text: "いいえ" } },
    ],
  };
}

async function handleEvent(event) {
  const lineUserId = event?.source?.userId;
  if (!lineUserId) return null;

  // 1) テキスト受信
  if (event.type === "message" && event.message.type === "text") {
    const text = (event.message.text || "").trim();

    // 開始合図（LIFFのボタンが送る文言）
    if (text === "住所変更を開始" || text === "住所変更を申請します") {
      await createReq(lineUserId);

      return lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: "運転免許証や住民票の写真などをご準備し、住所を入力ください。",
      });
    }

    // 進行中の依頼を取得
    const req = await getLatestReq(lineUserId);
    if (!req || req.status === "done") return null;

    // 住所入力待ち
    if (req.status === "waiting_address") {
      const addr = text;
      const updated = await updateReq(req.id, {
        status: "waiting_confirm",
        address_text: addr,
      });

      return lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: `こちらで間違いありませんか？\n\n${updated.address_text}`,
        quickReply: yesNoQuickReply(),
      });
    }

    // はい/いいえ待ち
    if (req.status === "waiting_confirm") {
      if (text === "はい") {
        await updateReq(req.id, { status: "waiting_photo" });

        return lineClient.replyMessage(event.replyToken, {
          type: "text",
          text: "ありがとうございます。運転免許証や住民票の写真をお送りください。無ければご準備いただき再度お願い致します。",
        });
      }

      if (text === "いいえ") {
        await updateReq(req.id, { status: "waiting_address", address_text: null });

        return lineClient.replyMessage(event.replyToken, {
          type: "text",
          text: "承知しました。もう一度、住所を入力してください。",
        });
      }

      return lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: "「はい」または「いいえ」を選んでください。",
        quickReply: yesNoQuickReply(),
      });
    }

    // 写真待ち中にテキストが来た
    if (req.status === "waiting_photo") {
      return lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: "運転免許証または住民票の写真をお送りください。",
      });
    }

    return null;
  }

  // 2) 画像受信（写真）
  if (event.type === "message" && event.message.type === "image") {
    const req = await getLatestReq(lineUserId);
    if (!req || req.status !== "waiting_photo") return null;

    await updateReq(req.id, { status: "done" });

    return lineClient.replyMessage(event.replyToken, {
      type: "text",
      text: "ご連絡ありがとうございます。社内の名簿を更新いたします。",
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
