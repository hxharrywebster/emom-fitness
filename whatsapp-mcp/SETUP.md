# Connecting WhatsApp — Setup Guide

This folder contains a **WhatsApp MCP server**. Once it's running on your
computer, it links to your WhatsApp (the same way "WhatsApp Web" does) and lets
an AI assistant like Claude read and send your WhatsApp messages.

> **Important — how the connection works.** This server keeps your WhatsApp
> session **on the machine that runs it**. It has to stay running to stay
> connected. On a laptop that means WhatsApp is connected whenever the app is
> running and your computer is on. If you want it connected 24/7, run it on an
> always-on machine (a small cloud server) instead — the steps are the same.

---

## What you need

1. **Docker Desktop** — the easiest way to run this. Free.
   - Mac / Windows: https://www.docker.com/products/docker-desktop/
   - Install it, open it once, and leave it running.
2. **Your phone with WhatsApp** — to scan a QR code (just like WhatsApp Web).

That's it. You do **not** need to install Go or know how to code.

---

## Step 1 — Get this folder onto your computer

If you already have the `emom-fitness` repo cloned, just `git pull`. Otherwise,
download it from GitHub (green **Code** button → **Download ZIP**) and unzip it.

Then open a terminal **in this `whatsapp-mcp` folder**:

```bash
cd path/to/emom-fitness/whatsapp-mcp
```

## Step 2 — Create your settings file

Copy the example settings file:

```bash
cp .env.example .env
```

Now open `.env` in any text editor and set your secret API key. This key is
just a password that stops other programs on your computer from using the
server. Generate one:

```bash
# Mac / Linux — prints a random key, paste it into .env
openssl rand -hex 32
```

Set it in `.env` like this (use your own generated value):

```
MCP_API_KEY=paste-your-generated-key-here
```

Optionally set your timezone so message times look right, e.g.:

```
TIMEZONE=Europe/London
```

Leave everything else as-is for now.

## Step 3 — Start the server

```bash
docker compose up -d
```

The first run takes a couple of minutes (it builds the app). After that it
starts in seconds.

## Step 4 — Link your WhatsApp (scan the QR code)

Show the logs so you can see the QR code:

```bash
docker compose logs -f
```

A QR code will appear in the terminal. On your phone:

1. Open **WhatsApp**
2. **Settings → Linked Devices → Link a Device**
3. Point your camera at the QR code in the terminal

The logs will change to **"Connected to WhatsApp"**. You're linked. Press
`Ctrl+C` to stop watching the logs (the server keeps running in the background).

> The QR code also gets saved as `qr.png` in this folder if it's easier to scan
> from an image.

## Step 5 — Check it's working

```bash
curl http://localhost:8080/health
```

You should see `OK`. If you see "WhatsApp not connected", the QR scan didn't
complete — repeat Step 4.

---

## Step 6 — Connect Claude to it

Add this to your Claude MCP configuration, replacing the key with the one you
put in `.env`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY_HERE"
      }
    }
  }
}
```

- **Claude Desktop config file:**
  - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop. You can now ask things like *"Summarise my last chat
with …"* or *"Send a WhatsApp to … saying …"*.

---

## Everyday commands

```bash
docker compose up -d       # start it
docker compose logs -f     # watch what it's doing / see the QR
docker compose down        # stop it (stays linked — your session is saved)
docker compose up -d --build   # rebuild after updating the code
```

Your WhatsApp session and messages are stored in the `data/` folder next to
this file. **Keep that folder private** — it contains your login. It is
deliberately excluded from Git (see `.gitignore`), so it never gets uploaded.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| QR code expired before I scanned | Run `docker compose logs -f` again — a fresh QR appears every ~20s. |
| `/health` says "WhatsApp not connected" | The link didn't finish. Re-scan (Step 4). |
| "Cannot connect to the Docker daemon" | Docker Desktop isn't running. Open it and retry. |
| Phone shows the linked device but nothing works | The computer running the server must be on and the container running. |
| I want it connected 24/7 | Run these same steps on an always-on cloud server (e.g. a small VPS) instead of your laptop. |

---

## Security notes

- The server listens on `127.0.0.1` (your computer only) by default — it is not
  exposed to the internet.
- Never commit your `.env` or the `data/` folder. Both are git-ignored.
- Using unofficial WhatsApp access can violate WhatsApp's Terms of Service — use
  your own account and use it responsibly. See the disclaimer in `README.md`.
