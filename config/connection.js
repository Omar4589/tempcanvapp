import mongoose from "mongoose";

const MONGO_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/tempcanvapp";

export async function connectMongo() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

// if you still need the connection instance somewhere else:
export const db = mongoose.connection;
