# Turning on the online leaderboard

The game already has gamer names and a leaderboard. Until it's connected to a database, every player only sees their own
scores on their own phone or computer. To let everyone compare scores, the game needs a free online database called
**Supabase**. You set it up once, which takes about 10 minutes.

## 1. Create the free database
1. Go to **https://supabase.com** and click **Start your project**. Sign in with your GitHub account (the easiest way).
2. Click **New project**.
   - Name: `FaithDash`
   - Database password: click **Generate a password** and save it somewhere safe. The game doesn't need it, but you
     will need it if you ever manage the database.
   - Region: pick the one closest to you, for example *East US*.
   - Click **Create new project**, then wait about 2 minutes while it gets set up.

## 2. Add the leaderboard tables
1. In the left menu, click **SQL Editor**, then **New query**.
2. Open this file on GitHub:
   https://github.com/nhernandez601/FaithDash/blob/main/supabase/leaderboard.sql
   Click the **Copy raw file** button (two overlapping squares, top right of the file).
3. Paste it into the SQL Editor and click **Run**. It should say **Success. No rows returned**.
4. Do the same with **supabase/badwords.sql** (the gamer-name filter).

## 3. Get the two connection values
1. In the left menu, click **Project Settings** (the gear), then **Data API** (it may be called **API**).
2. Copy the **Project URL**. It looks like `https://abcdefghijkl.supabase.co`.
3. Go to **API Keys** and copy the **anon public** key, or the **Publishable key** if that's what you see.
   **Do not** copy the `service_role` or **Secret** key. That one must stay private.

## 4. Send them to Claude
Paste both values into the chat. They're safe to share, because the public key can only call the 4 leaderboard
functions, and those check every name and score. Claude puts them into `src/online/config.js` and publishes the game.

## Good to know
- **Free plan:** if nobody plays for 7 days in a row, Supabase pauses the project. You'll get an email; open the
  project and click **Restore**. No data is lost.
- **Cheating:** the server only accepts a score for a run it saw start, and only if the score was possible in the time
  that passed. A determined cheater could still fake a believable score. To remove one, open the **SQL Editor** and run:
  `update fd_scores set hidden = true where id = 123;` (find the id under **Table Editor** -> `fd_scores`).
- **Bad names:** names are filtered in the game AND in the database (numbers for letters, spaced-out letters, repeated
  letters and look-alikes are decoded first). To block one more word straight away:
  `insert into fd_bad_words values ('word', 'part');` (anywhere in a name) or `'word'` instead of `'part'` (whole word only).
  Tell Claude too, so the game's own list (src/online/names.js) matches. To ban a player run
  `update fd_players set banned = true where name = 'TheName';`
