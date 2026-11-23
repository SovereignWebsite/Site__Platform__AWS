"""python3 -m unittest docs/swarm/test_extract.py"""
import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))
import extract


class Test_Extract(unittest.TestCase):
    def test_names(self):
        self.assertEqual(extract.short('swarm.aws.a@SovereignWebsite.dinis'), 'swarm.aws.a')
        self.assertEqual(extract.account('swarm.aws.a@SovereignWebsite.dinis'), 'a')
        self.assertEqual(extract.iso_minute('2026-11-23T03:34:48+00:00'), '2026-11-23T03:34Z')

    def test_message_line(self):
        m = extract.MESSAGE.match('aws.c -> s3.aws.c twin news')
        self.assertEqual(m.groups(), ('aws.c', 's3.aws.c', 'twin news'))

    def test_deterministic_and_public_only(self):
        runs = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as d:
                extract.main(['--out', d])
                runs.append(open(os.path.join(d, 'events.jsonl'), 'rb').read() + open(os.path.join(d, 'agents.json'), 'rb').read())
        self.assertEqual(runs[0], runs[1])
        allowed = {'t', 'kind', 'agent', 'to', 'what', 'ref', 'refs', 'signed', 'source'}
        for line in runs[0].split(b'\n'):
            if line.startswith(b'{"'):
                self.assertTrue(set(json.loads(line)) <= allowed)


if __name__ == '__main__':
    unittest.main()
