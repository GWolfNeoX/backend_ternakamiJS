const express = require("express");
const { getUserByEmail, insertUser, verifyToken } = require("./handler");
const db = require("./database");
const moment = require("moment-timezone");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const FormData = require("form-data");
const { Storage } = require("@google-cloud/storage");
const dotenv = require("dotenv");
dotenv.config();

const router = express.Router();

//API untuk registrasi User
router.post("/api/auth/register", async (req, res) => {
  const { email, password, fullname } = req.body;

  // Validasi input
  if (!email || !password || !fullname) {
    return res.status(400).json({
      message: "Email, Password, and Fullname fields must all be filled",
      statusCode: 400,
    });
  }

  try {
    const existingUser = await getUserByEmail(email);

    if (existingUser) {
      return res.status(400).json({
        message: "Email already taken",
        statusCode: 400,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 8);
    await insertUser(email, hashedPassword, fullname);

    res.status(201).json({
      message: "Successful Account Registration. Please Log In",
      statusCode: 201,
    });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({
      message: "Internal Server Error during registration",
      statusCode: 500,
    });
  }
});

//API untuk validasi token user saat berhasil Login
router.get("/api/validation", verifyToken, (req, res) => {
  res.json({ message: "Token is still valid", decodedUser: req.decoded });
});

//API untuk Login User
router.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  db.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    async (err, result) => {
      if (err) throw err;

      if (
        result.length === 0 ||
        !(await bcrypt.compare(password, result[0].password))
      ) {
        return res
          .status(400)
          .json({ message: "Wrong Password or Account not found" });
      }

      const token = jwt.sign(
        { id: result[0].id, fullname: result[0].fullname }, // Menambahkan fullname
        process.env.JWT_SECRET, // Menggunakan JWT_SECRET untuk enkode token
        { expiresIn: "7d" }
      );
      res.status(200).json({
        loginResult: {
          email: result[0].email,
          fullname: result[0].fullname,
          token: token,
          userid: result[0].id,
        },
        message: "Login Success",
      });
    }
  );
});

// Inisialisasi Google Cloud Storage
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const bucket = storage.bucket(process.env.GOOGLE_CLOUD_STORAGE_BUCKET);

//API untuk predict mata hewan
router.post("/api/predict", verifyToken, async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(500).json({ message: "Failed to authenticate token" });
    }

    if (
      !req.files ||
      !req.files.image ||
      !req.body.type ||
      !req.body.Animal_Name
    ) {
      return res
        .status(400)
        .json({ error: "No image, type, or Animal_Name specified" });
    }

    const imageFile = req.files.image;
    const animalType = req.body.type;
    const animalName = req.body.Animal_Name;

    try {
      // Mengirim data yang diperlukan ke backend machine learning
      const formData = new FormData();
      formData.append("image", imageFile.data, { filename: imageFile.name });
      formData.append("type", animalType);
      formData.append("Animal_Name", animalName);

      // Mengirim permintaan ke backend machine learning
      const response = await axios.post(
        "http://192.168.1.9:5000/api/predict",
        formData,
        {
          headers: {
            ...formData.getHeaders(), // Menggunakan formData.getHeaders() untuk mendapatkan header yang benar
          },
        }
      );

      const predictionResult = response.data;

      // Menyimpan prediksi dan gambar ke Google Cloud Storage
      let filename = `Mata_Hewan_${animalName}.jpg`; // Menggunakan nama file default

      // Menentukan nama file berdasarkan hasil prediksi
      const label = predictionResult.label_prediksi;
      if (label === "Mata Terlihat Sehat") {
        filename = `Mata_Hewan_Sehat_${animalName}.jpg`;
      } else if (label === "Mata Terjangkit PinkEye") {
        filename = `Mata_Hewan_Terjangkit_Pink_Eye_${animalName}.jpg`;
      }

      const blob = bucket.file(filename);

      const stream = blob.createWriteStream({
        metadata: {
          contentType: imageFile.mimetype,
        },
      });

      stream.on("error", (err) => {
        console.error("Error uploading image to Google Cloud Storage:", err);
        return res.status(500).json({ error: "Error uploading image" });
      });

      stream.on("finish", async () => {
        try {
          // Dapatkan URL gambar yang telah diunggah
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

          const created_at = moment()
            .tz("Asia/Jakarta")
            .format("YYYY-MM-DD HH:mm:ss");

          db.query(
            "INSERT INTO predictions (user_id, animal_type, animal_name, prediction_class, prediction_probability, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              decoded.id,
              animalType,
              animalName,
              predictionResult.label_prediksi,
              predictionResult.confidence,
              publicUrl,
              created_at,
            ],
            (error, result) => {
              if (error) {
                console.error("Error saving prediction:", error);
                return res
                  .status(500)
                  .json({ error: "Error saving prediction" });
              }

              res.json(predictionResult);
            }
          );
        } catch (error) {
          console.error("Error during prediction:", error);
          res.status(500).json({ error: "Error during prediction" });
        }
      });

      stream.end(imageFile.data);
    } catch (error) {
      console.error("Error during prediction:", error);
      res.status(500).json({ error: "Error during prediction" });
    }
  });
});

//API untuk mengetahui history predict yang telah dilakukan
router.get("/api/historyPredict", verifyToken, (req, res) => {
  const userId = req.decoded.id;

  // Ambil data history berdasarkan user_id
  db.query(
    "SELECT * FROM predictions WHERE user_id = ?",
    [userId],
    (error, result) => {
      if (error) {
        return res.status(500).json({ error: "Error fetching history" });
      }

      // Mengubah format waktu pada setiap data history
      const formattedResult = result.map((item) => {
        const formattedCreatedAt = moment(item.created_at)
          .tz("Asia/Jakarta")
          .format("YYYY-MM-DD HH:mm:ss");
        return {
          id: item.id,
          user_id: item.user_id,
          animal_type: item.animal_type,
          animal_name: item.animal_name,
          prediction_class: item.prediction_class,
          prediction_probability: item.prediction_probability,
          image_url: item.image_url,
          formatted_created_at: formattedCreatedAt,
        };
      });

      res.json(formattedResult); // Kirim data history dengan format waktu ke user
    }
  );
});

//API untuk masuk ke Homepage setelah berhasil Login
router.get("/api/homepage", verifyToken, (req, res) => {
  res.json({ message: `Welcome, ${req.decoded.fullname}` });
});

//Logout

module.exports = router;
