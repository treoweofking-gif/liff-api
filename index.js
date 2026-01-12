const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// RenderではPORT必須
const PORT = process.env.PORT || 3000;

// ★ RenderのPostgreSQL（自動 or 手動で設定）
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Render必須
  },
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
      "SELECT employee_no, name, role, status FROM employees WHERE line_user_id = $1",
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
