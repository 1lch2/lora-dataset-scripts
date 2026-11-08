import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from webui import launcher


class LauncherTests(unittest.TestCase):
    def test_occupied_port_never_starts_second_forge(self):
        with patch.object(launcher, 'forge_ready', return_value=False), \
                patch.object(launcher, 'listening', return_value=True), \
                patch.object(launcher.time, 'monotonic', side_effect=[0, 20]), \
                patch.object(launcher.subprocess, 'Popen') as start:
            with self.assertRaises(ValueError):
                launcher.ensure_forge('http://127.0.0.1:7860', Path('unused'), 10)
        start.assert_not_called()

    def test_console_preserves_arguments_and_adds_api(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'webui.bat').write_text('@echo off\n')
            user = directory / 'webui-user.bat'
            original = 'set COMMANDLINE_ARGS=--foo "a b"\ncall webui.bat\n'
            user.write_text(original)
            with patch.object(launcher.subprocess, 'call', return_value=0) as call, patch('builtins.input'):
                launcher.forge_console(directory, 7860)
            self.assertEqual(call.call_args.kwargs['env']['COMMANDLINE_ARGS'], '--foo "a b" --api --port 7860')
            self.assertEqual(user.read_text(), original)

if __name__ == '__main__':
    unittest.main()
