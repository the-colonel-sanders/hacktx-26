# Try it yourself

This guide runs a small version of the system: a few "phones" listening for a shot, a server that works out where it came from, and a dashboard that shows the result. You need one laptop. A real phone is optional.

| Part | What you do | Time |
| --- | --- | --- |
| [1. Set up](#1-set-up-once) | Install, create a free database, start the server | ~10 min |
| [2. Phones on one laptop](#2-three-listening-phones-on-one-laptop) | Three browser tabs act as three phones; simulate a shot | ~2 min |
| [3. A real phone](#3-use-a-real-phone-as-a-listener) | Your phone listens; clap to trigger it | ~10 min |

> [!WARNING]
> Test with claps or the **Simulate shot** button only. Never use real or fake gunfire, and don't run alarming tests in public spaces.

---

## 1. Set up (once)

**You need:** Node.js 20 or newer, Chrome or Edge on the laptop, and a free [Supabase](https://supabase.com) account (the database).

1. **Get the code and install it.** In a terminal:
   ```bash
   git clone https://github.com/bear102/hacktx-26.git
   cd hacktx-26
   npm install
   ```
2. **Create the database.** In Supabase, create a new project and wait for it to finish starting. Then open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**. Do the same with [`supabase/seed.sql`](supabase/seed.sql), which adds the demo floor plan's rooms.
3. **Connect the app to it.** Copy the example settings file:
   ```bash
   cp .env.example .env.local      # Windows: copy .env.example .env.local
   ```
   Open `.env.local` and fill in the first three values from Supabase → **Project Settings → API Keys** (the project URL, the `sb_publishable_…` key and the `sb_secret_…` key). Leave the optional ones as they are.
4. **Start the server:**
   ```bash
   npm run dev
   ```
   Open **http://localhost:3000**. You should see the Gunshot Locator home page.

---

## 2. Three listening phones on one laptop

Each browser tab on `/phone` acts as a separate phone. You'll put three "phones" in three rooms and press **Simulate shot** in each. They all report the same loudness at the same moment, so the only spot that fits is the one **equally far from all three**, and the system should find the middle.

1. Open **http://localhost:3000/phone**. Under *Where is this phone? · Room*, choose **Room 202** and press **Start listening**. Allow the microphone when the browser asks.
2. Open a **new tab** (not *Duplicate tab*) at the same address, choose **Room 204** and press **Start listening**.
3. One more new tab: choose **Hallway Center** and press **Start listening**.
4. Open the dashboard in another tab: **http://localhost:3000/incident**.
5. Press **Simulate shot** in all three phone tabs, within the same 10 seconds. Each tab counts down (*Window ends in N s*), so start right after it resets.
6. On the dashboard, within a second or two:
   - the incident turns **Active** (every listening phone gets the alert)
   - the red marker lands in **Room 203**, in the middle of the three phones, with the blue shading around it
   - the *Detections* table lists all three phones under one shot
7. Press **All clear** on the dashboard to reset.

> [!TIP]
> Want to move the shot? In the admin panel (**http://localhost:3000/admin**), give one phone a louder *Sim. loudness* (for example **−8**) and simulate again: the estimate moves toward that phone.

> [!NOTE]
> You can also clap. All tabs hear it and raise the alert, but they share one microphone, so they always hear it equally. For a real location test, use separate devices (part 3).

---

## 3. Use a real phone as a listener

Browsers only allow the microphone on secure (`https://`) pages, and a phone can't reach your laptop's `localhost`. Give the laptop an `https://` address the phone can open, using either option.

**Option A: ngrok (works on any network, including campus Wi-Fi).**

1. Install [ngrok](https://ngrok.com/download), create a free account and run the `ngrok config add-authtoken …` command it gives you.
2. With `npm run dev` still running, open a second terminal and run:
   ```bash
   ngrok http 3000
   ```
3. Copy the `https://….ngrok-free.app` address it prints. Use **this address on the laptop too**, instead of `localhost`. If ngrok shows a "You are about to visit" page, press **Visit Site**.

**Option B: same Wi-Fi, no extra tools.**

1. Stop the server (Ctrl+C) and start it with HTTPS instead:
   ```bash
   npm run dev:https
   ```
   The first run creates a local certificate. Allow it if your computer asks.
2. Find the laptop's address on the network: `ipconfig` on Windows (the *IPv4 Address*), or `ipconfig getifaddr en0` on a Mac, for example `192.168.1.23`.
3. Your address is `https://192.168.1.23:3000`. When you open it on the phone, the browser warns about the certificate. Continue anyway: on iPhone tap **Show Details → visit this website**; on Android tap **Advanced → Proceed**.

If the phone can't load the page at all, the Wi-Fi is probably blocking device-to-device traffic (common on campus and guest networks). Use option A.

**Then:**

1. On the **phone**, open `<your address>/phone`. Choose a room (for example **Room 201**), press **Start listening** and allow the microphone. Keep this page open with the screen on: if the screen turns off, the phone stops listening.
2. On the **laptop**, open `<your address>/phone` in a tab as the second listener at **Room 205**, then open `<your address>/incident` for the dashboard.
3. **Simulate:** the phone shows the same **Simulate shot** button as the tabs in part 2, and the admin panel at `<your address>/admin` sets its loudness and delay.
4. **Clap:** clap sharply once, about 1 m from the phone. Both devices report it, and the dashboard shows the alert and the estimate.

**For a real location test**, tell the server where each device actually is. In the admin panel set *All phones → Location* to **Exact spot**; each phone then shows a floor plan to tap. Treat the grid as metres: for example, put the phone at (0, 0) and the laptop at (6, 0) if they are 6 m apart. Before clapping, press **Calibrate** next to each phone in the admin panel and clap once about 1 m from that phone, so their microphones' loudness readings are comparable.

**Several judges on one server?** Press **Try demo** in the top bar, then **Create space**. Each space is a separate sandbox with its own phones and incidents, and it shows a QR code that phones scan to join it. Open the dashboard through your ngrok or network address first (not `localhost`), so the QR code points somewhere the phone can reach.

---

## No phones at all?

With `npm run dev` running, this sends a whole simulated building's worth of phones (one per room) and prints where the shot really was next to where the server placed it:

```bash
npx tsx scripts/simulate.ts 9 2
```

`9 2` is the shot's position in metres on the demo floor plan. Watch it arrive on http://localhost:3000/incident.

---

## If something goes wrong

| What you see | Fix |
| --- | --- |
| "Microphone permission was denied" / "The microphone needs HTTPS" | On the laptop use `http://localhost:3000`; on a phone use the `https://` address from part 3. Then allow the microphone in the browser's site settings. |
| The phone page loads but buttons do nothing | Reload the page. If you're on Option B with an unusual network address, use Option A (ngrok) instead. |
| An error mentioning `column … does not exist` or `relation … does not exist` | Run [`supabase/schema.sql`](supabase/schema.sql) again in the Supabase SQL Editor. It's safe to re-run. |
| The phone asks for a map pin or a spot instead of a room, or the estimate isn't in the middle | Someone changed the settings. In the admin panel set *All phones → Location* to **Room**, *Sim. loudness* to **−15** and *Sim. delay* to **0**. |
| A phone isn't in the admin panel | Phones appear once they press **Start listening**. The list shows phones seen in the last 15 minutes. |
| The dashboard shows two shots instead of one | The presses landed in different 10-second windows. Press **All clear** and simulate again, pressing all of them before the countdown ends. |
| A clap is "ignored (confidence …)" | The detector wants a short, sharp sound. Clap once, crisply, closer to the phone. |
| The phone stopped reporting | Its screen turned off. Keep the page open and the screen on (turn off battery saver if needed). |
