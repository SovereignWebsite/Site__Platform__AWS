"""python3 -I -m unittest discover -s docs/swarm -p 'test_*.py'"""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import extract


class Test_Extract(unittest.TestCase):
    def test_account(self):
        self.assertEqual(extract.account("swarm.aws.a@SovereignWebsite.dinis"), "a")
        self.assertEqual(extract.account("maestro.c"), "c")
        self.assertIsNone(extract.account("unattributed"))

    def test_log_forms(self):
        ev = extract.log_events("\n".join([
            "2026-11-23T04:00Z aws.c -> s3.aws.c twin news",
            "2026-11-23T04:01Z conductor.aws.c relayed the news to architect and s3",
            "2026-11-23T04:02Z first runs reported: viz (local)",
            "not a log line"]))
        self.assertEqual([e["type"] for e in ev], ["message", "wake", "message", "message", "note"])
        self.assertEqual((ev[0]["from"], ev[0]["to"], ev[0]["topic"]), ("aws.c", "s3.aws.c", "twin news"))
        self.assertEqual([e["to"] for e in ev[2:4]], ["architect.aws.c", "s3.aws.c"])
        self.assertNotIn("agent", ev[4])                      # a summary line is nobody's wake

    def test_summary(self):
        ev = [{"t": f"2026-11-23T03:22:{s:02d}Z", "type": "spawn", "from": "c.aws.c", "to": f"x{s}.aws.c"} for s in (0, 10, 20)]
        ev += [{"t": "2026-11-23T03:30Z", "type": "commit", "agent": "x0.aws.c", "signed": True, "branch": "dev"},
               {"t": "2026-11-23T03:40:00Z", "type": "commit", "agent": "x0.aws.a", "signed": False, "branch": "work/x0.aws.a"},
               {"t": "2026-11-23T03:40:00Z", "type": "move", "from": "x0.aws.c", "to": "x0.aws.a"}]
        s = extract.summary({"x0.aws.c": {}, "x0.aws.a": {}, "maestro.c": {}}, ev)
        self.assertEqual(s["spawn_burst"], {"agents": 3, "from": "2026-11-23T03:22:00Z", "to": "2026-11-23T03:22:20Z", "seconds": 20})
        self.assertEqual((s["commits"], s["signed"], s["commits_on_dev"], s["moves_to_account_a"]), (2, 1, 1, 1))
        self.assertEqual(s["agents_by_account"], {"a": 1, "c": 2})


if __name__ == "__main__":
    unittest.main()
