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


if __name__ == "__main__":
    unittest.main()
