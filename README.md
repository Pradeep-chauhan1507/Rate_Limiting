# Rate Limiter Tester

A simple API rate-limiting demo built with **Node.js, Express, and Redis**, with a dashboard made using HTML, CSS, and JavaScript.

## Features

- Limits requests per client IP using Redis.
- Configurable request limit and time window.
- Returns `200 OK` for allowed requests and `429 Too Many Requests` when the limit is exceeded.
- Dashboard shows sent, allowed, and rejected requests plus cooldown and request history.

## Architecture

### High-level architecture

```text
Browser / Dashboard
        |
        v
Node.js + Express API
        |
        v
Rate Limiter Middleware
        |
        v
      Redis
        |
        v
Allow request (200) or reject request (429)
```

### Detailed architecture

![Detailed rate limiter architecture](docs/rate-limiter-architecture.png)

1. The browser sends a request to `GET /api/test`.
2. Express passes the request to the rate-limiter middleware.
3. Middleware identifies the client using `req.ip`.
4. The middleware runs an atomic Lua script in Redis to increment the counter and set its expiry.
5. If the request is within the configured limit, it is allowed and returns `200 OK`.
6. If the limit is exceeded, the request is rejected with `429 Too Many Requests`.
7. Redis expires the counter at the end of the time window.
8. If Redis is unavailable, the protected endpoint returns `503 Service Unavailable`.

**Note:** The detailed reference image also shows cached rules, workers, and a message queue. These are possible extensions and are not implemented in this demo.

## Requirements

- Node.js and npm
- Redis
- Windows users can run Redis in Ubuntu on WSL; Docker is not required.

## Setup on Windows

Use **PowerShell (Administrator)** only for the initial WSL installation. Use **Ubuntu** for Redis commands and **Git Bash in VS Code** for the Node.js project commands.

### Step 1 — Install WSL (one time)

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

Restart Windows if prompted. Open Ubuntu from the Start menu and complete its first-time username/password setup.

If WSL is already installed, skip this step.

### Step 2 — Install Redis (one time, Ubuntu)

Open Ubuntu. Run each command:

```bash
sudo apt update
sudo apt install redis-server -y
```

### Step 3 — Start Redis (each time you work)

In Ubuntu, run:

```bash
sudo service redis-server start
redis-cli ping
```

The expected response is:

```text
PONG
```

### Step 4 — Open the project in VS Code

Open the project folder that contains `package.json`, `src/`, and `public/`. In VS Code, select **Terminal → New Terminal**, then choose **Git Bash**.

Use `cd` to enter the project folder if needed. For example:

```bash
cd ~/Downloads/rate-limiter-tester-no-docker/rate-limiter-tester-no-docker
```

Your folder path may differ. Confirm you are in the correct directory:

```bash
ls
```

You should see `package.json`, `src`, and `public`. Run all remaining commands from this folder.

### Step 5 — Configure the project (first time only)

In Git Bash:

```bash
cp .env.example .env
npm install
```

If `.env` already exists, you do not need to copy it again. The default `.env` values are:

```env
PORT=3000
REDIS_URL=redis://127.0.0.1:6379
RATE_LIMIT_MAX=5
RATE_LIMIT_WINDOW_SECONDS=10
```

### Step 6 — Run the project (each time)

In Git Bash, from the project folder:

```bash
npm start
```

Keep this terminal open. Open the dashboard at:

**http://localhost:3000**

## Everyday startup — quick version

1. **Ubuntu:** `sudo service redis-server start`
2. **Ubuntu:** `redis-cli ping` — confirm `PONG`
3. **VS Code / Git Bash:** go to the project root.
4. **Git Bash:** `npm start`
5. **Browser:** open `http://localhost:3000`

Stop the Node.js server with `Ctrl + C` in **Git Bash** when finished. If Redis is stopped, start it again next time. If you want to stop the the Redis write `sudo service redis-server stop` in **Ubuntu**

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Checks server and Redis connectivity. |
| `GET /api/config` | Shows the current rate-limit configuration. |
| `GET /api/status` | Reads the current client's quota status without consuming a request. |
| `GET /api/test` | Protected endpoint used to test rate limiting. |
| `GET /api` | Lists available endpoints. |

## Test the rate limiter

By default, the limit is **5 requests per 10 seconds per client IP**.

In Git Bash, run:

```bash
curl -i http://localhost:3000/api/test
```

Repeat the command several times quickly. After the limit is reached, responses should include `429 Too Many Requests`. Wait for the time window to expire before testing again.

## Project structure

```text
rate-limiter-tester-no-docker/
├── docs/
│   └── rate-limiter-architecture.png
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── src/
│   ├── redis.js
│   ├── rateLimiter.js
│   └── server.js
├── .env.example
├── package.json
└── README.md
```

## Troubleshooting

- **`npm` says `package.json` was not found:** use `cd` to enter the actual project folder.
- **`npm start` says `Missing script: start`:** check that you are in the correct project folder; its `package.json` should have a `start` script.
- **Redis connection refused:** start Redis in Ubuntu and confirm `redis-cli ping` returns `PONG`.
- **Port 3000 is busy:** stop the other server or change `PORT` in `.env`, then restart the app.

## Notes

- The dashboard's Reset button resets browser display statistics; it does not clear Redis counters.
- The project uses a fixed-window counter, so requests near window boundaries may occur close together.
- This is a learning demo, not a production security gateway. Do not expose it publicly without appropriate security and deployment configuration.
