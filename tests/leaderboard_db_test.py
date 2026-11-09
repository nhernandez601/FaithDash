"""Backend tests for supabase/schema.sql against a REAL PostgreSQL 16 (not a mock).
Every call is made as the `anon` role through the public RPC functions, exactly like a browser would.
Usage: python3 tests/leaderboard_db_test.py   (expects postgres on /tmp:54329 with roles anon/authenticated)
"""
import json, sys, os, uuid, psycopg2
VERBOSE = bool(os.environ.get('VERBOSE'))

DSN = "host=/tmp port=54329 user=pgtest dbname=postgres"
admin = psycopg2.connect(DSN); admin.autocommit = True
ac = admin.cursor()

LV = {1: dict(speed=9, length=675, coins=5), 2: dict(speed=10.5, length=900, coins=7), 3: dict(speed=12, length=1170, coins=9)}
passed = failed = 0
def t(name, ok, detail=""):
    global passed, failed
    if ok: passed += 1; print("PASS -", name)
    else: failed += 1; print("FAIL -", name, detail)

def anon():
    c = psycopg2.connect(DSN); c.autocommit = True
    cur = c.cursor(); cur.execute("set role anon"); return c, cur
ac_anon, an = anon()

def rpc(fn, *args):
    """call as anon; returns (ok, value_or_message)"""
    try:
        ph = ",".join(["%s"] * len(args))
        an.execute(f"select public.{fn}({ph})", args)
        v = an.fetchone()[0]
        return True, v
    except psycopg2.Error as e:
        return False, str(e).strip().split("\n")[0]

def reset():
    ac.execute("truncate public.reports, public.game_runs, public.run_sessions, public.players cascade")

def start(pid, lvl, age=300):
    ok, v = rpc("fd_start_run", pid, lvl)
    assert ok, v
    tok = v["token"]
    ac.execute("update public.run_sessions set started_at = now() - make_interval(secs => %s) where token = %s", (age, tok))
    return tok

def run_payload(pid, lvl, tok, score=None, name="Tester", status="game_over", **kw):
    L = LV[lvl]
    dist = kw.pop("dist", None)
    if score is None: score = 40.0
    if dist is None: dist = round(L["length"] * score / 100, 1)
    p = dict(player_id=pid, run_id=str(uuid.uuid4()), session_token=tok, level_id=lvl, display_name=name,
             score=score, progress_percent=score, furthest_distance=dist,
             active_play_time=round(dist / L["speed"] * 1.2 + 1, 2), correct_answers=1, incorrect_answers=1,
             coins_collected=2, lives_remaining=0, completion_status=status)
    p.update(kw); return p

def submit(pid, lvl, **kw):
    tok = start(pid, lvl, kw.pop("age", 300))
    p = run_payload(pid, lvl, tok, **kw)
    ok, v = rpc("fd_submit_run", json.dumps(p))
    return ok, v, p

# ---------------------------------------------------------------- tests
reset()
# direct table access must be impossible
for tbl in ["game_runs", "players", "run_sessions", "reports", "levels"]:
    try:
        an.execute(f"select * from public.{tbl} limit 1"); t(f"anon cannot SELECT {tbl}", False, "allowed")
    except psycopg2.Error as e: t(f"anon cannot SELECT {tbl}", "permission denied" in str(e))
try:
    an.execute("insert into public.game_runs (run_id) values (gen_random_uuid())"); t("anon cannot INSERT game_runs", False)
except psycopg2.Error as e: t("anon cannot INSERT game_runs", "permission denied" in str(e))
try:
    an.execute("update public.players set banned=false"); t("anon cannot UPDATE players", False)
except psycopg2.Error as e: t("anon cannot UPDATE players", "permission denied" in str(e))
for fn in ["fd_clean_name('x')", "fd_overall_rank(gen_random_uuid())"]:
    try:
        an.execute(f"select public.{fn}"); t(f"internal helper {fn.split('(')[0]} not callable by anon", False)
    except psycopg2.Error as e: t(f"internal helper {fn.split('(')[0]} not callable by anon", "permission denied" in str(e))

# valid submission
A = str(uuid.uuid4())
ok, v, p = submit(A, 1, score=42.5, name="Alice")
t("valid run accepted", ok and v["ok"] and v["is_personal_best"] and v["level_rank"] == 1, v)
t("overall rank returned", ok and v["overall_rank"] == 1, v)

# duplicate run id
tok2 = start(A, 1); p2 = dict(p); p2["session_token"] = tok2
ok, v = rpc("fd_submit_run", json.dumps(p2))
t("duplicate run_id rejected", (not ok) and "duplicate" in v, v)
# reused session token
p3 = dict(p); p3["run_id"] = str(uuid.uuid4())
ok, v = rpc("fd_submit_run", json.dumps(p3))
t("reused session token rejected", (not ok) and "bad_session" in v, v)
# missing session
p4 = dict(p); p4["run_id"] = str(uuid.uuid4()); p4["session_token"] = None
ok, v = rpc("fd_submit_run", json.dumps(p4))
t("run without a server-issued session rejected", (not ok) and "bad_session" in v, v)
# session for other player / level
B = str(uuid.uuid4())
tokB = start(B, 2)
pq = run_payload(A, 2, tokB)
ok, v = rpc("fd_submit_run", json.dumps(pq)); t("session belonging to another player rejected", (not ok) and "bad_session" in v, v)
tokL = start(A, 2); pl = run_payload(A, 1, tokL)
ok, v = rpc("fd_submit_run", json.dumps(pl)); t("session for a different level rejected", (not ok) and "bad_session" in v, v)

import re
def bad(name, mutate, expect, lvl=1, who=None, **kw):
    who = who or A
    tok = start(who, lvl, kw.pop("age", 300))
    p = run_payload(who, lvl, tok, **kw); mutate(p)
    ok, v = rpc("fd_submit_run", json.dumps(p))
    if VERBOSE: print("      ->", v)
    t(name, (not ok) and re.search(expect, str(v)) is not None, v)

bad("unknown level rejected", lambda p: p.update(level_id=9), "bad_session|invalid_run")
bad("score above 100 rejected", lambda p: p.update(score=120, progress_percent=120), "range|check|invalid")
bad("score != progress rejected", lambda p: p.update(score=50, progress_percent=30), "does not match progress")
bad("distance/percentage mismatch rejected", lambda p: p.update(furthest_distance=10), "mismatch")
bad("distance beyond level length rejected", lambda p: p.update(furthest_distance=9999), "distance range|mismatch|check")
bad("faster than level speed rejected", lambda p: p.update(active_play_time=1.0), "faster than the level speed")
bad("more play time than real elapsed time rejected", lambda p: p.update(active_play_time=5000), "more play time|time range|check")
bad("play time longer than session age rejected (age 5s, claims 60s)", lambda p: p.update(active_play_time=60), "more play time", age=5)
bad("more answers than coins rejected", lambda p: p.update(correct_answers=9, incorrect_answers=9, coins_collected=9), "trivia counts")
bad("answers exceeding collected coins rejected", lambda p: p.update(correct_answers=3, incorrect_answers=3, coins_collected=2), "trivia counts")
bad("negative answers rejected", lambda p: p.update(correct_answers=-1), "trivia counts|check")
bad("lives > 3 rejected", lambda p: p.update(lives_remaining=4), "lives|check")
bad("game over with lives left rejected", lambda p: p.update(lives_remaining=2), "game over with lives")
bad("completion claim with progress < 100 rejected", lambda p: p.update(completion_status="completed", lives_remaining=1), "completion claim", score=80.0)
bad("completion claim without collecting all coins rejected", lambda p: p.update(completion_status="completed", lives_remaining=2, coins_collected=2, score=100, progress_percent=100, furthest_distance=675, active_play_time=100), "completion claim")
bad("unknown status rejected", lambda p: p.update(completion_status="winner"), "status|check")
bad("empty name rejected", lambda p: p.update(display_name="   "), "bad identity|name")
bad("name made only of symbols rejected", lambda p: p.update(display_name="<<>>"), "bad identity|name")

# name sanitising
C = str(uuid.uuid4())
ok, v, p = submit(C, 1, score=10.0, name="<script>alert(1)</script>Bob")
t("HTML in display name is stripped", ok, v)
ok, rows = rpc("fd_leaderboard", "1", "score", 50, C)
nm = [r["display_name"] for r in rows["rows"]]
t("stored name contains no angle brackets/quotes", all(("<" not in n and ">" not in n and "(" not in n) for n in nm) and any(n.startswith("scriptalert1") for n in nm), nm)
t("display name capped at 16 chars", all(len(n) <= 16 for n in nm), nm)

# ---------------- personal best / ranking -----------------
reset()
P = {n: str(uuid.uuid4()) for n in "ABCD"}
ok, v, _ = submit(P["A"], 1, score=50.0, name="Ann", dist=337.5, active_play_time=60.0)
t("A L1 50% accepted", ok and v["is_personal_best"], v)
ok, v, _ = submit(P["A"], 1, score=30.0, name="Ann", dist=202.5, active_play_time=40.0)
t("worse replay is NOT a personal best", ok and v["is_personal_best"] is False, v)
ok, rows = rpc("fd_leaderboard", "1", "score", 50, P["A"])
t("worse replay does not overwrite best (still 50)", rows["rows"][0]["score"] == 50, rows)
ok, v, _ = submit(P["A"], 1, score=70.0, name="Ann", dist=472.5, active_play_time=80.0)
t("better replay replaces best", ok and v["is_personal_best"], v)
ok, rows = rpc("fd_leaderboard", "1", "score", 50, P["A"])
t("exactly one row per player per level", len(rows["rows"]) == 1 and rows["rows"][0]["score"] == 70, rows)
# tie-break on time
ok, v, _ = submit(P["B"], 1, score=70.0, name="Bea", dist=472.5, active_play_time=70.0)
ok, rows = rpc("fd_leaderboard", "1", "score", 50, P["B"])
t("tie on score broken by faster active time", [r["display_name"] for r in rows["rows"]] == ["Bea", "Ann"], rows)
t("official rank & is_me flags correct", rows["rows"][0]["official_rank"] == 1 and rows["rows"][0]["is_me"] is True and rows["rows"][1]["is_me"] is False, rows)
t("me block reports caller's rank", rows["me"]["official_rank"] == 1, rows["me"])
# equal score equal time -> earlier submission wins
ok, v, _ = submit(P["C"], 1, score=70.0, name="Cy", dist=472.5, active_play_time=70.0)
ok, rows = rpc("fd_leaderboard", "1", "score", 50, P["C"])
t("full tie broken by earlier submission", [r["display_name"] for r in rows["rows"]] == ["Bea", "Cy", "Ann"], [r["display_name"] for r in rows["rows"]])

# overall = sum of best per level, replay cannot inflate
ok, v, _ = submit(P["A"], 2, score=40.0, name="Ann", dist=360.0, active_play_time=60.0)
ok, v, _ = submit(P["A"], 3, score=20.0, name="Ann", dist=234.0, active_play_time=40.0)
for _ in range(3):
    submit(P["A"], 1, score=70.0, name="Ann", dist=472.5, active_play_time=90.0)   # replays of the easy level
ok, rows = rpc("fd_leaderboard", "overall", "score", 50, P["A"])
mine = [r for r in rows["rows"] if r["is_me"]][0]
t("overall score = sum of best per level (70+40+20=130) and replaying L1 does not inflate", abs(float(mine["score"]) - 130.0) < 0.01, mine)
t("overall max is 300 (3 levels x 100)", float(mine["score"]) <= 300)

# alternative sorts
reset()
Q = {n: str(uuid.uuid4()) for n in "WXYZ"}
submit(Q["W"], 1, score=90.0, name="Wes", dist=607.5, active_play_time=120.0, correct_answers=0, incorrect_answers=3, coins_collected=3)
submit(Q["X"], 1, score=60.0, name="Xan", dist=405.0, active_play_time=70.0, correct_answers=4, incorrect_answers=0, coins_collected=4)
submit(Q["Y"], 1, score=100.0, name="Yul", dist=675.0, active_play_time=100.0, correct_answers=3, incorrect_answers=2, coins_collected=5, lives_remaining=1, status="completed")
submit(Q["Z"], 1, score=100.0, name="Zed", dist=675.0, active_play_time=85.0, correct_answers=5, incorrect_answers=0, coins_collected=5, lives_remaining=3, status="completed")
def board(scope, sort, me=None):
    ok, v = rpc("fd_leaderboard", scope, sort, 50, me); assert ok, v; return [r["display_name"] for r in v["rows"]], v
names, v = board("1", "score");     t("default sort: score desc, time asc -> Zed, Yul, Wes, Xan", names == ["Zed", "Yul", "Wes", "Xan"], names)
names, v = board("1", "distance");  t("sort by distance", names[0] in ("Yul", "Zed") and names[-1] == "Xan", names)
names, v = board("1", "time");      t("fastest completion sort lists only COMPLETED runs, fastest first", names == ["Zed", "Yul"], names)
names, v = board("1", "correct");   t("most correct answers", names[0] == "Zed" and names[1] == "Xan", names)
names, v = board("1", "accuracy");  t("highest accuracy", names[0] in ("Xan", "Zed") and names[-1] == "Wes", names)
t("official_rank is independent of the chosen sort (correct-sort order Zed,Xan,Yul,Wes keeps ranks 1,4,2,3)", [r["official_rank"] for r in board("1", "correct")[1]["rows"]] == [1, 4, 2, 3], [r["official_rank"] for r in board("1", "correct")[1]["rows"]])
ok, v = rpc("fd_leaderboard", "1", "'; drop table players; --", 50, None)
t("malicious sort value is ignored (falls back to score)", ok and v["sort"] == "score", v)
ok, v = rpc("fd_leaderboard", "9", "score", 50, None)
t("unknown scope does not return data", (not ok) or v["rows"] == [], v)
ok, v = rpc("fd_leaderboard", "1", "score", 100000, None)
t("limit is capped (<=200)", ok and len(v["rows"]) <= 200)
reset()
ok, v = rpc("fd_leaderboard", "overall", "score", 50, None)
t("empty leaderboard returns an empty list (no error)", ok and v["rows"] == [], v)

# two players, same display name => separate records
E1, E2 = str(uuid.uuid4()), str(uuid.uuid4())
submit(E1, 1, score=33.0, name="Sam", dist=222.8, active_play_time=40.0)
submit(E2, 1, score=44.0, name="Sam", dist=297.0, active_play_time=50.0)
ok, v = rpc("fd_leaderboard", "1", "score", 50, None)
t("two players with identical display names keep separate records", len(v["rows"]) == 2 and [float(r["score"]) for r in v["rows"]] == [44.0, 33.0], v)

# rename propagates
ok, r = rpc("fd_set_display_name", E1, "Samuel")
ok, v = rpc("fd_leaderboard", "1", "score", 50, E1)
t("renaming updates the public name", "Samuel" in [r["display_name"] for r in v["rows"]], v)
ok, r = rpc("fd_set_display_name", E1, "<<<>>>")
t("renaming to an empty/invalid name rejected", not ok, r)

# moderation: hidden run & banned player disappear
ac.execute("update public.game_runs set hidden = true where player_id = %s", (E2,))
ok, v = rpc("fd_leaderboard", "1", "score", 50, None)
t("hidden (moderated) scores vanish from the board", [r["display_name"] for r in v["rows"]] == ["Samuel"], v)
ac.execute("update public.players set banned = true where player_id = %s", (E1,))
ok, v = rpc("fd_leaderboard", "1", "score", 50, None)
t("banned players vanish from the board", v["rows"] == [], v)
ok, v, _ = submit(E1, 1, score=10.0, name="Sam")
t("banned players cannot submit", not ok and "blocked" in v, v)

# rate limiting
R = str(uuid.uuid4()); okc = 0; limited = False
for i in range(9):
    ok, v, _ = submit(R, 1, score=5.0 + i, name="Rapid", dist=round(6.75 * (5 + i) / 5.0 * 1, 1) if False else round(675 * (5.0 + i) / 100, 1), active_play_time=100.0)
    if ok: okc += 1
    elif "rate_limited" in str(v): limited = True
t("rapid-fire submissions are rate limited (<=6 per minute)", limited and okc <= 6, (okc, limited))
ok, v = rpc("fd_start_run", R, 1)
for _ in range(15): ok, v = rpc("fd_start_run", R, 1)
t("run-session creation is rate limited", (not ok) and "rate_limited" in str(v), v)

# reports
reset()
S_ = str(uuid.uuid4()); ok, v, p = submit(S_, 1, score=20.0, name="Rep", dist=135.0, active_play_time=30.0)
ok, r = rpc("fd_report", p["run_id"], "rude name"); t("a score can be reported", ok and r["ok"], r)
ok, r = rpc("fd_report", str(uuid.uuid4()), "x"); t("reporting an unknown run rejected", not ok, r)
ac.execute("select count(*) from public.reports"); t("report stored for moderator review", ac.fetchone()[0] == 1)

# player stats
ok, v = rpc("fd_player_stats", S_)
t("player stats returns personal bests", ok and len(v["bests"]) == 1 and v["runs"] == 1, v)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
