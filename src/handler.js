const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const moment = require("moment-timezone");
const db = require("./database");
const EventEmitter = require('events');
const axios = require("axios");
const FormData = require("form-data");
const { Storage } = require("@google-cloud/storage");
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
require('dotenv').config({ path: '../.env' });
dotenv.config();

class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

myEmitter.on('register', async (data, callback) => {
  console.log(`Register user - ${data.email}`);
  try {
    const existingUser = await getUserByEmail(data.email);

    if (existingUser) {
      callback({ message: "Email already registered" }, null);
    } else {
      const hashedPassword = await bcrypt.hash(data.password, 10);
      await insertUser(data.email, hashedPassword, data.fullname);
      callback(null, { message: "Registration successful" });
    }
  } catch (error) {
    callback(error, null);
  }
});

myEmitter.on('userRegistered', (user) => {
  console.log(`User registered - ${user.email}`);
});

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

// Fungsi untuk mendapatkan pengguna berdasarkan ID
const getUserById = (id) => {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT email, fullname FROM users WHERE id = ?",
      [id],
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
          myEmitter.emit('userRegistered', { email });
        }
      }
    );
  });
};

// Fungsi untuk login user
const loginUser = (email, password) => {
  return new Promise((resolve, reject) => {
    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, result) => {
      if (err) reject(err);

      if (
        result.length === 0 ||
        !(await bcrypt.compare(password, result[0].password))
      ) {
        resolve(null);
      } else {
        const token = jwt.sign(
          { id: result[0].id, fullname: result[0].fullname }, // Menambahkan fullname
          process.env.JWT_SECRET, // Menggunakan JWT_SECRET untuk enkode token
          { expiresIn: "7d" }
        );
        resolve({
          email: result[0].email,
          fullname: result[0].fullname,
          token: token,
          userid: result[0].id,
        });
      }
    });
  });
};

myEmitter.on('login', async (data, callback) => {
  console.log(`User login - ${data.email}`);
  try {
    const loginResult = await loginUser(data.email, data.password);
    if (loginResult) {
      callback(null, loginResult);
    } else {
      callback({ message: "Wrong Password or Account not found" }, null);
    }
  } catch (error) {
    callback(error, null);
  }
});

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

// Inisialisasi Google Cloud Storage
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const bucket = storage.bucket(process.env.GOOGLE_CLOUD_STORAGE_BUCKET);

// Fungsi untuk mengunggah file ke Google Cloud Storage
const uploadFileToGCS = (file, filename) => {
  return new Promise((resolve, reject) => {
    const blob = bucket.file(filename);

    const stream = blob.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    stream.on("error", (err) => {
      reject(err);
    });

    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      resolve(publicUrl);
    });

    stream.end(file.data);
  });
};

// Fungsi untuk mendapatkan riwayat prediksi berdasarkan user_id
const getHistoryPredict = (userId) => {
  return new Promise((resolve, reject) => {
    db.query("SELECT * FROM predictions WHERE user_id = ?", [userId], (err, result) => {
      if (err) {
        reject(err);
      } else {
        if (result.length === 0) {
          resolve([]);
        } else {
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
          resolve(formattedResult);
        }
      }
    });
  });
};

myEmitter.on('fetchHistory', async (userId, callback) => {
  console.log(`Fetching history for user ID - ${userId}`);
  try {
    const history = await getHistoryPredict(userId);
    callback(null, history);
  } catch (error) {
    callback(error, null);
  }
});

// Fungsi untuk prediksi mata hewan
const predictAnimalEye = async (req) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    throw new Error("No token provided");
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (
    !req.files ||
    !req.files.image ||
    !req.body.type ||
    !req.body.Animal_Name
  ) {
    throw new Error("No image, type, or Animal_Name specified");
  }

  const user = await getUserById(decoded.id);
  if (!user) {
    throw new Error("User not found");
  }

  console.log(`User ${user.email} predicting animal eye`);

  const imageFile = req.files.image;
  const animalType = req.body.type;
  const animalName = req.body.Animal_Name;
  const uuid = uuidv4();

  // Mengirim data yang diperlukan ke backend machine learning
  const formData = new FormData();
  formData.append("image", imageFile.data, { filename: imageFile.name });
  formData.append("type", animalType);
  formData.append("Animal_Name", animalName);

  // Mengirim permintaan ke backend machine learning
  const response = await axios.post(
    "https://ml-ternakami-4f6b5a2230fd.herokuapp.com/api/predict",
    formData,
    {
      headers: {
        ...formData.getHeaders(),
      },
    }
  );

  const predictionResult = response.data;

  // Menyimpan prediksi dan gambar ke Google Cloud Storage
  let filename = `${uuid}_Mata_Hewan_${animalName}.jpg`;

  // Menentukan nama file berdasarkan hasil prediksi
  const label = predictionResult.label_prediksi;
  if (label === "Mata Terlihat Sehat") {
    filename = `${uuid}_Mata_Hewan_Sehat_${animalName}.jpg`;
  } else if (label === "Mata Terjangkit PinkEye") {
    filename = `${uuid}_Mata_Hewan_Terjangkit_Pink_Eye_${animalName}.jpg`;
  }

  const publicUrl = await uploadFileToGCS(imageFile, filename);

  const created_at = moment()
    .tz("Asia/Jakarta")
    .format("YYYY-MM-DD HH:mm:ss");

  await new Promise((resolve, reject) => {
    db.query(
      "INSERT INTO predictions (user_id, animal_type, animal_name, prediction_class, prediction_probability, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        decoded.id,
        animalType,
        animalName,
        label,
        predictionResult.confidence,
        publicUrl,
        created_at,
      ],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });

  return {
    message: "Prediction successful",
    prediction: predictionResult,
    imageUrl: publicUrl,
    createdAt: created_at,
  };
};

myEmitter.on('predict', async (req, callback) => {
  console.log("Predicting animal eye");
  try {
    const result = await predictAnimalEye(req);
    callback(null, result);
  } catch (error) {
    callback(error, null);
  }
});

module.exports = { getUserByEmail, insertUser, verifyToken, myEmitter };