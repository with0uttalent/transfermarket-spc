# TransferMarket

A full-featured football database web application inspired by Transfermarkt. Track teams, players, market values, transfers, titles, and competitions — with a public read-only view and a single admin account for managing all data.

---

## Features

| Feature | Public | Admin |
|---|---|---|
| Browse teams, players, competitions | ✅ | ✅ |
| View player profiles with market value history | ✅ | ✅ |
| View transfer records | ✅ | ✅ |
| Global search (players & teams) | ✅ | ✅ |
| Add / edit / delete teams | — | ✅ |
| Add / edit / delete players | — | ✅ |
| Adjust market values | — | ✅ |
| Record transfers (with fee, date, type) | — | ✅ |
| Add titles / honours to teams and players | — | ✅ |
| Manage competitions and leagues | — | ✅ |
| Manage countries / nationalities | — | ✅ |
| Change admin password | — | ✅ |
| Advertising banners (left/right columns) | — | ✅ |
| Loan players to other clubs | — | ✅ |
| Simulate matches with animated replay | ✅ | ✅ |
| Create & simulate tournaments (knockout bracket) | ✅ | ✅ |
| News feed (from matches & tournaments) | ✅ | ✅ |
| Player achievements & match stats | ✅ | ✅ |

### What you can manage

- **Teams** — name, short name, country, competition, founded year, stadium, logo, squad market value
- **Players** — name, date of birth, nationality, position, foot, height, shirt number, team, market value, status (active / retired / free agent), photo
- **Market Values** — set values per player; history is recorded automatically each time a value changes; match performance also adjusts values automatically
- **Transfers** — permanent, loan, free, or youth transfers with fee and date; moving a player updates their team automatically
- **Loans** — rent a player to another club with start/end dates and a loan fee; the player auto-returns when the loan expires
- **Titles** — league wins, cup wins, individual awards; assignable to a team or a player
- **Competitions** — leagues, cups, international tournaments linked to countries
- **Countries** — flag emoji, 3-letter code, used as nationalities and club countries
- **Matches** — schedule matches between teams, simulate them with a probabilistic engine, watch an 18-second animated replay
- **Tournaments** — create knockout tournaments, add teams, auto-generate a seeded bracket, simulate round by round
- **Banners** — upload or link advertising banners shown in the left and right sidebar columns on every page
- **News** — auto-generated from match results and tournament events; shown as a block on the homepage

---

## Requirements

- **Node.js** 18 or later
- **npm** 9 or later
- Ubuntu 20.04 / 22.04 / 24.04 (also works on any Linux/macOS)

---

## Installation on Ubuntu

### 1. Install Node.js (if not already installed)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should print v20.x.x
```

### 2. Clone the repository

```bash
git clone https://github.com/with0uttalent/transfermarket-spc.git
cd transfermarket-spc
```

### 3. Install dependencies

```bash
npm install
```

If you get a build error for `better-sqlite3`, install the native build tools first:

```bash
sudo apt install build-essential python3 -y
npm install
```

### 4. Configure environment variables

```bash
cp .env.example .env
nano .env
```

Edit these values:

```
PORT=3000
JWT_SECRET=some_long_random_secret_replace_this
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
```

> **Important:** Change `JWT_SECRET` to a long random string.
> Run `openssl rand -hex 32` to generate one.
> Set `ADMIN_PASSWORD` to something strong before running setup.

### 5. Create the admin account and seed data

```bash
npm run setup
```

This creates the SQLite database, runs the schema, creates the admin user, and seeds a list of common countries.

### 6. Start the application

```bash
npm start
```

Open your browser at **http://localhost:3000**

---

## Running as a Background Service (systemd)

To keep the app running after you close the terminal and restart automatically on reboot:

### 1. Create the service file

```bash
sudo nano /etc/systemd/system/transfermarket.service
```

Paste the following (adjust `User` and `WorkingDirectory` to match your setup):

```ini
[Unit]
Description=TransferMarket Web App
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/transfermarket-spc
EnvironmentFile=/home/ubuntu/transfermarket-spc/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 2. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable transfermarket
sudo systemctl start transfermarket
sudo systemctl status transfermarket
```

### 3. View logs

```bash
sudo journalctl -u transfermarket -f
```

---

## Reverse Proxy with Nginx (optional, recommended for production)

Serve the app on port 80/443 and optionally add HTTPS.

### Install Nginx

```bash
sudo apt install nginx -y
```

### Create a site config

```bash
sudo nano /etc/nginx/sites-available/transfermarket
```

```nginx
server {
    listen 80;
    server_name your-domain.com;   # or your server's IP address

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 10M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/transfermarket /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

To add HTTPS with Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

---

## Usage

### Logging in as admin

1. Click the **Login** button in the top-right corner.
2. Enter the username and password you set in `.env`.
3. After login, the **ADMIN** badge appears and edit/delete buttons become visible throughout the site.

### Adding a team

Go to **Teams** → click **+ Add Team**. Fill in name, country, competition, and optionally a logo URL. Click **Add Team**.

### Adding a player

Go to **Players** → click **+ Add Player**, or open a team's squad tab and click **+ Add Player** there.

### Recording a transfer

Open a player's profile → click **Transfer**. Select the source and destination teams, fee, date, and transfer type. The player is automatically moved to the new team and squad values are recalculated.

### Adjusting market values

Open a player → click **Edit** → change the **Market Value** field → save. Each change appends a new entry to the player's market value history, visible as a bar chart on their profile.

### Adding titles

Open a team or player detail page → click the **Titles** tab → **+ Add Title**. Link to a competition if desired, enter the season and year.

### Simulating a match

1. Go to **Matches** → click **+ Schedule Match**.
2. Select home team, away team, and a date.
3. Open the match detail page → click **Simulate Match** (admin only).
4. Once simulated, click **Watch Replay** to see an 18-second animated replay with a live event log.

Market values of standout performers are automatically adjusted after simulation.

### Running a tournament

1. Go to **Tournaments** → click **+ New Tournament**.
2. Open the tournament → click **+ Add Teams** and select participating clubs.
3. Click **Start Tournament** — the bracket is seeded by squad market value.
4. On each round, click **Simulate Round** to play all matches and advance the bracket.
5. The champion is crowned automatically and players receive achievement records.

### Managing loans

Open a player's profile → click **Loan Out**. Enter the destination club, loan fee, start and end dates. The player moves to the loan club and returns automatically when the loan expires (checked daily at 00:05).

To end a loan early: go to **Transfers** → **Loans** tab → click **End Loan**.

### Advertising banners

Go to **Admin** → **Banners**. Add a banner with a name, image URL or upload, optional link, and choose **left** or **right** position. Active banners appear in the sidebar columns on every page.

---

## File Structure

```
transfermarket-spc/
├── server.js              # Express entry point
├── package.json
├── .env                   # Your local config (not committed)
├── .env.example           # Template
├── database/
│   ├── db.js              # SQLite setup and schema
│   └── transfermarket.db  # Auto-created on first run
├── routes/
│   ├── auth.js
│   ├── banners.js         # Advertising banners
│   ├── countries.js
│   ├── competitions.js
│   ├── loans.js           # Player loans
│   ├── matches.js         # Match simulation
│   ├── news.js            # Auto-generated news feed
│   ├── players.js
│   ├── stats.js
│   ├── teams.js
│   ├── titles.js
│   ├── tournaments.js     # Knockout tournaments
│   └── transfers.js
├── services/
│   ├── matchSimulator.js  # Probabilistic match engine
│   └── scheduler.js       # Daily cron (00:05) for auto-simulation
├── middleware/
│   └── auth.js            # JWT verification
├── scripts/
│   └── setup.js           # First-run setup script
└── public/
    ├── index.html          # SPA shell
    ├── css/style.css
    ├── js/app.js           # Frontend SPA logic
    └── images/uploads/     # Uploaded images (auto-created)
```

---

## Backup

The entire database is a single file:

```bash
cp database/transfermarket.db database/transfermarket.db.backup
```

To restore:

```bash
cp database/transfermarket.db.backup database/transfermarket.db
```

---

## Updating

```bash
git pull
npm install
sudo systemctl restart transfermarket
```

Your data in `database/transfermarket.db` is never touched by updates.

### Migrating from v1 to v2 (existing deployments)

If you already have players, teams, and other data from v1, migration is **fully automatic and non-destructive**.

All new v2 tables (`matches`, `match_events`, `tournaments`, `loans`, `banners`, `news`, etc.) use `CREATE TABLE IF NOT EXISTS`, so they are created on first startup without modifying or dropping any existing tables.

**Recommended steps for safety:**

```bash
# 1. Back up your database first
cp database/transfermarket.db database/transfermarket.db.backup-$(date +%Y%m%d)

# 2. Pull the new code
git pull

# 3. Install new dependency (node-cron)
npm install

# 4. Restart the service
sudo systemctl restart transfermarket
```

That's it. All your existing teams, players, transfers, and titles will be intact. The new features (matches, tournaments, loans, banners, news) are empty and ready to populate.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Cannot find module 'better-sqlite3'` | Run `sudo apt install build-essential python3 -y && npm install` |
| Port 3000 already in use | Change `PORT=` in `.env` |
| Admin login fails | Update `.env` then re-run `npm run setup` |
| App crashes on start | Check `sudo journalctl -u transfermarket -n 50` |
| Images not showing | Ensure URL starts with `/images/uploads/` or is a valid external URL |
