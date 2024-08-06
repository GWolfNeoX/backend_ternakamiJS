const bodyParser = require("body-parser");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");

const middleware = (app) => {
  app.use(bodyParser.json());
  app.use(fileUpload());
  app.use(cors());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
};

module.exports = middleware;
