const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const moment = require("moment-timezone");
const db = require("./database");

// Fungsi untuk mendapatkan pengguna berdasarkan email
const getUserByEmail = (email) => {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT email FROM users WHERE email = ?",
      [email],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result.length > 0 ? result[0] : null);
        }
      }
    );
  });
};

// Fungsi untuk memasukkan pengguna ke dalam database
const insertUser = (email, hashedPassword, fullname) => {
  return new Promise((resolve, reject) => {
    db.query(
      "INSERT INTO users (email, password, fullname) VALUES (?, ?, ?)",
      [email, hashedPassword, fullname],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });
};

// Fungsi untuk memverifikasi token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ message: "Token Expired. Please Login!" });
      } else if (err.name === "JsonWebTokenError") {
        return res
          .status(401)
          .json({ message: "Invalid token. Please provide a valid token." });
      } else {
        return res
          .status(401)
          .json({ message: "Failed to authenticate token" });
      }
    }

    req.decoded = decoded;
    next();
  });
};

module.exports = { getUserByEmail, insertUser, verifyToken };
