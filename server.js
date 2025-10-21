import "dotenv/config";
import express from "express";
import compression from "compression";
import { corsMiddleware } from "./middlewares/cors.js";
import { apiLimiter } from "./middlewares/rateLimit.js";
import { errorHandler } from "./middlewares/error.js";
import { api } from "./controllers/index.js";
import { connectMongo } from "./config/connection.js"; // your file

const PORT = Number(process.env.PORT || 3001);

async function main() {
  await connectMongo();

  const app = express();
  app.disable("x-powered-by");

  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(corsMiddleware);

  app.use("/api", apiLimiter, api);
  app.use(errorHandler);

  app.listen(PORT, () => console.log(`canvass api listening on :${PORT}`));
}

main().catch((e) => {
  console.error("Fatal start error", e);
  process.exit(1);
});
