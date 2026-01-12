const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json());

// Render では PORT は環境変数から取得必須
const PORT = process.env.PORT || 3000;

// ===== DB設定（後で Render の Environment に入れる）=====
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root",
  database: process.env.DB_NAME || "liff_db",
};

// ===== 動作確認 =====
app.get("/", (req, res) => {
  res.send("LIFF API is running");
});

// ===== 社員判定 API =====
app.get("/api/me", async (req, res) => {
  const lineUserId = req.query.line_user_id;

  if (!lineUserId) {
    return res.status(400).json({ error: "line_user_id is required" });
  }

  try {
    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(
      "SELECT employee_no, name, role, status FROM employees WHERE line_user_id = ?",
      [lineUserId]
    );

    await conn.end();

    if (rows.length === 0) {
      return res.json({ exists: false });
    }

    return res.json({
      exists: true,
      employee: rows[0],
    });
  } catch (err) {
    console.error("DB ERROR:", err);
    return res.status(500).json({ error: "db error" });
  }
});

// ===== サーバ起動 =====
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
