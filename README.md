# TaskFlow

TaskFlow is a full-stack task management application built with the MERN stack. It gives teams and individuals a clean, dark-themed dashboard to track tasks, monitor progress, and manage priorities in one place.

**Live Demo:** [taskflow-gules-rho.vercel.app](https://taskflow-gules-rho.vercel.app)

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat&logo=mongodb&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)

## Features

- **Dashboard Overview** — At-a-glance stats for total tasks, in-progress, completed, and to-do items
- **Task Management** — Create, update, and track tasks with priority labels (Critical, High, Medium, Low)
- **Priority Breakdown** — Visual breakdown of tasks by priority level
- **In Progress Tracking** — Dedicated view for tasks currently being worked on, with due dates
- **Authentication & Authorization** — Secure login with JWT-based auth and role-based access control (Admin/User)
- **Project Organization** — Group tasks under projects for better structure
- **Responsive UI** — Clean, modern dark-mode interface

## 📸 Screenshots

### Login Page<img width="1911" height="962" alt="login" src="https://github.com/user-attachments/assets/0d0c1dbb-257c-4926-97f8-09a575567473" />


### Dashboard<img width="1902" height="962" alt="dashboard " src="https://github.com/user-attachments/assets/0df14ad4-e767-43fe-9bfa-8273e9e33a74" />


### PROJECTS<img width="1902" height="946" alt="projects" src="https://github.com/user-attachments/assets/ba39b08b-e2e4-498c-953b-2a111beedbe7" />



## Tech Stack

**Frontend:**
- React.js
- CSS / Tailwind CSS

**Backend:**
- Node.js
- Express.js
- MongoDB (Mongoose)
- JWT Authentication
- Role-Based Access Control (RBAC)

**Deployment:**
- Vercel

## Screenshots

The dashboard shows a personalized greeting, task stats, in-progress tasks with priority tags, and a priority breakdown chart — giving users a quick summary of their workspace every time they log in.

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (local or Atlas)
- npm or yarn

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/rakeshkumar0804/taskflow.git
   cd taskflow
   ```

2. Install server dependencies
   ```bash
   cd server
   npm install
   ```

3. Install client dependencies
   ```bash
   cd ../client
   npm install
   ```

4. Set up environment variables

   Create a `.env` file in the `server` directory:
   ```env
   PORT=5000
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret_key
   ```

   Create a `.env` file in the `client` directory:
   ```env
   REACT_APP_API_URL=http://localhost:5000/api
   ```

5. Run the application

   Start the backend:
   ```bash
   cd server
   npm start
   ```

   Start the frontend:
   ```bash
   cd client
   npm start
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
taskflow/
├── client/                 # React frontend
│   ├── public/
│   └── src/
│       ├── components/
│       ├── pages/
│       └── App.js
├── server/                 # Express backend
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   └── server.js
└── README.md
```

## API Endpoints

| Method | Endpoint             | Description                |
|--------|-----------------------|-----------------------------|
| POST   | `/api/auth/register`  | Register a new user         |
| POST   | `/api/auth/login`     | Login and get JWT token     |
| GET    | `/api/tasks`          | Get all tasks                |
| POST   | `/api/tasks`          | Create a new task            |
| PUT    | `/api/tasks/:id`      | Update a task                 |
| DELETE | `/api/tasks/:id`      | Delete a task                 |
| GET    | `/api/projects`       | Get all projects              |

## Contributing

Contributions are welcome. Feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License.

## Author

**Rakesh Kumar**
- GitHub: [@rakeshkumar0804](https://github.com/rakeshkumar0804)
- LinkedIn: [Rakesh Kumar](https://linkedin.com/in/rakesh-kumar-520754246)
