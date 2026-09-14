const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/taskflow';
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.warn(`⚠️ Primary MongoDB Connection failed (${error.message}). Attempting local fallback...`);
    try {
      const fallbackConn = await mongoose.connect('mongodb://127.0.0.1:27017/taskflow', {
        serverSelectionTimeoutMS: 5000,
      });
      console.log(`✅ MongoDB Connected (Local Fallback): ${fallbackConn.connection.host}`);
    } catch (fallbackErr) {
      console.error(`❌ MongoDB Error: ${fallbackErr.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
