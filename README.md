# TaskFlo

TaskFlow is a full-stack project management platform built with the MERN stack. It gives engineering teams a unified workspace to plan tasks, track releases, manage milestones, record architectural decisions, and monitor delivery health — all wrapped in a polished dark-themed UI.

**🚀 Live:** [taskflow-gules-rho.vercel.app](https://taskflow-gules-rho.vercel.app)

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat&logo=mongodb&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)
![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=flat&logo=socket.io&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?style=flat&logo=render&logoColor=white)

---

## Features

### Core Task Management
- **Dashboard** — Personalized overview with task statistics, in-progress items, priority breakdown chart, and quick actions
- **Task Board** — Create, update, filter, and search tasks with priority labels (Critical / High / Medium / Low) and status tracking (To Do → In Progress → Review → Completed)
- **Task Drawer** — Slide-out detail panel with comments, dependency links, GitHub evidence badges, and activity history
- **Drag-and-Drop** — Reorder and organize tasks visually

### Project Management
- **Projects** — Create and manage projects with team members, status tracking, and archival
- **Project Control Room** — Deep-dive into a single project with dependency graph, delivery forecast, and activity stream
- **Member Management** — Add / remove project members with role-based permissions

### Release & Milestone Tracking
- **Releases** — Plan and track software releases with linked tasks and delivery intelligence
- **Milestones** — Define project milestones with target dates and completion tracking
- **Release Readiness** — Automated readiness scoring based on linked task completion

### Delivery Intelligence
- **Dependency Graph** — Visual task dependency mapping with cycle detection
- **Delivery Forecasting** — Predictive delivery dates based on velocity and task dependencies
- **Flow Health** — Real-time flow health metrics (WIP limits, throughput, cycle time)
- **Execution Graph** — Interactive visualization of project execution state

### Engineering Decision Records
- **Decision Log** — Record architectural and engineering decisions with full lifecycle tracking
- **Decision Lifecycle** — Proposed → Accepted → Superseded → Deprecated status transitions
- **Impact Analysis** — Automatic impact scoring across linked tasks, milestones, and releases

### Team Capacity & Ownership
- **Capacity Planning** — Per-member capacity allocation across projects with intelligence insights
- **Workload Visibility** — Track who owns what across all active projects

### Activity & Execution Ledger
- **Activity Timeline** — Cursor-paginated, filterable activity feed across all domains
- **Execution Event Ledger** — Versioned, append-only audit trail for every mutation (29 canonical event types)
- **Ledger Coverage** — Admin diagnostics showing synchronization status across all aggregates
- **Privacy-Aware Views** — Members see only activity within their permitted project scope

### GitHub Integration
- **Webhook Receiver** — Receive GitHub push, PR, and issue events and link them to tasks
- **Evidence Badges** — Visual GitHub evidence indicators on tasks with linked commits/PRs
- **Signature Verification** — HMAC-SHA256 webhook signature validation

### Authentication & Authorization
- **JWT Authentication** — Secure token-based login and registration
- **Role-Based Access Control** — Three roles: Admin, Manager, Member — each with scoped permissions
- **User Management** — Admin panel to manage users, assign roles, and toggle active status

### Real-Time Updates
- **Socket.io** — Live updates pushed to all connected clients when tasks, projects, or releases change
- **Project Rooms** — Clients join project-specific rooms for scoped real-time events

---

## Screenshots

### Login Page
<img width="1911" height="962" alt="login" src="https://github.com/user-attachments/assets/0d0c1dbb-257c-4926-97f8-09a575567473" />

### Dashboard
<img width="1902" height="962" alt="dashboard" src="https://github.com/user-attachments/assets/0df14ad4-e767-43fe-9bfa-8273e9e33a74" />

### Projects
<img width="1902" height="946" alt="projects" src="https://github.com/user-attachments/assets/ba39b08b-e2e4-498c-953b-2a111beedbe7" />

---

## Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| React Router 6 | Client-side routing |
| Axios | HTTP client |
| Socket.io Client | Real-time communication |
| React Beautiful DnD | Drag-and-drop interactions |
| React Hot Toast | Notification toasts |
| date-fns | Date formatting and manipulation |
| CSS | Custom dark-theme styling |

### Backend
| Technology | Purpose |
|------------|---------|
| Node.js | Runtime |
| Express.js | HTTP framework |
| MongoDB + Mongoose 8 | Database and ODM |
| JSON Web Tokens | Authentication |
| Socket.io | Real-time event broadcasting |
| bcryptjs | Password hashing |
| dotenv | Environment configuration |

### Deployment
| Service | Role |
|---------|------|
| **Vercel** | Frontend hosting (auto-deploy from `main`) |
| **Render** | Backend API hosting |
| **MongoDB Atlas** | Cloud database |

---

## Getting Started

### Prerequisites
- Node.js v16 or higher
- MongoDB (local instance or [Atlas](https://www.mongodb.com/cloud/atlas) cluster)
- npm

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/rakeshkumar0804/taskflow.git
   cd taskflow/task-management
   ```

2. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```

3. **Install frontend dependencies**
   ```bash
   cd ../frontend
   npm install
   ```

4. **Set up environment variables**

   Create `backend/.env`:
   ```env
   PORT=5000
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret_key
   JWT_EXPIRE=7d
   NODE_ENV=development
   ```

   Optionally create `frontend/.env`:
   ```env
   REACT_APP_API_URL=http://localhost:5000/api
   ```

5. **Run the application**

   Start the backend:
   ```bash
   cd backend
   npm start
   ```

   Start the frontend (in a separate terminal):
   ```bash
   cd frontend
   npm start
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

---

## Project Structure

```
taskflow/
└── task-management/
    ├── backend/
    │   ├── config/
    │   │   └── db.js                  # MongoDB connection with fallback
    │   ├── controllers/
    │   │   ├── activityController.js   # Activity feed & ledger coverage
    │   │   ├── authController.js       # Login, register, profile
    │   │   ├── capacityController.js   # Team capacity intelligence
    │   │   ├── decisionController.js   # Decision records & lifecycle
    │   │   ├── milestoneController.js  # Milestone CRUD
    │   │   ├── projectController.js    # Projects, members, delivery intel
    │   │   ├── releaseController.js    # Release CRUD & readiness
    │   │   ├── taskController.js       # Tasks, comments, dependencies, GitHub
    │   │   └── userController.js       # User admin management
    │   ├── middleware/
    │   │   ├── auth.js                 # JWT verification & RBAC
    │   │   └── ledgerTransaction.js    # Transactional mutation wrapper
    │   ├── models/
    │   │   ├── DecisionRecord.js       # Engineering decision schema
    │   │   ├── ExecutionEvent.js       # Versioned execution ledger schema
    │   │   ├── Milestone.js            # Milestone schema
    │   │   ├── Project.js              # Project schema
    │   │   ├── ProjectCapacity.js      # Per-member capacity allocation
    │   │   ├── Release.js              # Release schema
    │   │   ├── Task.js                 # Task schema with dependencies
    │   │   └── User.js                 # User schema with bcrypt hashing
    │   ├── routes/
    │   │   ├── activity.js             # GET /api/activity
    │   │   ├── auth.js                 # POST /api/auth/*
    │   │   ├── capacity.js             # /api/projects/:id/capacity
    │   │   ├── decisions.js            # /api/decisions
    │   │   ├── milestones.js           # /api/milestones
    │   │   ├── projects.js             # /api/projects
    │   │   ├── releases.js             # /api/releases
    │   │   ├── tasks.js                # /api/tasks
    │   │   ├── users.js                # /api/users (admin)
    │   │   └── webhooks.js             # /api/webhooks/github
    │   ├── services/
    │   │   └── executionEventService.js # Ledger recording & idempotency
    │   ├── utils/
    │   │   ├── capacityIntelligence.js  # Capacity analytics
    │   │   ├── decisionImpact.js        # Decision impact scoring
    │   │   ├── deliveryIntelligence.js  # Delivery forecasting
    │   │   ├── dependencyGraph.js       # DAG operations & cycle detection
    │   │   ├── executionEventFactory.js # Canonical event vocabulary (29 types)
    │   │   ├── flowHealth.js            # Flow health metrics
    │   │   ├── projectAuthorization.js  # Shared authorization predicates
    │   │   └── releaseReadiness.js      # Release readiness scoring
    │   └── server.js                    # Express + Socket.io entry point
    └── frontend/
        └── src/
            ├── components/
            │   ├── activity/            # ActivityTimeline, ActivityDrawer
            │   ├── auth/                # ProtectedRoute
            │   ├── capacity/            # CapacityConfigModal
            │   ├── decisions/           # DecisionDrawer, DecisionModal
            │   ├── layout/              # AppLayout, Sidebar
            │   └── tasks/               # TaskDrawer, FlowHealthWidget
            ├── context/
            │   └── AuthContext.js        # JWT auth context provider
            ├── pages/
            │   ├── Dashboard.js          # Main dashboard
            │   ├── TasksPage.js          # Task board
            │   ├── Projects.js           # Project list
            │   ├── ProjectDetailPage.js  # Project control room
            │   ├── ReleasesPage.js       # Releases & milestones
            │   ├── ExecutionGraphPage.js # Execution visualization
            │   ├── DecisionsPage.js      # Decision records
            │   ├── TeamCapacityPage.js   # Team capacity planning
            │   ├── ActivityPage.js       # Activity timeline & ledger
            │   └── AuthPage.js           # Login / register
            └── utils/
                ├── api.js                # Axios instance & interceptors
                └── taskHelpers.js        # Shared task utilities
```

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and receive JWT |
| GET | `/api/auth/me` | Get current user profile |
| PUT | `/api/auth/profile` | Update profile |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks (filtered, paginated) |
| POST | `/api/tasks` | Create a task |
| GET | `/api/tasks/:id` | Get task details |
| PUT | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task (admin/manager) |
| POST | `/api/tasks/:id/comments` | Add a comment |
| GET | `/api/tasks/:id/dependencies` | Get task dependencies |
| POST | `/api/tasks/:id/dependencies` | Add a dependency |
| DELETE | `/api/tasks/:id/dependencies/:depId` | Remove a dependency |
| PUT | `/api/tasks/:id/github` | Link GitHub evidence |
| GET | `/api/tasks/stats` | Task statistics |
| GET | `/api/tasks/health` | Flow health metrics |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create a project |
| GET | `/api/projects/:id` | Get project details |
| PUT | `/api/projects/:id` | Update a project |
| DELETE | `/api/projects/:id` | Delete a project |
| POST | `/api/projects/:id/members` | Add a team member |
| DELETE | `/api/projects/:id/members/:userId` | Remove a member |
| GET | `/api/projects/:id/dependency-graph` | Dependency graph data |
| GET | `/api/projects/:id/delivery-intelligence` | Delivery forecast |
| GET | `/api/projects/:id/activity` | Project activity feed |

### Releases
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/releases` | List all releases |
| POST | `/api/releases` | Create a release |
| GET | `/api/releases/:id` | Get release details |
| PUT | `/api/releases/:id` | Update a release |
| DELETE | `/api/releases/:id` | Delete a release |
| GET | `/api/releases/:id/delivery-intelligence` | Release delivery intel |

### Milestones
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/milestones` | List all milestones |
| POST | `/api/milestones` | Create a milestone |
| GET | `/api/milestones/:id` | Get milestone details |
| PUT | `/api/milestones/:id` | Update a milestone |
| DELETE | `/api/milestones/:id` | Delete a milestone |

### Decisions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/decisions/:id/transition` | Transition decision status |
| GET | `/api/decisions/:id/impact` | Get decision impact analysis |

### Capacity
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/capacity` | Get capacity allocations |
| PUT | `/api/projects/:id/capacity/:userId` | Upsert member capacity |
| DELETE | `/api/projects/:id/capacity/:userId` | Remove capacity entry |
| GET | `/api/projects/:id/capacity-intelligence` | Capacity analytics |

### Activity & Ledger
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/activity` | Paginated activity feed |
| GET | `/api/activity/coverage` | Ledger coverage diagnostics |
| GET | `/api/activity/:eventId` | Get single event detail |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhooks/github` | Receive GitHub webhook events |

### Users (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| PUT | `/api/users/:id/role` | Update user role |
| PUT | `/api/users/:id/toggle-active` | Activate / deactivate user |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health + DB status |

---

## Environment Variables

### Backend (`backend/.env`)
| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 5000) |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Secret key for JWT signing |
| `JWT_EXPIRE` | No | Token expiry (default: 7d) |
| `NODE_ENV` | No | `development` or `production` |
| `CLIENT_URL` | No | Additional CORS origin |
| `GITHUB_WEBHOOK_SECRET` | No | GitHub webhook HMAC secret |

### Frontend (`frontend/.env`)
| Variable | Required | Description |
|----------|----------|-------------|
| `REACT_APP_API_URL` | No | Backend API base URL |

---

## Deployment

### Frontend (Vercel)
1. Import the GitHub repository on [vercel.com](https://vercel.com)
2. Set **Root Directory** to `task-management/frontend`
3. Set **Build Command** to `npm run build`
4. Set **Output Directory** to `build`
5. Optionally set `REACT_APP_API_URL` environment variable to your backend URL

### Backend (Render)
1. Create a new **Web Service** on [render.com](https://render.com)
2. Connect the GitHub repository
3. Set **Root Directory** to `task-management/backend`
4. Set **Build Command** to `npm install`
5. Set **Start Command** to `npm start`
6. Add environment variables: `MONGO_URI`, `JWT_SECRET`, `NODE_ENV=production`

### Database (MongoDB Atlas)
1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas)
2. Whitelist `0.0.0.0/0` under Network Access (required for Render's dynamic IPs)
3. Create a database user and use the connection string as `MONGO_URI`

---

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Author

**Rakesh Kumar**
- GitHub: [@rakeshkumar0804](https://github.com/rakeshkumar0804)
- LinkedIn: [Rakesh Kumar](https://linkedin.com/in/rakesh-kumar-520754246)
