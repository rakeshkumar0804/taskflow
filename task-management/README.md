# TaskFlow — Task Management System

A full-stack MERN real-time task management app with RBAC, Kanban board, and Socket.IO.

## Features

- **JWT Authentication** — Register/Login with role-based access (Admin, Manager, Member)
- **RBAC** — Role-Based Access Control across all routes
- **Real-time Updates** — Socket.IO syncs task/project changes live across all connected users
- **Kanban Board** — Drag tasks across To Do → In Progress → Review → Done
- **Projects** — Create projects, invite members, set colors and deadlines
- **Task Management** — Create tasks with priority, due date, tags, comments, and assignees
- **Team Management** — Admins can view all users, change roles, deactivate accounts
- **Dashboard** — Live stats: total, in-progress, Done, overdue tasks

## Tech Stack

- **Frontend**: React 18, React Router v6, Socket.IO Client, Axios, react-hot-toast, date-fns
- **Backend**: Node.js, Express, MongoDB + Mongoose, Socket.IO, JWT, bcryptjs

## Quick Start

### 1. Clone & install

```bash
# Server
cd server
npm install
cp .env.example .env    # Edit MONGO_URI and JWT_SECRET

# Client
cd ../client
npm install
```

### 2. Configure `.env`

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/taskmanagement
JWT_SECRET=change_this_to_something_secure
CLIENT_URL=http://localhost:3000
```

### 3. Run

```bash
# Terminal 1 — Backend
cd server && npm run dev

# Terminal 2 — Frontend
cd client && npm start
```

App runs at **http://localhost:3000**

## Project Structure

```
task-management/
├── server/
│   ├── index.js           # Entry point + Socket.IO setup
│   ├── models/
│   │   ├── User.js        # User schema with bcrypt
│   │   ├── Project.js     # Project + members
│   │   └── Task.js        # Task with comments
│   ├── routes/
│   │   ├── auth.js        # Register, Login, Me
│   │   ├── users.js       # CRUD + search
│   │   ├── projects.js    # Projects CRUD + members
│   │   └── tasks.js       # Tasks CRUD + comments
│   └── middleware/
│       └── auth.js        # JWT protect + requireRole
│
└── client/src/
    ├── App.js             # Router + providers
    ├── context/
    │   ├── AuthContext.js  # Auth state + login/logout
    │   └── SocketContext.js # Socket.IO connection
    ├── components/
    │   ├── auth/           # Login, Register
    │   ├── layout/         # Sidebar navigation
    │   ├── dashboard/      # Dashboard, Projects
    │   └── tasks/          # Kanban board, TaskCard, TaskModal
    └── pages/
        └── Team.js         # User management (admin)
```

## API Endpoints

| Method | Route                     | Auth        | Description              |
| ------ | ------------------------- | ----------- | ------------------------ |
| POST   | /api/auth/register        | Public      | Register user            |
| POST   | /api/auth/login           | Public      | Login                    |
| GET    | /api/auth/me              | User        | Get current user         |
| GET    | /api/projects             | User        | List accessible projects |
| POST   | /api/projects             | Manager+    | Create project           |
| PUT    | /api/projects/:id         | Owner/Admin | Update project           |
| POST   | /api/projects/:id/members | Owner/Admin | Add member               |
| GET    | /api/tasks                | User        | List tasks (filterable)  |
| POST   | /api/tasks                | Member      | Create task              |
| PUT    | /api/tasks/:id            | Member      | Update task              |
| POST   | /api/tasks/:id/comments   | Member      | Add comment              |
| GET    | /api/users                | Admin       | List all users           |
| GET    | /api/users/search?q=      | User        | Search users             |
| PUT    | /api/users/:id            | Admin/Self  | Update user              |

## Socket Events

| Event           | Direction     | Payload        |
| --------------- | ------------- | -------------- |
| join            | Client→Server | userId         |
| join_project    | Client→Server | projectId      |
| task_created    | Server→Client | Task object    |
| task_updated    | Server→Client | Task object    |
| task_deleted    | Server→Client | taskId         |
| project_created | Server→Client | Project object |
| project_updated | Server→Client | Project object |
| project_deleted | Server→Client | projectId      |
