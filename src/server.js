const express = require("express");
const middleware = require("./middleware");
const routes = require("./routes");

const app = express();

middleware(app);

app.use(routes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
});
