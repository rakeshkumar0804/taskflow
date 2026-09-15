require("dotenv").config();

// Ensure production fails closed if JWT_SECRET is missing
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is required in production");
  process.exit(1);
}

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const connectDB = require("./config/db");

// Bind all Mongoose operations executed inside connection.transaction() to
// the active session, including operations in nested controller services.
// This is required for the execution ledger's replica-set atomicity contract.
const mongoose = require("mongoose");
mongoose.set("transactionAsyncLocalStorage", true);

// Connect Database and start server
(async () => {
  await connectDB();

  const app = express();
  const server = http.createServer(app);

  // Allowed Frontend URLs (strictly controlled trusted origins)
  const defaultOrigins = [
    "http://localhost:3000",
    "https://taskflow-gules-rho.vercel.app",
  ];
  const allowedOrigins = process.env.CLIENT_URL
    ? [...new Set([...defaultOrigins, process.env.CLIENT_URL])]
    : defaultOrigins;

  // Socket.io
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
    },
  });

  // Middleware
  app.use(
    cors({
      origin: allowedOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  );

  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use(express.urlencoded({ extended: false }));

  // Attach io to requests
  app.use((req, _res, next) => {
    req.io = io;
    next();
  });

  // Routes
  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/tasks", require("./routes/tasks"));
  app.use("/api/projects", require("./routes/capacity"));
  app.use("/api/projects", require("./routes/projects"));
  app.use("/api/releases", require("./routes/releases"));
  app.use("/api/milestones", require("./routes/milestones"));
  app.use("/api/decisions", require("./routes/decisions"));
  app.use("/api/activity", require("./routes/activity"));
  app.use("/api/webhooks", require("./routes/webhooks"));
  app.use("/api/users", require("./routes/users"));

  // Health Check
  app.get("/api/health", (_req, res) => {
    const dbState = mongoose.connection.readyState;
    const status = dbState === 1 ? "OK" : "DEGRADED";
    res.status(dbState === 1 ? 200 : 503).json({
      status,
      timestamp: new Date(),
      database: dbState === 1 ? "connected" : "disconnected",
    });
  });

  // Socket.io Events
  io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    socket.on("join:project", (projectId) => {
      socket.join(`project:${projectId}`);

      console.log(
        `Socket ${socket.id} joined project:${projectId}`,
      );
    });

    socket.on("leave:project", (projectId) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });

  // 404 Handler
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      message: "Route not found",
    });
  });

  // Global Error Handler
  app.use((err, _req, res, _next) => {
    console.error(err.stack);

    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  });

  const PORT = process.env.PORT || 5000;

  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Socket.io enabled`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
  });
})();
