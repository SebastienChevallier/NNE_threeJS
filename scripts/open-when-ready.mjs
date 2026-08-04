#!/usr/bin/env node
// Waits for the editor server and the Vite dev server to answer, then opens
// the editor in the default browser.
//
// A plain node script rather than shell operators (`&&`, subshells) in the
// package.json script: those are spelled differently enough between cmd.exe
// and a POSIX shell that "works on my machine" is a real risk here, and this
// is exactly the script a Windows user double-clicks to get started.
import waitOn from 'wait-on';
import open from 'open';

const EDITOR_URL = 'http://127.0.0.1:5173';
const API_URL = 'http://127.0.0.1:5174/api/project';

try {
  await waitOn({ resources: [API_URL, EDITOR_URL], timeout: 30_000 });
  await open(EDITOR_URL);
} catch {
  // Not fatal: the servers are still up, the URL is printed either way, and a
  // headless environment or an unsupported platform is not an error state.
  console.log(`Ouvre ${EDITOR_URL} dans ton navigateur.`);
}
