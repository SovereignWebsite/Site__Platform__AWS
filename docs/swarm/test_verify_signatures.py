"""python3 -I -m unittest discover -s docs/swarm -p 'test_*.py'"""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from verify_signatures import trusted_label


class Test_Trusted_Label(unittest.TestCase):
    """security.aws.a 23 Nov 20:31: a bundle must not be able to name another agent."""
    def test_dev_needs_matching_file_name(self):
        self.assertTrue(trusted_label("origin/dev", "pm.aws.a.json", "pm.aws.a@SovereignWebsite.dinis"))
        self.assertFalse(trusted_label("origin/dev", "swarm.aws.a.json", "pm.aws.a@SovereignWebsite.dinis"))

    def test_work_branch_only_its_owner(self):
        self.assertTrue(trusted_label("origin/work/viz.aws.a", "viz.aws.a.json", "viz.aws.a@SovereignWebsite.dinis"))
        self.assertFalse(trusted_label("origin/work/viz.aws.a", "pm.aws.a.json", "pm.aws.a@SovereignWebsite.dinis"))
        self.assertFalse(trusted_label("origin/work/viz.aws.a", "viz.aws.a.json", "pm.aws.a@SovereignWebsite.dinis"))

    def test_not_json(self):
        self.assertFalse(trusted_label("origin/dev", "pm.aws.a.txt", "pm.aws.a"))


if __name__ == "__main__":
    unittest.main()
