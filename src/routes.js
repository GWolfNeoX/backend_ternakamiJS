const express = require("express");
const { verifyToken, myEmitter } = require("./handler");
const db = require("./database");
const moment = require("moment-timezone");
const dotenv = require("dotenv");
dotenv.config();

const router = express.Router();

// API untuk registrasi User
router.post("/api/auth/register", (req, res) => {
  const { email, password, fullname } = req.body;

  // Validasi input
  if (!email || !password || !fullname) {
    return res.status(400).json({
      message: "Email, Password, and Fullname fields must all be filled",
      statusCode: 400,
    });
  }

  myEmitter.emit('register', { email, password, fullname }, (error, result) => {
    if (error) {
      console.error("Error during registration:", error);
      return res.status(400).json({ message: error.message });
    }
    res.status(201).json({ message: "Successful Account Registration. Please Log In" });
  });
});

// API untuk validasi token user saat berhasil Login
router.get("/api/validation", verifyToken, (req, res) => {
  res.json({ message: "Token is still valid", decodedUser: req.decoded });
});

// API untuk Login User
router.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  myEmitter.emit('login', { email, password }, (error, result) => {
    if (error) {
      console.error("Error during login:", error);
      return res.status(400).json({ message: error.message });
    }
    res.status(200).json({
      loginResult: result,
      message: "Login Success",
    });
  });
});

// API untuk predict mata hewan
router.post("/api/predict", verifyToken, (req, res) => {
  myEmitter.emit('predict', req, (error, result) => {
    if (error) {
      console.error("Error during prediction:", error);
      return res.status(500).json({ message: error.message });
    }
    res.json(result);
  });
});

// API untuk mengetahui history predict yang telah dilakukan
router.get("/api/historyPredict", verifyToken, (req, res) => {
  const userId = req.decoded.id;

  myEmitter.emit('fetchHistory', userId, (error, history) => {
    if (error) {
      console.error("Error fetching history:", error);
      return res.status(500).json({ error: "Error fetching history" });
    }

    if (history.length === 0) {
      console.log("No History for this user");
      return res.status(404).json({ message: "No prediction history found for this user." });
    }

    console.log("Showing History");
    res.json(history);
  });
});

// API untuk masuk ke Homepage setelah berhasil Login
router.get("/api/homepage", verifyToken, (req, res) => {
  res.json({ message: `Welcome, ${req.decoded.fullname}` });
});

// API untuk mendapatkan artikel berdasarkan ID
router.get("/api/articles/:id", async (req, res) => {
  const articleId = req.params.id;

  try {
    const result = await new Promise((resolve, reject) => {
      db.query("SELECT * FROM articles WHERE id = ?", [articleId], (err, result) => {
        if (err) reject(err);
        resolve(result);
      });
    });

    if (result.length === 0) {
      return res.status(404).json({ message: "Article not found." });
    }

    // Format the article data
    const article = result[0];
    const formattedArticle = {
      id: article.id,
      title: article.title,
      content: article.content,
      author: article.author,
      published_date: moment(article.published_date)
        .tz("Asia/Jakarta")
        .format(),
      img_url: article.img_url,
    };

    res.json(formattedArticle);
  } catch (error) {
    console.error("Error during article retrieval:", error);
    res.status(500).json({ error: "Error during article retrieval" });
  }
});

// Api Test
router.get("/", (req, res) => {
  res.json({ message: "API is running normally" });
});

module.exports = router;
