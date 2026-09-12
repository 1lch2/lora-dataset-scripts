import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import launch_webui as launcher


class LauncherTests(unittest.TestCase):
    def test_reuses_ready_forge(self):
        with patch.object(launcher, 'forge_ready', return_value=True), patch.object(launcher.subprocess, 'Popen') as start:
            launcher.ensure_forge('http://127.0.0.1:7860', Path('unused'), 10)
        start.assert_not_called()

    def test_starts_visible_console_and_waits_for_api(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'webui.bat').write_text('@echo off\n')
            with patch.object(launcher, 'forge_ready', side_effect=[False, True]), \
                    patch.object(launcher, 'listening', return_value=False), \
                    patch.object(launcher.subprocess, 'Popen') as start:
                launcher.ensure_forge('http://127.0.0.1:7860', directory, 10)
            self.assertEqual(start.call_args.kwargs['creationflags'], launcher.subprocess.CREATE_NEW_CONSOLE)
            self.assertIn('--forge-console', start.call_args.args[0])
            self.assertIn(str(directory), start.call_args.args[0])

    def test_occupied_port_never_starts_second_forge(self):
        with patch.object(launcher, 'forge_ready', return_value=False), \
                patch.object(launcher, 'listening', return_value=True), \
                patch.object(launcher.time, 'monotonic', side_effect=[0, 20]), \
                patch.object(launcher.subprocess, 'Popen') as start:
            with self.assertRaisesRegex(ValueError, '超时'):
                launcher.ensure_forge('http://127.0.0.1:7860', Path('unused'), 10)
        start.assert_not_called()

    def test_console_preserves_arguments_and_adds_api(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'webui.bat').write_text('@echo off\n')
            user = directory / 'webui-user.bat'
            original = 'set COMMANDLINE_ARGS=--foo "a b"\ncall webui.bat\n'
            user.write_text(original)
            self.assertEqual(launcher.forge_arguments(directory), '--foo "a b"')
            with patch.object(launcher.subprocess, 'call', return_value=0) as call, patch('builtins.input'):
                launcher.forge_console(directory, 7860)
            self.assertEqual(call.call_args.kwargs['env']['COMMANDLINE_ARGS'], '--foo "a b" --api --port 7860')
            self.assertEqual(call.call_args.kwargs['cwd'], directory)
            self.assertEqual(user.read_text(), original)
            user.write_text('set "COMMANDLINE_ARGS=--xformers"\n')
            self.assertEqual(launcher.forge_arguments(directory), '--xformers')

    def test_remote_unavailable_does_not_launch_local_forge(self):
        with patch.object(launcher, 'forge_ready', return_value=False), patch.object(launcher.subprocess, 'Popen') as start:
            with self.assertRaisesRegex(ValueError, '远程'):
                launcher.ensure_forge('https://example.com', Path('unused'), 10)
        start.assert_not_called()


if __name__ == '__main__':
    unittest.main()
