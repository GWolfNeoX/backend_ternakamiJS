const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const cors = require('cors');

const middleware = (app) => {
    app.use(bodyParser.json());
    app.use(fileUpload());
    app.use(cors());
};

module.exports = middleware;