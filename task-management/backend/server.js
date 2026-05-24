require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const connectDB = require("./config/db");

// Connect Database
connectDB();

const app = express();
const server = http.createServer(app);

// Allowed Frontend URLs
const allowedOrigins = [
  "http://localhost:3000",
  "https://taskflow-gules-rho.vercel.app",
];

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
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Attach io to requests
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/users", require("./routes/users"));

// Health Check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date(),
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
