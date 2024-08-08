const express = require("express");
const middleware = require("./middleware");
const routes = require("./routes");
const swaggerUi = require("swagger-ui-express");
const yaml = require("yamljs");

const app = express();

middleware(app);

app.use(routes);

// Load and serve Swagger documentation
const swaggerDocument = yaml.load('./swagger.yaml');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
  console.log(`API Documentation available at http://localhost:${PORT}/api-docs`);
});
